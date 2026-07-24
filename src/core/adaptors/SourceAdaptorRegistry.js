import { CSVTableAdaptor } from './CSVTableAdaptor.js';
import { JSONGraphAdaptor } from './JSONGraphAdaptor.js';
import { OBJGeometryAdaptor } from './OBJGeometryAdaptor.js';
import { VentilationNetworkJsonAdaptor } from './VentilationNetworkJsonAdaptor.js';
import { AirflowStateCsvAdaptor } from './AirflowStateCsvAdaptor.js';
import { PeopleJsonAdaptor } from './PeopleJsonAdaptor.js';
import { EmergencyResourcesJsonAdaptor } from './EmergencyResourcesJsonAdaptor.js';
import { RoadwayHazardStateAdaptor } from './RoadwayHazardStateAdaptor.js';
import {
  LayeredGeologyJsonAdaptor,
  SurfaceMeshGeologyAdaptor,
  ResourceBlockGridJsonAdaptor,
  ResourceBlockAttributeBinaryAdaptor,
  VolumetricBlockModelJsonAdaptor,
  BlockModelCsvAdaptor,
  BoreholeJsonAdaptor,
  BoreholeTrajectoryJsonAdaptor,
  BoreholeCsvAdaptor,
  GeologicalStructureJsonAdaptor,
  GeologicalAttributeTableAdaptor
} from './GeologyAdaptors.js';

function normalizeSourcePayload(source) {
  if (!source || typeof source !== 'object') return source;
  if (typeof source.text !== 'string' || source.text.trim() || !source.path) return source;
  const normalized = { ...source };
  delete normalized.text;
  return normalized;
}

function createAdaptorFacade(adaptor) {
  if (!adaptor?.id || typeof adaptor.load !== 'function') {
    throw new Error('A source adaptor must declare id and load(source, contract).');
  }

  const canLoad = typeof adaptor.canLoad === 'function'
    ? adaptor.canLoad.bind(adaptor)
    : typeof adaptor.supports === 'function'
      ? adaptor.supports.bind(adaptor)
      : () => false;
  const load = adaptor.load.bind(adaptor);
  const inspect = typeof adaptor.inspect === 'function'
    ? adaptor.inspect.bind(adaptor)
    : async (source, contract = null) => {
        const result = await load(source, contract);
        const fields = [...new Set([...(result?.fields || []), ...(result?.paths || [])])];
        return {
          kind: result?.kind || adaptor.kind || 'source',
          fields,
          paths: result?.paths || result?.fields || [],
          summary: result?.summary || {},
          suggestedRoleMapping: result?.suggestedRoleMapping || {}
        };
      };

  return Object.assign(Object.create(adaptor), {
    canLoad,
    supports: canLoad,
    load,
    inspect
  });
}

export class SourceAdaptorRegistry {
  constructor() {
    this.adaptors = new Map();
  }

  register(adaptor) {
    const facade = createAdaptorFacade(adaptor);
    this.adaptors.set(facade.id, facade);
    return facade;
  }

  get(id) {
    return this.adaptors.get(id);
  }

  list() {
    return [...this.adaptors.values()];
  }

  infer(source) {
    return this.list().find((adaptor) => adaptor.canLoad(source)) ?? null;
  }

  resolve(source) {
    return this.get(source?.adaptor) || this.infer(source);
  }

  async load(source, contract = null) {
    const normalizedSource = normalizeSourcePayload(source);
    const adaptor = this.resolve(normalizedSource);
    if (!adaptor) throw new Error(`No source adaptor supports ${source?.path || source?.name || 'source'}`);
    const result = await adaptor.load(normalizedSource, contract);
    return {
      adaptorId: adaptor.id,
      adaptorLabel: adaptor.label,
      ...result
    };
  }

  async inspect(source, contract = null) {
    const normalizedSource = normalizeSourcePayload(source);
    const adaptor = this.resolve(normalizedSource);
    if (!adaptor) throw new Error(`No source adaptor supports ${source?.path || source?.name || 'source'}`);
    const result = await adaptor.inspect(normalizedSource, contract);
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
DefaultSourceAdaptorRegistry.register(new PeopleJsonAdaptor());
DefaultSourceAdaptorRegistry.register(new EmergencyResourcesJsonAdaptor());
DefaultSourceAdaptorRegistry.register(new RoadwayHazardStateAdaptor());
DefaultSourceAdaptorRegistry.register(new LayeredGeologyJsonAdaptor());
DefaultSourceAdaptorRegistry.register(new SurfaceMeshGeologyAdaptor());
DefaultSourceAdaptorRegistry.register(new ResourceBlockGridJsonAdaptor());
DefaultSourceAdaptorRegistry.register(new ResourceBlockAttributeBinaryAdaptor());
DefaultSourceAdaptorRegistry.register(new VolumetricBlockModelJsonAdaptor());
DefaultSourceAdaptorRegistry.register(new BlockModelCsvAdaptor());
DefaultSourceAdaptorRegistry.register(new BoreholeTrajectoryJsonAdaptor());
DefaultSourceAdaptorRegistry.register(new BoreholeJsonAdaptor());
DefaultSourceAdaptorRegistry.register(new BoreholeCsvAdaptor());
DefaultSourceAdaptorRegistry.register(new GeologicalStructureJsonAdaptor());
DefaultSourceAdaptorRegistry.register(new GeologicalAttributeTableAdaptor());
DefaultSourceAdaptorRegistry.register(new CSVTableAdaptor());
DefaultSourceAdaptorRegistry.register(new JSONGraphAdaptor());
DefaultSourceAdaptorRegistry.register(new OBJGeometryAdaptor());
