import {
  normalizeContributionRelations,
  normalizeSingleGridLayout
} from './SingleGridContributionLayoutPolicy.js';

const TYPE_DEFAULTS = Object.freeze({
  'scene-layer': {
    host: 'main-3d-scene',
    contributionKind: 'layer',
    semanticRole: 'state',
    objectSystem: 'workspace'
  },
  layer: {
    host: 'main-3d-scene',
    contributionKind: 'layer',
    semanticRole: 'state',
    objectSystem: 'workspace'
  },
  'topology-view': {
    host: 'topology-view',
    contributionKind: 'panel',
    semanticRole: 'detail',
    objectSystem: 'workspace'
  },
  chart: {
    host: 'bottom-panel',
    contributionKind: 'chart',
    semanticRole: 'detail',
    objectSystem: 'workspace'
  },
  drawing: {
    host: 'bottom-panel',
    contributionKind: 'panel',
    semanticRole: 'detail',
    objectSystem: 'workspace'
  },
  timeline: {
    host: 'bottom-panel',
    contributionKind: 'panel',
    semanticRole: 'detail',
    objectSystem: 'workspace'
  },
  legend: {
    host: 'legend',
    contributionKind: 'legend',
    semanticRole: 'legend',
    objectSystem: 'workspace'
  },
  control: {
    host: 'right-panel',
    contributionKind: 'control',
    semanticRole: 'control',
    objectSystem: 'workspace'
  },
  panel: {
    host: 'right-panel',
    contributionKind: 'panel',
    semanticRole: 'detail',
    objectSystem: 'workspace'
  }
});

const ROLE_PRIORITY = Object.freeze({
  base: 10,
  context: 20,
  structure: 30,
  detail: 40,
  legend: 50,
  control: 50,
  state: 60,
  diagnostic: 70,
  selection: 90
});

function runtimeKind(contribution) {
  if (contribution.contributionKind) return contribution.contributionKind;
  return TYPE_DEFAULTS[contribution.type]?.contributionKind || contribution.type || 'panel';
}

function mapsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

export class VisualContributionManager {
  constructor(onChange = null) {
    this.items = new Map();
    this.onChange = onChange;
    this.listeners = new Set();
    this.activationListeners = new Set();
    this.focusedFunctionId = null;
    this.functionLabels = new Map();
    this.ownerManifests = new Map();
    this.interactionLocked = false;
    this.revision = 0;
    this.transactionDepth = 0;
    this.notificationScheduled = false;
    this.isNotifying = false;
    this.isApplying = false;
    this.pendingComposition = false;
    this.compositionDirty = false;
    this.pendingChanges = {
      added: new Set(),
      updated: new Set(),
      removed: new Set()
    };
    this.diagnostics = {
      notifications: 0,
      compositionPasses: 0,
      maxTransactionDepth: 0
    };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    listener(this.list(), {
      revision: this.revision,
      added: [],
      updated: [],
      removed: [],
      initial: true
    });
    return () => this.listeners.delete(listener);
  }

  subscribeActivation(listener) {
    if (typeof listener !== 'function') return () => {};
    this.activationListeners.add(listener);
    return () => this.activationListeners.delete(listener);
  }

  requestActivate(id) {
    const item = this.items.get(id);
    if (!item?.element) return false;
    if (item.visible === false) this.setVisible(id, true);
    this.activationListeners.forEach((listener) => listener(id, item));
    return true;
  }

  registerOwner(ownerId, manifest) {
    if (ownerId && manifest) this.ownerManifests.set(ownerId, manifest);
  }

  unregisterOwnerManifest(ownerId) {
    this.ownerManifests.delete(ownerId);
  }

  manifestDescriptor(contribution) {
    const manifest = this.ownerManifests.get(contribution.ownerId || contribution.ownerOperatorId);
    if (!manifest) return null;
    if (contribution.manifestId) {
      return manifest.contributions?.find((item) => item.id === contribution.manifestId) || null;
    }
    const kind = runtimeKind(contribution);
    const matches = (manifest.contributions || []).filter((item) => item.contributionKind === kind);
    if (matches.length <= 1) return matches[0] || null;
    const defaults = TYPE_DEFAULTS[contribution.type] || TYPE_DEFAULTS[kind] || {};
    const host = contribution.host || defaults.host;
    const hostMatches = host ? matches.filter((item) => item.host === host) : [];
    if (hostMatches.length === 1) return hostMatches[0];
    const semanticRole = contribution.semanticRole || defaults.semanticRole;
    const roleMatches = semanticRole
      ? (hostMatches.length ? hostMatches : matches).filter((item) => item.semanticRole === semanticRole)
      : [];
    return roleMatches.length === 1 ? roleMatches[0] : null;
  }

  normalizeContribution(contribution) {
    const typeDefaults = TYPE_DEFAULTS[contribution.type] || TYPE_DEFAULTS[runtimeKind(contribution)] || TYPE_DEFAULTS.panel;
    const manifestDescriptor = this.manifestDescriptor(contribution) || {};
    const runtimeDescriptor = contribution.descriptor || {};
    const descriptor = {
      ...manifestDescriptor,
      ...runtimeDescriptor,
      composition: {
        ...(manifestDescriptor.composition || {}),
        ...(runtimeDescriptor.composition || {})
      },
      layout: {
        ...(manifestDescriptor.layout || {}),
        ...(runtimeDescriptor.layout || {})
      },
      relations: {
        ...(manifestDescriptor.relations || {}),
        ...(runtimeDescriptor.relations || {})
      }
    };
    const ownerFunctionId = contribution.ownerFunctionId || contribution.functionId || contribution.ownerId;
    const semanticRole = contribution.semanticRole || descriptor.semanticRole || typeDefaults.semanticRole;
    const contributionKind = contribution.contributionKind || descriptor.contributionKind || typeDefaults.contributionKind;
    const composition = {
      mergePolicy: 'compose',
      focusBehavior: semanticRole === 'state' ? 'primary-when-focused' : 'context',
      canPin: true,
      defaultVisibility: true,
      defaultOpacity: contribution.opacity ?? descriptor.composition?.defaultOpacity ?? 1,
      ...(descriptor.composition || {}),
      ...(contribution.composition || {})
    };
    const item = {
      visible: contribution.state?.visible ?? contribution.visible ?? composition.defaultVisibility,
      pinned: contribution.state?.pinned ?? contribution.pinned ?? false,
      opacity: contribution.state?.opacity ?? contribution.opacity ?? composition.defaultOpacity,
      host: contribution.host || descriptor.host || typeDefaults.host,
      contributionKind,
      semanticRole,
      objectSystem: contribution.objectSystem || descriptor.objectSystem || typeDefaults.objectSystem,
      visualChannels: contribution.visualChannels || descriptor.visualChannels || {},
      priority: contribution.priority ?? ROLE_PRIORITY[semanticRole] ?? 30,
      order: contribution.order ?? contribution.priority ?? ROLE_PRIORITY[semanticRole] ?? 30,
      composition,
      ownerFunctionId,
      ownerOperatorId: contribution.ownerOperatorId || contribution.ownerId,
      sharedKey: contribution.sharedKey || descriptor.id || `${ownerFunctionId}:${contribution.id}`,
      interactionLocked: this.interactionLocked,
      effectiveVisible: true,
      muted: false,
      ...contribution,
      descriptor
    };
    item.layout = normalizeSingleGridLayout(item);
    item.relations = normalizeContributionRelations(item);
    return item;
  }

  register(contribution) {
    const item = this.normalizeContribution(contribution);
    const previous = this.items.get(item.id);
    if (previous) {
      item._appliedVisible = previous._appliedVisible;
      item._appliedOpacity = previous._appliedOpacity;
      item._appliedMuted = previous._appliedMuted;
    }
    this.items.set(item.id, item);
    this.requestComposition();
    this.markChanged(previous ? 'updated' : 'added', item.id);
    return item;
  }
  unregister(id, { cleanup = true } = {}) {
    const item = this.items.get(id);
    if (!item) return false;
    if (cleanup) item.cleanup?.();
    this.items.delete(id);
    this.transaction(() => {
      this.markChanged('removed', id);
      this.requestComposition();
    });
    return true;
  }


  get(id) {
    return this.items.get(id);
  }

  list() {
    return [...this.items.values()];
  }

  childrenOf(parentId) {
    return this.list().filter((item) => item.parentId === parentId);
  }

  setVisible(id, visible) {
    const item = this.items.get(id);
    if (!item) return false;
    const nextVisible = Boolean(visible);
    let changed = item.visible !== nextVisible;
    item.visible = nextVisible;
    if (item.collection) this.childrenOf(id).forEach((child) => {
      if (child.visible === nextVisible) return;
      child.visible = nextVisible;
      changed = true;
      this.markChanged('updated', child.id);
    });
    if (!changed) return false;
    this.requestComposition();
    this.markChanged('updated', id);
    return true;
  }

  setOpacity(id, opacity) {
    const item = this.items.get(id);
    if (!item) return false;
    const nextOpacity = Math.max(0, Math.min(1, Number(opacity)));
    if (Object.is(item.opacity, nextOpacity)) return false;
    item.opacity = nextOpacity;
    this.requestComposition();
    this.markChanged('updated', id);
    return true;
  }

  setOrder(id, order) {
    const item = this.items.get(id);
    if (!item) return false;
    const nextOrder = Number(order);
    if (Object.is(item.order, nextOrder)) return false;
    item.order = nextOrder;
    item.setOrder?.(item.order);
    this.markChanged('updated', id);
    return true;
  }

  setInteractionLocked(locked) {
    const nextLocked = Boolean(locked);
    if (this.interactionLocked === nextLocked) return false;
    this.interactionLocked = nextLocked;
    this.items.forEach((item) => {
      item.interactionLocked = this.interactionLocked;
      item.setInteractionEnabled?.(!this.interactionLocked);
      this.markChanged('updated', item.id);
    });
    return true;
  }

  togglePinned(id) {
    const item = this.items.get(id);
    if (!item || item.composition?.canPin === false) return false;
    item.pinned = !item.pinned;
    this.requestComposition();
    this.markChanged('updated', id);
    return true;
  }

  setFunctionLabels(functions = []) {
    const nextLabels = new Map(functions.map((fn) => [fn.id, fn.label]));
    if (mapsEqual(this.functionLabels, nextLabels)) return false;
    this.functionLabels = nextLabels;
    this.markChanged('updated');
    return true;
  }

  reassignOwnerFunction(ownerId, functionId) {
    const nextFunctionId = functionId || ownerId || null;
    let changed = false;
    this.transaction(() => {
      this.items.forEach((item) => {
        if (item.ownerId !== ownerId && item.ownerOperatorId !== ownerId) return;
        if (item.ownerFunctionId === nextFunctionId && item.functionId === nextFunctionId) return;
        item.ownerFunctionId = nextFunctionId;
        item.functionId = nextFunctionId;
        changed = true;
        this.markChanged('updated', item.id);
      });
      if (changed) this.requestComposition();
    });
    return changed;
  }

  setFocusedFunction(functionId) {
    const nextId = functionId || null;
    if (this.focusedFunctionId === nextId) return false;
    this.focusedFunctionId = nextId;
    this.requestComposition();
    this.markChanged('updated');
    return true;
  }

  ownerLabel(item) {
    return this.functionLabels.get(item.ownerFunctionId) ||
      this.functionLabels.get(item.functionId) ||
      item.ownerLabel ||
      '';
  }

  focusOwner(functionId) {
    if (functionId) this.onFocusFunction?.(functionId);
  }

  requestComposition() {
    if (this.transactionDepth) {
      this.compositionDirty = true;
      return;
    }
    this.compositionDirty = false;
    this.applyComposition();
  }

  applyComposition() {
    if (this.isApplying) {
      this.pendingComposition = true;
      return;
    }
    this.isApplying = true;
    let pass = 0;
    try {
      do {
        this.pendingComposition = false;
        const focusedId = this.focusedFunctionId;
        const focusedLegends = [];
        this.items.forEach((item) => {
          item.focused = Boolean(focusedId && item.ownerFunctionId === focusedId);
          item.muted = false;
          let visible = Boolean(item.visible);
          let opacityFactor = 1;
          if (!item.pinned && focusedId && item.ownerFunctionId && item.ownerFunctionId !== focusedId) {
            const behavior = item.composition?.focusBehavior || 'context';
            if (
              item.host === 'legend' ||
              item.semanticRole === 'legend' ||
              behavior === 'primary-when-focused' ||
              ['panel', 'control', 'chart'].includes(item.contributionKind)
            ) {
              visible = false;
            } else if (item.semanticRole === 'diagnostic' || behavior === 'annotation') {
              opacityFactor = 0.68;
              item.muted = true;
            } else if (item.semanticRole === 'structure' || behavior === 'context') {
              opacityFactor = 0.42;
              item.muted = true;
            } else if (item.semanticRole === 'state') {
              opacityFactor = 0.32;
              item.muted = true;
            }
          }
          item.effectiveVisible = visible;
          item.effectiveOpacity = Math.max(0, Math.min(1, Number(item.opacity ?? 1) * opacityFactor));
          if (item.host === 'legend' && item.focused && visible) focusedLegends.push(item);
          this.applyContributionState(item);
        });
        focusedLegends
          .sort((left, right) => (right.order || 0) - (left.order || 0))
          .slice(1)
          .forEach((item) => {
            if (!item.pinned) {
              item.effectiveVisible = false;
              this.applyContributionState(item);
            }
          });
        pass += 1;
        this.diagnostics.compositionPasses += 1;
      } while (this.pendingComposition && pass < 4);
    } finally {
      this.isApplying = false;
    }
    if (this.pendingComposition) queueMicrotask(() => this.applyComposition());
  }

  applyContributionState(item) {
    const visible = Boolean(item.effectiveVisible);
    const opacity = Math.max(0, Math.min(1, Number(item.effectiveOpacity ?? item.opacity ?? 1)));
    if (item._appliedVisible !== visible) {
      // Dockview owns DOM panel visibility. Scene/non-DOM contributions still use
      // their rendering callbacks, but panel callbacks must not write display state.
      if (!item.element) {
        if (visible) item.show?.();
        else item.hide?.();
      }
      item._appliedVisible = visible;
    }
    if (visible && item.setOpacity && item._appliedOpacity !== opacity) {
      item.setOpacity(opacity);
      item._appliedOpacity = opacity;
    }
    if (item._appliedMuted !== item.muted) {
      if (item.muted) item.mute?.();
      else item.unmute?.();
      item._appliedMuted = item.muted;
    }
  }

  unregisterOwner(ownerId, { keepPinned = true } = {}) {
    const hasPinnedDescendant = (itemId) =>
      this.list().some((item) => item.parentId === itemId && (item.pinned || hasPinnedDescendant(item.id)));
    const ownerHasPinnedItem = this.list().some((item) => item.ownerId === ownerId && item.pinned);
    this.transaction(() => {
      for (const [id, item] of this.items) {
        if (item.ownerId !== ownerId) continue;
        if (keepPinned && (item.pinned || hasPinnedDescendant(id) || (item.keepWithPinnedOwner && ownerHasPinnedItem))) continue;
        item.cleanup?.();
        this.items.delete(id);
        this.markChanged('removed', id);
      }
      this.unregisterOwnerManifest(ownerId);
      this.requestComposition();
    });
  }

  transaction(callback) {
    this.transactionDepth += 1;
    this.diagnostics.maxTransactionDepth = Math.max(
      this.diagnostics.maxTransactionDepth,
      this.transactionDepth
    );
    try {
      return callback();
    } finally {
      this.transactionDepth -= 1;
      if (!this.transactionDepth) {
        if (this.compositionDirty) this.requestComposition();
        this.scheduleNotification();
      }
    }
  }

  markChanged(kind = 'updated', id = null) {
    if (id) {
      if (kind === 'added') {
        this.pendingChanges.removed.delete(id);
        this.pendingChanges.updated.delete(id);
        this.pendingChanges.added.add(id);
      } else if (kind === 'removed') {
        if (!this.pendingChanges.added.delete(id)) this.pendingChanges.removed.add(id);
        this.pendingChanges.updated.delete(id);
      } else if (!this.pendingChanges.added.has(id) && !this.pendingChanges.removed.has(id)) {
        this.pendingChanges.updated.add(id);
      }
    } else {
      this.items.forEach((item) => {
        if (!this.pendingChanges.added.has(item.id)) this.pendingChanges.updated.add(item.id);
      });
    }
    if (!this.transactionDepth) this.scheduleNotification();
  }

  scheduleNotification() {
    if (this.notificationScheduled) return;
    this.notificationScheduled = true;
    queueMicrotask(() => this.flushNotifications());
  }

  flushNotifications() {
    if (this.isNotifying) {
      this.scheduleNotification();
      return;
    }
    this.notificationScheduled = false;
    const hasChanges = Object.values(this.pendingChanges).some((set) => set.size);
    if (!hasChanges) return;
    const changes = {
      revision: ++this.revision,
      added: [...this.pendingChanges.added],
      updated: [...this.pendingChanges.updated],
      removed: [...this.pendingChanges.removed]
    };
    this.diagnostics.notifications += 1;
    Object.values(this.pendingChanges).forEach((set) => set.clear());
    const items = this.list();
    this.isNotifying = true;
    try {
      this.onChange?.(items, changes);
      [...this.listeners].forEach((listener) => listener(items, changes));
    } finally {
      this.isNotifying = false;
    }
    if (Object.values(this.pendingChanges).some((set) => set.size)) this.scheduleNotification();
  }

  notify() {
    this.markChanged('updated');
  }

  getDiagnostics() {
    return {
      ...this.diagnostics,
      revision: this.revision,
      itemCount: this.items.size,
      pendingNotification: this.notificationScheduled,
      pendingComposition: this.pendingComposition || this.compositionDirty,
      transactionDepth: this.transactionDepth
    };
  }
}
