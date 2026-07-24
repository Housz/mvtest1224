import { OperatorExecutionContext } from './OperatorExecutionContext.js';

export class BaseOperatorRuntime {
  constructor(nodeModel, inputs = {}) {
    this.nodeModel = nodeModel;
    this.inputs = inputs;
    this.id = nodeModel?.id;
    this.label = nodeModel?.label;
    this.params = nodeModel?.params || {};
    this.definition = null;
    this.operatorManifest = null;
    this.executionContext = null;
    this.disposers = [];
    this.panels = [];
    this.contributionHandles = [];
    this.outputs = {};
    this.outputListeners = new Map();
  }

  beginExecution(options = {}) {
    this.executionContext?.cleanup();
    this.executionContext = new OperatorExecutionContext({
      operator: this,
      ...options,
      contributionManager: options.contributionManager || options.contributionRegistry
    });
    return this.executionContext;
  }

  trackDisposer(dispose) {
    if (typeof dispose === 'function') this.disposers.push(dispose);
    this.executionContext?.track(dispose);
    return dispose;
  }

  trackPanel(panel) {
    if (panel) this.panels.push(panel);
    this.executionContext?.trackPanel(panel);
    return panel;
  }

  trackResource(resource, dispose = null) {
    return this.executionContext?.trackResource(resource, dispose) || resource;
  }

  trackContribution(handle) {
    if (handle) this.contributionHandles.push(handle);
    return handle;
  }

  registerContribution(contribution) {
    const handle = this.executionContext?.registerContribution(contribution);
    return this.trackContribution(handle);
  }

  publishOutput(portId, dataset) {
    this.outputs[portId] = dataset;
    this.executionContext?.publishOutput(portId, dataset);
    (this.outputListeners.get(portId) || []).forEach((listener) => listener(dataset));
    return dataset;
  }

  getOutputDataset(portId) {
    return this.outputs[portId] || this.executionContext?.getOutput(portId) || null;
  }

  subscribeOutput(portId, listener) {
    if (!this.outputListeners.has(portId)) this.outputListeners.set(portId, new Set());
    this.outputListeners.get(portId).add(listener);
    return () => this.outputListeners.get(portId)?.delete(listener);
  }

  cleanupBase() {
    this.contributionHandles.splice(0).forEach((handle) => handle?.cleanup?.());
    this.disposers.splice(0).reverse().forEach((dispose) => dispose?.());
    this.panels.splice(0).forEach((panel) => panel?.remove?.());
    this.executionContext?.cleanup();
    this.executionContext = null;
    this.outputListeners.clear();
  }
}

export function adoptOperatorRuntime(runtime, nodeModel = null, inputs = {}) {
  if (!runtime || typeof runtime !== 'object') {
    throw new Error('Operator runtime factory must return an object.');
  }
  const defaults = new BaseOperatorRuntime(nodeModel || runtime.nodeModel || {}, inputs);
  [
    'nodeModel',
    'inputs',
    'id',
    'label',
    'params',
    'definition',
    'operatorManifest',
    'executionContext',
    'disposers',
    'panels',
    'contributionHandles',
    'outputs',
    'outputListeners'
  ].forEach((key) => {
    if (runtime[key] === undefined) runtime[key] = defaults[key];
  });
  Object.getOwnPropertyNames(BaseOperatorRuntime.prototype)
    .filter((name) => name !== 'constructor' && typeof BaseOperatorRuntime.prototype[name] === 'function')
    .forEach((name) => {
      if (typeof runtime[name] === 'function') return;
      Object.defineProperty(runtime, name, {
        configurable: true,
        writable: true,
        value: BaseOperatorRuntime.prototype[name]
      });
    });
  runtime.operatorRuntimeContractVersion = 1;
  return runtime;
}
