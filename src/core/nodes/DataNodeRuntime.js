import { SemanticContractRegistry } from '../semantics/SemanticContractRegistry.js';
import { DefaultSemanticizationService } from '../semantics/SemanticizationService.js';
import { DataNodePresetRegistry } from './DataNodePresetRegistry.js';

export function defaultRoleMapping(contractId) {
  const contract = SemanticContractRegistry.get(contractId);
  return Object.fromEntries(
    (contract?.roles || [])
      .map((role) => [role.key, role.defaultPath])
      .filter(([, value]) => value)
  );
}

export function cloneDataNodeValue(value) {
  if (value == null) return value;
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function applyLegacySourceParamOverrides(typeId, sources = {}, params = {}) {
  const next = cloneDataNodeValue(sources || {});
  const apply = (sourceKey, pathKey, adaptorKey) => {
    if (!next[sourceKey]) next[sourceKey] = {};
    if (params[pathKey]) next[sourceKey].path = params[pathKey];
    if (adaptorKey && params[adaptorKey]) next[sourceKey].adaptor = params[adaptorKey];
  };
  if (typeId === 'RoadwayDataNode') {
    apply('topology', 'topologyPath', 'topologyAdaptor');
    apply('geometry', 'modelPath', 'geometryAdaptor');
  } else if (typeId === 'SensorRegistryDataNode') {
    apply('registry', 'registryPath', 'registryAdaptor');
  } else if (
    [
      'SensorReadingsDataNode',
      'COSensorReadingsDataNode',
      'HumiditySensorReadingsDataNode',
      'CH4SensorReadingsDataNode',
      'EnvironmentalSensorReadingsDataNode'
    ].includes(typeId)
  ) {
    apply('readings', 'readingsPath', 'readingsAdaptor');
    if (!params.readingsPath && params.sourcePath) next.readings.path = params.sourcePath;
  } else if (typeId === 'VentilationNetworkDataNode') {
    apply('network', 'networkPath', 'networkAdaptor');
  } else if (typeId === 'AirflowStateDataNode') {
    apply('state', 'statePath', 'stateAdaptor');
  } else if (typeId === 'PeopleDataNode') {
    apply('people', 'peoplePath', 'peopleAdaptor');
  } else if (typeId === 'EmergencyResourcesDataNode') {
    apply('resources', 'resourcesPath', 'resourcesAdaptor');
  } else if (typeId === 'RoadwayHazardStateDataNode') {
    apply('state', 'statePath', 'stateAdaptor');
  }
  return next;
}

export function normalizeDataNodeSources(nodeModel) {
  const params = nodeModel.params || {};
  if (params.sources) return applyLegacySourceParamOverrides(nodeModel.typeId, params.sources, params);
  if (nodeModel.typeId === 'RoadwayDataNode') {
    return applyLegacySourceParamOverrides(nodeModel.typeId, {
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
    }, params);
  }
  if (nodeModel.typeId === 'SensorRegistryDataNode') {
    return applyLegacySourceParamOverrides(nodeModel.typeId, {
      registry: {
        label: 'Registry CSV',
        path: params.registryPath || '/data/temperature_sensors.csv',
        adaptor: params.registryAdaptor || 'CSVTableAdaptor'
      }
    }, params);
  }
  if (nodeModel.typeId === 'SensorReadingsDataNode') {
    return applyLegacySourceParamOverrides(nodeModel.typeId, {
      readings: {
        label: 'Readings Source',
        path: params.readingsPath || '/data/Temperature_timeseries_20steps.csv',
        adaptor: params.readingsAdaptor || 'CSVTableAdaptor'
      }
    }, params);
  }
  if (
    [
      'COSensorReadingsDataNode',
      'HumiditySensorReadingsDataNode',
      'CH4SensorReadingsDataNode',
      'EnvironmentalSensorReadingsDataNode'
    ].includes(nodeModel.typeId)
  ) {
    return applyLegacySourceParamOverrides(nodeModel.typeId, {
      readings: {
        label: 'Readings Source',
        path: params.readingsPath || params.sourcePath || '',
        adaptor: params.readingsAdaptor || 'CSVTableAdaptor'
      }
    }, params);
  }
  if (nodeModel.typeId === 'VentilationNetworkDataNode') {
    return applyLegacySourceParamOverrides(nodeModel.typeId, {
      network: {
        label: 'Network Source',
        path: params.networkPath || '/data/ventilation_network.json',
        adaptor: params.networkAdaptor || 'VentilationNetworkJsonAdaptor'
      }
    }, params);
  }
  if (nodeModel.typeId === 'AirflowStateDataNode') {
    return applyLegacySourceParamOverrides(nodeModel.typeId, {
      state: {
        label: 'State Source',
        path: params.statePath || '/data/airflow_state.csv',
        adaptor: params.stateAdaptor || 'AirflowStateCsvAdaptor'
      }
    }, params);
  }
  if (nodeModel.typeId === 'PeopleDataNode') {
    return applyLegacySourceParamOverrides(nodeModel.typeId, {
      people: {
        label: 'People Source',
        path: params.peoplePath || '/data/people.json',
        adaptor: params.peopleAdaptor || 'PeopleJsonAdaptor'
      }
    }, params);
  }
  if (nodeModel.typeId === 'EmergencyResourcesDataNode') {
    return applyLegacySourceParamOverrides(nodeModel.typeId, {
      resources: {
        label: 'Resources Source',
        path: params.resourcesPath || '/data/emergency_resources.json',
        adaptor: params.resourcesAdaptor || 'EmergencyResourcesJsonAdaptor'
      }
    }, params);
  }
  if (nodeModel.typeId === 'RoadwayHazardStateDataNode') {
    return applyLegacySourceParamOverrides(nodeModel.typeId, {
      state: {
        label: 'Hazard State Source',
        path: params.statePath || '/data/roadway_hazard_state_mock.csv',
        adaptor: params.stateAdaptor || 'RoadwayHazardStateAdaptor'
      }
    }, params);
  }
  return {};
}

export function normalizeDataNodeParams(nodeModel) {
  const definition = DataNodePresetRegistry.get(nodeModel.typeId)?.definition;
  const defaultParams = cloneDataNodeValue(definition?.defaultParams || {});
  const savedParams = cloneDataNodeValue(nodeModel.params || {});
  const params = { ...defaultParams, ...savedParams };
  if (defaultParams.sources || savedParams.sources) {
    const sourceKeys = new Set([
      ...Object.keys(defaultParams.sources || {}),
      ...Object.keys(savedParams.sources || {})
    ]);
    params.sources = {};
    sourceKeys.forEach((sourceKey) => {
      params.sources[sourceKey] = {
        ...(defaultParams.sources?.[sourceKey] || {}),
        ...(savedParams.sources?.[sourceKey] || {})
      };
    });
  }
  params.sources = normalizeDataNodeSources({ ...nodeModel, params });
  params.roleMapping = {
    ...defaultRoleMapping(params.contractId),
    ...(params.roleMapping || {})
  };
  nodeModel.params = params;
  return params;
}

export async function semanticizeDataNode(nodeModel, { updateNode = true } = {}) {
  const params = normalizeDataNodeParams(nodeModel);
  return DefaultSemanticizationService.semanticize({ nodeModel, params, updateNode });
}
