export class BaseOperatorRuntime {
  constructor(nodeModel, inputs = {}) {
    this.nodeModel = nodeModel;
    this.inputs = inputs;
    this.id = nodeModel?.id;
    this.disposers = [];
    this.panels = [];
    this.contributionHandles = [];
  }

  trackDisposer(dispose) {
    if (typeof dispose === 'function') this.disposers.push(dispose);
    return dispose;
  }

  trackPanel(panel) {
    if (panel) this.panels.push(panel);
    return panel;
  }

  trackContribution(handle) {
    if (handle) this.contributionHandles.push(handle);
    return handle;
  }

  cleanupBase() {
    this.contributionHandles.splice(0).forEach((handle) => handle?.cleanup?.());
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.panels.splice(0).forEach((panel) => panel?.remove?.());
  }
}
