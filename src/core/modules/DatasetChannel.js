import { DatasetDefinitionRegistry } from '../datasets/definitions/index.js';

function emptyValidation() {
  return { valid: true, errors: [], warnings: [], diagnostics: [], summary: {} };
}

export class DatasetChannel {
  constructor({
    id,
    type,
    operator = null,
    portId = id,
    definitionRegistry = DatasetDefinitionRegistry
  }) {
    this.id = id;
    this.type = type;
    this.operator = operator;
    this.portId = portId;
    this.definitionRegistry = definitionRegistry;
    this.dataset = null;
    this.validation = emptyValidation();
    this.listeners = new Set();
    this.revision = 0;
    this.upstreamDispose = null;
  }

  validate(dataset) {
    if (dataset == null) return emptyValidation();
    const diagnostics = [];
    if (this.type && dataset.type !== this.type) {
      diagnostics.push({
        severity: 'error',
        code: 'output-dataset-type-mismatch',
        message: `Output ${this.portId} expected ${this.type}, received ${dataset.type || '<missing>'}.`,
        path: 'type'
      });
    }
    const definition = this.definitionRegistry.getByType(this.type) ||
      this.definitionRegistry.getByType(dataset.type) ||
      this.definitionRegistry.getByClass(dataset.semanticClass);
    if (!definition) {
      diagnostics.push({
        severity: 'error',
        code: 'output-dataset-definition-missing',
        message: `No Dataset definition is registered for output type ${this.type || dataset.type}.`,
        path: 'type'
      });
    } else {
      diagnostics.push(...this.definitionRegistry.validateDataset(dataset, definition).diagnostics);
    }
    const errors = diagnostics.filter((item) => item.severity === 'error').map((item) => item.message);
    const warnings = diagnostics.filter((item) => item.severity === 'warning').map((item) => item.message);
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      diagnostics,
      summary: {
        channelId: this.id,
        portId: this.portId,
        datasetType: dataset.type,
        semanticClass: dataset.semanticClass
      }
    };
  }

  publish(dataset, { source = this.operator?.id || 'runtime', throwOnInvalid = true } = {}) {
    const validation = this.validate(dataset);
    this.validation = validation;
    if (!validation.valid && throwOnInvalid) {
      throw new Error(`Invalid Dataset output on ${this.portId}: ${validation.errors.join(' ')}`);
    }
    this.dataset = dataset;
    this.revision += 1;
    const event = { dataset, validation, revision: this.revision, source };
    this.listeners.forEach((listener) => listener(dataset, event));
    return event;
  }

  refresh({ throwOnInvalid = true } = {}) {
    const dataset = this.operator?.getOutputDataset?.(this.portId) ??
      this.operator?.outputs?.[this.portId] ??
      this.dataset;
    if (dataset !== this.dataset || this.revision === 0) {
      this.publish(dataset, { throwOnInvalid });
    }
    return this.dataset;
  }

  getDataset() {
    return this.refresh();
  }

  subscribe(listener, { immediate = false } = {}) {
    this.listeners.add(listener);
    if (immediate && this.dataset) listener(this.dataset, {
      dataset: this.dataset,
      validation: this.validation,
      revision: this.revision,
      source: 'current'
    });
    if (!this.upstreamDispose && this.operator?.subscribeOutput) {
      this.upstreamDispose = this.operator.subscribeOutput(this.portId, (dataset) => {
        this.publish(dataset);
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.upstreamDispose) {
        this.upstreamDispose();
        this.upstreamDispose = null;
      }
    };
  }

  asInputProxy() {
    return {
      __operatorDatasetOutput: true,
      portId: this.portId,
      type: this.type,
      operator: this.operator,
      channel: this,
      getDataset: () => this.getDataset(),
      peekDataset: () => this.dataset,
      subscribe: (callback) => this.subscribe(callback)
    };
  }
}
