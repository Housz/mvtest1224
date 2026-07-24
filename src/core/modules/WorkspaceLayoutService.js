import { createDockview } from 'dockview';
import { normalizeContributionLayout, layoutRoleForElement } from './ContributionLayoutPolicy.js';
import { LayoutStateStore, previewViewportClass } from './LayoutStateStore.js';
import { PanelContentHost } from './PanelContentHost.js';
import { DockingPolicy, EDGE_POSITIONS } from './DockingPolicy.js';
import { DockingCompassOverlay } from './DockingCompassOverlay.js';
import { DockingDragController } from './DockingDragController.js';
import { createLucideIcon } from '../../ui/LucideIcons.js';

const SCENE_ANCHOR_ID = 'minevis:scene-anchor';
const LAYOUT_VERSION = 5;

const EDGE_CONFIG = Object.freeze({
  left: { initialSize: 288, minimumSize: 220, ratio: 0.32 },
  right: { initialSize: 288, minimumSize: 220, ratio: 0.32 },
  top: { initialSize: 220, minimumSize: 140, ratio: 0.32 },
  bottom: { initialSize: 250, minimumSize: 160, ratio: 0.38 }
});

const scheduleFrame = (callback) => (
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 0)
);

const cancelFrame = (handle) => {
  if (!handle) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function disposeSubscription(subscription) {
  if (typeof subscription === 'function') subscription();
  else subscription?.dispose?.();
}

class WorkspaceContentRenderer {
  constructor(service, id) {
    this.service = service;
    this.id = id;
    this.element = document.createElement('div');
    this.element.className = 'minevis-dock-content';
  }

  init(params) {
    this.params = params;
    this.service.mountRenderer(this.id, this.element, params);
  }

  onShow() {
    this.service.setRecordActive(this.id, true);
    this.service.requestRecordResize(this.id);
  }

  onHide() {
    this.service.setRecordActive(this.id, false);
  }

  layout() {
    this.service.requestRecordResize(this.id);
  }

  dispose() {
    this.service.unmountRenderer(this.id, this.element);
  }
}

class WorkspaceTabRenderer {
  constructor(service, id) {
    this.service = service;
    this.id = id;
    this.element = document.createElement('div');
    this.element.className = 'minevis-dock-tab';
  }

  init(params) {
    this.params = params;
    const title = document.createElement('span');
    title.className = 'minevis-dock-tab-title';
    const actions = document.createElement('span');
    actions.className = 'minevis-dock-tab-actions';

    const makeAction = (action, label, icon) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.appendChild(createLucideIcon(icon));
      actions.appendChild(button);
    };

    makeAction('pin', 'Pin contribution', 'pin');
    makeAction('autohide', 'Auto-hide panel', 'panel-right');
    makeAction('maximize', 'Maximize panel', 'maximize-2');
    makeAction('close', 'Close panel', 'x');
    this.element.append(title, actions);

    this.element.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) {
        event.stopPropagation();
        return;
      }
      this.service.startPanelDrag(this.id, event);
    });
    this.element.addEventListener('click', (event) => {
      const action = event.target.closest('button')?.dataset.action;
      if (!action) {
        if (!this.service.dragController?.shouldSuppressClick()) {
          this.service.activateRecordFromTab(this.id);
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (action === 'pin') this.service.togglePinned(this.id);
      if (action === 'autohide') this.service.autoHideRecord(this.id);
      if (action === 'maximize') this.service.toggleMaximize(this.id);
      if (action === 'close') this.service.closeRecord(this.id);
    });
    this.element.addEventListener('dblclick', (event) => {
      if (event.target.closest('button')) return;
      event.preventDefault();
      this.service.toggleMaximize(this.id);
    });
    this.unsubscribe = this.service.subscribeRecord(this.id, () => this.render());
    this.render();
  }

  render() {
    const record = this.service.getRecord(this.id);
    const title = record?.title || this.params?.title || this.id;
    this.element.querySelector('.minevis-dock-tab-title').textContent = title;
    const pin = this.element.querySelector('[data-action="pin"]');
    const close = this.element.querySelector('[data-action="close"]');
    const autoHide = this.element.querySelector('[data-action="autohide"]');
    const maximize = this.element.querySelector('[data-action="maximize"]');
    const canPin = Boolean(record?.item && record.item.composition?.canPin !== false);
    pin.hidden = !canPin;
    pin.classList.toggle('active', Boolean(record?.item?.pinned));
    pin.title = record?.item?.pinned ? 'Unpin contribution' : 'Pin contribution';
    autoHide.hidden = record?.layout?.zone !== 'tool' || record?.layout?.dockable === false;
    maximize.hidden = record?.layout?.maximizable === false || record?.dockPanel?.api?.location?.type === 'floating';
    close.hidden = record?.layout?.closable === false;
    this.element.classList.toggle('minevis-main-scene-tab', Boolean(record?.layout?.documentRoot));
  }

  dispose() {
    this.unsubscribe?.();
  }
}

export class WorkspaceLayoutService {
  constructor({
    container,
    stagingElement,
    contributionManager,
    mainViewElement = null,
    mainViewResize = null,
    stateStore = new LayoutStateStore('minevis.preview.layout.v5'),
    scope = {},
    onLayoutChange = null
  }) {
    this.container = container;
    this.stagingElement = stagingElement;
    this.contributionManager = contributionManager;
    this.mainViewElement = mainViewElement;
    this.mainViewResize = mainViewResize;
    this.stateStore = stateStore;
    this.scope = { ...scope, viewportClass: scope.viewportClass || previewViewportClass() };
    this.onLayoutChange = onLayoutChange;
    this.records = new Map();
    this.recordListeners = new Map();
    this.layoutListeners = new Set();
    this.regionGroups = new Map();
    this.autoHideRails = new Map();
    this.removingPanelIds = new Set();
    this.transactionDepth = 0;
    this.transactionSnapshot = null;
    this.recovering = false;
    this.sceneFocus = false;
    this.sceneFocusEdgeState = null;
    this.persistenceTimer = 0;
    this.contributionSyncFrame = 0;
    this.layoutFrame = 0;
    this.lifecycleFrame = 0;
    this.pendingContributionItems = null;
    this.pendingFocusFunctionId = null;
    this.systemChromeService = null;
    this.systemChromeDispose = null;
    this.suppressPersistence = false;
    this.pendingSavedState = this.stateStore.load(this.scope);
    this.diagnostics = {
      transactions: 0,
      rollbacks: 0,
      invariantFailures: 0,
      contributionSyncRequests: 0,
      contributionSyncs: 0,
      layoutReconciliations: 0,
      dockingOperations: 0
    };

    this.container.classList.add('dockview-theme-abyss', 'minevis-professional-dock');
    this.api = createDockview(container, {
      createComponent: (options) => new WorkspaceContentRenderer(this, options.id),
      createTabComponent: (options) => new WorkspaceTabRenderer(this, options.id),
      noPanelsOverlay: 'emptyGroup',
      hideBorders: true,
      defaultRenderer: 'onlyWhenVisible',
      floatingGroupBounds: 'boundedWithinViewport',
      floatingGroupDragHandle: 'tabbar',
      disableDnd: true,
      dndStrategy: 'pointer',
      keyboardNavigation: true,
      getTabContextMenuItems: ({ panel }) => this.contextMenuItemsFor(panel)
    });

    this.createAutoHideRails();
    this.createMainScenePanel();
    this.dockingPolicy = new DockingPolicy(this);
    this.dockingOverlay = new DockingCompassOverlay({
      container: this.container,
      service: this,
      policy: this.dockingPolicy
    });
    this.dragController = new DockingDragController({
      service: this,
      overlay: this.dockingOverlay,
      policy: this.dockingPolicy
    });

    this.layoutDisposers = [
      this.api.onWillMutateLayout?.(() => {}),
      this.api.onDidMutateLayout?.(() => this.handleLayoutChange()),
      this.api.onDidLayoutChange?.(() => this.handleLayoutChange()),
      this.api.onDidMovePanel?.(() => this.handleLayoutChange()),
      this.api.onDidMaximizedGroupChange?.(() => this.handleLayoutChange()),
      this.api.onDidActivePanelChange?.((event) => this.handleActivePanelChange(event)),
      this.api.onDidRemovePanel?.((event) => this.handlePanelRemoved(event?.panel || event))
    ].filter(Boolean);
    this.contributionDispose = contributionManager?.subscribe?.(
      (items) => this.scheduleContributionSync(items)
    );
  }

  isDocumentRoot(record) {
    return Boolean(record?.layout?.documentRoot);
  }

  contextMenuItemsFor(panel) {
    const record = this.records.get(panel?.id);
    if (!record) return [];
    const items = [];
    if (record.layout?.maximizable !== false && panel.api?.location?.type !== 'floating') {
      items.push({
        label: panel.api?.isMaximized?.() ? 'Restore panel' : 'Maximize panel',
        action: () => this.toggleMaximize(panel.id)
      });
    }
    if (record.item) {
      items.push({
        label: record.item?.pinned ? 'Unpin contribution' : 'Pin contribution',
        action: () => this.togglePinned(panel.id)
      });
    }
    if (this.dockingPolicy?.canDrag(record)) {
      EDGE_POSITIONS.forEach((position) => items.push({
        label: `Dock ${position[0].toUpperCase()}${position.slice(1)}`,
        action: () => this.dockRecord(record.id, position),
        disabled: !this.dockingPolicy.isCompatible({
          record,
          sourceGroup: panel.group,
          position,
          scope: 'workspace'
        })
      }));
      items.push({
        label: 'Float panel',
        action: () => this.floatRecord(panel.id),
        disabled: record.layout?.floatable === false
      });
    }
    if (record.layout?.closable !== false) {
      items.push('separator', { label: 'Close panel', action: () => this.closeRecord(panel.id) });
    }
    return items;
  }

  createMainScenePanel() {
    let record = this.records.get(SCENE_ANCHOR_ID);
    if (!record) {
      record = {
        id: SCENE_ANCHOR_ID,
        title: 'Main Scene',
        system: true,
        registered: true,
        open: true,
        active: true,
        semanticVisible: true,
        closedByUser: false,
        element: this.mainViewElement,
        layout: normalizeContributionLayout({
          semanticRole: 'primary-view',
          contributionKind: 'panel',
          layout: {
            role: 'primary-view',
            zone: 'document',
            documentRoot: true,
            preferredRegion: 'tab',
            allowedDock: ['center'],
            minSize: { width: 320, height: 220 },
            dockable: false,
            floatable: false,
            closable: false,
            maximizable: true,
            priority: 10000,
            content: { profile: 'scene', padding: 'none', overflow: 'hidden' }
          }
        }),
        resize: (size) => this.mainViewResize?.(size)
      };
      record.panelHost = this.createPanelHost(record);
      this.records.set(record.id, record);
    } else {
      record.element = this.mainViewElement || record.element;
      record.resize = (size) => this.mainViewResize?.(size);
      record.panelHost?.update({ element: record.element, onResize: record.resize, content: record.layout.content });
      record.registered = true;
      record.open = true;
      record.semanticVisible = true;
    }
    const existing = this.api.getPanel?.(SCENE_ANCHOR_ID);
    if (existing) {
      record.dockPanel = existing;
      this.markGroupProfiles();
      return existing;
    }
    const panel = this.api.addPanel({
      id: SCENE_ANCHOR_ID,
      component: 'minevis-workspace-panel',
      tabComponent: 'minevis-workspace-tab',
      title: 'Main Scene',
      renderer: 'onlyWhenVisible',
      minimumWidth: 320,
      minimumHeight: 220
    });
    record.dockPanel = panel;
    panel.api?.setActive?.();
    this.markGroupProfiles();
    return panel;
  }

  createPanelHost(record) {
    return new PanelContentHost({
      id: record.id,
      element: record.element,
      stagingElement: this.stagingElement,
      onResize: record.resize,
      content: record.layout?.content
    });
  }

  setMainViewResize(callback) {
    this.mainViewResize = callback;
    const record = this.records.get(SCENE_ANCHOR_ID);
    if (!record) return;
    record.resize = (size) => this.mainViewResize?.(size);
    record.panelHost?.update({ onResize: record.resize, content: record.layout.content });
    this.requestRecordResize(record.id);
  }


  setSystemChromeService(service) {
    this.systemChromeDispose?.();
    this.systemChromeService = service || null;
    this.systemChromeDispose = null;
    if (!service?.subscribe) return;
    let initialized = false;
    this.systemChromeDispose = service.subscribe(() => {
      if (!initialized) {
        initialized = true;
        return;
      }
      if (this.suppressPersistence || this.recovering) return;
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = setTimeout(() => this.saveLayout(), 180);
    });
  }
  createAutoHideRails() {
    ['left', 'right', 'top', 'bottom'].forEach((position) => {
      const rail = document.createElement('div');
      rail.className = `workspace-auto-hide-rail workspace-auto-hide-rail-${position}`;
      rail.dataset.region = position;
      rail.setAttribute('aria-label', `${position} auto-hidden panels`);
      rail.hidden = true;
      this.container.appendChild(rail);
      this.autoHideRails.set(position, rail);
    });
  }

  defaultAutoHide(record) {
    if (record?.layout?.autoHide) return true;
    if (this.scope.viewportClass !== 'compact') return false;
    return record?.layout?.zone === 'tool' && record?.layout?.role !== 'control';
  }

  autoHideRegion(record) {
    const location = record?.dockPanel?.api?.location;
    if (location?.type === 'edge') return location.position;
    const preferred = record?.layout?.preferredRegion;
    return EDGE_POSITIONS.includes(preferred) ? preferred : 'right';
  }

  renderAutoHideRails() {
    this.autoHideRails.forEach((rail) => rail.replaceChildren());
    [...this.records.values()]
      .filter((record) => !this.isDocumentRoot(record) && record.autoHidden && record.semanticVisible && record.open)
      .sort((left, right) => (right.layout?.priority || 0) - (left.layout?.priority || 0))
      .forEach((record) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'workspace-auto-hide-tab';
        button.textContent = record.title || 'Panel';
        button.title = `Restore ${record.title || 'panel'}`;
        button.addEventListener('click', () => this.showAutoHidden(record.id));
        this.autoHideRails.get(this.autoHideRegion(record))?.appendChild(button);
      });
    this.autoHideRails.forEach((rail) => { rail.hidden = !rail.childElementCount; });
  }

  getRecord(id) {
    return this.records.get(id) || null;
  }

  getWorkspaceBounds() {
    const rect = this.container.getBoundingClientRect();
    return { x: 0, y: 0, width: rect.width, height: rect.height };
  }

  getGroupBounds(group) {
    const box = group?.api?.boundingBox;
    if (box && Number.isFinite(box.width) && Number.isFinite(box.height)) return { ...box };
    const element = group?.element;
    if (!element?.isConnected) return null;
    const workspace = this.container.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left - workspace.left,
      y: rect.top - workspace.top,
      width: rect.width,
      height: rect.height
    };
  }

  getDocumentRootPanel() {
    return this.api.getPanel?.(SCENE_ANCHOR_ID) || null;
  }

  getMainViewBounds() {
    return this.getGroupBounds(this.getDocumentRootPanel()?.group);
  }

  groupForElement(element) {
    if (!element) return null;
    return (this.api.groups || []).find((group) => group.element === element) || null;
  }

  recordForGroup(group) {
    if (!group) return null;
    const activeId = group.activePanel?.id || group.panels?.[0]?.id;
    return activeId ? this.records.get(activeId) || null : null;
  }

  groupAtPoint(clientX, clientY) {
    const source = this.dragController?.drag?.group?.element?.closest?.('.dv-resize-container');
    const previous = source?.style?.pointerEvents;
    if (source) source.style.pointerEvents = 'none';
    const element = document.elementFromPoint(clientX, clientY);
    if (source) source.style.pointerEvents = previous || '';
    return this.groupForElement(element?.closest?.('.dv-groupview'));
  }

  edgeGroup(position) {
    const edgeApi = this.api.getEdgeGroup?.(position);
    return edgeApi ? this.api.getGroup?.(edgeApi.id) || null : null;
  }

  ensureEdgeGroup(position) {
    const existing = this.edgeGroup(position);
    if (existing) {
      this.api.setEdgeGroupVisible?.(position, true);
      existing.api?.expand?.();
      return existing;
    }
    const workspace = this.getWorkspaceBounds();
    const config = EDGE_CONFIG[position];
    const axisSize = ['left', 'right'].includes(position) ? workspace.width : workspace.height;
    const maximumSize = Math.max(config.minimumSize, Math.floor(axisSize * config.ratio));
    const edgeApi = this.api.addEdgeGroup(position, {
      id: `minevis:edge:${position}`,
      initialSize: Math.min(config.initialSize, maximumSize),
      minimumSize: config.minimumSize,
      maximumSize,
      collapsedSize: 28,
      collapsed: false
    });
    this.api.setEdgeGroupVisible?.(position, true);
    return this.api.getGroup?.(edgeApi.id) || null;
  }

  canOpenEdge(position, record, minimumShare = 0.45) {
    if (!EDGE_POSITIONS.includes(position)) return false;
    const workspace = this.getWorkspaceBounds();
    if (!workspace.width || !workspace.height) return true;
    const occupied = { left: 0, right: 0, top: 0, bottom: 0 };
    EDGE_POSITIONS.forEach((edge) => {
      const group = this.edgeGroup(edge);
      if (!group || !(group.panels || []).length || group.api?.isCollapsed?.()) return;
      const box = this.getGroupBounds(group);
      if (box) occupied[edge] = ['left', 'right'].includes(edge) ? box.width : box.height;
    });
    if (!this.edgeGroup(position)) {
      const preferred = record?.layout?.preferredSize || {};
      occupied[position] = ['left', 'right'].includes(position)
        ? clamp(Number(preferred.width) || 288, 180, workspace.width * 0.32)
        : clamp(Number(preferred.height) || 220, 140, workspace.height * 0.38);
    }
    const width = Math.max(0, workspace.width - occupied.left - occupied.right);
    const height = Math.max(0, workspace.height - occupied.top - occupied.bottom);
    return (width * height) / (workspace.width * workspace.height) >= minimumShare;
  }

  canSplitDocument(_position, record, minimumShare = 0.45) {
    const workspace = this.getWorkspaceBounds();
    const minimum = record?.layout?.minSize || {};
    if (!workspace.width || !workspace.height) return true;
    const remainingWidth = Math.max(320, workspace.width - (Number(minimum.width) || 0));
    const remainingHeight = Math.max(220, workspace.height - (Number(minimum.height) || 0));
    return Math.max(remainingWidth / workspace.width, remainingHeight / workspace.height) >= minimumShare;
  }

  moveSourceToEdge(source, position) {
    if (!source || !EDGE_POSITIONS.includes(position)) return false;
    const target = this.ensureEdgeGroup(position);
    if (!target) return false;
    source.api.moveTo({ group: target, position: 'center' });
    target.api?.expand?.();
    (target.panels || []).forEach((panel) => {
      const record = this.records.get(panel.id);
      if (record) record.autoHidden = false;
    });
    this.diagnostics.dockingOperations += 1;
    return true;
  }

  moveSourceToDocumentEdge(source, position) {
    const root = this.getDocumentRootPanel()?.group;
    if (!source || !root || source === root || source.group?.id === root.id) return false;
    source.api.moveTo({ group: root, position });
    this.diagnostics.dockingOperations += 1;
    return true;
  }

  floatDragAtPointer(drag, event) {
    const workspace = this.getWorkspaceBounds();
    const workspaceRect = this.container.getBoundingClientRect();
    const preferred = drag.record.layout?.preferredSize || {};
    const current = drag.initialFloatingBounds || this.getGroupBounds(drag.group) || {};
    const width = clamp(current.width || preferred.width || 360, 220, Math.max(220, workspace.width * 0.72));
    const height = clamp(current.height || preferred.height || 300, 150, Math.max(150, workspace.height * 0.72));
    const offset = drag.pointerOffset || { x: 28, y: 14 };
    const x = clamp(event.clientX - workspaceRect.left - offset.x, 0, Math.max(0, workspace.width - width));
    const y = clamp(event.clientY - workspaceRect.top - offset.y, 0, Math.max(0, workspace.height - height));
    const source = drag.source === 'panel' ? drag.panel : drag.group;
    if (!source) return false;
    this.api.addFloatingGroup(source, { x, y, width, height, dragHandle: 'tabbar' });
    this.diagnostics.dockingOperations += 1;
    return true;
  }

  transaction(command, callback, { validate = true } = {}) {
    const outermost = this.transactionDepth === 0;
    if (outermost) this.transactionSnapshot = this.captureLayoutSnapshot();
    this.transactionDepth += 1;
    let result;
    try {
      result = callback();
    } catch (error) {
      if (outermost) this.restoreTransactionSnapshot(error);
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
    if (!outermost) return result;
    this.diagnostics.transactions += 1;
    this.cleanupEmptyEdgeGroups();
    this.reconcilePanelRecords();
    const validation = validate ? this.validateLayout() : { valid: true, errors: [] };
    if (!validation.valid) {
      this.diagnostics.invariantFailures += 1;
      this.restoreTransactionSnapshot(new Error(`${command}: ${validation.errors.join(' ')}`));
      return false;
    }
    this.transactionSnapshot = null;
    this.handleLayoutChange();
    return result ?? true;
  }

  captureLayoutSnapshot() {
    try {
      return {
        dockview: this.api.toJSON(),
        records: new Map([...this.records].map(([id, record]) => [id, {
          open: record.open,
          semanticVisible: record.semanticVisible,
          closedByUser: record.closedByUser,
          autoHidden: record.autoHidden,
          lastPlacement: record.lastPlacement ? structuredClone(record.lastPlacement) : null
        }]))
      };
    } catch {
      return null;
    }
  }

  restoreTransactionSnapshot(error) {
    const snapshot = this.transactionSnapshot;
    this.transactionSnapshot = null;
    this.diagnostics.rollbacks += 1;
    console.warn('[MineVis layout] Rolling back an invalid layout transaction.', error);
    if (!snapshot?.dockview) {
      this.resetLayout({ clearSaved: false });
      return;
    }
    this.recovering = true;
    this.suppressPersistence = true;
    try {
      snapshot.records.forEach((state, id) => Object.assign(this.records.get(id) || {}, state));
      this.api.fromJSON(snapshot.dockview, { reuseExistingPanels: true });
      this.reconcilePanelRecords();
    } catch (restoreError) {
      console.warn('[MineVis layout] Snapshot restore failed; using canonical layout.', restoreError);
      this.resetLayout({ clearSaved: false });
    } finally {
      this.recovering = false;
      this.suppressPersistence = false;
    }
  }

  cleanupEmptyEdgeGroups() {
    EDGE_POSITIONS.forEach((position) => {
      const group = this.edgeGroup(position);
      if (!group || (group.panels || []).length) return;
      try {
        this.api.removeEdgeGroup(position);
      } catch {
        // A nested Dockview mutation may already have removed it.
      }
    });
  }

  validateLayout() {
    const errors = [];
    const panels = this.api.panels || [];
    const ids = panels.map((panel) => panel.id);
    if (new Set(ids).size !== ids.length) errors.push('Duplicate Dockview panel ids.');
    ids.forEach((id) => {
      const record = this.records.get(id);
      if (!record) errors.push(`Unknown Dockview panel ${id}.`);
      else if (!record.open || !record.semanticVisible) errors.push(`Closed panel ${id} remains in layout.`);
    });
    this.records.forEach((record) => {
      if (record.registered && record.open && record.semanticVisible && !ids.includes(record.id)) {
        errors.push(`Open panel ${record.id} is missing from Dockview.`);
      }
    });
    const scene = this.api.getPanel?.(SCENE_ANCHOR_ID);
    if (!scene || scene.api?.location?.type === 'floating' || scene.api?.location?.type === 'edge') {
      errors.push('Main Scene is not in the central document area.');
    }
    EDGE_POSITIONS.forEach((position) => {
      const group = this.edgeGroup(position);
      if (!group) return;
      if (!(group.panels || []).length) errors.push(`Empty ${position} Edge Group.`);
      (group.panels || []).forEach((panel) => {
        if (this.records.get(panel.id)?.layout?.zone !== 'tool') {
          errors.push(`Document panel ${panel.id} is in a tool Edge Group.`);
        }
      });
    });
    const workspace = this.getWorkspaceBounds();
    (this.api.groups || []).forEach((group) => {
      if (group.api?.location?.type !== 'floating') return;
      const box = this.getGroupBounds(group);
      if (!box) return;
      if (box.x < -1 || box.y < -1 || box.x + box.width > workspace.width + 1 || box.y + box.height > workspace.height + 1) {
        errors.push(`Floating group ${group.id} is outside the workspace.`);
      }
    });
    return { valid: errors.length === 0, errors };
  }

  subscribeRecord(id, listener) {
    if (!this.recordListeners.has(id)) this.recordListeners.set(id, new Set());
    this.recordListeners.get(id).add(listener);
    return () => this.recordListeners.get(id)?.delete(listener);
  }

  notifyRecord(id) {
    (this.recordListeners.get(id) || []).forEach((listener) => listener(this.records.get(id)));
  }

  subscribeLayout(listener) {
    this.layoutListeners.add(listener);
    return () => this.layoutListeners.delete(listener);
  }

  notifyLayout() {
    this.layoutListeners.forEach((listener) => listener());
    this.onLayoutChange?.();
  }

  registerSystemPanel({ id, title, element, layout = {}, visible = true, resize = null }) {
    const normalizedLayout = normalizeContributionLayout({
      semanticRole: layout.role || layoutRoleForElement(element),
      layout
    });
    const existing = this.records.get(id);
    const record = existing || { id, system: true, registered: true };
    const wasVisible = Boolean(record.semanticVisible);
    Object.assign(record, {
      title,
      element,
      layout: normalizedLayout,
      system: true,
      registered: true,
      semanticVisible: Boolean(visible),
      resize,
      destroyed: false
    });
    if (!existing) {
      record.open = Boolean(visible);
      record.closedByUser = false;
      record.autoHidden = this.defaultAutoHide(record);
      record.panelHost = this.createPanelHost(record);
    } else {
      if (!wasVisible && visible) {
        record.open = true;
        record.closedByUser = false;
      }
      if (!visible) record.open = false;
      record.panelHost?.update({ element, onResize: resize, content: record.layout.content });
    }
    this.records.set(id, record);
    this.transaction('register-system-panel', () => this.reconcileRecord(record));
    this.notifyRecord(id);
    return record;
  }

  scheduleContributionSync(items = []) {
    this.diagnostics.contributionSyncRequests += 1;
    this.pendingContributionItems = items;
    if (this.contributionSyncFrame) return;
    this.contributionSyncFrame = scheduleFrame(() => {
      this.contributionSyncFrame = 0;
      const pending = this.pendingContributionItems || [];
      this.pendingContributionItems = null;
      this.syncContributions(pending);
    });
  }

  flushContributionSync() {
    if (this.contributionSyncFrame) {
      cancelFrame(this.contributionSyncFrame);
      this.contributionSyncFrame = 0;
    }
    const pending = this.pendingContributionItems || this.contributionManager?.list?.() || [];
    this.pendingContributionItems = null;
    this.syncContributions(pending);
  }

  syncContributions(items = []) {
    this.diagnostics.contributionSyncs += 1;
    const activeIds = new Set();
    this.transaction('sync-contributions', () => {
      items.forEach((item) => {
        if (!item?.element || item.layout?.role === 'layer' || item.host === 'main-3d-scene') return;
        activeIds.add(item.id);
        const existing = this.records.get(item.id);
        const record = existing || { id: item.id, system: false, registered: true };
        const wasSemanticVisible = Boolean(record.semanticVisible);
        record.title = item.label || item.id;
        record.item = item;
        record.element = item.element;
        record.element.dataset.workspacePanelId = record.id;
        record.element.dataset.workspacePanelTitle ||= record.title || '';
        record.element.classList.add('workspace-panel-source');
        record.layout = normalizeContributionLayout(item);
        record.semanticVisible = item.visible !== false;
        record.registered = true;
        record.resize = item.resize || item.onResize || null;
        record.destroyed = false;
        if (!existing) {
          record.open = record.semanticVisible;
          record.closedByUser = false;
          record.autoHidden = this.defaultAutoHide(record);
          record.panelHost = this.createPanelHost(record);
        } else {
          if (!wasSemanticVisible && record.semanticVisible) {
            record.open = true;
            record.closedByUser = false;
          } else if (!record.semanticVisible) {
            record.open = false;
            record.closedByUser = false;
          }
          record.panelHost?.update({
            element: record.element,
            onResize: record.resize,
            content: record.layout.content
          });
        }
        this.records.set(item.id, record);
        this.reconcileRecord(record);
      });

      [...this.records.values()].forEach((record) => {
        if (record.system || activeIds.has(record.id)) return;
        this.removeRecord(record.id);
      });
    });
    this.renderAutoHideRails();
    if (this.pendingFocusFunctionId) this.focusFunction(this.pendingFocusFunctionId);
  }

  reconcileRecord(record) {
    if (!record || record.destroyed) return;
    const panel = this.api.getPanel?.(record.id) || record.dockPanel;
    record.dockPanel = panel || null;
    const shouldExist = Boolean(record.registered && record.open && record.semanticVisible);
    if (shouldExist && !record.dockPanel) this.addRecordPanel(record);
    else if (!shouldExist && record.dockPanel) this.removePanelFromLayout(record);
    this.notifyRecord(record.id);
  }

  addRecordPanel(record) {
    if (!record.element || record.destroyed) return null;
    const layout = record.layout || normalizeContributionLayout({});
    const viewportWidth = Math.max(1, this.container.clientWidth || window.innerWidth);
    const viewportHeight = Math.max(1, this.container.clientHeight || window.innerHeight);
    const preferred = layout.preferredSize || {};
    const minimum = layout.minSize || {};
    const maxRatio = layout.maxViewportRatio || {};
    const options = {
      id: record.id,
      component: 'minevis-workspace-panel',
      tabComponent: 'minevis-workspace-tab',
      title: record.title,
      renderer: 'onlyWhenVisible',
      initialWidth: preferred.width,
      initialHeight: preferred.height,
      minimumWidth: minimum.width,
      minimumHeight: minimum.height,
      maximumWidth: maxRatio.width ? Math.max(minimum.width || 1, viewportWidth * maxRatio.width) : undefined,
      maximumHeight: maxRatio.height ? Math.max(minimum.height || 1, viewportHeight * maxRatio.height) : undefined
    };

    const placement = record.lastPlacement;
    const previousGroup = placement?.groupId && this.api.getGroup?.(placement.groupId);
    if (placement?.location === 'floating' && layout.floatable !== false) {
      const box = placement.box || {};
      options.floating = {
        x: Number.isFinite(box.x) ? box.x : 48,
        y: Number.isFinite(box.y) ? box.y : 48,
        width: box.width || preferred.width || 360,
        height: box.height || preferred.height || 300
      };
    } else if (placement?.location === 'edge' && EDGE_POSITIONS.includes(placement.edge)) {
      const group = this.ensureEdgeGroup(placement.edge);
      options.position = { referenceGroup: group };
    } else if (previousGroup && (previousGroup.panels || []).length) {
      options.position = { referenceGroup: previousGroup };
    } else {
      options.position = this.defaultPositionFor(record);
    }

    try {
      record.dockPanel = this.api.addPanel(options);
      record.open = true;
      record.panelHost?.visibilityChanged(true);
      this.rememberRegionGroup(record, record.dockPanel.group);
      if (record.autoHidden && record.dockPanel.api?.location?.type === 'edge') {
        record.dockPanel.group.api?.collapse?.();
      }
      return record.dockPanel;
    } catch (error) {
      console.warn(`[MineVis layout] Failed to add panel ${record.id}.`, error);
      return null;
    }
  }

  defaultPositionFor(record) {
    const layout = record.layout || {};
    if (layout.zone === 'tool') {
      const edge = EDGE_POSITIONS.includes(layout.preferredRegion) ? layout.preferredRegion : 'right';
      return { referenceGroup: this.ensureEdgeGroup(edge) };
    }
    const groupKey = layout.tabGroup || 'document-views';
    const existing = this.validRegionGroup(groupKey);
    if (existing) return { referenceGroup: existing };
    const root = this.getDocumentRootPanel();
    if (!root) return undefined;
    const direction = layout.preferredRegion === 'top'
      ? 'above'
      : layout.preferredRegion === 'left'
        ? 'left'
        : layout.preferredRegion === 'right'
          ? 'right'
          : 'below';
    return { referencePanel: root, direction };
  }

  validRegionGroup(key) {
    const id = this.regionGroups.get(key);
    const group = id ? this.api.getGroup?.(id) : null;
    return group && (group.panels || []).length ? group : null;
  }

  rememberRegionGroup(record, group) {
    if (!group?.id || record.layout?.zone !== 'document' || record.layout?.documentRoot) return;
    const key = record.layout?.tabGroup || 'document-views';
    this.regionGroups.set(key, group.id);
  }

  capturePlacement(record) {
    const panel = this.api.getPanel?.(record.id) || record.dockPanel;
    if (!panel?.group) return;
    const location = panel.api?.location || { type: 'grid' };
    const box = this.getGroupBounds(panel.group);
    record.lastPlacement = {
      location: location.type,
      edge: location.type === 'edge' ? location.position : null,
      groupId: panel.group.id,
      tabIndex: (panel.group.panels || []).findIndex((candidate) => candidate.id === record.id),
      box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
    };
  }

  moveFocusBeforeRemoval(record) {
    if (!record?.element?.contains?.(document.activeElement)) return;
    this.container.closest('.runtime-shell')?.focus?.({ preventScroll: true });
  }

  removePanelFromLayout(record) {
    const panel = this.api.getPanel?.(record.id) || record.dockPanel;
    if (!panel) return;
    this.capturePlacement(record);
    this.moveFocusBeforeRemoval(record);
    record.panelHost?.visibilityChanged(false);
    this.removingPanelIds.add(record.id);
    record.dockPanel = null;
    try {
      this.api.removePanel(panel);
    } finally {
      this.removingPanelIds.delete(record.id);
    }
  }

  removeRecord(id) {
    const record = this.records.get(id);
    if (!record) return;
    record.destroyed = true;
    record.registered = false;
    record.open = false;
    if (this.api.getPanel?.(id) || record.dockPanel) this.removePanelFromLayout(record);
    record.panelHost?.dispose();
    this.records.delete(id);
    this.recordListeners.delete(id);
  }

  handlePanelRemoved(panel) {
    const id = panel?.id;
    if (!id) return;
    const record = this.records.get(id);
    if (!record) return;
    record.dockPanel = null;
    record.panelHost?.visibilityChanged(false);
    if (!this.removingPanelIds.has(id) && !record.destroyed && !this.recovering) {
      record.open = false;
      record.closedByUser = true;
    }
    this.handleLayoutChange();
  }

  mountRenderer(id, host, params) {
    const record = this.records.get(id);
    if (!record?.element) {
      host.innerHTML = '<div class="workspace-panel-unavailable">Panel content is not currently available.</div>';
      return;
    }
    record.dockPanel = this.api.getPanel?.(id) || record.dockPanel;
    record.panelHost?.mount(host, params);
    this.requestRecordResize(id);
    this.markGroupProfiles();
  }

  unmountRenderer(id, host) {
    this.records.get(id)?.panelHost?.unmount(host);
  }

  setRecordActive(id, active) {
    const record = this.records.get(id);
    if (!record) return;
    record.active = Boolean(active);
    if (record.active) record.panelHost?.activate();
    else record.panelHost?.deactivate();
  }

  requestRecordResize(id) {
    this.records.get(id)?.panelHost?.requestResize('api');
  }

  reconcilePanelRecords() {
    this.records.forEach((record) => {
      const panel = this.api.getPanel?.(record.id) || null;
      record.dockPanel = panel;
      if (!panel) return;
      record.location = panel.api?.location || null;
      record.open = true;
      record.panelHost?.locationChanged(record.location);
      const active = panel.group?.activePanel?.id === panel.id;
      this.setRecordActive(record.id, active);
      this.rememberRegionGroup(record, panel.group);
    });
    this.markGroupProfiles();
    this.renderAutoHideRails();
  }

  refreshPanelLifecycles() {
    if (this.lifecycleFrame) return;
    this.lifecycleFrame = scheduleFrame(() => {
      this.lifecycleFrame = 0;
      this.reconcilePanelRecords();
      this.records.forEach((record) => {
        if (record.dockPanel && record.active) this.requestRecordResize(record.id);
      });
    });
  }

  markGroupProfiles() {
    (this.api.groups || []).forEach((group) => {
      const records = (group.panels || []).map((panel) => this.records.get(panel.id)).filter(Boolean);
      const scene = records.some((record) => record.layout?.content?.profile === 'scene');
      const documentGroup = records.some((record) => record.layout?.zone === 'document');
      group.element?.classList.toggle('workspace-main-scene-group', scene);
      group.element?.classList.toggle('workspace-document-group', documentGroup);
      group.element?.classList.toggle('workspace-tool-group', !documentGroup);
    });
  }

  startPanelDrag(id, event) {
    return this.dragController?.startPanelDrag(id, event) || false;
  }

  dockRecord(id, position, targetId = null) {
    const record = this.records.get(id);
    const panel = this.api.getPanel?.(id);
    const targetPanel = targetId ? this.api.getPanel?.(targetId) : null;
    if (!record || !panel) return false;
    const scope = targetPanel ? 'group' : 'workspace';
    if (!this.dockingPolicy?.isCompatible({
      record,
      sourceGroup: panel.group,
      targetGroup: targetPanel?.group || null,
      position,
      scope
    })) return false;
    return this.transaction('dock-record', () => this.dockingPolicy.dock({
      panel,
      targetGroup: targetPanel?.group || null,
      position,
      scope
    }));
  }

  closeRecord(id) {
    const record = this.records.get(id);
    if (!record || record.layout?.closable === false) return false;
    return this.transaction('close-panel', () => {
      record.autoHidden = false;
      record.open = false;
      record.closedByUser = true;
      this.removePanelFromLayout(record);
      this.renderAutoHideRails();
      this.notifyRecord(id);
      return true;
    });
  }

  autoHideRecord(id) {
    const record = this.records.get(id);
    const panel = this.api.getPanel?.(id);
    if (!record || !panel || record.layout?.zone !== 'tool') return false;
    return this.transaction('auto-hide-panel', () => {
      const position = this.autoHideRegion(record);
      if (panel.api?.location?.type !== 'edge') this.moveSourceToEdge(panel, position);
      const group = this.edgeGroup(position) || this.api.getPanel?.(id)?.group;
      (group?.panels || []).forEach((candidate) => {
        const sibling = this.records.get(candidate.id);
        if (sibling) sibling.autoHidden = true;
      });
      record.autoHidden = true;
      group?.api?.collapse?.();
      this.renderAutoHideRails();
      return true;
    });
  }

  showAutoHidden(id) {
    const record = this.records.get(id);
    const panel = this.api.getPanel?.(id);
    if (!record || !panel) return false;
    return this.transaction('restore-auto-hidden-panel', () => {
      (panel.group?.panels || []).forEach((candidate) => {
        const sibling = this.records.get(candidate.id);
        if (sibling) sibling.autoHidden = false;
      });
      panel.group?.api?.expand?.();
      panel.api?.setActive?.();
      this.renderAutoHideRails();
      return true;
    });
  }

  togglePinned(id) {
    const record = this.records.get(id);
    if (!record?.item) return;
    this.contributionManager?.togglePinned?.(id);
    this.notifyRecord(id);
  }

  floatRecord(id, bounds = null) {
    const record = this.records.get(id);
    const panel = this.api.getPanel?.(id);
    if (!record || !panel || record.layout?.floatable === false) return false;
    const width = bounds?.width || record.layout?.preferredSize?.width || 360;
    const height = bounds?.height || record.layout?.preferredSize?.height || 300;
    return this.transaction('float-panel', () => {
      this.api.addFloatingGroup(panel, {
        x: bounds?.x ?? Math.max(24, (this.container.clientWidth - width) / 2),
        y: bounds?.y ?? Math.max(24, (this.container.clientHeight - height) / 2),
        width,
        height,
        dragHandle: 'tabbar'
      });
      this.diagnostics.dockingOperations += 1;
      return true;
    });
  }

  toggleMaximize(id) {
    const panel = this.api.getPanel?.(id);
    if (!panel || panel.api.location?.type === 'floating') return false;
    if (panel.api.isMaximized?.()) panel.api.exitMaximized?.();
    else panel.api.maximize?.();
    return true;
  }

  activatePanel(id) {
    const record = this.records.get(id);
    if (!record) return false;
    if (record.item?.visible === false) this.contributionManager?.setVisible?.(id, true);
    record.semanticVisible = true;
    record.open = true;
    record.closedByUser = false;
    record.autoHidden = false;
    this.transaction('open-panel', () => this.reconcileRecord(record));
    const panel = this.api.getPanel?.(id);
    if (!panel) return false;
    if (panel.api?.location?.type === 'edge') panel.group?.api?.expand?.();
    panel.api?.setActive?.();
    this.setRecordActive(id, true);
    record.item?.activate?.();
    return true;
  }

  isPanelRegistered(id) {
    return this.records.has(id);
  }

  isPanelOpen(id) {
    const record = this.records.get(id);
    return Boolean(record?.open && this.api.getPanel?.(id));
  }

  setSystemPanelVisible(id, visible) {
    const record = this.records.get(id);
    if (!record?.system) return;
    record.semanticVisible = Boolean(visible);
    record.open = Boolean(visible);
    if (visible) {
      record.closedByUser = false;
      record.autoHidden = false;
    }
    this.transaction('system-panel-visibility', () => this.reconcileRecord(record));
  }

  isPanelVisible(id) {
    const record = this.records.get(id);
    const panel = this.api.getPanel?.(id);
    if (!record?.open || !panel) return false;
    return panel.api?.location?.type !== 'edge' || !panel.group?.api?.isCollapsed?.();
  }

  activateRecordFromTab(id) {
    const record = this.records.get(id);
    if (!record) return false;
    const activated = this.activatePanel(id);
    if (activated && record.item?.ownerFunctionId) {
      queueMicrotask(() => {
        if (this.contributionManager?.focusedFunctionId === record.item.ownerFunctionId) return;
        this.contributionManager?.focusOwner?.(record.item.ownerFunctionId);
      });
    }
    return activated;
  }

  focusFunction(functionId) {
    if (!functionId) {
      this.pendingFocusFunctionId = null;
      return { control: null, primary: null };
    }
    const candidates = [...this.records.values()]
      .filter((record) => (
        record.item?.ownerFunctionId === functionId &&
        record.semanticVisible &&
        record.open &&
        this.api.getPanel?.(record.id)
      ))
      .sort((left, right) => {
        const score = (role) => role === 'control' ? 3 : role === 'primary-view' ? 2 : 1;
        return score(right.layout?.role) - score(left.layout?.role) ||
          (right.layout?.priority || 0) - (left.layout?.priority || 0);
      });
    if (!candidates.length) {
      this.pendingFocusFunctionId = functionId;
      return { control: null, primary: null };
    }
    this.pendingFocusFunctionId = null;
    const control = candidates.find((record) => record.layout?.role === 'control');
    const primary = candidates.find((record) => record.layout?.role === 'primary-view');
    control?.dockPanel?.api?.setActive?.();
    primary?.dockPanel?.api?.setActive?.();
    return { control: control || null, primary: primary || null };
  }

  hasExplicitControl(functionId) {
    return this.contributionManager?.list?.().some((item) => (
      item?.ownerFunctionId === functionId &&
      item?.element &&
      item.visible !== false &&
      normalizeContributionLayout(item).role === 'control'
    )) || false;
  }

  toggleSceneFocus(force = null) {
    const next = force == null ? !this.sceneFocus : Boolean(force);
    if (next === this.sceneFocus) return this.sceneFocus;
    this.sceneFocus = next;
    const panel = this.getDocumentRootPanel();
    if (next) {
      this.sceneFocusEdgeState = Object.fromEntries(EDGE_POSITIONS.map((position) => [
        position,
        Boolean(this.edgeGroup(position) && this.api.isEdgeGroupVisible?.(position))
      ]));
      EDGE_POSITIONS.forEach((position) => {
        if (this.edgeGroup(position)) this.api.setEdgeGroupVisible?.(position, false);
      });
    } else {
      const previous = this.sceneFocusEdgeState || {};
      EDGE_POSITIONS.forEach((position) => {
        if (!Object.prototype.hasOwnProperty.call(previous, position)) return;
        if (this.edgeGroup(position)) this.api.setEdgeGroupVisible?.(position, previous[position]);
      });
      this.sceneFocusEdgeState = null;
    }
    if (panel) {
      if (next) panel.api?.maximize?.();
      else panel.api?.exitMaximized?.();
      panel.api?.setActive?.();
    }
    this.container.closest('.runtime-shell')?.classList.toggle('scene-focus-active', next);
    this.handleLayoutChange();
    return next;
  }

  isSceneFocusActive() {
    return this.sceneFocus;
  }

  getOccludingRects() {
    const sceneRect = this.records.get(SCENE_ANCHOR_ID)?.element?.getBoundingClientRect?.();
    if (!sceneRect) return [];
    return [...this.container.querySelectorAll('.dv-resize-container')]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.right > sceneRect.left && rect.left < sceneRect.right && rect.bottom > sceneRect.top && rect.top < sceneRect.bottom);
  }

  handleActivePanelChange(event) {
    const panel = event?.panel;
    if (!panel) return;
    (panel.group?.panels || []).forEach((candidate) => {
      this.setRecordActive(candidate.id, candidate.id === panel.id);
    });
    this.requestRecordResize(panel.id);
    const record = this.records.get(panel.id);
    if (!record?.item || event.origin !== 'user') return;
    record.item.activate?.();
    queueMicrotask(() => {
      if (!record.item?.ownerFunctionId) return;
      if (this.contributionManager?.focusedFunctionId === record.item.ownerFunctionId) return;
      this.contributionManager?.focusOwner?.(record.item.ownerFunctionId);
    });
  }

  handleLayoutChange() {
    if (this.transactionDepth || this.recovering || this.layoutFrame) return;
    this.layoutFrame = scheduleFrame(() => {
      this.layoutFrame = 0;
      this.diagnostics.layoutReconciliations += 1;
      this.reconcilePanelRecords();
      this.records.forEach((record) => {
        if (record.dockPanel) this.capturePlacement(record);
      });
      this.notifyLayout();
      if (!this.suppressPersistence) {
        clearTimeout(this.persistenceTimer);
        this.persistenceTimer = setTimeout(() => this.saveLayout(), 180);
      }
    });
  }

  saveLayout() {
    if (this.suppressPersistence || !this.scope?.workspaceId) return;
    try {
      this.records.forEach((record) => {
        if (record.dockPanel) this.capturePlacement(record);
      });
      const placements = Object.fromEntries(
        [...this.records.values()].map((record) => [record.id, record.lastPlacement || null])
      );
      const edgeGroups = Object.fromEntries(EDGE_POSITIONS.map((position) => {
        const group = this.edgeGroup(position);
        return [position, group ? {
          id: group.id,
          collapsed: Boolean(group.api?.isCollapsed?.()),
          visible: Boolean(this.api.isEdgeGroupVisible?.(position))
        } : null];
      }));
      this.stateStore.save(this.scope, {
        version: LAYOUT_VERSION,
        dockview: this.api.toJSON(),
        openPanelIds: [...this.records.values()]
          .filter((record) => record.open && record.semanticVisible)
          .map((record) => record.id),
        placements,
        edgeGroups,
        activePanels: (this.api.groups || []).map((group) => ({
          groupId: group.id,
          panelId: group.activePanel?.id || null
        })),
        floatingBounds: (this.api.groups || [])
          .filter((group) => group.api?.location?.type === 'floating')
          .map((group) => ({ groupId: group.id, ...this.getGroupBounds(group) })),
        autoHidden: [...this.records.values()].filter((record) => record.autoHidden).map((record) => record.id),
        sceneFocus: false,
        systemChrome: this.systemChromeService?.layoutState?.() || {}
      });
    } catch (error) {
      console.warn('[MineVis layout] Failed to serialize workspace layout.', error);
    }
  }

  setScope(scope) {
    this.saveLayout();
    this.pendingFocusFunctionId = null;
    this.scope = { ...scope, viewportClass: scope.viewportClass || previewViewportClass() };
    this.pendingSavedState = this.stateStore.load(this.scope);
    this.resetLayout({ clearSaved: false });
  }

  restoreSavedLayout() {
    this.flushContributionSync();
    const saved = this.pendingSavedState || this.stateStore.load(this.scope);
    this.pendingSavedState = null;
    if (saved?.version !== LAYOUT_VERSION || !saved?.dockview || !Array.isArray(saved.openPanelIds)) return false;
    const knownIds = new Set(this.records.keys());
    if (
      !saved.openPanelIds.includes(SCENE_ANCHOR_ID) ||
      new Set(saved.openPanelIds).size !== saved.openPanelIds.length ||
      saved.openPanelIds.some((id) => !knownIds.has(id))
    ) {
      this.stateStore.clear(this.scope);
      return false;
    }
    this.suppressPersistence = true;
    this.recovering = true;
    try {
      const openIds = new Set(saved.openPanelIds);
      const autoHidden = new Set(saved.autoHidden || []);
      this.records.forEach((record) => {
        record.open = record.semanticVisible && openIds.has(record.id);
        if (this.isDocumentRoot(record)) record.open = true;
        record.closedByUser = record.semanticVisible && !record.open;
        record.autoHidden = autoHidden.has(record.id);
        record.lastPlacement = saved.placements?.[record.id] || null;
      });
      this.api.fromJSON(saved.dockview, { reuseExistingPanels: true });
      (this.api.panels || []).forEach((panel) => {
        const record = this.records.get(panel.id);
        if (!record || !record.open || !record.semanticVisible) this.api.removePanel(panel);
      });
      this.records.forEach((record) => {
        record.dockPanel = this.api.getPanel?.(record.id) || null;
        if (record.open && record.semanticVisible && !record.dockPanel) this.addRecordPanel(record);
      });
      this.cleanupEmptyEdgeGroups();
      this.reconcilePanelRecords();
      const validation = this.validateLayout();
      if (!validation.valid) throw new Error(validation.errors.join(' '));
      this.systemChromeService?.applyLayoutState?.(saved.systemChrome || {});
      this.renderAutoHideRails();
      return true;
    } catch (error) {
      console.warn('[MineVis layout] Saved v5 layout is incompatible; using defaults.', error);
      this.stateStore.clear(this.scope);
      this.resetLayout({ clearSaved: false });
      return false;
    } finally {
      this.recovering = false;
      this.suppressPersistence = false;
      this.handleLayoutChange();
    }
  }

  resetLayout({ clearSaved = true } = {}) {
    this.suppressPersistence = true;
    this.pendingFocusFunctionId = null;
    try {
      this.api.clear();
      this.regionGroups.clear();
      this.records.forEach((record) => {
        record.dockPanel = null;
        record.lastPlacement = null;
        record.autoHidden = this.defaultAutoHide(record);
        record.open = this.isDocumentRoot(record) || Boolean(record.semanticVisible);
        record.closedByUser = false;
      });
      this.createMainScenePanel();
      [...this.records.values()]
        .filter((record) => !this.isDocumentRoot(record) && record.open && record.semanticVisible)
        .sort((left, right) => {
          const zone = (record) => record.layout?.zone === 'document' ? 0 : 1;
          return zone(left) - zone(right) || (right.layout?.priority || 0) - (left.layout?.priority || 0);
        })
        .forEach((record) => this.addRecordPanel(record));
      this.getDocumentRootPanel()?.api?.setActive?.();
      this.reconcilePanelRecords();
      if (clearSaved) this.stateStore.clear(this.scope);
      this.renderAutoHideRails();
    } finally {
      this.suppressPersistence = false;
      this.handleLayoutChange();
    }
  }

  getDiagnostics() {
    return {
      ...this.diagnostics,
      recordCount: this.records.size,
      openPanelCount: [...this.records.values()].filter((record) => record.open).length,
      dockPanelCount: (this.api.panels || []).length,
      edgeGroupCount: EDGE_POSITIONS.filter((position) => this.edgeGroup(position)).length,
      pendingContributionSync: Boolean(this.contributionSyncFrame),
      pendingLayoutReconciliation: Boolean(this.layoutFrame),
      transactionDepth: this.transactionDepth
    };
  }

  dispose() {
    clearTimeout(this.persistenceTimer);
    cancelFrame(this.contributionSyncFrame);
    cancelFrame(this.layoutFrame);
    cancelFrame(this.lifecycleFrame);
    this.saveLayout();
    this.systemChromeDispose?.();
    this.contributionDispose?.();
    this.layoutDisposers.forEach(disposeSubscription);
    this.dragController?.dispose();
    this.dockingOverlay?.dispose();
    this.records.forEach((record) => record.panelHost?.dispose());
    this.records.clear();
    this.api.dispose?.();
  }
}

export { SCENE_ANCHOR_ID, LAYOUT_VERSION };
