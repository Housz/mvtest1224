import { DatasetTaxonomy } from './Taxonomies.js';

const role = (key, label, description, required = true, expectedType = 'string', defaultPath = '', candidates = []) => ({
  key,
  label,
  description,
  required,
  expectedType,
  defaultPath,
  candidates
});

const contracts = [
  {
    id: 'RoadwayContract',
    class: 'Roadway',
    taxonomyClass: 'Roadways & Infrastructure',
    label: 'Roadway',
    description: 'A coherent underground roadway object system with topology, geometry, and their internal correspondence.',
    requiredTemplates: ['Graph', 'Geometry', 'Relation'],
    roles: [
      role('graph.nodeId', 'Node identity', 'Unique roadway graph node id.', true, 'string', 'nodes.id'),
      role('graph.nodePosition', 'Node position', '3D position of each roadway graph node.', true, 'vec3', 'nodes.position'),
      role('graph.edgeId', 'Edge identity', 'Unique roadway graph edge id.', true, 'string', 'edges.id'),
      role('graph.fromNode', 'From node', 'Source node referenced by an edge.', true, 'string', 'edges.source'),
      role('graph.toNode', 'To node', 'Target node referenced by an edge.', true, 'string', 'edges.target'),
      role('graph.path', 'Edge centerline', 'Polyline or path points for each roadway edge.', false, 'polyline', 'edges.path'),
      role('geometry.meshPartId', 'Mesh part identity', 'OBJ object or group name for each roadway mesh part.', true, 'string', 'meshParts.name'),
      role(
        'relation.geometryTarget',
        'Mesh-to-graph target',
        'Graph entity id that a mesh part corresponds to; defaults to matching mesh part names to node/edge ids.',
        false,
        'string',
        'meshParts.name'
      )
    ],
    constraints: [
      'Graph must contain non-empty nodes and edges.',
      'Node ids and edge ids must be unique.',
      'Each edge endpoint must reference an existing node.',
      'Geometry should contain mesh parts or a model source.',
      'Geometry-to-graph correspondence should be derivable from mesh part names or mapping attributes.'
    ]
  },
  {
    id: 'SensorRegistryContract',
    class: 'SensorRegistry',
    taxonomyClass: 'Monitoring & Sensing',
    label: 'Sensor Registry',
    description: 'A registry of monitoring sensors with identity, position, and mounting relation to roadways.',
    requiredTemplates: ['Registry', 'Geometry', 'Relation'],
    roles: [
      role('sensorIdentity', 'Sensor identity', 'Stable identity of each sensor.', true, 'string', 'sensorID'),
      role('sensorType', 'Sensor type', 'Sensor category or measured variable.', false, 'string', 'type'),
      role('positionX', 'Position X', 'Sensor position X coordinate.', true, 'number', 'x'),
      role('positionY', 'Position Y', 'Sensor position Y coordinate.', true, 'number', 'y'),
      role('positionZ', 'Position Z', 'Sensor position Z coordinate.', true, 'number', 'z'),
      role('roadwayAnchor', 'Roadway anchor', 'Roadway edge or node id on which the sensor is mounted.', false, 'string', 'roadwayID'),
      role('ratio', 'Roadway ratio', 'Relative position along the mounted roadway edge.', false, 'number', 'ratio')
    ],
    constraints: [
      'Sensor identities should be unique.',
      'Sensor point coordinates must be numeric.',
      'Missing roadway anchors are warnings because unmounted sensors can still be shown as points.'
    ]
  },
  {
    id: 'SensorReadingsContract',
    class: 'EnvironmentalSensorReadings',
    taxonomyClass: 'Monitoring & Sensing',
    label: 'Environmental Sensor Readings',
    description: 'Time-indexed environmental sensor observations such as temperature, CO, humidity, or CH4.',
    requiredTemplates: ['State', 'Relation'],
    roles: [
      role('observedEntity', 'Observed sensor', 'Sensor identity referenced by each reading.', true, 'string', 'sensorID', [
        'sensorID',
        'sensor_id',
        'sensorId',
        'station_code'
      ]),
      role('timestamp', 'Observation time', 'Observation time for each reading.', true, 'datetime', 'time', [
        'time',
        'timestamp',
        'record_time',
        'Time'
      ]),
      role('measuredValue', 'Measured value', 'Numeric environmental value.', true, 'number', 'value', [
        'value',
        'temperature',
        'temp',
        'CO',
        'co',
        'humidity',
        'rh',
        'CH4',
        'ch4',
        'methane'
      ]),
      role('variableName', 'Variable field', 'Optional field that names the measured variable in long-form tables.', false, 'string', 'variable', [
        'variable',
        'measurement',
        'variableName',
        'type'
      ]),
      role('unitName', 'Unit field', 'Optional field that provides the measurement unit.', false, 'string', 'unit', [
        'unit',
        'units'
      ])
    ],
    constraints: [
      'Observed entity must be present for each reading.',
      'Timestamp values should be parseable.',
      'Measured values must be numeric.',
      'The materialized series map must be non-empty.',
      'A measured variable should be declared by preset, parameter, or source field.'
    ]
  },
  {
    id: 'VentilationNetworkContract',
    class: 'VentilationNetwork',
    taxonomyClass: 'Ventilation & Utility Network',
    label: 'Ventilation Network',
    description:
      'A ventilation business network with ventilation nodes, branches, facilities, boundary conditions, and roadway relations.',
    requiredTemplates: ['Graph', 'Registry', 'Relation'],
    roles: [
      role('graph.nodeId', 'Ventilation node identity', 'Unique ventilation node id.', true, 'string', 'nodes.id'),
      role('graph.nodeType', 'Ventilation node type', 'Node type such as junction, intake, or return.', false, 'string', 'nodes.type'),
      role('graph.nodePosition', 'Ventilation node position', '3D node position.', false, 'vec3', 'nodes.position'),
      role('graph.branchId', 'Branch identity', 'Unique ventilation branch id.', true, 'string', 'branches.id'),
      role('graph.fromNode', 'From ventilation node', 'Source node referenced by a branch.', true, 'string', 'branches.from'),
      role('graph.toNode', 'To ventilation node', 'Target node referenced by a branch.', true, 'string', 'branches.to'),
      role('graph.branchType', 'Branch type', 'Business type of ventilation branch.', false, 'string', 'branches.branchType'),
      role('graph.nominalDirection', 'Nominal direction', 'Branch nominal airflow direction.', false, 'string', 'branches.nominalDirection'),
      role('graph.path', 'Branch path', 'Polyline path of the ventilation branch.', false, 'polyline', 'branches.path'),
      role('facility.facilityId', 'Facility identity', 'Unique ventilation facility id.', false, 'string', 'facilities.id'),
      role('facility.facilityType', 'Facility type', 'Facility type such as fan, door, regulator, or stopping.', false, 'string', 'facilities.type'),
      role('facility.branchId', 'Mounted branch', 'Branch on which the facility is mounted.', false, 'string', 'facilities.branchId'),
      role('facility.ratio', 'Branch ratio', 'Relative mounted position along the branch.', false, 'number', 'facilities.ratio'),
      role('relation.roadwayEdges', 'Roadway branch relation', 'Roadway edge ids represented by the ventilation branch.', false, 'string[]', 'branches.roadwayEdgeIds'),
      role('relation.roadwayNode', 'Roadway node relation', 'Roadway node associated with the ventilation node.', false, 'string', 'nodes.roadwayNodeId')
    ],
    constraints: [
      'Ventilation branch ids and node ids should be unique.',
      'Each branch endpoint must reference an existing ventilation node.',
      'Facility branch references should resolve to ventilation branches.',
      'Boundary condition node references should resolve to ventilation nodes.'
    ]
  },
  {
    id: 'AirflowStateContract',
    class: 'AirflowState',
    taxonomyClass: 'Ventilation & Utility Network',
    label: 'Airflow State',
    description: 'Time-indexed airflow states defined on ventilation branches.',
    requiredTemplates: ['State', 'Field', 'Relation'],
    roles: [
      role('branchId', 'Ventilation branch', 'Ventilation branch referenced by each state row.', true, 'string', 'branch_id', [
        'branch_id',
        'branchId',
        'branchID',
        'id'
      ]),
      role('timestamp', 'State time', 'Time of each airflow state row.', true, 'datetime', 'time', ['time', 'timestamp', 't', 'step']),
      role('airQuantity', 'Air quantity', 'Branch air quantity in m3/s.', true, 'number', 'air_quantity_m3s', [
        'air_quantity_m3s',
        'airQuantity',
        'Q',
        'flow',
        'airflow'
      ]),
      role('velocity', 'Velocity', 'Branch airflow velocity.', false, 'number', 'velocity_ms', [
        'velocity_ms',
        'velocity',
        'v',
        'air_velocity'
      ]),
      role('pressureDrop', 'Pressure drop', 'Branch pressure drop.', false, 'number', 'pressure_drop_pa', [
        'pressure_drop_pa',
        'pressureDrop',
        'deltaP',
        'dp'
      ]),
      role('pressureFrom', 'From pressure', 'Pressure at branch from node.', false, 'number', 'pressure_from_pa', [
        'pressure_from_pa',
        'pressureFrom',
        'p_from'
      ]),
      role('pressureTo', 'To pressure', 'Pressure at branch to node.', false, 'number', 'pressure_to_pa', [
        'pressure_to_pa',
        'pressureTo',
        'p_to'
      ]),
      role('directionSign', 'Direction sign', 'Direction sign relative to nominal direction.', false, 'number', 'direction_sign', [
        'direction_sign',
        'directionSign',
        'sign'
      ]),
      role('direction', 'Direction', 'Actual airflow direction.', false, 'string', 'direction', ['direction']),
      role('anomalyType', 'Anomaly type', 'Airflow anomaly label.', false, 'string', 'anomaly_type', [
        'anomaly_type',
        'anomalyType'
      ]),
      role('scenarioId', 'Scenario id', 'Scenario identifier.', false, 'string', 'scenario_id', ['scenario_id', 'scenarioId'])
    ],
    constraints: [
      'Airflow state rows must reference branch ids.',
      'Time values should be parseable.',
      'Air quantity values should be numeric.',
      'Rows should be non-empty.'
    ]
  }
];

class SemanticContractRegistryClass {
  constructor() {
    this.contracts = new Map(contracts.map((contract) => [contract.id, contract]));
  }

  list() {
    return [...this.contracts.values()];
  }

  get(id) {
    return this.contracts.get(id);
  }

  getByClass(className) {
    return this.list().find((contract) => contract.class === className) ?? null;
  }

  getDatasetTaxonomyRow(contract) {
    return DatasetTaxonomy.find((item) => item.class === contract?.taxonomyClass) ?? null;
  }
}

export const SemanticContractRegistry = new SemanticContractRegistryClass();
