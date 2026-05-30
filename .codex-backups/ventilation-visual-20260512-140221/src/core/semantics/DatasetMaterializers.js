import { RoadwayDataset } from '../datasets/RoadwayDataset.js';
import { SensorRegistryDataset } from '../datasets/SensorRegistryDataset.js';
import { SensorReadingsDataset } from '../datasets/SensorReadingsDataset.js';
import { VentilationNetworkDataset } from '../datasets/VentilationNetworkDataset.js';
import { AirflowStateDataset } from '../datasets/AirflowStateDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from './DataTemplates.js';

const isFiniteNumber = (value) => Number.isFinite(Number(value));

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

export function materializeDataset({ datasetType, contract, adaptorResults, roleMapping, sources, variable, unit, displayRange }) {
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
    default:
      throw new Error(`No dataset materializer registered for ${datasetType}`);
  }
}

export function mergeRoleMapping(contract, adaptorResults, roleMapping) {
  return completeRoleMapping(contract, adaptorResults, roleMapping);
}
