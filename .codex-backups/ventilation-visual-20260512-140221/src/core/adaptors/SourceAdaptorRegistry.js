import { CSVTableAdaptor } from './CSVTableAdaptor.js';
import { JSONGraphAdaptor } from './JSONGraphAdaptor.js';
import { OBJGeometryAdaptor } from './OBJGeometryAdaptor.js';
import { VentilationNetworkJsonAdaptor } from './VentilationNetworkJsonAdaptor.js';
import { AirflowStateCsvAdaptor } from './AirflowStateCsvAdaptor.js';

export class SourceAdaptorRegistry {
  constructor() {
    this.adaptors = new Map();
  }

  register(adaptor) {
    this.adaptors.set(adaptor.id, adaptor);
  }

  get(id) {
    return this.adaptors.get(id);
  }

  list() {
    return [...this.adaptors.values()];
  }

  infer(source) {
    return this.list().find((adaptor) => adaptor.supports(source)) ?? null;
  }

  async load(source, contract = null) {
    const adaptor = this.get(source?.adaptor) || this.infer(source);
    if (!adaptor) throw new Error(`No source adaptor supports ${source?.path || source?.name || 'source'}`);
    const result = await adaptor.load(source, contract);
    return {
      adaptorId: adaptor.id,
      adaptorLabel: adaptor.label,
      ...result
    };
  }
}

export const DefaultSourceAdaptorRegistry = new SourceAdaptorRegistry();
DefaultSourceAdaptorRegistry.register(new VentilationNetworkJsonAdaptor());
DefaultSourceAdaptorRegistry.register(new AirflowStateCsvAdaptor());
DefaultSourceAdaptorRegistry.register(new CSVTableAdaptor());
DefaultSourceAdaptorRegistry.register(new JSONGraphAdaptor());
DefaultSourceAdaptorRegistry.register(new OBJGeometryAdaptor());
