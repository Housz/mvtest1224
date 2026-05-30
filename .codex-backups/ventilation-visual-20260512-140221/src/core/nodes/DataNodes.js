import { DefaultSourceAdaptorRegistry } from '../adaptors/SourceAdaptorRegistry.js';
import { SemanticContractRegistry } from '../semantics/SemanticContractRegistry.js';
import { materializeDataset, mergeRoleMapping } from '../semantics/DatasetMaterializers.js';
import { EnvironmentalReadingPresets } from '../environmental/EnvironmentalPresets.js';

const outputPort = (name, type) => [{ id: 'dataset', name, direction: 'out', type }];

function defaultRoleMapping(contractId) {
  const contract = SemanticContractRegistry.get(contractId);
  return Object.fromEntries((contract?.roles || []).map((role) => [role.key, role.defaultPath]).filter(([, value]) => value));
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function normalizeSources(nodeModel) {
  const params = nodeModel.params || {};
  if (params.sources) return params.sources;
  if (nodeModel.typeId === 'RoadwayDataNode') {
    return {
      topology: {
        label: 'Topology JSON',
        path: params.topologyPath || '/data/roadway_topo.json',
        adaptor: params.topologyAdaptor || 'JSONGraphAdaptor'
      },
      geometry: {
        label: 'Roadway OBJ',
        path: params.modelPath || '/data/roadway_model.obj',
        adaptor: params.geometryAdaptor || 'OBJGeometryAdaptor'
      }
    };
  }
  if (nodeModel.typeId === 'SensorRegistryDataNode') {
    return {
      registry: {
        label: 'Registry CSV',
        path: params.registryPath || '/data/temperature_sensors.csv',
        adaptor: params.registryAdaptor || 'CSVTableAdaptor'
      }
    };
  }
  if (nodeModel.typeId === 'SensorReadingsDataNode') {
    return {
      readings: {
        label: 'Readings Source',
        path: params.readingsPath || '/data/Temperature_timeseries_20steps.csv',
        adaptor: params.readingsAdaptor || 'CSVTableAdaptor'
      }
    };
  }
  if (
    [
      'COSensorReadingsDataNode',
      'HumiditySensorReadingsDataNode',
      'CH4SensorReadingsDataNode',
      'EnvironmentalSensorReadingsDataNode'
    ].includes(nodeModel.typeId)
  ) {
    return {
      readings: {
        label: 'Readings Source',
        path: params.readingsPath || params.sourcePath || '',
        adaptor: params.readingsAdaptor || 'CSVTableAdaptor'
      }
    };
  }
  if (nodeModel.typeId === 'VentilationNetworkDataNode') {
    return {
      network: {
        label: 'Network Source',
        path: params.networkPath || '/data/ventilation_network.json',
        adaptor: params.networkAdaptor || 'VentilationNetworkJsonAdaptor'
      }
    };
  }
  if (nodeModel.typeId === 'AirflowStateDataNode') {
    return {
      state: {
        label: 'State Source',
        path: params.statePath || '/data/airflow_state.csv',
        adaptor: params.stateAdaptor || 'AirflowStateCsvAdaptor'
      }
    };
  }
  return {};
}

export function normalizeDataNodeParams(nodeModel) {
  const definition = DataNodeDefinitions.find((item) => item.typeId === nodeModel.typeId);
  const params = {
    ...(definition?.defaultParams || {}),
    ...(nodeModel.params || {})
  };
  params.sources = normalizeSources({ ...nodeModel, params });
  params.roleMapping = {
    ...defaultRoleMapping(params.contractId),
    ...(params.roleMapping || {})
  };
  nodeModel.params = params;
  return params;
}

export async function semanticizeDataNode(nodeModel, { updateNode = true } = {}) {
  const params = normalizeDataNodeParams(nodeModel);
  const contract = SemanticContractRegistry.get(params.contractId);
  if (!contract) throw new Error(`Unknown semantic contract: ${params.contractId}`);
  const adaptorResults = {};
  for (const [sourceKey, source] of Object.entries(params.sources)) {
    adaptorResults[sourceKey] = await DefaultSourceAdaptorRegistry.load(source, contract);
  }
  const roleMapping = mergeRoleMapping(contract, adaptorResults, params.roleMapping);
  if (updateNode) nodeModel.params.roleMapping = roleMapping;
  const dataset = materializeDataset({
    datasetType: params.datasetType,
    contract,
    adaptorResults,
    roleMapping,
    sources: params.sources,
    variable: params.variable,
    unit: params.unit,
    displayRange: params.displayRange
  });
  if (updateNode) {
    nodeModel.params.semanticStatus = {
      valid: dataset.validation?.valid === true,
      errors: dataset.validation?.errors?.length || 0,
      warnings: dataset.validation?.warnings?.length || 0,
      summary: dataset.validation?.summary || {}
    };
    if (dataset.validation?.summary?.valueRange && nodeModel.params.datasetType === 'SensorReadings') {
      nodeModel.params.detectedRange = dataset.validation.summary.valueRange;
    }
  }
  return { dataset, contract, adaptorResults, roleMapping };
}

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

export const DataNodeDefinitions = [
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
  }
];

export function seedDataNode(typeId, position = { x: 80, y: 80 }, overrides = {}) {
  const def = DataNodeDefinitions.find((item) => item.typeId === typeId);
  if (!def) throw new Error(`Unknown dataset node type: ${typeId}`);
  return {
    typeId,
    label: overrides.label ?? def.label,
    position,
    params: { ...clone(def.defaultParams), ...(overrides.params ?? {}) },
    ports: clone(def.ports)
  };
}
