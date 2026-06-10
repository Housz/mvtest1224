import { RoadwayDataset } from '../datasets/RoadwayDataset.js';
import { SensorRegistryDataset } from '../datasets/SensorRegistryDataset.js';
import { SensorReadingsDataset } from '../datasets/SensorReadingsDataset.js';
import { VentilationNetworkDataset } from '../datasets/VentilationNetworkDataset.js';
import { AirflowStateDataset } from '../datasets/AirflowStateDataset.js';
import { PeopleDataset } from '../datasets/PeopleDataset.js';
import { EmergencyResourcesDataset } from '../datasets/EmergencyResourcesDataset.js';
import { RoadwayHazardStateDataset } from '../datasets/RoadwayHazardStateDataset.js';
import { GeologicalBodyDataset } from '../datasets/GeologicalBodyDataset.js';
import { BoreholeDataset } from '../datasets/BoreholeDataset.js';
import { GeologicalStructureDataset } from '../datasets/GeologicalStructureDataset.js';
import { GeologicalAttributeModelDataset } from '../datasets/GeologicalAttributeModelDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from './DataTemplates.js';

const isFiniteNumber = (value) => Number.isFinite(Number(value));
const toPoint = (value = {}) => {
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  return {
    x: Number(value.x ?? value.X ?? value[0]) || 0,
    y: Number(value.y ?? value.Y ?? value[1]) || 0,
    z: Number(value.z ?? value.Z ?? value[2]) || 0
  };
};

export function getPathValue(object, path) {
  if (!path || object == null) return undefined;
  return String(path)
    .split('.')
    .reduce((current, key) => (current == null ? undefined : current[key]), object);
}

function relativePath(path, collectionName) {
  const prefix = `${collectionName}.`;
  return String(path || '').startsWith(prefix) ? String(path).slice(prefix.length) : path;
}

function rolePath(roleMapping, key, fallback = '') {
  return roleMapping?.[key] || fallback;
}

function completeRoleMapping(contract, adaptorResults, userRoleMapping = {}) {
  const mapping = {};
  (contract?.roles || []).forEach((role) => {
    if (role.defaultPath) mapping[role.key] = role.defaultPath;
  });
  Object.values(adaptorResults || {}).forEach((result) => {
    Object.assign(mapping, result?.suggestedRoleMapping || {});
  });
  Object.entries(userRoleMapping || {}).forEach(([key, value]) => {
    if (value) mapping[key] = value;
  });
  return mapping;
}

function makeReport() {
  return { valid: true, warnings: [], errors: [], summary: {} };
}

function finalizeReport(report, templates = {}) {
  report.valid = report.errors.length === 0;
  report.summary.templates = Object.values(templates).map((template) => template.summary());
  return report;
}

function validateUnique(values, label, report) {
  const seen = new Set();
  values.forEach((value) => {
    if (value == null || value === '') {
      report.errors.push(`${label} contains an empty id.`);
      return;
    }
    if (seen.has(value)) report.errors.push(`${label} contains duplicate id: ${value}`);
    seen.add(value);
  });
}

function firstAdaptorResult(adaptorResults = {}) {
  return Object.entries(adaptorResults || {}).find(([key, result]) => key !== 'descriptor' && result?.kind !== 'MineVis dataset descriptor')?.[1] || {};
}

function rowsOf(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function arrayOf(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function mergeRows(...collections) {
  return collections.flatMap((collection) => arrayOf(collection));
}

function mergeByIdentity(rows = [], identityKeys = []) {
  const merged = new Map();
  rows.forEach((row, index) => {
    if (!row) return;
    const id = identityKeys.map((key) => getPathValue(row, key)).find((value) => value != null && value !== '') ?? `__row_${index}`;
    const key = String(id);
    merged.set(key, { ...(merged.get(key) || {}), ...row });
  });
  return [...merged.values()];
}

function valueFromAnyPath(row, paths = []) {
  for (const path of paths) {
    const value = getPathValue(row, path);
    if (value != null && value !== '') return value;
  }
  return undefined;
}

function fieldRoleMapping(mapping, keys = []) {
  return Object.fromEntries(keys.map((key) => [key, mapping[key]]).filter(([, value]) => value));
}

const GEOLOGICAL_ATTRIBUTE_NON_VALUE_KEYS = new Set([
  'id',
  'elementId',
  'element_id',
  'supportElementId',
  'support_element_id',
  'blockId',
  'block_id',
  'modelId',
  'model_id',
  'unitId',
  'unit_id',
  'seamId',
  'seam_id',
  'surfaceId',
  'surface_id',
  'lithology',
  'unitType',
  'unit_type',
  'category',
  'resourceCategory',
  'resource_category',
  'x',
  'X',
  'y',
  'Y',
  'z',
  'Z',
  'centroid',
  'centroidX',
  'centroidY',
  'centroidZ',
  'centroid_x',
  'centroid_y',
  'centroid_z',
  'gridX',
  'gridY',
  'grid_x',
  'grid_y',
  'blockSizeX',
  'blockSizeY',
  'blockSizeZ',
  'block_size_x',
  'block_size_y',
  'block_size_z',
  'dx',
  'dy',
  'dz',
  'size',
  'layerOrder',
  'layer_order',
  'attributeName',
  'attributeValue',
  'attribute_name',
  'attribute_value',
  'valueType',
  'value_type',
  'name',
  'value',
  'unit'
]);

function isGeologicalAttributeValueColumn(key, value) {
  if (!key || GEOLOGICAL_ATTRIBUTE_NON_VALUE_KEYS.has(key)) return false;
  if (value == null || value === '' || typeof value === 'object') return false;
  return isFiniteNumber(value);
}

function materializeRoadway({ contract, adaptorResults, roleMapping, sources }) {
  const topology = adaptorResults.topology || {};
  const geometry = adaptorResults.geometry || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rawNodes = topology.nodes || [];
  const rawEdges = topology.edges || [];

  const nodes = rawNodes.map((rawNode, index) => {
    const positionPath = relativePath(rolePath(mapping, 'graph.nodePosition', 'position'), 'nodes');
    return {
      ...rawNode,
      id: getPathValue(rawNode, relativePath(rolePath(mapping, 'graph.nodeId', 'id'), 'nodes')) ?? `Node_${index}`,
      position: getPathValue(rawNode, positionPath) ?? rawNode.position ?? rawNode.coordinate ?? rawNode,
      idx: index
    };
  });

  const edges = rawEdges.map((rawEdge, index) => ({
    ...rawEdge,
    id: getPathValue(rawEdge, relativePath(rolePath(mapping, 'graph.edgeId', 'id'), 'edges')) ?? `Edge_${index}`,
    source: getPathValue(rawEdge, relativePath(rolePath(mapping, 'graph.fromNode', 'source'), 'edges')),
    target: getPathValue(rawEdge, relativePath(rolePath(mapping, 'graph.toNode', 'target'), 'edges')),
    path: getPathValue(rawEdge, relativePath(rolePath(mapping, 'graph.path', 'path'), 'edges')) ?? rawEdge.path ?? [],
    idx: index
  }));

  const meshParts = geometry.meshParts || [];
  const templates = {
    graph: new GraphTemplate({
      id: 'graph',
      label: 'Roadway graph',
      role: 'networkStructure',
      data: { nodes, edges },
      roleMapping: Object.fromEntries(Object.entries(mapping).filter(([key]) => key.startsWith('graph.')))
    }),
    geometry: new GeometryTemplate({
      id: 'geometry',
      label: 'Roadway geometry',
      role: 'spatialSupport',
      data: {
        form: 'MeshSurface',
        modelPath: sources.geometry?.path,
        objText: geometry.objText,
        meshParts
      },
      roleMapping: Object.fromEntries(Object.entries(mapping).filter(([key]) => key.startsWith('geometry.')))
    }),
    geometryToGraph: new RelationTemplate({
      id: 'geometryToGraph',
      label: 'Geometry to roadway graph',
      role: 'constitutiveCorrespondence',
      data: {
        source: 'geometry.meshPartId',
        target: 'graph.edgeId / graph.nodeId',
        rows: meshParts.map((part) => ({ meshPartId: part.name, graphEntityId: part.name }))
      },
      roleMapping: { geometryTarget: mapping['relation.geometryTarget'] },
      metadata: { relation: 'geometry parts are attached to roadway graph entities by id/name correspondence' }
    })
  };

  const report = makeReport();
  if (!nodes.length) report.errors.push('Roadway graph has no nodes.');
  if (!edges.length) report.errors.push('Roadway graph has no edges.');
  validateUnique(nodes.map((node) => node.id), 'Roadway node ids', report);
  validateUnique(edges.map((edge) => edge.id), 'Roadway edge ids', report);
  const nodeIds = new Set(nodes.map((node) => node.id));
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source)) report.errors.push(`Edge ${edge.id} references missing from node ${edge.source}.`);
    if (!nodeIds.has(edge.target)) report.errors.push(`Edge ${edge.id} references missing to node ${edge.target}.`);
  });
  if (!geometry.objText && !sources.geometry?.path) report.errors.push('Roadway geometry source is missing.');
  if (!meshParts.length) report.warnings.push('Roadway geometry contains no parsed mesh parts.');
  report.summary = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    meshPartCount: meshParts.length
  };

  return new RoadwayDataset({
    nodes,
    edges,
    source: { topologyPath: sources.topology?.path, modelPath: sources.geometry?.path },
    topologyPath: sources.topology?.path,
    modelPath: sources.geometry?.path,
    objText: geometry.objText,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

function materializeSensorRegistry({ contract, adaptorResults, roleMapping, sources }) {
  const table = adaptorResults.registry || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rows = table.rows || [];
  const sensors = rows.map((row, index) => {
    const id = getPathValue(row, rolePath(mapping, 'sensorIdentity', 'sensorID')) ?? `S${index + 1}`;
    const anchor = getPathValue(row, rolePath(mapping, 'roadwayAnchor', 'roadwayID'));
    const sensorType = getPathValue(row, rolePath(mapping, 'sensorType', 'type')) ?? 'temperature';
    const ratio = getPathValue(row, rolePath(mapping, 'ratio', 'ratio'));
    const anchorText = anchor == null ? '' : String(anchor);
    return {
      ...row,
      id: String(id),
      sensorID: String(id),
      type: sensorType,
      x: Number(getPathValue(row, rolePath(mapping, 'positionX', 'x'))),
      y: Number(getPathValue(row, rolePath(mapping, 'positionY', 'y'))),
      z: Number(getPathValue(row, rolePath(mapping, 'positionZ', 'z'))),
      roadwayID: anchorText || null,
      edgeId: anchorText.startsWith('Edge') ? anchorText : null,
      nodeId: anchorText.startsWith('Node') ? anchorText : null,
      parentType: anchorText.startsWith('Node') ? 'Node' : 'Connection',
      ratio: ratio === '' || ratio == null ? null : Number(ratio),
      idx: index
    };
  });

  const templates = {
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Sensor registry',
      role: 'entityIdentity',
      data: { entities: sensors },
      roleMapping: {
        sensorIdentity: mapping.sensorIdentity,
        sensorType: mapping.sensorType
      },
      metadata: { keyRole: 'sensorIdentity' }
    }),
    pointGeometry: new GeometryTemplate({
      id: 'pointGeometry',
      label: 'Sensor point geometry',
      role: 'sensorPosition',
      data: {
        form: 'PointSet',
        points: sensors.map((sensor) => ({ id: sensor.sensorID, x: sensor.x, y: sensor.y, z: sensor.z }))
      },
      roleMapping: {
        positionX: mapping.positionX,
        positionY: mapping.positionY,
        positionZ: mapping.positionZ
      },
      metadata: { form: 'PointSet' }
    }),
    mountedOnRoadway: new RelationTemplate({
      id: 'mountedOnRoadway',
      label: 'Mounted on roadway',
      role: 'roadwayMountRelation',
      data: {
        source: 'registry.sensorIdentity',
        target: 'Roadway.graph.edgeId / nodeId',
        anchors: sensors.map((sensor) => ({
          sensorID: sensor.sensorID,
          edgeId: sensor.edgeId,
          nodeId: sensor.nodeId,
          ratio: sensor.ratio
        }))
      },
      roleMapping: {
        roadwayAnchor: mapping.roadwayAnchor,
        ratio: mapping.ratio
      },
      metadata: { relation: 'sensors are mounted onto roadway graph entities' }
    })
  };

  const report = makeReport();
  validateUnique(sensors.map((sensor) => sensor.sensorID), 'Sensor ids', report);
  sensors.forEach((sensor) => {
    if (!isFiniteNumber(sensor.x) || !isFiniteNumber(sensor.y) || !isFiniteNumber(sensor.z)) {
      report.errors.push(`Sensor ${sensor.sensorID} has invalid position.`);
    }
    if (!sensor.edgeId && !sensor.nodeId) report.warnings.push(`Sensor ${sensor.sensorID} has no roadway anchor.`);
  });
  report.summary = {
    sensorCount: sensors.length,
    anchoredSensorCount: sensors.filter((sensor) => sensor.edgeId || sensor.nodeId).length
  };

  return new SensorRegistryDataset({
    sensors,
    source: { registryPath: sources.registry?.path },
    registryPath: sources.registry?.path,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

function materializeSensorReadings({ contract, adaptorResults, roleMapping, sources, variable, unit = '', displayRange = null }) {
  const table = adaptorResults.readings || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const variablePath = rolePath(mapping, 'variableName', '');
  const unitPath = rolePath(mapping, 'unitName', '');
  const fixedVariable = variable || '';
  const rows = (table.rows || [])
    .map((row) => {
      const rowVariable = variablePath ? getPathValue(row, variablePath) : null;
      const rowUnit = unitPath ? getPathValue(row, unitPath) : null;
      return {
        ...row,
        sensorID: getPathValue(row, rolePath(mapping, 'observedEntity', 'sensorID')),
        time: getPathValue(row, rolePath(mapping, 'timestamp', 'time')),
        value: getPathValue(row, rolePath(mapping, 'measuredValue', 'value')),
        variable: rowVariable || fixedVariable,
        unit: rowUnit || unit
      };
    })
    .filter((row) => {
      if (!fixedVariable || !variablePath || !row.variable) return true;
      return String(row.variable).toLowerCase() === String(fixedVariable).toLowerCase();
    });
  const parsedRows = rows.map((row) => ({
    ...row,
    value: Number(row.value)
  }));

  const validTimes = parsedRows
    .map((row) => {
      const numeric = Number(row.time);
      return Number.isFinite(numeric) ? numeric : Date.parse(row.time);
    })
    .filter(Number.isFinite);
  const timeRange = validTimes.length ? { min: Math.min(...validTimes), max: Math.max(...validTimes) } : null;
  const validValues = parsedRows.map((row) => row.value).filter(Number.isFinite);
  const valueRange = validValues.length ? { min: Math.min(...validValues), max: Math.max(...validValues) } : null;

  const templates = {
    state: new StateTemplate({
      id: 'state',
      label: 'Sensor reading state',
      role: 'timeIndexedObservation',
      data: { rows: parsedRows },
      roleMapping: {
        observedEntity: mapping.observedEntity,
        timestamp: mapping.timestamp,
        measuredValue: mapping.measuredValue
      },
      metadata: {
        subjectRole: 'observedEntity',
        timeRole: 'timestamp',
        valueRole: 'measuredValue',
        variable: fixedVariable,
        unit,
        timeRange
      }
    }),
    readingOfSensor: new RelationTemplate({
      id: 'readingOfSensor',
      label: 'Reading of sensor',
      role: 'observationTargetRelation',
      data: {
        source: 'state.observedEntity',
        target: 'SensorRegistry.registry.sensorIdentity',
        rows: parsedRows.map((row) => ({ observedEntity: row.sensorID }))
      },
      roleMapping: { observedEntity: mapping.observedEntity },
      metadata: { relation: 'readings reference sensor registry identities' }
    })
  };

  const report = makeReport();
  if (!fixedVariable) report.errors.push('Sensor readings variable is not defined.');
  parsedRows.forEach((row, index) => {
    if (!row.sensorID) report.errors.push(`Reading row ${index + 1} is missing observed entity.`);
    const parsedTime = Number.isFinite(Number(row.time)) ? Number(row.time) : Date.parse(row.time);
    if (!Number.isFinite(parsedTime)) report.errors.push(`Reading row ${index + 1} has an invalid timestamp.`);
    if (!Number.isFinite(row.value)) report.errors.push(`Reading row ${index + 1} has a non-numeric value.`);
  });
  const subjectSet = new Set(parsedRows.map((row) => row.sensorID).filter(Boolean));
  if (!subjectSet.size) report.errors.push('Sensor readings series map would be empty.');
  report.summary = {
    rowCount: parsedRows.length,
    seriesCount: subjectSet.size,
    variable: fixedVariable,
    unit,
    timeRange,
    valueRange
  };

  return new SensorReadingsDataset({
    readings: parsedRows,
    source: { readingsPath: sources.readings?.path },
    readingsPath: sources.readings?.path,
    variable: fixedVariable,
    unit,
    displayRange,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

function materializeVentilationNetwork({ contract, adaptorResults, roleMapping, sources }) {
  const network = adaptorResults.network || {};
  const raw = network.raw || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const nodes = (network.nodes || raw.nodes || []).map((node, index) => ({
    ...node,
    id: getPathValue(node, relativePath(rolePath(mapping, 'graph.nodeId', 'id'), 'nodes')) ?? `VN_${index + 1}`,
    type: getPathValue(node, relativePath(rolePath(mapping, 'graph.nodeType', 'type'), 'nodes')) ?? node.type ?? 'junction',
    roadwayNodeId: getPathValue(node, relativePath(rolePath(mapping, 'relation.roadwayNode', 'roadwayNodeId'), 'nodes')) ?? node.roadwayNodeId ?? null,
    position: getPathValue(node, relativePath(rolePath(mapping, 'graph.nodePosition', 'position'), 'nodes')) ?? node.position ?? node
  }));
  const branches = (network.branches || raw.branches || raw.edges || []).map((branch, index) => ({
    ...branch,
    id: getPathValue(branch, relativePath(rolePath(mapping, 'graph.branchId', 'id'), 'branches')) ?? `VB_${index + 1}`,
    from: getPathValue(branch, relativePath(rolePath(mapping, 'graph.fromNode', 'from'), 'branches')),
    to: getPathValue(branch, relativePath(rolePath(mapping, 'graph.toNode', 'to'), 'branches')),
    branchType: getPathValue(branch, relativePath(rolePath(mapping, 'graph.branchType', 'branchType'), 'branches')) ?? branch.branchType,
    nominalDirection:
      getPathValue(branch, relativePath(rolePath(mapping, 'graph.nominalDirection', 'nominalDirection'), 'branches')) ??
      branch.nominalDirection,
    roadwayEdgeIds:
      getPathValue(branch, relativePath(rolePath(mapping, 'relation.roadwayEdges', 'roadwayEdgeIds'), 'branches')) ??
      branch.roadwayEdgeIds ??
      [],
    path: getPathValue(branch, relativePath(rolePath(mapping, 'graph.path', 'path'), 'branches')) ?? branch.path ?? []
  }));
  const facilities = (network.facilities || raw.facilities || []).map((facility, index) => ({
    ...facility,
    id: getPathValue(facility, relativePath(rolePath(mapping, 'facility.facilityId', 'id'), 'facilities')) ?? `FAC_${index + 1}`,
    type: getPathValue(facility, relativePath(rolePath(mapping, 'facility.facilityType', 'type'), 'facilities')) ?? facility.type,
    branchId:
      getPathValue(facility, relativePath(rolePath(mapping, 'facility.branchId', 'branchId'), 'facilities')) ?? facility.branchId,
    ratio: getPathValue(facility, relativePath(rolePath(mapping, 'facility.ratio', 'ratio'), 'facilities')) ?? facility.ratio
  }));
  const boundaryConditions = network.boundaryConditions || raw.boundaryConditions || { intakes: [], returns: [] };
  const relations = network.relations || raw.relations || [];

  const templates = {
    graph: new GraphTemplate({
      id: 'graph',
      label: 'Ventilation graph',
      role: 'ventilationNetworkStructure',
      data: { nodes, edges: branches },
      roleMapping: Object.fromEntries(Object.entries(mapping).filter(([key]) => key.startsWith('graph.'))),
      metadata: { edgeName: 'branch' }
    }),
    facilityRegistry: new RegistryTemplate({
      id: 'facilityRegistry',
      label: 'Ventilation facility registry',
      role: 'facilityIdentity',
      data: { entities: facilities },
      roleMapping: Object.fromEntries(Object.entries(mapping).filter(([key]) => key.startsWith('facility.'))),
      metadata: { keyRole: 'facility.facilityId' }
    }),
    roadwayRelation: new RelationTemplate({
      id: 'roadwayRelation',
      label: 'Ventilation to roadway relation',
      role: 'roadwayReference',
      data: {
        source: 'ventilation.branchId / facilityId / nodeId',
        target: 'Roadway.graph.edgeId / nodeId',
        rows: [
          ...branches.map((branch) => ({ branchId: branch.id, roadwayEdgeIds: branch.roadwayEdgeIds })),
          ...nodes.map((node) => ({ nodeId: node.id, roadwayNodeId: node.roadwayNodeId })),
          ...facilities.map((facility) => ({ facilityId: facility.id, branchId: facility.branchId }))
        ]
      },
      roleMapping: Object.fromEntries(Object.entries(mapping).filter(([key]) => key.startsWith('relation.'))),
      metadata: { relation: 'ventilation branches, facilities, and nodes reference roadway objects' }
    }),
    branchGeometry: new GeometryTemplate({
      id: 'branchGeometry',
      label: 'Ventilation branch geometry',
      role: 'branchCenterline',
      data: {
        form: 'Polyline',
        paths: branches.map((branch) => ({ id: branch.id, path: branch.path || [] }))
      },
      roleMapping: { path: mapping['graph.path'] },
      metadata: { form: 'Polyline' }
    })
  };

  const report = makeReport();
  if (!nodes.length) report.errors.push('Ventilation network has no nodes.');
  if (!branches.length) report.errors.push('Ventilation network has no branches.');
  validateUnique(nodes.map((node) => node.id), 'Ventilation node ids', report);
  validateUnique(branches.map((branch) => branch.id), 'Ventilation branch ids', report);
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  branches.forEach((branch) => {
    if (!nodeIds.has(String(branch.from))) report.errors.push(`Branch ${branch.id} references missing from node ${branch.from}.`);
    if (!nodeIds.has(String(branch.to))) report.errors.push(`Branch ${branch.id} references missing to node ${branch.to}.`);
    if (branch.roadwayEdgeIds && !Array.isArray(branch.roadwayEdgeIds)) {
      report.warnings.push(`Branch ${branch.id} roadwayEdgeIds is not an array.`);
    }
  });
  const branchIds = new Set(branches.map((branch) => String(branch.id)));
  facilities.forEach((facility) => {
    if (facility.branchId && !branchIds.has(String(facility.branchId))) {
      report.errors.push(`Facility ${facility.id} references missing branch ${facility.branchId}.`);
    }
  });
  [...(boundaryConditions.intakes || []), ...(boundaryConditions.returns || [])].forEach((entry) => {
    if (entry.nodeId && !nodeIds.has(String(entry.nodeId))) {
      report.errors.push(`Boundary condition references missing ventilation node ${entry.nodeId}.`);
    }
  });
  report.summary = {
    nodeCount: nodes.length,
    branchCount: branches.length,
    facilityCount: facilities.length,
    intakeCount: boundaryConditions.intakes?.length || 0,
    returnCount: boundaryConditions.returns?.length || 0
  };

  return new VentilationNetworkDataset({
    nodes,
    branches,
    facilities,
    relations,
    boundaryConditions,
    source: { networkPath: sources.network?.path },
    networkPath: sources.network?.path,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

function materializeAirflowState({ contract, adaptorResults, roleMapping, sources }) {
  const table = adaptorResults.state || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rows = (table.rows || []).map((row) => ({
    ...row,
    branch_id: getPathValue(row, rolePath(mapping, 'branchId', 'branch_id')),
    time: getPathValue(row, rolePath(mapping, 'timestamp', 'time')),
    air_quantity_m3s: getPathValue(row, rolePath(mapping, 'airQuantity', 'air_quantity_m3s')),
    velocity_ms: getPathValue(row, rolePath(mapping, 'velocity', 'velocity_ms')),
    pressure_drop_pa: getPathValue(row, rolePath(mapping, 'pressureDrop', 'pressure_drop_pa')),
    pressure_from_pa: getPathValue(row, rolePath(mapping, 'pressureFrom', 'pressure_from_pa')),
    pressure_to_pa: getPathValue(row, rolePath(mapping, 'pressureTo', 'pressure_to_pa')),
    direction_sign: getPathValue(row, rolePath(mapping, 'directionSign', 'direction_sign')),
    direction: getPathValue(row, rolePath(mapping, 'direction', 'direction')),
    anomaly_type: getPathValue(row, rolePath(mapping, 'anomalyType', 'anomaly_type')),
    scenario_id: getPathValue(row, rolePath(mapping, 'scenarioId', 'scenario_id'))
  }));
  const validTimes = rows
    .map((row) => {
      const numeric = Number(row.time);
      return Number.isFinite(numeric) ? numeric : Date.parse(row.time);
    })
    .filter(Number.isFinite);
  const timeRange = validTimes.length ? { min: Math.min(...validTimes), max: Math.max(...validTimes) } : null;
  const branchIds = new Set(rows.map((row) => row.branch_id).filter(Boolean));
  const templates = {
    state: new StateTemplate({
      id: 'state',
      label: 'Airflow branch state',
      role: 'branchTimeState',
      data: { rows },
      roleMapping: {
        branchId: mapping.branchId,
        timestamp: mapping.timestamp,
        airQuantity: mapping.airQuantity
      },
      metadata: {
        subjectRole: 'branchId',
        timeRole: 'timestamp',
        valueRole: 'airQuantity',
        variable: 'airflow',
        timeRange
      }
    }),
    airflowField: createTemplate('Field', {
      id: 'airflowField',
      label: 'Graph-supported airflow field',
      role: 'branchSupportedField',
      data: {
        support: 'VentilationNetwork.graph.branches',
        rows
      },
      roleMapping: {
        support: mapping.branchId,
        value: mapping.airQuantity
      },
      metadata: { support: 'ventilationBranch' }
    }),
    stateOfBranch: new RelationTemplate({
      id: 'stateOfBranch',
      label: 'Airflow state of branch',
      role: 'stateBranchRelation',
      data: {
        source: 'state.branchId',
        target: 'VentilationNetwork.graph.branchId',
        rows: [...branchIds].map((branchId) => ({ branchId }))
      },
      roleMapping: { branchId: mapping.branchId },
      metadata: { relation: 'airflow states are defined on ventilation branches' }
    })
  };

  const report = makeReport();
  if (!rows.length) report.errors.push('Airflow state has no rows.');
  rows.forEach((row, index) => {
    if (!row.branch_id) report.errors.push(`Airflow row ${index + 1} is missing branch id.`);
    const parsedTime = Number.isFinite(Number(row.time)) ? Number(row.time) : Date.parse(row.time);
    if (!Number.isFinite(parsedTime)) report.errors.push(`Airflow row ${index + 1} has invalid time.`);
    if (!isFiniteNumber(row.air_quantity_m3s)) report.errors.push(`Airflow row ${index + 1} has invalid air quantity.`);
    if (row.direction_sign != null && row.direction_sign !== '' && ![-1, 0, 1].includes(Number(row.direction_sign))) {
      report.warnings.push(`Airflow row ${index + 1} has unusual direction_sign ${row.direction_sign}.`);
    }
  });
  report.summary = {
    rowCount: rows.length,
    branchCount: branchIds.size,
    timeRange
  };

  return new AirflowStateDataset({
    rows,
    source: { statePath: sources.state?.path },
    statePath: sources.state?.path,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

function materializePeople({ contract, adaptorResults, roleMapping, sources }) {
  const source = adaptorResults.people || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rawPeople = source.people || source.raw?.people || [];
  const people = rawPeople.map((row, index) => {
    const positionValue = getPathValue(row, relativePath(rolePath(mapping, 'position', 'position'), 'people'));
    const position =
      positionValue && typeof positionValue === 'object'
        ? toPoint(positionValue)
        : {
            x: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionX', 'position.x'), 'people'))),
            y: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionY', 'position.y'), 'people'))),
            z: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionZ', 'position.z'), 'people')))
          };
    const edgeId = getPathValue(row, relativePath(rolePath(mapping, 'roadwayEdgeId', 'roadwayAnchor.edgeId'), 'people'));
    const nodeId = getPathValue(row, relativePath(rolePath(mapping, 'roadwayNodeId', 'roadwayAnchor.nodeId'), 'people'));
    const ratio = getPathValue(row, relativePath(rolePath(mapping, 'ratio', 'roadwayAnchor.ratio'), 'people'));
    const id =
      getPathValue(row, relativePath(rolePath(mapping, 'personId', 'personId'), 'people')) ??
      row.person_id ??
      row.id ??
      `P_${String(index + 1).padStart(3, '0')}`;
    return {
      ...row,
      personId: String(id),
      label: getPathValue(row, relativePath(rolePath(mapping, 'label', 'label'), 'people')) ?? row.name ?? `Person ${index + 1}`,
      personType: getPathValue(row, relativePath(rolePath(mapping, 'personType', 'personType'), 'people')) ?? row.type ?? 'worker',
      team: getPathValue(row, relativePath(rolePath(mapping, 'team', 'team'), 'people')) ?? row.group ?? '',
      status: getPathValue(row, relativePath(rolePath(mapping, 'status', 'status'), 'people')) ?? 'unknown',
      timestamp: getPathValue(row, relativePath(rolePath(mapping, 'timestamp', 'timestamp'), 'people')) ?? row.time ?? null,
      position,
      roadwayAnchor: {
        type: nodeId ? 'node' : edgeId ? 'edge' : null,
        edgeId: edgeId == null || edgeId === '' ? null : String(edgeId),
        nodeId: nodeId == null || nodeId === '' ? null : String(nodeId),
        ratio: ratio == null || ratio === '' ? null : Number(ratio)
      },
      idx: index
    };
  });

  const templates = {
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'People registry',
      role: 'personIdentity',
      data: {
        entities: people.map((person) => ({
          personId: person.personId,
          label: person.label,
          personType: person.personType,
          team: person.team
        }))
      },
      roleMapping: {
        personId: mapping.personId,
        label: mapping.label,
        personType: mapping.personType,
        team: mapping.team
      },
      metadata: { keyRole: 'personId' }
    }),
    pointGeometry: new GeometryTemplate({
      id: 'pointGeometry',
      label: 'People point geometry',
      role: 'personPosition',
      data: {
        form: 'PointSet',
        points: people.map((person) => ({ id: person.personId, ...toPoint(person.position) }))
      },
      roleMapping: {
        position: mapping.position,
        positionX: mapping.positionX,
        positionY: mapping.positionY,
        positionZ: mapping.positionZ
      },
      metadata: { form: 'PointSet' }
    }),
    currentState: new StateTemplate({
      id: 'currentState',
      label: 'People current state',
      role: 'personCurrentState',
      data: {
        rows: people.map((person) => ({
          personId: person.personId,
          status: person.status,
          timestamp: person.timestamp
        }))
      },
      roleMapping: {
        personId: mapping.personId,
        status: mapping.status,
        timestamp: mapping.timestamp
      },
      metadata: { subjectRole: 'personId', timeRole: 'timestamp', valueRole: 'status' }
    }),
    roadwayRelation: new RelationTemplate({
      id: 'roadwayRelation',
      label: 'People roadway location',
      role: 'personRoadwayAnchor',
      data: {
        source: 'registry.personId',
        target: 'Roadway.graph.edgeId / nodeId',
        anchors: people.map((person) => ({
          personId: person.personId,
          edgeId: person.roadwayAnchor.edgeId,
          nodeId: person.roadwayAnchor.nodeId,
          ratio: person.roadwayAnchor.ratio
        }))
      },
      roleMapping: {
        roadwayEdgeId: mapping.roadwayEdgeId,
        roadwayNodeId: mapping.roadwayNodeId,
        ratio: mapping.ratio
      },
      metadata: { relation: 'people are located on roadway edges or nodes' }
    })
  };

  const report = makeReport();
  if (!people.length) report.errors.push('People dataset has no people.');
  validateUnique(people.map((person) => person.personId), 'Person ids', report);
  const allowedStatuses = new Set(['normal', 'trapped', 'evacuating', 'rescued', 'unknown']);
  people.forEach((person) => {
    const position = toPoint(person.position);
    if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y) || !isFiniteNumber(position.z)) {
      report.errors.push(`Person ${person.personId} has invalid position.`);
    }
    if (!person.status) report.warnings.push(`Person ${person.personId} has no status.`);
    if (person.status && !allowedStatuses.has(String(person.status).toLowerCase())) {
      report.warnings.push(`Person ${person.personId} has custom status ${person.status}.`);
    }
    if (!person.roadwayAnchor.edgeId && !person.roadwayAnchor.nodeId) {
      report.warnings.push(`Person ${person.personId} has no roadway anchor.`);
    }
    if (person.roadwayAnchor.edgeId && person.roadwayAnchor.ratio != null) {
      const ratio = Number(person.roadwayAnchor.ratio);
      if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        report.errors.push(`Person ${person.personId} has invalid roadway ratio.`);
      }
    }
  });
  report.summary = {
    personCount: people.length,
    anchoredPersonCount: people.filter((person) => person.roadwayAnchor.edgeId || person.roadwayAnchor.nodeId).length,
    statusCounts: people.reduce((counts, person) => {
      counts[person.status] = (counts[person.status] || 0) + 1;
      return counts;
    }, {})
  };

  return new PeopleDataset({
    people,
    source: { peoplePath: sources.people?.path },
    peoplePath: sources.people?.path,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

function materializeEmergencyResources({ contract, adaptorResults, roleMapping, sources }) {
  const source = adaptorResults.resources || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rawResources = source.resources || source.raw?.resources || [];
  const resources = rawResources.map((row, index) => {
    const positionValue = getPathValue(row, relativePath(rolePath(mapping, 'position', 'position'), 'resources'));
    const position =
      positionValue && typeof positionValue === 'object'
        ? toPoint(positionValue)
        : {
            x: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionX', 'position.x'), 'resources'))),
            y: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionY', 'position.y'), 'resources'))),
            z: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionZ', 'position.z'), 'resources')))
          };
    const edgeId = getPathValue(row, relativePath(rolePath(mapping, 'roadwayEdgeId', 'roadwayAnchor.edgeId'), 'resources'));
    const nodeId = getPathValue(row, relativePath(rolePath(mapping, 'roadwayNodeId', 'roadwayAnchor.nodeId'), 'resources'));
    const ratio = getPathValue(row, relativePath(rolePath(mapping, 'ratio', 'roadwayAnchor.ratio'), 'resources'));
    const id =
      getPathValue(row, relativePath(rolePath(mapping, 'resourceId', 'resourceId'), 'resources')) ??
      row.resource_id ??
      row.id ??
      `ER_${String(index + 1).padStart(3, '0')}`;
    return {
      ...row,
      resourceId: String(id),
      label: getPathValue(row, relativePath(rolePath(mapping, 'label', 'label'), 'resources')) ?? row.name ?? `Resource ${index + 1}`,
      resourceType: getPathValue(row, relativePath(rolePath(mapping, 'resourceType', 'resourceType'), 'resources')) ?? row.type,
      status: getPathValue(row, relativePath(rolePath(mapping, 'status', 'status'), 'resources')) ?? 'unknown',
      capacity: getPathValue(row, relativePath(rolePath(mapping, 'capacity', 'capacity'), 'resources')),
      position,
      roadwayAnchor: {
        type: nodeId ? 'node' : edgeId ? 'edge' : null,
        edgeId: edgeId == null || edgeId === '' ? null : String(edgeId),
        nodeId: nodeId == null || nodeId === '' ? null : String(nodeId),
        ratio: ratio == null || ratio === '' ? null : Number(ratio)
      },
      idx: index
    };
  });

  const templates = {
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Emergency resource registry',
      role: 'resourceIdentity',
      data: {
        entities: resources.map((resource) => ({
          resourceId: resource.resourceId,
          label: resource.label,
          resourceType: resource.resourceType,
          status: resource.status,
          capacity: resource.capacity
        }))
      },
      roleMapping: {
        resourceId: mapping.resourceId,
        label: mapping.label,
        resourceType: mapping.resourceType,
        status: mapping.status,
        capacity: mapping.capacity
      },
      metadata: { keyRole: 'resourceId' }
    }),
    pointGeometry: new GeometryTemplate({
      id: 'pointGeometry',
      label: 'Emergency resource point geometry',
      role: 'resourcePosition',
      data: {
        form: 'PointSet',
        points: resources.map((resource) => ({ id: resource.resourceId, ...toPoint(resource.position) }))
      },
      roleMapping: {
        position: mapping.position,
        positionX: mapping.positionX,
        positionY: mapping.positionY,
        positionZ: mapping.positionZ
      },
      metadata: { form: 'PointSet' }
    }),
    roadwayRelation: new RelationTemplate({
      id: 'roadwayRelation',
      label: 'Emergency resource roadway location',
      role: 'resourceRoadwayAnchor',
      data: {
        source: 'registry.resourceId',
        target: 'Roadway.graph.edgeId / nodeId',
        anchors: resources.map((resource) => ({
          resourceId: resource.resourceId,
          edgeId: resource.roadwayAnchor.edgeId,
          nodeId: resource.roadwayAnchor.nodeId,
          ratio: resource.roadwayAnchor.ratio
        }))
      },
      roleMapping: {
        roadwayEdgeId: mapping.roadwayEdgeId,
        roadwayNodeId: mapping.roadwayNodeId,
        ratio: mapping.ratio
      },
      metadata: { relation: 'emergency resources are located on roadway edges or nodes' }
    })
  };

  const report = makeReport();
  if (!resources.length) report.errors.push('Emergency resources dataset has no resources.');
  validateUnique(resources.map((resource) => resource.resourceId), 'Emergency resource ids', report);
  const allowedStatuses = new Set(['available', 'unavailable', 'limited', 'unknown']);
  resources.forEach((resource) => {
    const position = toPoint(resource.position);
    if (!resource.resourceType) report.errors.push(`Resource ${resource.resourceId} is missing resource type.`);
    if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y) || !isFiniteNumber(position.z)) {
      report.errors.push(`Resource ${resource.resourceId} has invalid position.`);
    }
    if (resource.capacity != null && resource.capacity !== '' && !isFiniteNumber(resource.capacity)) {
      report.errors.push(`Resource ${resource.resourceId} has non-numeric capacity.`);
    }
    if (resource.status && !allowedStatuses.has(String(resource.status).toLowerCase())) {
      report.warnings.push(`Resource ${resource.resourceId} has custom status ${resource.status}.`);
    }
    if (!resource.roadwayAnchor.edgeId && !resource.roadwayAnchor.nodeId) {
      report.warnings.push(`Resource ${resource.resourceId} has no roadway anchor.`);
    }
    if (resource.roadwayAnchor.edgeId && resource.roadwayAnchor.ratio != null) {
      const ratio = Number(resource.roadwayAnchor.ratio);
      if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        report.errors.push(`Resource ${resource.resourceId} has invalid roadway ratio.`);
      }
    }
  });
  report.summary = {
    resourceCount: resources.length,
    exitCount: resources.filter((resource) => String(resource.resourceType).toLowerCase() === 'exit').length,
    availableCount: resources.filter((resource) => String(resource.status).toLowerCase() === 'available').length
  };

  return new EmergencyResourcesDataset({
    resources,
    source: { resourcesPath: sources.resources?.path },
    resourcesPath: sources.resources?.path,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

function materializeRoadwayHazardState({ contract, adaptorResults, roleMapping, sources }) {
  const source = adaptorResults.state || adaptorResults.hazard || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rows = (source.rows || source.raw?.rows || []).map((row) => ({
    ...row,
    roadwayEdgeId: getPathValue(row, rolePath(mapping, 'roadwayEdgeId', 'roadwayEdgeId')) ?? row.edgeId,
    roadwayNodeId: getPathValue(row, rolePath(mapping, 'roadwayNodeId', 'roadwayNodeId')) ?? row.nodeId,
    time: getPathValue(row, rolePath(mapping, 'time', 'time')),
    hazardType: getPathValue(row, rolePath(mapping, 'hazardType', 'hazardType')),
    hazardValue: getPathValue(row, rolePath(mapping, 'hazardValue', 'hazardValue')),
    severity: getPathValue(row, rolePath(mapping, 'severity', 'severity')),
    passability: getPathValue(row, rolePath(mapping, 'passability', 'passability')),
    arrivalTime: getPathValue(row, rolePath(mapping, 'arrivalTime', 'arrivalTime')),
    scenarioId: getPathValue(row, rolePath(mapping, 'scenarioId', 'scenarioId'))
  }));
  let minTime = Infinity;
  let maxTime = -Infinity;
  rows.forEach((row) => {
    const numeric = Number(row.time);
    const parsed = Number.isFinite(numeric) ? numeric : Date.parse(row.time);
    if (!Number.isFinite(parsed)) return;
    if (parsed < minTime) minTime = parsed;
    if (parsed > maxTime) maxTime = parsed;
  });
  const timeRange = Number.isFinite(minTime) ? { min: minTime, max: maxTime } : null;
  const templates = {
    hazardState: new StateTemplate({
      id: 'hazardState',
      label: 'Roadway hazard state',
      role: 'roadwayHazardTimeState',
      data: { rows },
      roleMapping: {
        time: mapping.time,
        hazardType: mapping.hazardType,
        hazardValue: mapping.hazardValue,
        severity: mapping.severity,
        passability: mapping.passability
      },
      metadata: {
        subjectRole: 'roadwayEdgeId / roadwayNodeId',
        timeRole: 'time',
        valueRole: 'hazardValue',
        timeRange
      }
    }),
    hazardField: createTemplate('Field', {
      id: 'hazardField',
      label: 'Roadway-supported hazard field',
      role: 'roadwayHazardField',
      data: {
        support: 'Roadway.graph.edgeId / nodeId',
        fieldType: 'graph-supported scalar / categorical field',
        rows
      },
      roleMapping: {
        support: mapping.support,
        value: mapping.hazardValue
      },
      metadata: { support: 'roadway', fieldType: 'graph-supported', valueRole: 'hazardValue' }
    }),
    roadwayRelation: new RelationTemplate({
      id: 'roadwayRelation',
      label: 'Hazard state roadway relation',
      role: 'hazardRoadwaySupport',
      data: {
        source: 'state row',
        target: 'Roadway.graph.edgeId / nodeId',
        rows: rows.map((row) => ({
          roadwayEdgeId: row.roadwayEdgeId,
          roadwayNodeId: row.roadwayNodeId
        }))
      },
      roleMapping: {
        roadwayEdgeId: mapping.roadwayEdgeId,
        roadwayNodeId: mapping.roadwayNodeId
      },
      metadata: { relation: 'hazard state rows are defined on roadway graph supports' }
    })
  };

  const report = makeReport();
  if (!rows.length) report.errors.push('Roadway hazard state has no rows.');
  const allowedPassability = new Set(['passable', 'risky', 'blocked', '', null, undefined]);
  const allowedSeverity = new Set(['none', 'low', 'medium', 'high', 'critical', 'unknown', '', null, undefined]);
  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const parsedTime = Number.isFinite(Number(row.time)) ? Number(row.time) : Date.parse(row.time);
    if (!Number.isFinite(parsedTime)) report.errors.push(`Hazard row ${rowNumber} has invalid time.`);
    if (!row.hazardType) report.errors.push(`Hazard row ${rowNumber} is missing hazard type.`);
    if (!isFiniteNumber(row.hazardValue)) report.errors.push(`Hazard row ${rowNumber} has invalid hazard value.`);
    if (!row.roadwayEdgeId && !row.roadwayNodeId) {
      report.errors.push(`Hazard row ${rowNumber} does not reference a roadway edge or node.`);
    }
    if (!allowedPassability.has(row.passability)) report.warnings.push(`Hazard row ${rowNumber} has custom passability ${row.passability}.`);
    if (!allowedSeverity.has(row.severity)) report.warnings.push(`Hazard row ${rowNumber} has custom severity ${row.severity}.`);
  });
  report.summary = {
    rowCount: rows.length,
    affectedEdgeCount: new Set(rows.map((row) => row.roadwayEdgeId).filter(Boolean)).size,
    hazardType: rows.find((row) => row.hazardType)?.hazardType ?? null,
    timeRange
  };

  return new RoadwayHazardStateDataset({
    rows,
    source: { statePath: sources.state?.path },
    statePath: sources.state?.path,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

function materializeGeologicalBody({ contract, adaptorResults, roleMapping, sources, representationProfile = 'generic' }) {
  const source = adaptorResults.body || adaptorResults.geology || adaptorResults.model || firstAdaptorResult(adaptorResults);
  const geometrySource = adaptorResults.geometry || {};
  const unitsSource = adaptorResults.units || {};
  const surfacesSource = adaptorResults.surfaces || {};
  const blocksSource = adaptorResults.blocks || {};
  const attributesSource = adaptorResults.attributes || {};
  const relationsSource = adaptorResults.relations || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const profile = representationProfile || source.representationProfile || geometrySource.representationProfile || 'generic';
  const rawUnits = mergeRows(source.units, source.raw?.units, source.raw?.geologicalUnits, rowsOf(unitsSource));
  const explicitBodies = mergeRows(source.bodies, source.raw?.bodies, source.raw?.geologicalBodies, rowsOf(adaptorResults.bodies));
  const rawBodies = explicitBodies.length ? explicitBodies : rawUnits;
  const rawSurfaces = mergeByIdentity(
    mergeRows(source.surfaces, source.raw?.surfaces, source.raw?.meshes, geometrySource.surfaces, rowsOf(surfacesSource)),
    ['surfaceId', 'surface_id', 'meshPartId', 'mesh_part_id', 'name']
  );
  const rawBlocks = mergeRows(source.blocks, source.rows, source.raw?.blocks, blocksSource.blocks, rowsOf(blocksSource));
  const attributes = mergeRows(source.attributes, source.raw?.attributes, attributesSource.elements, attributesSource.attributes, rowsOf(attributesSource));
  const relations = mergeRows(source.relations, source.raw?.relations, rowsOf(relationsSource), relationsSource.relations);

  const units = rawUnits.map((row, index) => ({
    ...row,
    geologicalUnitId:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitId', 'id'), 'units')) ??
      row.unit_id ??
      row.unitId ??
      row.id ??
      `GU_${index + 1}`,
    geologicalUnitName:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitName', 'name'), 'units')) ??
      row.unit_name ??
      row.unitName ??
      row.name ??
      `Unit ${index + 1}`,
    geologicalUnitType:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitType', 'type'), 'units')) ?? row.unit_type ?? row.unitType ?? row.type ?? 'unknown'
  }));
  const bodies = rawBodies.map((row, index) => ({
    ...row,
    bodyId:
      getPathValue(row, relativePath(rolePath(mapping, 'bodyId', 'bodyId'), 'bodies')) ??
      row.body_id ??
      row.bodyId ??
      row.id ??
      row.geologicalUnitId ??
      row.unit_id ??
      `GB_${index + 1}`,
    bodyName:
      getPathValue(row, relativePath(rolePath(mapping, 'bodyName', 'bodyName'), 'bodies')) ??
      row.body_name ??
      row.unit_name ??
      row.name ??
      row.geologicalUnitName ??
      `Body ${index + 1}`,
    geologicalUnitId:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitId', 'geologicalUnitId'), 'bodies')) ??
      row.unit_id ??
      row.unitId ??
      row.geologicalUnitId ??
      null,
    geologicalUnitType:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitType', 'type'), 'bodies')) ?? row.unit_type ?? row.body_type ?? row.type ?? 'unknown',
    roofSurface: getPathValue(row, relativePath(rolePath(mapping, 'roofSurface', 'roofSurface'), 'bodies')) ?? row.roofSurfaceId ?? row.roof_surface_id ?? null,
    floorSurface: getPathValue(row, relativePath(rolePath(mapping, 'floorSurface', 'floorSurface'), 'bodies')) ?? row.floorSurfaceId ?? row.floor_surface_id ?? null
  }));
  const surfaces = rawSurfaces.map((row, index) => ({
    ...row,
    surfaceId:
      getPathValue(row, relativePath(rolePath(mapping, 'surfaceId', 'surfaceId'), 'surfaces')) ??
      row.surface_id ??
      row.id ??
      row.meshPartId ??
      row.mesh_part_id ??
      `SURF_${index + 1}`,
    surfaceType: getPathValue(row, relativePath(rolePath(mapping, 'surfaceType', 'surfaceType'), 'surfaces')) ?? row.surface_type ?? row.type ?? 'surface',
    layerOrder: getPathValue(row, relativePath(rolePath(mapping, 'layerOrder', 'layerOrder'), 'surfaces')) ?? row.layer_order ?? row.order ?? null,
    meshPartId: getPathValue(row, relativePath(rolePath(mapping, 'meshPartId', 'meshPartId'), 'surfaces')) ?? row.mesh_part_id ?? row.name ?? null,
    bodyId: row.body_id ?? row.bodyId ?? null,
    geologicalUnitId:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitId', 'geologicalUnitId'), 'surfaces')) ?? row.unit_id ?? row.unitId ?? null,
    horizonElevation:
      getPathValue(row, relativePath(rolePath(mapping, 'horizonElevation', 'elevation'), 'surfaces')) ?? row.horizonElevation ?? null
  }));
  const blocks = rawBlocks.map((row, index) => ({
    ...row,
    blockId:
      getPathValue(row, relativePath(rolePath(mapping, 'blockId', 'blockId'), 'blocks')) ??
      row.block_id ??
      row.id ??
      `BLOCK_${index + 1}`,
    bodyId:
      getPathValue(row, relativePath(rolePath(mapping, 'bodyId', 'bodyId'), 'blocks')) ??
      getPathValue(row, relativePath(rolePath(mapping, 'orebodyId', 'orebodyId'), 'blocks')) ??
      row.orebody_id ??
      null,
    centroidX: getPathValue(row, relativePath(rolePath(mapping, 'centroidX', 'x'), 'blocks')),
    centroidY: getPathValue(row, relativePath(rolePath(mapping, 'centroidY', 'y'), 'blocks')),
    centroidZ: getPathValue(row, relativePath(rolePath(mapping, 'centroidZ', 'z'), 'blocks')),
    blockSizeX: getPathValue(row, relativePath(rolePath(mapping, 'blockSizeX', 'dx'), 'blocks')),
    blockSizeY: getPathValue(row, relativePath(rolePath(mapping, 'blockSizeY', 'dy'), 'blocks')),
    blockSizeZ: getPathValue(row, relativePath(rolePath(mapping, 'blockSizeZ', 'dz'), 'blocks')),
    lithology: getPathValue(row, relativePath(rolePath(mapping, 'lithology', 'lithology'), 'blocks')) ?? row.oreType,
    grade: getPathValue(row, relativePath(rolePath(mapping, 'grade', 'grade'), 'blocks')),
    density: getPathValue(row, relativePath(rolePath(mapping, 'density', 'density'), 'blocks'))
  }));

  const templates = {
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Geological body registry',
      role: 'geologicalIdentity',
      data: { units, bodies, surfaces, blocks: blocks.map((block) => ({ blockId: block.blockId, bodyId: block.bodyId })) },
      roleMapping: fieldRoleMapping(mapping, ['bodyId', 'bodyName', 'geologicalUnitId', 'geologicalUnitName', 'geologicalUnitType', 'surfaceId', 'blockId']),
      metadata: { representationProfile: profile }
    }),
    geometry: new GeometryTemplate({
      id: 'geometry',
      label: 'Geological body geometry',
      role: 'geologicalSpatialSupport',
      data: {
        form: profile === 'volumetric-block' ? 'BlockModel' : profile === 'layered-surface' ? 'SurfaceMesh / LayerInterface' : 'Hybrid',
        surfaces,
        blocks,
        meshParts: mergeRows(source.meshParts, geometrySource.meshParts)
      },
      roleMapping: fieldRoleMapping(mapping, ['geometrySupport', 'surfaceId', 'meshPartId', 'blockId', 'centroidX', 'centroidY', 'centroidZ']),
      metadata: { representationProfile: profile }
    }),
    field: createTemplate('Field', {
      id: 'field',
      label: 'Geological body attributes',
      role: 'geologicalAttributeField',
      data: { attributes, blocks },
      roleMapping: fieldRoleMapping(mapping, ['attributeField', 'thickness', 'grade', 'density', 'lithology', 'confidence', 'uncertainty']),
      metadata: { support: profile === 'volumetric-block' ? 'blocks' : 'surfaces / units' }
    }),
    relation: new RelationTemplate({
      id: 'relation',
      label: 'Geological body relations',
      role: 'geologicalObjectRelation',
      data: { rows: relations, bodies, surfaces, blocks },
      roleMapping: fieldRoleMapping(mapping, ['relationToRoadway', 'relationToBorehole', 'roofSurface', 'floorSurface']),
      metadata: { relation: 'geological objects can reference roadway, borehole, surface, and body objects' }
    })
  };

  const report = makeReport();
  if (!units.length && !bodies.length && !surfaces.length && !blocks.length) {
    report.errors.push('Geological body dataset has no units, bodies, surfaces, or blocks.');
  }
  validateUnique(units.map((unit) => unit.geologicalUnitId).filter(Boolean), 'Geological unit ids', report);
  validateUnique(bodies.map((body) => body.bodyId).filter(Boolean), 'Geological body ids', report);
  validateUnique(surfaces.map((surface) => surface.surfaceId).filter(Boolean), 'Geological surface ids', report);
  validateUnique(blocks.map((block) => block.blockId).filter(Boolean), 'Geological block ids', report);
  if (!surfaces.length && !blocks.length) report.warnings.push('Geological body has no explicit renderable geometry support.');
  report.summary = {
    representationProfile: profile,
    unitCount: units.length,
    bodyCount: bodies.length,
    surfaceCount: surfaces.length,
    blockCount: blocks.length,
    attributeCount: attributes.length
  };

  return new GeologicalBodyDataset({
    representationProfile: profile,
    units,
    bodies,
    surfaces,
    blocks,
    attributes,
    relations,
    source: {
      bodyPath: sources.body?.path || sources.geology?.path || sources.model?.path,
      geometryPath: sources.geometry?.path,
      unitsPath: sources.units?.path,
      surfacesPath: sources.surfaces?.path,
      relationsPath: sources.relations?.path
    },
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

function materializeBorehole({ contract, adaptorResults, roleMapping, sources }) {
  const source = adaptorResults.legacy || adaptorResults.boreholes || adaptorResults.logs || firstAdaptorResult(adaptorResults);
  const boreholeSource = adaptorResults.boreholes || {};
  const trajectorySource = adaptorResults.trajectories || {};
  const intervalSource = adaptorResults.intervals || adaptorResults.logs || {};
  const assaySource = adaptorResults.assays || {};
  const relationsSource = adaptorResults.relations || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const sourceIsBoreholeRegistry = source === boreholeSource && !source.raw?.boreholes;
  const intervalRows = mergeRows(
    intervalSource.intervals || rowsOf(intervalSource),
    assaySource.intervals || assaySource.samples || rowsOf(assaySource)
  );
  const rawIntervals = mergeRows(sourceIsBoreholeRegistry ? [] : source.intervals, sourceIsBoreholeRegistry ? [] : source.raw?.intervals, intervalRows);
  const rawBoreholes = mergeRows(source.boreholes, source.raw?.boreholes, rowsOf(boreholeSource), trajectorySource.boreholes);
  const boreholeMap = new Map();
  rawBoreholes.forEach((row, index) => {
    const id =
      getPathValue(row, relativePath(rolePath(mapping, 'boreholeId', 'boreholeId'), 'boreholes')) ??
      row.boreholeId ??
      row.borehole_id ??
      row.hole_id ??
      row.id ??
      `BH_${index + 1}`;
    boreholeMap.set(String(id), {
      ...row,
      boreholeId: String(id),
      boreholeName:
        getPathValue(row, relativePath(rolePath(mapping, 'boreholeName', 'name'), 'boreholes')) ??
        row.borehole_name ??
        row.boreholeName ??
        row.name ??
        String(id),
      collar: {
        x: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarX', 'collar.x'), 'boreholes'), 'collar_x', 'x']) ?? 0),
        y: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarY', 'collar.y'), 'boreholes'), 'collar_y', 'y']) ?? 0),
        z: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarZ', 'collar.z'), 'boreholes'), 'collar_z', 'z']) ?? 0)
      },
      trajectory: getPathValue(row, relativePath(rolePath(mapping, 'trajectory', 'trajectory'), 'boreholes')) ?? row.trajectory ?? row.points ?? []
    });
  });
  rawIntervals.forEach((row, index) => {
    const id =
      getPathValue(row, relativePath(rolePath(mapping, 'boreholeId', 'boreholeId'), 'intervals')) ??
      row.boreholeId ??
      row.borehole_id ??
      row.hole_id ??
      row.id ??
      `BH_${index + 1}`;
    if (!boreholeMap.has(String(id))) {
      boreholeMap.set(String(id), {
        boreholeId: String(id),
        boreholeName: String(id),
        collar: {
          x: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarX', 'x'), 'intervals'), 'x', 'collar_x']) ?? 0),
          y: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarY', 'y'), 'intervals'), 'y', 'collar_y']) ?? 0),
          z: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarZ', 'z'), 'intervals'), 'z', 'collar_z']) ?? 0)
        },
        trajectory: []
      });
    }
  });
  const boreholes = [...boreholeMap.values()];
  const intervals = rawIntervals.map((row, index) => ({
    ...row,
    sampleId:
      getPathValue(row, relativePath(rolePath(mapping, 'sampleId', 'sampleId'), 'intervals')) ??
      row.sample_id ??
      `SAMPLE_${index + 1}`,
    boreholeId:
      getPathValue(row, relativePath(rolePath(mapping, 'boreholeId', 'boreholeId'), 'intervals')) ??
      row.boreholeId ??
      row.borehole_id ??
      row.hole_id ??
      row.id,
    depthFrom: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'depthFrom', 'depthFrom'), 'intervals'), 'depth_from', 'from_depth', 'from']) ?? 0),
    depthTo: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'depthTo', 'depthTo'), 'intervals'), 'depth_to', 'to_depth', 'to']) ?? 0),
    lithology: getPathValue(row, relativePath(rolePath(mapping, 'lithology', 'lithology'), 'intervals')) ?? row.rock_type ?? null,
    grade: getPathValue(row, relativePath(rolePath(mapping, 'grade', 'grade'), 'intervals')) ?? row.assay ?? row.value ?? null,
    attributeValue: getPathValue(row, relativePath(rolePath(mapping, 'attributeValue', 'value'), 'intervals')) ?? row.value ?? null
  }));

  const templates = {
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Borehole registry',
      role: 'boreholeIdentity',
      data: { boreholes, samples: intervals.map((interval) => ({ sampleId: interval.sampleId, boreholeId: interval.boreholeId })) },
      roleMapping: fieldRoleMapping(mapping, ['boreholeId', 'boreholeName', 'sampleId']),
      metadata: { keyRole: 'boreholeId' }
    }),
    trajectoryGeometry: new GeometryTemplate({
      id: 'trajectoryGeometry',
      label: 'Borehole trajectory geometry',
      role: 'boreholeSpatialSupport',
      data: { form: 'Point / Polyline / LinearInterval', boreholes, intervals },
      roleMapping: fieldRoleMapping(mapping, ['collarX', 'collarY', 'collarZ', 'trajectory', 'depthFrom', 'depthTo']),
      metadata: { form: 'BoreholeTrajectory' }
    }),
    logField: createTemplate('Field', {
      id: 'logField',
      label: 'Borehole log field',
      role: 'depthIndexedLog',
      data: { rows: intervals },
      roleMapping: fieldRoleMapping(mapping, ['lithology', 'grade', 'attributeValue']),
      metadata: { support: 'borehole intervals' }
    }),
    relation: new RelationTemplate({
      id: 'relation',
      label: 'Borehole sample relation',
      role: 'sampleBoreholeRelation',
      data: { rows: mergeRows(intervals.map((interval) => ({ sampleId: interval.sampleId, boreholeId: interval.boreholeId })), rowsOf(relationsSource), relationsSource.relations) },
      roleMapping: fieldRoleMapping(mapping, ['boreholeId', 'sampleId', 'depthFrom', 'depthTo']),
      metadata: { relation: 'samples and intervals are located along boreholes' }
    })
  };

  const report = makeReport();
  if (!boreholes.length) report.errors.push('Borehole dataset has no boreholes.');
  validateUnique(boreholes.map((borehole) => borehole.boreholeId).filter(Boolean), 'Borehole ids', report);
  intervals.forEach((interval, index) => {
    if (!interval.boreholeId) report.errors.push(`Borehole interval ${index + 1} does not reference a borehole.`);
    if (Number.isFinite(interval.depthFrom) && Number.isFinite(interval.depthTo) && interval.depthFrom > interval.depthTo) {
      report.errors.push(`Borehole interval ${index + 1} has depthFrom greater than depthTo.`);
    }
  });
  report.summary = {
    boreholeCount: boreholes.length,
    intervalCount: intervals.length,
    sampleCount: intervals.filter((interval) => interval.sampleId).length
  };

  return new BoreholeDataset({
    boreholes,
    intervals,
    samples: source.samples || intervalSource.samples || intervals,
    logs: source.logs || intervalSource.logs || intervals,
    source: {
      boreholePath: sources.boreholes?.path || sources.logs?.path || sources.legacy?.path,
      trajectoryPath: sources.trajectories?.path,
      intervalPath: sources.intervals?.path,
      assayPath: sources.assays?.path,
      relationsPath: sources.relations?.path
    },
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

function materializeGeologicalStructure({ contract, adaptorResults, roleMapping, sources }) {
  const source = adaptorResults.legacy || adaptorResults.structures || firstAdaptorResult(adaptorResults);
  const geometrySource = adaptorResults.geometry || {};
  const structureSource = adaptorResults.structures || {};
  const traceSource = adaptorResults.traces || {};
  const relationsSource = adaptorResults.relations || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rawStructures = mergeByIdentity(
    mergeRows(source.structures, source.raw?.structures, rowsOf(structureSource), geometrySource.surfaces),
    ['structureId', 'structure_id', 'meshPartId', 'mesh_part_id', 'surfaceId', 'name']
  );
  const relations = mergeRows(source.relations, source.raw?.relations, rowsOf(relationsSource), relationsSource.relations);
  const structures = rawStructures.map((row, index) => ({
    ...row,
    structureId:
      getPathValue(row, relativePath(rolePath(mapping, 'structureId', 'structureId'), 'structures')) ??
      row.structureId ??
      row.structure_id ??
      row.mesh_part_id ??
      row.meshPartId ??
      row.surfaceId ??
      row.id ??
      `GS_${index + 1}`,
    structureName:
      getPathValue(row, relativePath(rolePath(mapping, 'structureName', 'name'), 'structures')) ??
      row.structure_name ??
      row.structureName ??
      row.name ??
      `Structure ${index + 1}`,
    structureType:
      getPathValue(row, relativePath(rolePath(mapping, 'structureType', 'structureType'), 'structures')) ?? row.structure_type ?? row.type ?? 'unknown',
    geometry:
      getPathValue(row, relativePath(rolePath(mapping, 'geometrySupport', 'geometry'), 'structures')) ??
      (row.geometryPath ? { form: row.geometryFormat || 'mesh', path: row.geometryPath, meshPartId: row.meshPartId } : null) ??
      row.trace ??
      row.surface ??
      row.mesh ??
      null,
    strike: getPathValue(row, relativePath(rolePath(mapping, 'strike', 'strike'), 'structures')),
    dip: getPathValue(row, relativePath(rolePath(mapping, 'dip', 'dip'), 'structures')),
    throw: getPathValue(row, relativePath(rolePath(mapping, 'throw', 'throw'), 'structures')),
    width: getPathValue(row, relativePath(rolePath(mapping, 'width', 'width'), 'structures')),
    confidence: getPathValue(row, relativePath(rolePath(mapping, 'confidence', 'confidence'), 'structures')),
    waterConductivity: getPathValue(row, relativePath(rolePath(mapping, 'waterConductivity', 'waterConductivity'), 'structures')) ?? row.water_conductivity,
    activity: getPathValue(row, relativePath(rolePath(mapping, 'activity', 'activity'), 'structures')),
    riskLevel: getPathValue(row, relativePath(rolePath(mapping, 'riskLevel', 'riskLevel'), 'structures')) ?? row.risk_level
  }));

  const templates = {
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Geological structure registry',
      role: 'structureIdentity',
      data: { entities: structures.map((structure) => ({ structureId: structure.structureId, structureName: structure.structureName, structureType: structure.structureType })) },
      roleMapping: fieldRoleMapping(mapping, ['structureId', 'structureName', 'structureType']),
      metadata: { keyRole: 'structureId' }
    }),
    geometry: new GeometryTemplate({
      id: 'geometry',
      label: 'Geological structure geometry',
      role: 'structureSpatialSupport',
      data: { form: 'Trace / Surface / Zone', structures, traces: rowsOf(traceSource) },
      roleMapping: fieldRoleMapping(mapping, ['geometrySupport']),
      metadata: { form: 'GeologicalStructureGeometry' }
    }),
    field: createTemplate('Field', {
      id: 'field',
      label: 'Geological structure attributes',
      role: 'structureAttributeField',
      data: { rows: structures },
      roleMapping: fieldRoleMapping(mapping, ['strike', 'dip', 'throw', 'width', 'confidence', 'waterConductivity', 'activity', 'riskLevel'])
    }),
    relation: new RelationTemplate({
      id: 'relation',
      label: 'Geological structure relation',
      role: 'structureObjectRelation',
      data: { rows: relations },
      roleMapping: {},
      metadata: { relation: 'structures may cut bodies, intersect roadway, or be observed by boreholes' }
    })
  };

  const report = makeReport();
  if (!structures.length) report.errors.push('Geological structure dataset has no structures.');
  validateUnique(structures.map((structure) => structure.structureId).filter(Boolean), 'Geological structure ids', report);
  structures.forEach((structure) => {
    if (!structure.structureType) report.errors.push(`Structure ${structure.structureId} is missing structure type.`);
  });
  report.summary = {
    structureCount: structures.length,
    structureTypes: [...new Set(structures.map((structure) => structure.structureType).filter(Boolean))],
    relationCount: relations.length
  };

  return new GeologicalStructureDataset({
    structures,
    relations,
    source: { structurePath: sources.structures?.path || sources.legacy?.path, geometryPath: sources.geometry?.path, relationsPath: sources.relations?.path },
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

function materializeGeologicalAttributeModel({ contract, adaptorResults, roleMapping, sources, representationProfile = 'generic' }) {
  const source = adaptorResults.model || adaptorResults.attributes || firstAdaptorResult(adaptorResults);
  const gridSource = adaptorResults.grid || {};
  const binarySource = adaptorResults.binary || {};
  const schemaSource = adaptorResults.schema || {};
  const previewSource = adaptorResults.preview || {};
  const elementSource = adaptorResults.elements || adaptorResults.attributes || {};
  const blockSource = adaptorResults.blocks || {};
  const geometrySource = adaptorResults.geometry || {};
  const relationsSource = adaptorResults.relations || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const profile = representationProfile || source.representationProfile || gridSource.representationProfile || 'generic';
  const grid = gridSource.grid || source.grid || source.raw?.grid || null;
  const binaryBuffer = binarySource.arrayBuffer || null;
  const sourceElementRows = source === elementSource || source === blockSource || source === previewSource
    ? []
    : mergeRows(source.elements, source.blocks, source.rows, source.raw?.elements);
  const rawElements = mergeRows(
    sourceElementRows,
    elementSource.elements || elementSource.blocks || rowsOf(elementSource),
    blockSource.blocks || blockSource.elements || rowsOf(blockSource),
    previewSource.elements || previewSource.blocks || rowsOf(previewSource)
  );
  const rawAttributes = mergeRows(source.attributes, source.raw?.attributes, gridSource.attributes, rowsOf(schemaSource));
  const relations = mergeRows(source.relations, source.raw?.relations, rowsOf(relationsSource), relationsSource.relations);
  const elements = rawElements.map((row, index) => {
    const blockId = getPathValue(row, relativePath(rolePath(mapping, 'blockId', 'blockId'), 'elements')) ?? row.block_id ?? row.blockId ?? row.id;
    const seamId = getPathValue(row, relativePath(rolePath(mapping, 'seamId', 'seamId'), 'elements')) ?? row.seam_id;
    const rawElementId =
      getPathValue(row, relativePath(rolePath(mapping, 'supportElementId', 'supportElementId'), 'elements')) ??
      row.element_id ??
      row.elementId ??
      blockId ??
      `GA_${index + 1}`;
    const elementId = profile === 'coal-seam-attribute' && seamId && rawElementId
      ? `${seamId}_${rawElementId}`
      : rawElementId;
    return {
      ...row,
      elementId: String(elementId),
      blockId: blockId == null ? null : String(blockId),
      modelId: getPathValue(row, relativePath(rolePath(mapping, 'modelId', 'modelId'), 'elements')) ?? row.model_id ?? null,
      centroidX: getPathValue(row, relativePath(rolePath(mapping, 'centroidX', 'x'), 'elements')),
      centroidY: getPathValue(row, relativePath(rolePath(mapping, 'centroidY', 'y'), 'elements')),
      centroidZ: getPathValue(row, relativePath(rolePath(mapping, 'centroidZ', 'z'), 'elements')),
      blockSizeX: getPathValue(row, relativePath(rolePath(mapping, 'blockSizeX', 'dx'), 'elements')),
      blockSizeY: getPathValue(row, relativePath(rolePath(mapping, 'blockSizeY', 'dy'), 'elements')),
      blockSizeZ: getPathValue(row, relativePath(rolePath(mapping, 'blockSizeZ', 'dz'), 'elements')),
      attributeName: getPathValue(row, relativePath(rolePath(mapping, 'attributeName', 'attributeName'), 'elements')) ?? row.name,
      attributeValue: getPathValue(row, relativePath(rolePath(mapping, 'attributeValue', 'attributeValue'), 'elements')) ?? row.value,
      grade: getPathValue(row, relativePath(rolePath(mapping, 'grade', 'grade'), 'elements')),
      density: getPathValue(row, relativePath(rolePath(mapping, 'density', 'density'), 'elements')),
      tonnage: getPathValue(row, relativePath(rolePath(mapping, 'tonnage', 'tonnage'), 'elements')),
      oreType: getPathValue(row, relativePath(rolePath(mapping, 'oreType', 'oreType'), 'elements')) ?? row.ore_type,
      resourceCategory: getPathValue(row, relativePath(rolePath(mapping, 'resourceCategory', 'resourceCategory'), 'elements')) ?? row.resource_category,
      thickness: getPathValue(row, relativePath(rolePath(mapping, 'thickness', 'thickness'), 'elements')),
      riskValue: getPathValue(row, relativePath(rolePath(mapping, 'riskValue', 'riskValue'), 'elements')),
      uncertainty: getPathValue(row, relativePath(rolePath(mapping, 'uncertainty', 'uncertainty'), 'elements')),
      seamId,
      surfaceId: getPathValue(row, relativePath(rolePath(mapping, 'surfaceId', 'surfaceId'), 'elements')) ?? row.surface_id,
      calorificValue: getPathValue(row, relativePath(rolePath(mapping, 'calorificValue', 'calorificValue'), 'elements')) ?? row.calorific_value,
      gasContent: getPathValue(row, relativePath(rolePath(mapping, 'gasContent', 'gasContent'), 'elements')) ?? row.gas_content,
      waterContent: getPathValue(row, relativePath(rolePath(mapping, 'waterContent', 'waterContent'), 'elements')) ?? row.water_content
    };
  });
  const attributes = rawAttributes.length ? rawAttributes.map((attribute) => ({
    ...attribute,
    attributeName: attribute.attributeName ?? attribute.attribute_name ?? attribute.key ?? attribute.name,
    valueType: attribute.valueType ?? attribute.value_type ?? attribute.dtype ?? attribute.type,
    unit: attribute.unit ?? '',
    nodata: attribute.nodata ?? attribute.noData
  })) : [];
  const blocks = elements.filter((element) => element.blockId || profile === 'resource-block');
  const binaryAttributes = {};
  if (binaryBuffer && grid && attributes.length) {
    attributes.forEach((attribute, index) => {
      const key = attribute.key ?? attribute.attributeName ?? attribute.name ?? `attribute_${index + 1}`;
      const dtype = String(attribute.dtype ?? attribute.valueType ?? '').toLowerCase();
      const offset = Number(attribute.offset ?? 0);
      const length = Number(attribute.length ?? grid.totalVoxels ?? 0);
      if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0 || attribute.offset == null) return;
      try {
        if (dtype.includes('uint8')) binaryAttributes[key] = new Uint8Array(binaryBuffer, offset, length);
        else if (dtype.includes('int16')) binaryAttributes[key] = new Int16Array(binaryBuffer, offset, length);
        else if (dtype.includes('uint16')) binaryAttributes[key] = new Uint16Array(binaryBuffer, offset, length);
        else if (dtype.includes('int32')) binaryAttributes[key] = new Int32Array(binaryBuffer, offset, length);
        else if (dtype.includes('uint32')) binaryAttributes[key] = new Uint32Array(binaryBuffer, offset, length);
        else binaryAttributes[key] = new Float32Array(binaryBuffer, offset, length);
      } catch (error) {
        // Keep semanticization resilient; validation below will still expose missing arrays.
      }
    });
  }

  const templates = {
    geometry: new GeometryTemplate({
      id: 'geometry',
      label: 'Geological attribute geometry support',
      role: 'attributeSpatialSupport',
      data: {
        form: profile === 'resource-block' ? 'BlockModel' : profile === 'coal-seam-attribute' ? 'SurfaceGrid' : 'GenericSpatialTable',
        elements,
        blocks,
        grid,
        meshParts: geometrySource.meshParts || []
      },
      roleMapping: fieldRoleMapping(mapping, ['spatialSupport', 'supportElementId', 'blockId', 'centroidX', 'centroidY', 'centroidZ', 'gridX', 'gridY']),
      metadata: { representationProfile: profile }
    }),
    field: createTemplate('Field', {
      id: 'field',
      label: 'Geological attribute field',
      role: 'spatialGeologicalField',
      data: { elements, attributes, grid, binaryAttributes: Object.keys(binaryAttributes) },
      roleMapping: fieldRoleMapping(mapping, [
        'attributeName',
        'attributeValue',
        'valueType',
        'unit',
        'grade',
        'density',
        'tonnage',
        'thickness',
        'ash',
        'sulfur',
        'calorificValue',
        'gasContent',
        'waterContent',
        'riskValue',
        'riskType',
        'probability',
        'uncertainty'
      ]),
      metadata: { support: 'geological geometry support' }
    }),
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Geological attribute element registry',
      role: 'attributeElementIdentity',
      data: { modelId: sources.model?.path || sources.grid?.path || profile, elements: elements.map((element) => ({ elementId: element.elementId, blockId: element.blockId })), grid },
      roleMapping: fieldRoleMapping(mapping, ['modelId', 'supportElementId', 'blockId', 'geologicalUnitId', 'orebodyId', 'domainId', 'seamId']),
      metadata: { keyRole: 'supportElementId / blockId' }
    }),
    relation: new RelationTemplate({
      id: 'relation',
      label: 'Geological attribute relations',
      role: 'attributeModelRelation',
      data: { rows: relations, elements },
      roleMapping: fieldRoleMapping(mapping, ['geologicalUnitId', 'orebodyId', 'domainId', 'surfaceId']),
      metadata: { relation: 'attribute model elements can reference bodies, domains, surfaces, roadway, or boreholes' }
    })
  };

  const report = makeReport();
  if (!elements.length && !grid) report.errors.push('Geological attribute model has no spatial elements or grid support.');
  validateUnique(elements.map((element) => element.elementId).filter(Boolean), 'Geological attribute element ids', report);
  blocks.forEach((block) => {
    ['blockSizeX', 'blockSizeY', 'blockSizeZ'].forEach((key) => {
      if (block[key] != null && block[key] !== '' && Number(block[key]) <= 0) report.errors.push(`Block ${block.blockId || block.elementId} has invalid ${key}.`);
    });
  });
  const attributeNames = new Set();
  elements.forEach((element) => {
    ['grade', 'density', 'tonnage', 'thickness', 'ash', 'sulfur', 'calorificValue', 'gasContent', 'waterContent', 'riskValue', 'uncertainty'].forEach((key) => {
      if (element[key] != null && element[key] !== '') attributeNames.add(key);
    });
    Object.entries(element).forEach(([key, value]) => {
      if (isGeologicalAttributeValueColumn(key, value)) attributeNames.add(key);
    });
    if (element.attributeName) attributeNames.add(element.attributeName);
  });
  if (!attributeNames.size && !attributes.length) report.warnings.push('Geological attribute model has no detected attribute values.');
  attributes.forEach((attribute) => {
    const name = attribute.attributeName ?? attribute.key ?? attribute.name;
    if (name) attributeNames.add(name);
  });
  report.summary = {
    representationProfile: profile,
    elementCount: elements.length,
    blockCount: blocks.length,
    gridSize: grid ? `${grid.nx || grid.width} x ${grid.ny || grid.height} x ${grid.nz || grid.depth}` : null,
    attributeCount: attributeNames.size || attributes.length,
    attributes: [...attributeNames]
  };

  return new GeologicalAttributeModelDataset({
    representationProfile: profile,
    modelId: sources.model?.path || sources.grid?.path || profile,
    elements,
    blocks,
    attributes,
    relations,
    grid,
    binaryAttributes,
    source: {
      modelPath: sources.model?.path || sources.attributes?.path || sources.elements?.path,
      gridPath: sources.grid?.path,
      binaryPath: sources.binary?.path,
      schemaPath: sources.schema?.path,
      geometryPath: sources.geometry?.path,
      blocksPath: sources.blocks?.path,
      relationsPath: sources.relations?.path
    },
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}

export function materializeDataset({ datasetType, contract, adaptorResults, roleMapping, sources, variable, unit, displayRange, representationProfile }) {
  switch (datasetType) {
    case 'Roadway':
      return materializeRoadway({ contract, adaptorResults, roleMapping, sources });
    case 'SensorRegistry':
      return materializeSensorRegistry({ contract, adaptorResults, roleMapping, sources });
    case 'SensorReadings':
      return materializeSensorReadings({ contract, adaptorResults, roleMapping, sources, variable, unit, displayRange });
    case 'VentilationNetwork':
      return materializeVentilationNetwork({ contract, adaptorResults, roleMapping, sources });
    case 'AirflowState':
      return materializeAirflowState({ contract, adaptorResults, roleMapping, sources });
    case 'People':
      return materializePeople({ contract, adaptorResults, roleMapping, sources });
    case 'EmergencyResources':
      return materializeEmergencyResources({ contract, adaptorResults, roleMapping, sources });
    case 'RoadwayHazardState':
      return materializeRoadwayHazardState({ contract, adaptorResults, roleMapping, sources });
    case 'GeologicalBody':
      return materializeGeologicalBody({ contract, adaptorResults, roleMapping, sources, representationProfile });
    case 'Borehole':
      return materializeBorehole({ contract, adaptorResults, roleMapping, sources });
    case 'GeologicalStructure':
      return materializeGeologicalStructure({ contract, adaptorResults, roleMapping, sources });
    case 'GeologicalAttributeModel':
      return materializeGeologicalAttributeModel({ contract, adaptorResults, roleMapping, sources, representationProfile });
    default:
      throw new Error(`No dataset materializer registered for ${datasetType}`);
  }
}

export function mergeRoleMapping(contract, adaptorResults, roleMapping) {
  return completeRoleMapping(contract, adaptorResults, roleMapping);
}
