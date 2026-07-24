export class OperatorExecutionContext {
  constructor({
    operator,
    sceneManager = null,
    context = null,
    contributionManager = null,
    hostRegistry = null,
    functionId = null,
    workspaceId = null,
    mode = 'root',
    exposure = 'full'
  }) {
    this.operator = operator;
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionManager = contributionManager;
    this.hostRegistry = hostRegistry;
    this.functionId = functionId;
    this.workspaceId = workspaceId;
    this.mode = mode;
    this.exposure = exposure;
    this.disposers = [];
    this.resources = [];
    this.panels = [];
    this.contributionIds = new Set();
    this.outputListeners = new Map();
    this.outputs = new Map();
    this.cleaned = false;
  }

  track(dispose) {
    if (typeof dispose === 'function') this.disposers.push(dispose);
    return dispose;
  }

  trackResource(resource, dispose = null) {
    if (!resource) return resource;
    this.resources.push({ resource, dispose });
    return resource;
  }

  trackPanel(panel) {
    if (panel) this.panels.push(panel);
    return panel;
  }

  subscribeContext(key, listener, options = {}) {
    return this.track(this.context?.subscribe(key, listener, options));
  }

  publishContext(key, value, options = {}) {
    return this.context?.set(key, value, {
      source: this.operator?.id || this.functionId || 'operator',
      ...options
    });
  }

  registerContribution(contribution) {
    if (!this.contributionManager) return null;
    const item = this.contributionManager.register({
      ownerId: this.operator?.id,
      ownerOperatorId: this.operator?.id,
      functionId: this.functionId,
      ...contribution
    });
    if (item?.id) this.contributionIds.add(item.id);
    return item;
  }

  publishOutput(portId, dataset) {
    this.outputs.set(portId, dataset);
    (this.outputListeners.get(portId) || []).forEach((listener) => listener(dataset));
    return dataset;
  }

  getOutput(portId) {
    return this.outputs.get(portId) || null;
  }

  subscribeOutput(portId, listener) {
    if (!this.outputListeners.has(portId)) this.outputListeners.set(portId, new Set());
    this.outputListeners.get(portId).add(listener);
    return this.track(() => this.outputListeners.get(portId)?.delete(listener));
  }

  cleanup() {
    if (this.cleaned) return;
    this.contributionManager?.unregisterOwner(this.operator?.id, { keepPinned: false });
    this.disposers.splice(0).reverse().forEach((dispose) => {
      try {
        dispose?.();
      } catch (error) {
        console.warn('Operator disposer failed.', error);
      }
    });
    this.panels.splice(0).forEach((panel) => panel?.remove?.());
    this.resources.splice(0).reverse().forEach(({ resource, dispose }) => {
      try {
        if (dispose) dispose(resource);
        else {
          resource?.geometry?.dispose?.();
          const materials = Array.isArray(resource?.material) ? resource.material : [resource?.material];
          materials.filter(Boolean).forEach((material) => material.dispose?.());
          resource?.dispose?.();
        }
      } catch (error) {
        console.warn('Operator resource cleanup failed.', error);
      }
    });
    this.outputListeners.clear();
    this.outputs.clear();
    this.cleaned = true;
  }
}
