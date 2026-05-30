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
