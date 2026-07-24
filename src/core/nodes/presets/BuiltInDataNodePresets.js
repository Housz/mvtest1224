import { EnvironmentalReadingPresets } from '../../environmental/EnvironmentalPresets.js';
import { defaultRoleMapping, semanticizeDataNode } from '../DataNodeRuntime.js';
import { registerDataNodeDefinitions } from '../DataNodePresetRegistry.js';

const outputPort = (name, type) => [{ id: 'dataset', name, direction: 'out', type }];
const roadwayDefaults = {
  datasetType: 'Roadway',
  contractId: 'RoadwayContract',
  sources: {
    topology: { label: 'Topology JSON', path: '/data/roadway_topo.json', adaptor: 'JSONGraphAdaptor' },
    geometry: { label: 'Roadway OBJ', path: '/data/roadway_model.obj', adaptor: 'OBJGeometryAdaptor' }
  },
  roleMapping: defaultRoleMapping('RoadwayContract')
};

const registryDefaults = {
  datasetType: 'SensorRegistry',
  contractId: 'SensorRegistryContract',
  sources: {
    registry: { label: 'Registry CSV', path: '/data/temperature_sensors.csv', adaptor: 'CSVTableAdaptor' }
  },
  roleMapping: defaultRoleMapping('SensorRegistryContract')
};

const readingsDefaults = {
  datasetType: 'SensorReadings',
  contractId: 'SensorReadingsContract',
  presetId: 'temperature',
  sources: {
    readings: { label: 'Readings Source', path: '/data/Temperature_timeseries_20steps.csv', adaptor: 'CSVTableAdaptor' }
  },
  roleMapping: defaultRoleMapping('SensorReadingsContract'),
  variable: 'temperature',
  unit: 'degC'
};

const ventilationNetworkDefaults = {
  datasetType: 'VentilationNetwork',
  contractId: 'VentilationNetworkContract',
  sources: {
    network: {
      label: 'Network Source',
      path: '/data/ventilation_network.json',
      adaptor: 'VentilationNetworkJsonAdaptor'
    }
  },
  roleMapping: defaultRoleMapping('VentilationNetworkContract')
};

const airflowStateDefaults = {
  datasetType: 'AirflowState',
  contractId: 'AirflowStateContract',
  sources: {
    state: {
      label: 'State Source',
      path: '/data/airflow_state.csv',
      adaptor: 'AirflowStateCsvAdaptor'
    }
  },
  roleMapping: defaultRoleMapping('AirflowStateContract')
};

const peopleDefaults = {
  datasetType: 'People',
  contractId: 'PeopleContract',
  sources: {
    people: {
      label: 'People Source',
      path: '/data/people.json',
      adaptor: 'PeopleJsonAdaptor'
    }
  },
  roleMapping: defaultRoleMapping('PeopleContract')
};

const emergencyResourcesDefaults = {
  datasetType: 'EmergencyResources',
  contractId: 'EmergencyResourcesContract',
  sources: {
    resources: {
      label: 'Resources Source',
      path: '/data/emergency_resources.json',
      adaptor: 'EmergencyResourcesJsonAdaptor'
    }
  },
  roleMapping: defaultRoleMapping('EmergencyResourcesContract')
};

const roadwayHazardStateDefaults = {
  datasetType: 'RoadwayHazardState',
  contractId: 'RoadwayHazardStateContract',
  sources: {
    state: {
      label: 'Hazard State Source',
      path: '/data/roadway_hazard_state_mock.csv',
      adaptor: 'RoadwayHazardStateAdaptor'
    }
  },
  roleMapping: defaultRoleMapping('RoadwayHazardStateContract')
};

const GEOLOGY_PROFILES = {
  body: ['layered-surface', 'volumetric-block', 'hybrid', 'generic'],
  attribute: ['resource-block', 'coal-seam-attribute', 'risk-uncertainty', 'surface-attribute', 'generic']
};

const GEOLOGY_BASE = '/data/geological/';

const layeredGeologicalBodyDefaults = {
  datasetType: 'GeologicalBody',
  semanticClass: 'GeologicalBody',
  contractId: 'GeologicalBodyContract',
  representationProfile: 'layered-surface',
  descriptorPath: '',
  metadata: { taxonomyGroup: 'Geology & Resource', preset: 'Layered Geological Body' },
  profileOptions: GEOLOGY_PROFILES.body,
  sources: {
    descriptor: { label: 'Dataset Descriptor', template: 'Descriptor', path: '', adaptor: 'JSONGraphAdaptor', acceptedFormats: ['json'], required: false },
    geometry: { label: 'Surface Geometry Source', template: 'Geometry', path: `${GEOLOGY_BASE}layered_geological_surfaces.obj`, adaptor: 'SurfaceMeshGeologyAdaptor', acceptedFormats: ['obj', 'gltf', 'glb'], required: true },
    units: { label: 'Geological Units Table', template: 'Registry', path: `${GEOLOGY_BASE}layered_geological_units.csv`, adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv'], required: true },
    surfaces: { label: 'Surface Mapping Table', template: 'Geometry / Relation', path: `${GEOLOGY_BASE}layered_geological_surfaces.csv`, adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv'], required: true },
    attributes: { label: 'Attribute Field Table', template: 'Field', path: '', adaptor: 'GeologicalAttributeTableAdaptor', acceptedFormats: ['csv'], required: false },
    relations: { label: 'Relations Source', template: 'Relation', path: `${GEOLOGY_BASE}layered_geological_relations.csv`, adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    body: { label: 'Legacy Single JSON', template: 'Legacy', path: '', adaptor: 'LayeredGeologyJsonAdaptor', acceptedFormats: ['json'], required: false }
  },
  roleMapping: defaultRoleMapping('GeologicalBodyContract')
};

const volumetricGeologicalBodyDefaults = {
  datasetType: 'GeologicalBody',
  semanticClass: 'GeologicalBody',
  contractId: 'GeologicalBodyContract',
  representationProfile: 'volumetric-block',
  descriptorPath: '',
  metadata: { taxonomyGroup: 'Geology & Resource', preset: 'Volumetric / Block Geological Body' },
  profileOptions: GEOLOGY_PROFILES.body,
  sources: {
    descriptor: { label: 'Dataset Descriptor', template: 'Descriptor', path: '', adaptor: 'JSONGraphAdaptor', acceptedFormats: ['json'], required: false },
    geometry: { label: 'Boundary Geometry', template: 'Geometry', path: `${GEOLOGY_BASE}geovolume_geological_bodies.obj`, adaptor: 'SurfaceMeshGeologyAdaptor', acceptedFormats: ['obj', 'gltf', 'glb'], required: false },
    units: { label: 'Geological Units Table', template: 'Registry', path: `${GEOLOGY_BASE}geovolume_bodies.csv`, adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv'], required: true },
    surfaces: { label: 'Domain Mapping Table', template: 'Geometry / Relation', path: `${GEOLOGY_BASE}geovolume_surfaces.csv`, adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv'], required: false },
    relations: { label: 'Relations Source', template: 'Relation', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    blocks: { label: 'Block Table CSV', template: 'Field', path: '', adaptor: 'BlockModelCsvAdaptor', acceptedFormats: ['csv'], required: false },
    body: { label: 'Legacy Single JSON', template: 'Legacy', path: '', adaptor: 'VolumetricBlockModelJsonAdaptor', acceptedFormats: ['json'], required: false }
  },
  roleMapping: defaultRoleMapping('GeologicalBodyContract')
};

const geologicalBodyDefaults = {
  datasetType: 'GeologicalBody',
  semanticClass: 'GeologicalBody',
  contractId: 'GeologicalBodyContract',
  representationProfile: 'generic',
  descriptorPath: '',
  metadata: { taxonomyGroup: 'Geology & Resource', preset: 'Geological Body' },
  profileOptions: GEOLOGY_PROFILES.body,
  sources: {
    descriptor: { label: 'Dataset Descriptor', template: 'Descriptor', path: '', adaptor: 'JSONGraphAdaptor', acceptedFormats: ['json'], required: false },
    geometry: { label: 'Geometry Source', template: 'Geometry', path: '', adaptor: 'SurfaceMeshGeologyAdaptor', acceptedFormats: ['obj', 'gltf', 'glb', 'json'], required: false },
    units: { label: 'Registry Table', template: 'Registry', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    surfaces: { label: 'Surface / Mesh Mapping Table', template: 'Geometry / Relation', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv'], required: false },
    attributes: { label: 'Attribute Field Table', template: 'Field', path: '', adaptor: 'GeologicalAttributeTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    relations: { label: 'Relations Source', template: 'Relation', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    body: { label: 'Legacy Single JSON', template: 'Legacy', path: '', adaptor: 'LayeredGeologyJsonAdaptor', acceptedFormats: ['json'], required: false }
  },
  roleMapping: defaultRoleMapping('GeologicalBodyContract')
};

const boreholeDefaults = {
  datasetType: 'Borehole',
  semanticClass: 'Borehole',
  contractId: 'BoreholeContract',
  descriptorPath: '',
  metadata: { taxonomyGroup: 'Geology & Resource', preset: 'Borehole' },
  sources: {
    descriptor: { label: 'Dataset Descriptor', template: 'Descriptor', path: '', adaptor: 'JSONGraphAdaptor', acceptedFormats: ['json'], required: false },
    boreholes: { label: 'Borehole Registry Table', template: 'Registry', path: `${GEOLOGY_BASE}boreholes.csv`, adaptor: 'BoreholeCsvAdaptor', acceptedFormats: ['csv'], required: true },
    trajectories: { label: 'Trajectory Table', template: 'Geometry', path: `${GEOLOGY_BASE}borehole_trajectories.json`, adaptor: 'BoreholeTrajectoryJsonAdaptor', acceptedFormats: ['json', 'csv'], required: false },
    intervals: { label: 'Intervals Table', template: 'Field', path: `${GEOLOGY_BASE}borehole_intervals.csv`, adaptor: 'BoreholeCsvAdaptor', acceptedFormats: ['csv'], required: false },
    assays: { label: 'Assay Table', template: 'Field', path: '', adaptor: 'BoreholeCsvAdaptor', acceptedFormats: ['csv'], required: false },
    relations: { label: 'Relations Source', template: 'Relation', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    legacy: { label: 'Legacy Single JSON', template: 'Legacy', path: '', adaptor: 'BoreholeJsonAdaptor', acceptedFormats: ['json'], required: false }
  },
  roleMapping: defaultRoleMapping('BoreholeContract')
};

const geologicalStructureDefaults = {
  datasetType: 'GeologicalStructure',
  semanticClass: 'GeologicalStructure',
  contractId: 'GeologicalStructureContract',
  descriptorPath: '',
  metadata: { taxonomyGroup: 'Geology & Resource', preset: 'Geological Structure' },
  sources: {
    descriptor: { label: 'Dataset Descriptor', template: 'Descriptor', path: '', adaptor: 'JSONGraphAdaptor', acceptedFormats: ['json'], required: false },
    geometry: { label: 'Structure Surface Geometry', template: 'Geometry', path: `${GEOLOGY_BASE}geological_structures.obj`, adaptor: 'SurfaceMeshGeologyAdaptor', acceptedFormats: ['obj', 'gltf', 'glb'], required: false },
    structures: { label: 'Structure Registry Table', template: 'Registry', path: `${GEOLOGY_BASE}geological_structures.csv`, adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv'], required: true },
    traces: { label: 'Trace Table', template: 'Geometry', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv'], required: false },
    relations: { label: 'Relations Source', template: 'Relation', path: `${GEOLOGY_BASE}geological_structure_relations.csv`, adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    legacy: { label: 'Legacy Single JSON', template: 'Legacy', path: '', adaptor: 'GeologicalStructureJsonAdaptor', acceptedFormats: ['json'], required: false }
  },
  roleMapping: defaultRoleMapping('GeologicalStructureContract')
};

const resourceBlockModelDefaults = {
  datasetType: 'GeologicalAttributeModel',
  semanticClass: 'GeologicalAttributeModel',
  contractId: 'GeologicalAttributeModelContract',
  representationProfile: 'resource-block',
  descriptorPath: '',
  metadata: { taxonomyGroup: 'Geology & Resource', preset: 'Resource Block Model' },
  profileOptions: GEOLOGY_PROFILES.attribute,
  sources: {
    descriptor: { label: 'Dataset Descriptor', template: 'Descriptor', path: '', adaptor: 'JSONGraphAdaptor', acceptedFormats: ['json'], required: false },
    grid: { label: 'Resource Block Grid Metadata', template: 'Geometry', path: `${GEOLOGY_BASE}resource_block_grid.json`, adaptor: 'ResourceBlockGridJsonAdaptor', acceptedFormats: ['json'], required: true },
    binary: { label: 'Attribute Binary Array', template: 'Field', path: `${GEOLOGY_BASE}resource_block_attributes.bin`, adaptor: 'ResourceBlockAttributeBinaryAdaptor', acceptedFormats: ['bin', 'raw'], required: true },
    schema: { label: 'Attribute Schema Table', template: 'Field', path: `${GEOLOGY_BASE}resource_block_attribute_schema.csv`, adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv'], required: true },
    blocks: { label: 'Blocks Table', template: 'Geometry / Field', path: '', adaptor: 'BlockModelCsvAdaptor', acceptedFormats: ['csv'], required: false },
    relations: { label: 'Relations Source', template: 'Relation', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    geometry: { label: 'Boundary Geometry', template: 'Geometry', path: '', adaptor: 'SurfaceMeshGeologyAdaptor', acceptedFormats: ['obj', 'gltf', 'glb'], required: false },
    preview: { label: 'Preview / Sample Table', template: 'Preview', path: '', adaptor: 'GeologicalAttributeTableAdaptor', acceptedFormats: ['csv'], required: false },
    model: { label: 'Legacy Single JSON or CSV', template: 'Legacy', path: '', adaptor: 'GeologicalAttributeTableAdaptor', acceptedFormats: ['json', 'csv'], required: false }
  },
  roleMapping: defaultRoleMapping('GeologicalAttributeModelContract')
};

const coalSeamAttributeModelDefaults = {
  datasetType: 'GeologicalAttributeModel',
  semanticClass: 'GeologicalAttributeModel',
  contractId: 'GeologicalAttributeModelContract',
  representationProfile: 'coal-seam-attribute',
  descriptorPath: '',
  metadata: { taxonomyGroup: 'Geology & Resource', preset: 'Coal Seam Attribute Model' },
  profileOptions: GEOLOGY_PROFILES.attribute,
  sources: {
    descriptor: { label: 'Dataset Descriptor', template: 'Descriptor', path: '', adaptor: 'JSONGraphAdaptor', acceptedFormats: ['json'], required: false },
    elements: { label: 'Attribute Samples Table', template: 'Field', path: `${GEOLOGY_BASE}coal_seam_attribute_grid.csv`, adaptor: 'GeologicalAttributeTableAdaptor', acceptedFormats: ['csv'], required: true },
    schema: { label: 'Attribute Schema Table', template: 'Field', path: `${GEOLOGY_BASE}coal_seam_attribute_schema.csv`, adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv'], required: false },
    relations: { label: 'Relations Source', template: 'Relation', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    geometry: { label: 'Support Geometry', template: 'Geometry', path: '', adaptor: 'SurfaceMeshGeologyAdaptor', acceptedFormats: ['obj', 'gltf', 'glb'], required: false },
    model: { label: 'Legacy Single JSON', template: 'Legacy', path: '', adaptor: 'GeologicalAttributeTableAdaptor', acceptedFormats: ['json'], required: false }
  },
  roleMapping: defaultRoleMapping('GeologicalAttributeModelContract')
};

const geologicalRiskUncertaintyModelDefaults = {
  datasetType: 'GeologicalAttributeModel',
  semanticClass: 'GeologicalAttributeModel',
  contractId: 'GeologicalAttributeModelContract',
  representationProfile: 'risk-uncertainty',
  descriptorPath: '',
  metadata: { taxonomyGroup: 'Geology & Resource', preset: 'Geological Risk / Uncertainty Model' },
  profileOptions: GEOLOGY_PROFILES.attribute,
  sources: {
    descriptor: { label: 'Dataset Descriptor', template: 'Descriptor', path: '', adaptor: 'JSONGraphAdaptor', acceptedFormats: ['json'], required: false },
    elements: { label: 'Risk / Uncertainty Table', template: 'Field', path: '', adaptor: 'GeologicalAttributeTableAdaptor', acceptedFormats: ['csv'], required: true },
    schema: { label: 'Attribute Schema Table', template: 'Field', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv'], required: false },
    relations: { label: 'Relations Source', template: 'Relation', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    geometry: { label: 'Support Geometry', template: 'Geometry', path: '', adaptor: 'SurfaceMeshGeologyAdaptor', acceptedFormats: ['obj', 'gltf', 'glb'], required: false },
    model: { label: 'Legacy Single JSON', template: 'Legacy', path: '', adaptor: 'GeologicalAttributeTableAdaptor', acceptedFormats: ['json'], required: false }
  },
  roleMapping: defaultRoleMapping('GeologicalAttributeModelContract')
};

const geologicalAttributeModelDefaults = {
  datasetType: 'GeologicalAttributeModel',
  semanticClass: 'GeologicalAttributeModel',
  contractId: 'GeologicalAttributeModelContract',
  representationProfile: 'generic',
  descriptorPath: '',
  metadata: { taxonomyGroup: 'Geology & Resource', preset: 'Geological Attribute Model' },
  profileOptions: GEOLOGY_PROFILES.attribute,
  sources: {
    descriptor: { label: 'Dataset Descriptor', template: 'Descriptor', path: '', adaptor: 'JSONGraphAdaptor', acceptedFormats: ['json'], required: false },
    geometry: { label: 'Geometry Source', template: 'Geometry', path: '', adaptor: 'SurfaceMeshGeologyAdaptor', acceptedFormats: ['obj', 'gltf', 'glb', 'json'], required: false },
    elements: { label: 'Attribute Table', template: 'Field', path: '', adaptor: 'GeologicalAttributeTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    schema: { label: 'Attribute Schema Table', template: 'Field', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv'], required: false },
    relations: { label: 'Relations Source', template: 'Relation', path: '', adaptor: 'CSVTableAdaptor', acceptedFormats: ['csv', 'json'], required: false },
    model: { label: 'Legacy Single JSON', template: 'Legacy', path: '', adaptor: 'GeologicalAttributeTableAdaptor', acceptedFormats: ['json'], required: false }
  },
  roleMapping: defaultRoleMapping('GeologicalAttributeModelContract')
};

const readingTypeIds = {
  temperature: 'SensorReadingsDataNode',
  CO: 'COSensorReadingsDataNode',
  humidity: 'HumiditySensorReadingsDataNode',
  CH4: 'CH4SensorReadingsDataNode',
  environmental: 'EnvironmentalSensorReadingsDataNode'
};

function readingDefaultsFromPreset(preset) {
  return {
    datasetType: 'SensorReadings',
    contractId: 'SensorReadingsContract',
    presetId: preset.id,
    sources: {
      readings: { label: 'Readings Source', path: preset.sourcePath, adaptor: 'CSVTableAdaptor' }
    },
    roleMapping: {
      ...defaultRoleMapping('SensorReadingsContract'),
      measuredValue: preset.measuredValuePath || 'value'
    },
    variable: preset.variable,
    unit: preset.unit
  };
}

function createReadingsDefinition(preset) {
  return {
    typeId: readingTypeIds[preset.id],
    label: preset.label,
    kind: 'data',
    category: preset.id === 'environmental' ? 'Data / Generic' : 'Data',
    libraryCategory: 'Monitoring & Sensing',
    color: '#1f7ad6',
    ports: outputPort('Sensor Readings', 'SensorReadingsDataset'),
    defaultParams: readingDefaultsFromPreset(preset),
    inlineControls: [
      { type: 'sources', label: 'Sources' },
      { type: 'text', key: 'variable', label: 'Variable' },
      { type: 'text', key: 'unit', label: 'Unit' }
    ],
    createRuntime() {
      return {
        async execute(registry, nodeModel) {
          const result = await semanticizeDataNode(nodeModel);
          return { dataset: result.dataset };
        }
      };
    }
  };
}

function createSemanticDataDefinition({ typeId, label, portName, portType, defaultParams, libraryCategory = 'Geology & Resources' }) {
  return {
    typeId,
    label,
    kind: 'data',
    category: 'Data',
    libraryCategory,
    color: '#1f7ad6',
    ports: outputPort(portName, portType),
    defaultParams,
    inlineControls: [{ type: 'sources', label: 'Sources' }],
    createRuntime() {
      return {
        async execute(registry, nodeModel) {
          const result = await semanticizeDataNode(nodeModel);
          return { dataset: result.dataset };
        }
      };
    }
  };
}

const dataNodeDefinitions = [
  {
    typeId: 'RoadwayDataNode',
    label: 'Roadway',
    kind: 'data',
    category: 'Data',
    libraryCategory: 'Roadways & Infrastructure',
    color: '#1f7ad6',
    ports: outputPort('Roadway', 'RoadwayDataset'),
    defaultParams: roadwayDefaults,
    inlineControls: [{ type: 'sources', label: 'Sources' }],
    createRuntime() {
      return {
        async execute(registry, nodeModel) {
          const result = await semanticizeDataNode(nodeModel);
          return { dataset: result.dataset };
        }
      };
    }
  },
  {
    typeId: 'SensorRegistryDataNode',
    label: 'Sensor Registry',
    kind: 'data',
    category: 'Data',
    libraryCategory: 'Monitoring & Sensing',
    color: '#1f7ad6',
    ports: outputPort('Sensor Registry', 'SensorRegistryDataset'),
    defaultParams: registryDefaults,
    inlineControls: [{ type: 'sources', label: 'Sources' }],
    createRuntime() {
      return {
        async execute(registry, nodeModel) {
          const result = await semanticizeDataNode(nodeModel);
          return { dataset: result.dataset };
        }
      };
    }
  },
  {
    ...createReadingsDefinition({
      ...EnvironmentalReadingPresets.temperature,
      label: 'Temperature Sensor Readings'
    }),
    defaultParams: readingsDefaults,
    inlineControls: [
      { type: 'sources', label: 'Sources' },
      { type: 'text', key: 'variable', label: 'Variable' },
      { type: 'text', key: 'unit', label: 'Unit' }
    ]
  },
  createReadingsDefinition(EnvironmentalReadingPresets.CO),
  createReadingsDefinition(EnvironmentalReadingPresets.humidity),
  createReadingsDefinition(EnvironmentalReadingPresets.CH4),
  createReadingsDefinition(EnvironmentalReadingPresets.environmental),
  {
    typeId: 'VentilationNetworkDataNode',
    label: 'Ventilation Network',
    kind: 'data',
    category: 'Data',
    libraryCategory: 'Ventilation & Utility Network',
    color: '#1f7ad6',
    ports: outputPort('Ventilation Network', 'VentilationNetworkDataset'),
    defaultParams: ventilationNetworkDefaults,
    inlineControls: [{ type: 'sources', label: 'Sources' }],
    createRuntime() {
      return {
        async execute(registry, nodeModel) {
          const result = await semanticizeDataNode(nodeModel);
          return { dataset: result.dataset };
        }
      };
    }
  },
  {
    typeId: 'AirflowStateDataNode',
    label: 'Airflow State',
    kind: 'data',
    category: 'Data',
    libraryCategory: 'Ventilation & Utility Network',
    color: '#1f7ad6',
    ports: outputPort('Airflow State', 'AirflowStateDataset'),
    defaultParams: airflowStateDefaults,
    inlineControls: [{ type: 'sources', label: 'Sources' }],
    createRuntime() {
      return {
        async execute(registry, nodeModel) {
          const result = await semanticizeDataNode(nodeModel);
          return { dataset: result.dataset };
        }
      };
    }
  },
  {
    typeId: 'PeopleDataNode',
    label: 'People',
    kind: 'data',
    category: 'Data',
    libraryCategory: 'People & Vehicles',
    color: '#1f7ad6',
    ports: outputPort('People', 'PeopleDataset'),
    defaultParams: peopleDefaults,
    inlineControls: [{ type: 'sources', label: 'Sources' }],
    createRuntime() {
      return {
        async execute(registry, nodeModel) {
          const result = await semanticizeDataNode(nodeModel);
          return { dataset: result.dataset };
        }
      };
    }
  },
  {
    typeId: 'EmergencyResourcesDataNode',
    label: 'Emergency Resources',
    kind: 'data',
    category: 'Data',
    libraryCategory: 'Safety & Emergency',
    color: '#1f7ad6',
    ports: outputPort('Emergency Resources', 'EmergencyResourcesDataset'),
    defaultParams: emergencyResourcesDefaults,
    inlineControls: [{ type: 'sources', label: 'Sources' }],
    createRuntime() {
      return {
        async execute(registry, nodeModel) {
          const result = await semanticizeDataNode(nodeModel);
          return { dataset: result.dataset };
        }
      };
    }
  },
  {
    typeId: 'RoadwayHazardStateDataNode',
    label: 'Roadway Hazard State (Mock)',
    kind: 'data',
    category: 'Data / Advanced',
    libraryCategory: 'Safety & Emergency',
    color: '#1f7ad6',
    ports: outputPort('Roadway Hazard State', 'RoadwayHazardStateDataset'),
    defaultParams: roadwayHazardStateDefaults,
    inlineControls: [{ type: 'sources', label: 'Sources' }],
    createRuntime() {
      return {
        async execute(registry, nodeModel) {
          const result = await semanticizeDataNode(nodeModel);
          return { dataset: result.dataset };
        }
      };
    }
  },
  createSemanticDataDefinition({
    typeId: 'LayeredGeologicalBodyDataNode',
    label: 'Layered Geological Body',
    portName: 'Geological Body',
    portType: 'GeologicalBodyDataset',
    defaultParams: layeredGeologicalBodyDefaults
  }),
  createSemanticDataDefinition({
    typeId: 'VolumetricGeologicalBodyDataNode',
    label: 'Volumetric / Block Geological Body',
    portName: 'Geological Body',
    portType: 'GeologicalBodyDataset',
    defaultParams: volumetricGeologicalBodyDefaults
  }),
  createSemanticDataDefinition({
    typeId: 'GeologicalBodyDataNode',
    label: 'Geological Body',
    portName: 'Geological Body',
    portType: 'GeologicalBodyDataset',
    defaultParams: geologicalBodyDefaults
  }),
  createSemanticDataDefinition({
    typeId: 'BoreholeDataNode',
    label: 'Borehole',
    portName: 'Borehole',
    portType: 'BoreholeDataset',
    defaultParams: boreholeDefaults
  }),
  createSemanticDataDefinition({
    typeId: 'GeologicalStructureDataNode',
    label: 'Geological Structure',
    portName: 'Geological Structure',
    portType: 'GeologicalStructureDataset',
    defaultParams: geologicalStructureDefaults
  }),
  createSemanticDataDefinition({
    typeId: 'ResourceBlockModelDataNode',
    label: 'Resource Block Model',
    portName: 'Geological Attribute Model',
    portType: 'GeologicalAttributeModelDataset',
    defaultParams: resourceBlockModelDefaults
  }),
  createSemanticDataDefinition({
    typeId: 'CoalSeamAttributeModelDataNode',
    label: 'Coal Seam Attribute Model',
    portName: 'Geological Attribute Model',
    portType: 'GeologicalAttributeModelDataset',
    defaultParams: coalSeamAttributeModelDefaults
  }),
  createSemanticDataDefinition({
    typeId: 'GeologicalRiskUncertaintyModelDataNode',
    label: 'Geological Risk / Uncertainty Model',
    portName: 'Geological Attribute Model',
    portType: 'GeologicalAttributeModelDataset',
    defaultParams: geologicalRiskUncertaintyModelDefaults
  }),
  createSemanticDataDefinition({
    typeId: 'GeologicalAttributeModelDataNode',
    label: 'Geological Attribute Model',
    portName: 'Geological Attribute Model',
    portType: 'GeologicalAttributeModelDataset',
    defaultParams: geologicalAttributeModelDefaults
  })
];
export const BuiltInDataNodeDefinitions = registerDataNodeDefinitions(dataNodeDefinitions);