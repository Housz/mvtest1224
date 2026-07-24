import { createDockview } from 'dockview';
import { LayoutStateStore, previewViewportClass } from './LayoutStateStore.js';
import { normalizeSingleGridLayout } from './SingleGridContributionLayoutPolicy.js';
import { SingleGridDockingPolicy, EDGE_POSITIONS } from './SingleGridDockingPolicy.js';
import { DockingCompassOverlay } from './DockingCompassOverlay.js';
import { DockingDragController } from './DockingDragController.js';
import { UnifiedPanelContentHost } from './UnifiedPanelContentHost.js';
import { SingleGridContentRenderer, SingleGridTabRenderer } from './SingleGridDockComponents.js';
import {
  captureSingleGridSnapshot,
  serializeSingleGridLayout,
  validateSingleGridLayout
} from './SingleGridLayoutState.js';

const LAYOUT_VERSION = 6;
const ROOT_DIRECTIONS = Object.freeze({
  left: 'left',
  right: 'right',
  top: 'above',
  bottom: 'below'
});

const scheduleFrame = (callback) => (
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 0)
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

export class WorkspaceLayoutService {
  constructor({
    container,
    stagingElement,
    contributionManager,
    stateStore = new LayoutStateStore('minevis.preview.layout.v6'),
    scope = {},
    onLayoutChange = null
  }) {
    this.container = container;
    this.stagingElement = stagingElement;
    this.contributionManager = contributionManager;
    this.stateStore = stateStore;
    this.scope = { ...scope, viewportClass: scope.viewportClass || previewViewportClass() };
    this.onLayoutChange = onLayoutChange;
    this.records = new Map();
    this.recordListeners = new Map();
    this.layoutListeners = new Set();
    this.regionGroups = new Map();
    this.removingPanelIds = new Set();
    this.canonicalSizedGroups = new Set();
    this.canonicalSizeAttempts = new Map();
    this.canonicalSizeFailures = new Set();
    this.transactionDepth = 0;
    this.transactionSnapshot = null;
    this.lastValidSnapshot = null;
    this.recovering = false;
    this.suppressPersistence = false;
    this.persistenceTimer = 0;
    this.contributionSyncFrame = 0;
    this.layoutFrame = 0;
    this.lifecycleFrame = 0;
    this.geometryTimer = 0;
    this.geometryFrame = 0;
    this.canonicalSizeFrame = 0;
    this.pendingContributionItems = null;
    this.pendingFocusFunctionId = null;
    this.pendingSavedState = this.stateStore.load(this.scope);
    this.initialLayoutResolved = false;
    this.systemChromeService = null;
    this.systemChromeDispose = null;
    this.groupSequence = 0;
    this.diagnostics = {
      transactions: 0,
      rollbacks: 0,
      invariantFailures: 0,
      geometryFailures: 0,
      contributionSyncRequests: 0,
      contributionSyncs: 0,
      layoutReconciliations: 0,
      canonicalSizingRuns: 0,
      canonicalSizingFailures: 0,
      dockingOperations: 0
    };

    this.container.classList.add('dockview-theme-abyss', 'minevis-professional-dock', 'minevis-single-grid-dock');
    this.api = createDockview(container, {
      createComponent: (options) => new SingleGridContentRenderer(this, options.id),
      createTabComponent: (options) => new SingleGridTabRenderer(this, options.id),
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

    this.dockingPolicy = new SingleGridDockingPolicy(this);
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
      this.api.onDidMutateLayout?.(() => this.handleLayoutChange()),
      this.api.onDidLayoutChange?.(() => this.handleLayoutChange()),
      this.api.onDidMovePanel?.(() => this.handleLayoutChange()),
      this.api.onDidActivePanelChange?.((event) => this.handleActivePanelChange(event)),
      this.api.onDidRemovePanel?.((event) => this.handlePanelRemoved(event?.panel || event))
    ].filter(Boolean);
    this.contributionDispose = contributionManager?.subscribe?.(
      (items) => this.scheduleContributionSync(items)
    );
    this.activationDispose = contributionManager?.subscribeActivation?.(
      (id) => this.activatePanel(id)
    );
  }

  contextMenuItemsFor(panel) {
    const record = this.records.get(panel?.id);
    if (!record) return [];
    const items = EDGE_POSITIONS.map((position) => ({
      label: `Dock ${position[0].toUpperCase()}${position.slice(1)}`,
      action: () => this.dockRecord(record.id, position)
    }));
    items.push({ label: 'Float panel', action: () => this.floatRecord(record.id) });
    if (record.layout?.closable !== false) {
      items.push('separator', { label: 'Close panel', action: () => this.closeRecord(record.id) });
    }
    return items;
  }

  createPanelHost(record) {
    return new UnifiedPanelContentHost({
      id: record.id,
      element: record.element,
      stagingElement: this.stagingElement,
      onResize: record.resize,
      content: record.layout?.content
    });
  }

  setSystemChromeService(service) {
    this.systemChromeDispose?.();
    this.systemChromeService = service || null;
    this.systemChromeDispose = service?.subscribe?.(() => this.handleLayoutChange()) || null;
  }

  getRecord(id) {
    return this.records.get(id) || null;
  }

  getWorkspaceBounds() {
    return { x: 0, y: 0, width: this.container.clientWidth, height: this.container.clientHeight };
  }

  clientToWorkspace(clientX, clientY) {
    const rect = this.container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  getGroupBounds(group) {
    const workspace = this.container.getBoundingClientRect();
    if (group?.element?.isConnected) {
      const rect = group.element.getBoundingClientRect();
      return {
        x: rect.left - workspace.left,
        y: rect.top - workspace.top,
        width: rect.width,
        height: rect.height
      };
    }
    const box = group?.api?.boundingBox;
    if (!box || !Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
    return {
      x: Number.isFinite(box.x) ? box.x : Number(box.left) || 0,
      y: Number.isFinite(box.y) ? box.y : Number(box.top) || 0,
      width: box.width,
      height: box.height
    };
  }

  groupForElement(element) {
    if (!element) return null;
    return (this.api.groups || []).find((group) => group.element === element) || null;
  }

  groupAtPoint(clientX, clientY) {
    const sourceWrapper = this.dragController?.drag?.group?.element?.closest?.('.dv-resize-container');
    const previous = sourceWrapper?.style?.pointerEvents;
    if (sourceWrapper) sourceWrapper.style.pointerEvents = 'none';
    const stack = document.elementsFromPoint?.(clientX, clientY) || [document.elementFromPoint(clientX, clientY)];
    if (sourceWrapper) sourceWrapper.style.pointerEvents = previous || '';
    for (const element of stack) {
      if (!element || element.closest?.('.workspace-docking-overlay')) continue;
      const group = this.groupForElement(element.closest?.('.dv-groupview'));
      if (!group) continue;
      if (this.dragController?.drag?.source === 'group' &&
          group.id === this.dragController.drag.group?.id) continue;
      return group;
    }
    return null;
  }

  recordForGroup(group) {
    const id = group?.activePanel?.id || group?.panels?.[0]?.id;
    return id ? this.records.get(id) || null : null;
  }

  noteDockingOperation() {
    this.diagnostics.dockingOperations += 1;
  }

  moveSourceToRootEdge(source, position) {
    if (!source || !EDGE_POSITIONS.includes(position)) return false;
    const target = this.api.addGroup({
      id: `minevis:root:${position}:${++this.groupSequence}`,
      direction: ROOT_DIRECTIONS[position]
    });
    source.api.moveTo({ group: target, position: 'center' });
    const record = source.id ? this.records.get(source.id) : this.recordForGroup(source);
    const preferred = record?.layout?.preferredSize || {};
    try {
      if (position === 'left' || position === 'right') {
        target.api?.setSize?.({ width: preferred.width || 288 });
      } else {
        target.api?.setSize?.({ height: preferred.height || 250 });
      }
    } catch {
      // The split is valid even if Dockview defers its preferred size.
    }
    if (position === 'left') this.systemChromeService?.setCollapsed?.('functions', true);
    if (position === 'right') this.systemChromeService?.setCollapsed?.('contributions', true);
    this.noteDockingOperation();
    return true;
  }

  floatDragAtPointer(drag, event) {
    const workspace = this.getWorkspaceBounds();
    const point = this.clientToWorkspace(event.clientX, event.clientY);
    const preferred = drag.record.layout?.preferredSize || {};
    const current = drag.initialFloatingBounds || this.getGroupBounds(drag.group) || {};
    const width = clamp(current.width || preferred.width || 360, 200, Math.max(200, workspace.width * 0.82));
    const height = clamp(current.height || preferred.height || 300, 140, Math.max(140, workspace.height * 0.82));
    const offset = drag.pointerOffset || { x: 28, y: 14 };
    const x = clamp(point.x - offset.x, 0, Math.max(0, workspace.width - width));
    const y = clamp(point.y - offset.y, 0, Math.max(0, workspace.height - height));
    const source = drag.source === 'panel' ? drag.panel : drag.group;
    if (!source) return false;
    this.api.addFloatingGroup(source, { x, y, width, height, dragHandle: 'tabbar' });
    this.noteDockingOperation();
    return true;
  }

  captureLayoutSnapshot() {
    return captureSingleGridSnapshot(this);
  }

  validateLayout(options) {
    return validateSingleGridLayout(this, options);
  }

  transaction(command, callback, { validate = true } = {}) {
    const outermost = this.transactionDepth === 0;
    if (outermost) this.transactionSnapshot = this.captureLayoutSnapshot();
    this.transactionDepth += 1;
    let result;
    try {
      result = callback();
    } catch (error) {
      this.transactionDepth -= 1;
      if (outermost) this.restoreTransactionSnapshot(error);
      throw error;
    }
    this.transactionDepth -= 1;
    if (!outermost) return result;
    this.diagnostics.transactions += 1;
    this.reconcilePanelRecords();
    const check = validate ? this.validateLayout({ geometry: false }) : { valid: true, errors: [] };
    if (!check.valid) {
      this.diagnostics.invariantFailures += 1;
      this.restoreTransactionSnapshot(new Error(`${command}: ${check.errors.join(' ')}`));
      return false;
    }
    this.lastValidSnapshot = this.captureLayoutSnapshot();
    this.transactionSnapshot = null;
    this.handleLayoutChange();
    return result ?? true;
  }

  restoreTransactionSnapshot(error) {
    const snapshot = this.transactionSnapshot || this.lastValidSnapshot;
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
      snapshot.records?.forEach((state, id) => Object.assign(this.records.get(id) || {}, state));
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
        const sceneLayer = item.host === 'main-3d-scene' ||
          item.contributionKind === 'layer' ||
          item.type === 'scene-layer';
        if (!item?.element || sceneLayer) return;
        activeIds.add(item.id);
        const existing = this.records.get(item.id);
        const record = existing || { id: item.id, registered: true };
        record.title = item.label || item.id;
        record.item = item;
        record.element = item.element;
        record.element.dataset.workspacePanelId = record.id;
        record.element.dataset.workspacePanelTitle = record.title;
        record.element.classList.add('workspace-panel-source');
        record.layout = normalizeSingleGridLayout(item);
        record.semanticVisible = item.visible !== false;
        record.registered = true;
        record.resize = item.resize || item.onResize || null;
        record.destroyed = false;
        if (!existing) {
          record.open = record.semanticVisible;
          record.closedByUser = false;
          record.panelHost = this.createPanelHost(record);
        } else {
          record.panelHost?.update({
            element: record.element,
            onResize: record.resize,
            content: record.layout.content
          });
        }
        this.records.set(record.id, record);
      });

      [...this.records.values()].forEach((record) => {
        if (activeIds.has(record.id)) return;
        this.removeRecord(record.id);
      });
      [...this.records.values()]
        .filter((record) => record.registered && record.open &&
          record.semanticVisible && !this.api.getPanel?.(record.id))
        .sort((left, right) => this.canonicalOrder(left) - this.canonicalOrder(right) ||
          (right.layout?.priority || 0) - (left.layout?.priority || 0))
        .forEach((record) => this.addRecordPanel(record));
      [...this.records.values()].forEach((record) => this.reconcileRecord(record));
    });
    this.scheduleCanonicalGroupSizing();
    if (this.pendingFocusFunctionId) this.focusFunction(this.pendingFocusFunctionId);
  }

  canonicalOrder(record) {
    const region = record.layout?.preferredRegion;
    if (region === 'center') return 0;
    if (region === 'right') return 1;
    if (region === 'left') return 2;
    if (region === 'top') return 3;
    return 4;
  }

  reconcileRecord(record) {
    if (!record || record.destroyed) return;
    record.dockPanel = this.api.getPanel?.(record.id) || null;
    const shouldExist = Boolean(record.registered && record.open && record.semanticVisible);
    if (shouldExist && !record.dockPanel) this.addRecordPanel(record);
    else if (!shouldExist && record.dockPanel) this.removePanelFromLayout(record);
    this.notifyRecord(record.id);
  }

  validRegionGroup(key) {
    const id = this.regionGroups.get(key);
    const group = id ? this.api.getGroup?.(id) : null;
    return group && (group.panels || []).length &&
      group.api?.location?.type !== 'floating' ? group : null;
  }

  gridAnchorPanel() {
    const gridPanels = (this.api.panels || [])
      .filter((panel) => panel.api?.location?.type !== 'floating')
      .sort((left, right) => {
        const leftRecord = this.records.get(left.id);
        const rightRecord = this.records.get(right.id);
        return this.canonicalOrder(leftRecord || {}) - this.canonicalOrder(rightRecord || {});
      });
    return gridPanels[0] || (this.api.panels || [])[0] || null;
  }

  placementRegion(box) {
    if (!box) return null;
    const workspace = this.getWorkspaceBounds();
    const horizontalTool = box.width <= workspace.width * 0.55;
    const verticalTool = box.height <= workspace.height * 0.55;
    if (horizontalTool && box.x <= 2) return 'left';
    if (horizontalTool && box.x + box.width >= workspace.width - 2) return 'right';
    if (verticalTool && box.y <= 2) return 'top';
    if (verticalTool && box.y + box.height >= workspace.height - 2) return 'bottom';
    return 'center';
  }

  defaultPositionFor(record) {
    const region = record.lastPlacement?.region || record.layout?.preferredRegion;
    if (!(this.api.panels || []).length || region === 'center') return undefined;
    const group = record.layout?.tabGroup ? this.validRegionGroup(record.layout.tabGroup) : null;
    if (!record.lastPlacement && group) return { referenceGroup: group };
    const anchor = this.gridAnchorPanel();
    if (!anchor) return undefined;
    return {
      referencePanel: anchor,
      direction: ROOT_DIRECTIONS[region] || 'right'
    };
  }

  rememberRegionGroup(record, group) {
    const key = record.layout?.tabGroup;
    if (key && group?.id && group.api?.location?.type !== 'floating') {
      this.regionGroups.set(key, group.id);
    }
  }

  addRecordPanel(record) {
    if (!record.element || record.destroyed) return null;
    const preferred = record.layout?.preferredSize || {};
    const minimum = record.layout?.minSize || {};
    const options = {
      id: record.id,
      component: 'minevis-workspace-panel',
      tabComponent: 'minevis-workspace-tab',
      title: record.title,
      renderer: 'onlyWhenVisible',
      initialWidth: preferred.width,
      initialHeight: preferred.height,
      minimumWidth: minimum.width || 180,
      minimumHeight: minimum.height || 120
    };
    const placement = record.lastPlacement;
    const previousGroup = placement?.groupId && this.api.getGroup?.(placement.groupId);
    if (placement?.location === 'floating') {
      const box = placement.box || {};
      options.floating = {
        x: Number.isFinite(box.x) ? box.x : 48,
        y: Number.isFinite(box.y) ? box.y : 48,
        width: box.width || preferred.width || 360,
        height: box.height || preferred.height || 300
      };
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
      // Verify preferred startup sizing after Dockview settles sibling inserts.
      this.scheduleCanonicalGroupSizing();
      return record.dockPanel;
    } catch (error) {
      console.warn(`[MineVis layout] Failed to add panel ${record.id}.`, error);
      return null;
    }
  }

  capturePlacement(record) {
    const panel = this.api.getPanel?.(record.id) || record.dockPanel;
    if (!panel?.group) return;
    const box = this.getGroupBounds(panel.group);
    const location = panel.api?.location?.type || 'grid';
    record.lastPlacement = {
      location,
      region: location === 'floating' ? null : this.placementRegion(box),
      groupId: panel.group.id,
      tabIndex: (panel.group.panels || []).findIndex((candidate) => candidate.id === record.id),
      box: box ? { ...box } : null
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
    if (this.api.getPanel?.(id) || record.dockPanel) this.removePanelFromLayout(record);
    record.panelHost?.dispose();
    this.records.delete(id);
    this.recordListeners.delete(id);
  }

  handlePanelRemoved(panel) {
    const record = this.records.get(panel?.id);
    if (!record) return;
    record.dockPanel = null;
    record.panelHost?.visibilityChanged(false);
    if (!this.removingPanelIds.has(record.id) && !record.destroyed && !this.recovering) {
      record.open = false;
      record.closedByUser = true;
    }
    this.handleLayoutChange();
  }

  mountRenderer(id, host, params) {
    const record = this.records.get(id);
    if (!record?.element) {
      host.textContent = 'Panel content is not currently available.';
      return;
    }
    record.dockPanel = this.api.getPanel?.(id) || record.dockPanel;
    record.panelHost?.mount(host, params);
    this.requestRecordResize(id);
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
      record.location = panel.api?.location?.type || 'grid';
      record.panelHost?.locationChanged(panel.api?.location || { type: 'grid' });
      this.setRecordActive(record.id, panel.group?.activePanel?.id === panel.id);
      this.rememberRegionGroup(record, panel.group);
    });
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

  startPanelDrag(id, event) {
    return this.dragController?.startPanelDrag(id, event) || false;
  }

  dockRecord(id, position, targetId = null) {
    const record = this.records.get(id);
    const panel = this.api.getPanel?.(id);
    const targetPanel = targetId ? this.api.getPanel?.(targetId) : null;
    if (!record || !panel) return false;
    const scope = targetPanel ? 'group' : 'workspace';
    if (!this.dockingPolicy.isCompatible({
      record,
      sourceGroup: panel.group,
      targetGroup: targetPanel?.group || null,
      position,
      scope
    })) return false;
    return this.transaction('dock-panel', () => this.dockingPolicy.dock({
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
      record.open = false;
      record.closedByUser = true;
      this.removePanelFromLayout(record);
      this.notifyRecord(id);
      return true;
    });
  }

  floatRecord(id, bounds = null) {
    const record = this.records.get(id);
    const panel = this.api.getPanel?.(id);
    if (!record || !panel) return false;
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
      this.noteDockingOperation();
      return true;
    });
  }

  activatePanel(id) {
    const record = this.records.get(id);
    if (!record) return false;
    if (record.item?.visible === false) this.contributionManager?.setVisible?.(id, true);
    record.semanticVisible = true;
    record.open = true;
    record.closedByUser = false;
    this.transaction('open-panel', () => this.reconcileRecord(record));
    const panel = this.api.getPanel?.(id);
    if (!panel) return false;
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


  activateRecordFromTab(id) {
    const record = this.records.get(id);
    if (!record) return false;
    const activated = this.activatePanel(id);
    if (activated && record.item?.ownerFunctionId) {
      queueMicrotask(() => {
        if (this.contributionManager?.focusedFunctionId !== record.item.ownerFunctionId) {
          this.contributionManager?.focusOwner?.(record.item.ownerFunctionId);
        }
      });
    }
    return activated;
  }

  focusFunction(functionId) {
    if (!functionId) {
      this.pendingFocusFunctionId = null;
      return { control: null, primary: null };
    }
    const candidates = [...this.records.values()].filter((record) => (
      record.item?.ownerFunctionId === functionId &&
      record.semanticVisible &&
      record.open &&
      this.api.getPanel?.(record.id)
    ));
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
      normalizeSingleGridLayout(item).role === 'control'
    )) || false;
  }

  getOccludingRects(targetElement = null) {
    const target = targetElement?.getBoundingClientRect?.();
    if (!target) return [];
    return (this.api.groups || [])
      .filter((group) => group.api?.location?.type === 'floating')
      .map((group) => group.element?.closest?.('.dv-resize-container')?.getBoundingClientRect?.())
      .filter((rect) => rect && rect.right > target.left && rect.left < target.right &&
        rect.bottom > target.top && rect.top < target.bottom);
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
      if (record.item?.ownerFunctionId &&
          this.contributionManager?.focusedFunctionId !== record.item.ownerFunctionId) {
        this.contributionManager?.focusOwner?.(record.item.ownerFunctionId);
      }
    });
  }

  scheduleCanonicalGroupSizing() {
    if (this.canonicalSizeFrame || this.recovering) return;
    this.canonicalSizeFrame = scheduleFrame(() => {
      this.canonicalSizeFrame = scheduleFrame(() => {
        this.canonicalSizeFrame = 0;
        this.applyCanonicalGroupSizing();
      });
    });
  }

  applyCanonicalGroupSizing() {
    if (this.recovering || this.transactionDepth) return;
    this.diagnostics.canonicalSizingRuns += 1;
    const workspace = this.getWorkspaceBounds();
    if (!workspace.width || !workspace.height) return;
    const rightWidth = Math.round(clamp(
      workspace.width * 0.24,
      220,
      Math.max(220, workspace.width * 0.32)
    ));
    const bottomHeight = Math.round(clamp(
      workspace.height * 0.30,
      160,
      Math.max(160, workspace.height * 0.38)
    ));
    const targets = [
      {
        group: this.validRegionGroup('right-tools'),
        dimension: 'width',
        value: rightWidth
      },
      {
        group: this.validRegionGroup('bottom-views'),
        dimension: 'height',
        value: bottomHeight
      }
    ];
    let needsVerification = false;
    targets.forEach(({ group, dimension, value }) => {
      if (!group || this.canonicalSizedGroups.has(group.id) ||
          this.canonicalSizeFailures.has(group.id)) return;
      const bounds = this.getGroupBounds(group);
      if (bounds && Math.abs(bounds[dimension] - value) <= 2) {
        this.canonicalSizedGroups.add(group.id);
        this.canonicalSizeAttempts.delete(group.id);
        return;
      }
      const attempts = this.canonicalSizeAttempts.get(group.id) || 0;
      if (attempts >= 12) {
        this.canonicalSizeFailures.add(group.id);
        this.diagnostics.canonicalSizingFailures += 1;
        console.warn(
          `[MineVis layout] Could not settle canonical ${dimension} for group ${group.id}.`
        );
        return;
      }
      try {
        group.api?.setSize?.({ [dimension]: value });
        this.canonicalSizeAttempts.set(group.id, attempts + 1);
        needsVerification = true;
      } catch (error) {
        this.canonicalSizeFailures.add(group.id);
        this.diagnostics.canonicalSizingFailures += 1;
        console.warn('[MineVis layout] Canonical group sizing failed.', error);
      }
    });
    if (needsVerification) this.scheduleCanonicalGroupSizing();
    this.reconcilePanelRecords();
    this.records.forEach((record) => {
      if (record.dockPanel && record.active) this.requestRecordResize(record.id);
    });
    this.handleLayoutChange();
  }


  scheduleGeometryValidation() {
    clearTimeout(this.geometryTimer);
    if (this.geometryFrame) cancelFrame(this.geometryFrame);
    this.geometryTimer = setTimeout(() => {
      this.geometryTimer = 0;
      this.geometryFrame = scheduleFrame(() => {
        this.geometryFrame = 0;
        if (this.transactionDepth || this.recovering) return;
        const validation = this.validateLayout({ geometry: true });
        if (!validation.valid) {
          this.diagnostics.geometryFailures += 1;
          console.warn('[MineVis layout] Stable layout geometry invariant failed.', validation.errors);
        } else {
          this.lastValidSnapshot = this.captureLayoutSnapshot();
        }
      });
    }, 100);
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
      this.scheduleGeometryValidation();
      this.notifyLayout();
      if (!this.suppressPersistence) {
        clearTimeout(this.persistenceTimer);
        this.persistenceTimer = setTimeout(() => this.saveLayout(), 180);
      }
    });
  }

  saveLayout() {
    if (!this.initialLayoutResolved || this.suppressPersistence || !this.scope?.workspaceId) return;
    try {
      this.stateStore.save(this.scope, serializeSingleGridLayout(this, LAYOUT_VERSION));
    } catch (error) {
      console.warn('[MineVis layout] Failed to serialize workspace layout.', error);
    }
  }

  setScope(scope) {
    this.saveLayout();
    this.pendingFocusFunctionId = null;
    this.scope = { ...scope, viewportClass: scope.viewportClass || previewViewportClass() };
    this.pendingSavedState = this.stateStore.load(this.scope);
    this.initialLayoutResolved = false;
    this.resetLayout({ clearSaved: false });
  }

  restoreSavedLayout() {
    this.flushContributionSync();
    cancelFrame(this.canonicalSizeFrame);
    this.canonicalSizeFrame = 0;
    const saved = this.pendingSavedState;
    this.pendingSavedState = null;
    if (saved?.version !== LAYOUT_VERSION || !saved?.dockview ||
        !Array.isArray(saved.openPanelIds)) {
      this.initialLayoutResolved = true;
      this.scheduleCanonicalGroupSizing();
      return false;
    }
    const known = new Set(this.records.keys());
    if (new Set(saved.openPanelIds).size !== saved.openPanelIds.length ||
        saved.openPanelIds.some((id) => !known.has(id))) {
      this.stateStore.clear(this.scope);
      this.initialLayoutResolved = true;
      this.scheduleCanonicalGroupSizing();
      return false;
    }
    this.suppressPersistence = true;
    this.recovering = true;
    try {
      const open = new Set(saved.openPanelIds);
      this.records.forEach((record) => {
        record.open = record.semanticVisible && open.has(record.id);
        record.closedByUser = record.semanticVisible && !record.open;
        record.lastPlacement = saved.placements?.[record.id] || null;
      });
      this.api.fromJSON(saved.dockview, { reuseExistingPanels: true });
      (this.api.panels || []).forEach((panel) => {
        const record = this.records.get(panel.id);
        if (!record || !record.open || !record.semanticVisible) this.api.removePanel(panel);
      });
      this.canonicalSizedGroups.clear();
      this.canonicalSizeAttempts.clear();
      this.canonicalSizeFailures.clear();
      (this.api.groups || []).forEach((group) => this.canonicalSizedGroups.add(group.id));
      this.records.forEach((record) => {
        record.dockPanel = this.api.getPanel?.(record.id) || null;
        if (record.open && record.semanticVisible && !record.dockPanel) this.addRecordPanel(record);
      });
      this.reconcilePanelRecords();
      const validation = this.validateLayout({ geometry: false });
      if (!validation.valid) throw new Error(validation.errors.join(' '));
      this.systemChromeService?.applyLayoutState?.(saved.systemChrome || {});
      this.lastValidSnapshot = this.captureLayoutSnapshot();
      return true;
    } catch (error) {
      this.initialLayoutResolved = true;
      console.warn('[MineVis layout] Saved v6 layout is incompatible; using defaults.', error);
      this.stateStore.clear(this.scope);
      this.resetLayout({ clearSaved: false });
      return false;
    } finally {
      this.initialLayoutResolved = true;
      this.recovering = false;
      this.suppressPersistence = false;
      this.notifyLayout();
      this.handleLayoutChange();
    }
  }

  resetLayout({ clearSaved = true } = {}) {
    this.suppressPersistence = true;
    this.recovering = true;
    this.pendingFocusFunctionId = null;
    try {
      this.canonicalSizedGroups.clear();
      this.canonicalSizeAttempts.clear();
      this.canonicalSizeFailures.clear();
      this.api.clear();
      this.regionGroups.clear();
      this.records.forEach((record) => {
        record.dockPanel = null;
        record.lastPlacement = null;
        record.open = Boolean(record.semanticVisible);
        record.closedByUser = false;
      });
      [...this.records.values()]
        .filter((record) => record.registered && record.open && record.semanticVisible)
        .sort((left, right) => this.canonicalOrder(left) - this.canonicalOrder(right) ||
          (right.layout?.priority || 0) - (left.layout?.priority || 0))
        .forEach((record) => this.addRecordPanel(record));
      const defaultPanel = [...this.records.values()]
        .filter((record) => record.registered && record.open && record.semanticVisible && record.dockPanel)
        .sort((left, right) => this.canonicalOrder(left) - this.canonicalOrder(right))[0]
        ?.dockPanel;
      defaultPanel?.api?.setActive?.();
      this.reconcilePanelRecords();
      const validation = this.validateLayout({ geometry: false });
      if (!validation.valid) {
        console.warn('[MineVis layout] Canonical layout validation failed.', validation.errors);
      }
      this.lastValidSnapshot = this.captureLayoutSnapshot();
      if (clearSaved) this.stateStore.clear(this.scope);
    } finally {
      this.recovering = false;
      this.suppressPersistence = false;
      this.handleLayoutChange();
      this.scheduleCanonicalGroupSizing();
    }
  }

  getDiagnostics() {
    return {
      ...this.diagnostics,
      recordCount: this.records.size,
      openPanelCount: [...this.records.values()].filter((record) => record.open).length,
      dockPanelCount: (this.api.panels || []).length,
      pendingContributionSync: Boolean(this.contributionSyncFrame),
      pendingLayoutReconciliation: Boolean(this.layoutFrame),
      transactionDepth: this.transactionDepth
    };
  }

  dispose() {
    clearTimeout(this.persistenceTimer);
    clearTimeout(this.geometryTimer);
    cancelFrame(this.geometryFrame);
    cancelFrame(this.canonicalSizeFrame);
    cancelFrame(this.contributionSyncFrame);
    cancelFrame(this.layoutFrame);
    this.canonicalSizedGroups.clear();
    this.canonicalSizeAttempts.clear();
    this.canonicalSizeFailures.clear();
    cancelFrame(this.lifecycleFrame);
    this.saveLayout();
    this.systemChromeDispose?.();
    this.contributionDispose?.();
    this.activationDispose?.();
    this.layoutDisposers.forEach(disposeSubscription);
    this.dragController?.dispose();
    this.dockingOverlay?.dispose();
    this.records.forEach((record) => record.panelHost?.dispose());
    this.records.clear();
    this.api.dispose?.();
  }
}

export { LAYOUT_VERSION };
