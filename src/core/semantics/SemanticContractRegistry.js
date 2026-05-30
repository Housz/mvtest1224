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
  },
  {
    id: 'PeopleContract',
    class: 'People',
    taxonomyClass: 'Equipment, People & Mobile Asset',
    label: 'People',
    description: 'A registry of underground personnel with identity, point position, current status, and roadway anchor relation.',
    requiredTemplates: ['Registry', 'Geometry', 'State', 'Relation'],
    roles: [
      role('personId', 'Person ID', 'Stable identity of each person.', true, 'string', 'people.personId', [
        'people.personId',
        'people.person_id',
        'people.id'
      ]),
      role('label', 'Label', 'Human-readable person label.', false, 'string', 'people.label', ['people.label', 'people.name']),
      role('personType', 'Person Type', 'Person role such as worker, inspector, rescuer, or visitor.', false, 'string', 'people.personType', [
        'people.personType',
        'people.type'
      ]),
      role('team', 'Team / Group', 'Team or group membership.', false, 'string', 'people.team', ['people.team', 'people.group']),
      role('status', 'Status', 'Current personnel status.', false, 'string', 'people.status', ['people.status']),
      role('timestamp', 'Timestamp', 'Timestamp of the current personnel state.', false, 'datetime', 'people.timestamp', [
        'people.timestamp',
        'people.time'
      ]),
      role('position', 'Position', '3D point position of the person.', true, 'vec3', 'people.position', [
        'people.position'
      ]),
      role('positionX', 'Position X', 'Person position X coordinate when position is stored as columns.', false, 'number', 'people.position.x', [
        'people.position.x',
        'people.x'
      ]),
      role('positionY', 'Position Y', 'Person position Y coordinate when position is stored as columns.', false, 'number', 'people.position.y', [
        'people.position.y',
        'people.y'
      ]),
      role('positionZ', 'Position Z', 'Person position Z coordinate when position is stored as columns.', false, 'number', 'people.position.z', [
        'people.position.z',
        'people.z'
      ]),
      role('roadwayEdgeId', 'Roadway Edge ID', 'Roadway edge on which the person is located.', false, 'string', 'people.roadwayAnchor.edgeId', [
        'people.roadwayAnchor.edgeId',
        'people.edgeId',
        'people.roadwayEdgeId'
      ]),
      role('roadwayNodeId', 'Roadway Node ID', 'Roadway node on which the person is located.', false, 'string', 'people.roadwayAnchor.nodeId', [
        'people.roadwayAnchor.nodeId',
        'people.nodeId',
        'people.roadwayNodeId'
      ]),
      role('ratio', 'Anchor Ratio', 'Relative location on the anchored roadway edge.', false, 'number', 'people.roadwayAnchor.ratio', [
        'people.roadwayAnchor.ratio',
        'people.ratio'
      ])
    ],
    constraints: [
      'Person ids must be unique.',
      'Position must be valid.',
      'Status should be interpretable.',
      'Roadway anchor should reference a roadway edge or node when available.',
      'Ratio should be between 0 and 1 when edge anchor is used.'
    ]
  },
  {
    id: 'EmergencyResourcesContract',
    class: 'EmergencyResources',
    taxonomyClass: 'Safety, Hazard & Emergency',
    label: 'Emergency Resources',
    description: 'A registry of emergency response resources such as exits, refuges, rescue stations, and supplies.',
    requiredTemplates: ['Registry', 'Geometry', 'Relation'],
    roles: [
      role('resourceId', 'Resource ID', 'Stable identity of each emergency resource.', true, 'string', 'resources.resourceId', [
        'resources.resourceId',
        'resources.resource_id',
        'resources.id'
      ]),
      role('label', 'Label', 'Human-readable resource label.', false, 'string', 'resources.label', [
        'resources.label',
        'resources.name'
      ]),
      role('resourceType', 'Resource Type', 'Resource type such as exit, refuge, rescue station, or emergency supply.', true, 'string', 'resources.resourceType', [
        'resources.resourceType',
        'resources.type'
      ]),
      role('status', 'Status', 'Resource availability status.', false, 'string', 'resources.status', ['resources.status']),
      role('capacity', 'Capacity', 'Resource capacity when relevant.', false, 'number', 'resources.capacity', [
        'resources.capacity'
      ]),
      role('position', 'Position', '3D point position of the resource.', true, 'vec3', 'resources.position', [
        'resources.position'
      ]),
      role('positionX', 'Position X', 'Resource position X coordinate when position is stored as columns.', false, 'number', 'resources.position.x', [
        'resources.position.x',
        'resources.x'
      ]),
      role('positionY', 'Position Y', 'Resource position Y coordinate when position is stored as columns.', false, 'number', 'resources.position.y', [
        'resources.position.y',
        'resources.y'
      ]),
      role('positionZ', 'Position Z', 'Resource position Z coordinate when position is stored as columns.', false, 'number', 'resources.position.z', [
        'resources.position.z',
        'resources.z'
      ]),
      role('roadwayEdgeId', 'Roadway Edge ID', 'Roadway edge on which the resource is located.', false, 'string', 'resources.roadwayAnchor.edgeId', [
        'resources.roadwayAnchor.edgeId',
        'resources.edgeId',
        'resources.roadwayEdgeId'
      ]),
      role('roadwayNodeId', 'Roadway Node ID', 'Roadway node on which the resource is located.', false, 'string', 'resources.roadwayAnchor.nodeId', [
        'resources.roadwayAnchor.nodeId',
        'resources.nodeId',
        'resources.roadwayNodeId'
      ]),
      role('ratio', 'Anchor Ratio', 'Relative location on the anchored roadway edge.', false, 'number', 'resources.roadwayAnchor.ratio', [
        'resources.roadwayAnchor.ratio',
        'resources.ratio'
      ])
    ],
    constraints: [
      'Resource ids must be unique.',
      'Resource type must be interpretable.',
      'Position must be valid.',
      'Capacity should be numeric when provided.',
      'Status should be available, unavailable, or limited when provided.',
      'Roadway anchor should reference a roadway edge or node when available.'
    ]
  },
  {
    id: 'RoadwayHazardStateContract',
    class: 'RoadwayHazardState',
    taxonomyClass: 'Safety, Hazard & Emergency',
    label: 'Roadway Hazard State',
    description: 'A derived time-indexed hazard state defined on roadway graph supports.',
    requiredTemplates: ['State', 'Field', 'Relation'],
    roles: [
      role('support', 'Roadway Support', 'Roadway support on which hazard values are defined.', true, 'string', 'roadwayEdgeId', [
        'roadwayEdgeId',
        'roadway_edge_id',
        'edgeId'
      ]),
      role('roadwayEdgeId', 'Roadway Edge ID', 'Roadway edge referenced by a hazard state row.', false, 'string', 'roadwayEdgeId', [
        'roadwayEdgeId',
        'roadway_edge_id',
        'edgeId'
      ]),
      role('roadwayNodeId', 'Roadway Node ID', 'Roadway node referenced by a hazard state row.', false, 'string', 'roadwayNodeId', [
        'roadwayNodeId',
        'roadway_node_id',
        'nodeId'
      ]),
      role('time', 'Time', 'Hazard state time.', true, 'datetime', 'time', ['time', 'timestamp', 't', 'step']),
      role('hazardType', 'Hazard Type', 'Hazard type such as water, smoke, fire, or gas.', true, 'string', 'hazard_type', [
        'hazardType',
        'hazard_type',
        'type'
      ]),
      role('hazardValue', 'Hazard Value', 'Numeric hazard intensity value.', true, 'number', 'hazard_value', [
        'hazardValue',
        'hazard_value',
        'value',
        'intensity'
      ]),
      role('severity', 'Severity', 'Categorical severity level.', false, 'string', 'severity', ['severity']),
      role('passability', 'Passability', 'Roadway passability status.', false, 'string', 'passability', ['passability']),
      role('arrivalTime', 'Arrival Time', 'Hazard arrival time on the support.', false, 'datetime', 'arrival_time', [
        'arrivalTime',
        'arrival_time'
      ]),
      role('scenarioId', 'Scenario ID', 'Scenario identifier.', false, 'string', 'scenario_id', [
        'scenarioId',
        'scenario_id'
      ])
    ],
    constraints: [
      'Time values must be valid.',
      'Hazard type must be defined.',
      'Hazard values must be numeric when provided.',
      'Hazard state should reference roadway edge or node.',
      'Passability should be passable, risky, or blocked when provided.'
    ]
  },
  {
    id: 'GeologicalBodyContract',
    class: 'GeologicalBody',
    taxonomyClass: 'Geology & Resource Datasets',
    label: 'Geological Body',
    description:
      'A semantic geological body dataset for layered surfaces, volumetric blocks, geological units, and their relations.',
    requiredTemplates: ['Registry', 'Geometry', 'Relation'],
    roles: [
      role('bodyId', 'Body ID', 'Stable geological body identity.', false, 'string', 'bodies.bodyId', [
        'bodies.bodyId',
        'bodies.body_id',
        'bodies.id',
        'blocks.bodyId'
      ]),
      role('bodyName', 'Body Name', 'Human-readable body name.', false, 'string', 'bodies.bodyName', [
        'bodies.bodyName',
        'bodies.name'
      ]),
      role('geologicalUnitId', 'Geological Unit ID', 'Stable geological unit identity.', false, 'string', 'units.id', [
        'units.id',
        'units.unitId',
        'units.geologicalUnitId',
        'surfaces.geologicalUnitId'
      ]),
      role('geologicalUnitName', 'Geological Unit Name', 'Human-readable geological unit name.', false, 'string', 'units.name', [
        'units.name',
        'units.geologicalUnitName'
      ]),
      role('geologicalUnitType', 'Geological Unit Type', 'Unit type such as seam, stratum, orebody, or lithology.', false, 'string', 'units.type', [
        'units.type',
        'units.geologicalUnitType',
        'bodies.type'
      ]),
      role('geometrySupport', 'Geometry Support', 'Surface, mesh, solid, block, or hybrid support for the body.', false, 'string', 'surfaces.geometry', [
        'surfaces.geometry',
        'surfaces.meshPartId',
        'blocks.blockId'
      ]),
      role('attributeField', 'Attribute Field', 'Attribute field attached to the geological support.', false, 'string', 'attributes.attributeName', [
        'attributes.attributeName',
        'attributes.name',
        'blocks.grade'
      ]),
      role('spatialReference', 'Spatial Reference', 'Coordinate reference or spatial frame.', false, 'string', 'metadata.spatialReference', [
        'metadata.spatialReference',
        'spatialReference'
      ]),
      role('relationToRoadway', 'Relation to Roadway', 'Relation between geological object and roadway objects.', false, 'string', 'relations.roadwayEdgeId', [
        'relations.roadwayEdgeId',
        'relations.roadwayNodeId'
      ]),
      role('relationToBorehole', 'Relation to Borehole', 'Relation between geological body and boreholes.', false, 'string', 'relations.boreholeId', [
        'relations.boreholeId',
        'relations.hole_id'
      ]),
      role('confidence', 'Confidence', 'Confidence or reliability score.', false, 'number', 'attributes.confidence', [
        'confidence',
        'attributes.confidence',
        'blocks.confidence'
      ]),
      role('uncertainty', 'Uncertainty', 'Uncertainty value or category.', false, 'number', 'attributes.uncertainty', [
        'uncertainty',
        'attributes.uncertainty',
        'blocks.uncertainty'
      ]),
      role('surfaceId', 'Surface ID', 'Layered surface identity.', false, 'string', 'surfaces.surfaceId', [
        'surfaces.surfaceId',
        'surfaces.id'
      ]),
      role('surfaceType', 'Surface Type', 'Surface type such as roof, floor, horizon, or mesh surface.', false, 'string', 'surfaces.surfaceType', [
        'surfaces.surfaceType',
        'surfaces.type'
      ]),
      role('layerOrder', 'Layer Order', 'Order of a layer or horizon.', false, 'number', 'surfaces.layerOrder', [
        'surfaces.layerOrder',
        'surfaces.order'
      ]),
      role('roofSurface', 'Roof Surface', 'Roof surface id for paired layered body representation.', false, 'string', 'bodies.roofSurface', [
        'bodies.roofSurface',
        'bodies.roofSurfaceId'
      ]),
      role('floorSurface', 'Floor Surface', 'Floor surface id for paired layered body representation.', false, 'string', 'bodies.floorSurface', [
        'bodies.floorSurface',
        'bodies.floorSurfaceId'
      ]),
      role('meshPartId', 'Mesh Part ID', 'Mesh object or group identity.', false, 'string', 'surfaces.meshPartId', [
        'surfaces.meshPartId',
        'meshParts.name'
      ]),
      role('horizonElevation', 'Horizon Elevation', 'Representative elevation of a horizon or surface.', false, 'number', 'surfaces.elevation', [
        'surfaces.elevation',
        'surfaces.horizonElevation'
      ]),
      role('thickness', 'Thickness', 'Layer or seam thickness.', false, 'number', 'attributes.thickness', [
        'thickness',
        'attributes.thickness',
        'blocks.thickness'
      ]),
      role('blockId', 'Block ID', 'Volumetric block identity.', false, 'string', 'blocks.blockId', [
        'blocks.blockId',
        'blocks.block_id',
        'blocks.id'
      ]),
      role('centroidX', 'Centroid X', 'Block centroid X coordinate.', false, 'number', 'blocks.x', [
        'blocks.x',
        'blocks.centroid_x',
        'blocks.centroidX'
      ]),
      role('centroidY', 'Centroid Y', 'Block centroid Y coordinate.', false, 'number', 'blocks.y', [
        'blocks.y',
        'blocks.centroid_y',
        'blocks.centroidY'
      ]),
      role('centroidZ', 'Centroid Z', 'Block centroid Z coordinate.', false, 'number', 'blocks.z', [
        'blocks.z',
        'blocks.centroid_z',
        'blocks.centroidZ'
      ]),
      role('blockSizeX', 'Block Size X', 'Block size in X.', false, 'number', 'blocks.dx', [
        'blocks.dx',
        'blocks.size_x',
        'blocks.block_size_x'
      ]),
      role('blockSizeY', 'Block Size Y', 'Block size in Y.', false, 'number', 'blocks.dy', [
        'blocks.dy',
        'blocks.size_y',
        'blocks.block_size_y'
      ]),
      role('blockSizeZ', 'Block Size Z', 'Block size in Z.', false, 'number', 'blocks.dz', [
        'blocks.dz',
        'blocks.size_z',
        'blocks.block_size_z'
      ]),
      role('orebodyId', 'Orebody ID', 'Orebody or domain identity for a block.', false, 'string', 'blocks.orebodyId', [
        'blocks.orebodyId',
        'blocks.orebody_id',
        'blocks.domainId'
      ]),
      role('lithology', 'Lithology', 'Lithology or rock type.', false, 'string', 'blocks.lithology', [
        'blocks.lithology',
        'blocks.oreType',
        'blocks.ore_type'
      ]),
      role('grade', 'Grade', 'Grade or assay value.', false, 'number', 'blocks.grade', ['blocks.grade', 'grade']),
      role('density', 'Density', 'Density or specific gravity.', false, 'number', 'blocks.density', [
        'blocks.density',
        'blocks.sg'
      ])
    ],
    constraints: [
      'Geological unit ids should be stable if provided.',
      'Geometry support must exist.',
      'Spatial reference should be valid or recorded.',
      'Field support must match geometry support.',
      'Surface ids or block ids should be unique if provided.',
      'Relation targets should reference valid objects when relations are provided.'
    ]
  },
  {
    id: 'BoreholeContract',
    class: 'Borehole',
    taxonomyClass: 'Geology & Resource Datasets',
    label: 'Borehole',
    description: 'Boreholes, trajectories, sampling intervals, lithology logs, and assay records.',
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation'],
    roles: [
      role('boreholeId', 'Borehole ID', 'Stable borehole identity.', true, 'string', 'boreholes.boreholeId', [
        'boreholes.boreholeId',
        'boreholes.borehole_id',
        'boreholes.hole_id',
        'intervals.borehole_id',
        'hole_id',
        'id'
      ]),
      role('boreholeName', 'Borehole Name', 'Human-readable borehole name.', false, 'string', 'boreholes.name', [
        'boreholes.name',
        'boreholes.boreholeName'
      ]),
      role('collarX', 'Collar X', 'Borehole collar X coordinate.', false, 'number', 'boreholes.collar.x', [
        'boreholes.collar.x',
        'boreholes.collar_x',
        'x',
        'collar_x'
      ]),
      role('collarY', 'Collar Y', 'Borehole collar Y coordinate.', false, 'number', 'boreholes.collar.y', [
        'boreholes.collar.y',
        'boreholes.collar_y',
        'y',
        'collar_y'
      ]),
      role('collarZ', 'Collar Z', 'Borehole collar Z coordinate.', false, 'number', 'boreholes.collar.z', [
        'boreholes.collar.z',
        'boreholes.collar_z',
        'z',
        'collar_z'
      ]),
      role('trajectory', 'Trajectory', 'Borehole trajectory polyline.', false, 'polyline', 'boreholes.trajectory', [
        'boreholes.trajectory',
        'boreholes.path'
      ]),
      role('depthFrom', 'Depth From', 'Interval start depth.', false, 'number', 'intervals.depthFrom', [
        'intervals.depthFrom',
        'intervals.depth_from',
        'from',
        'depth_from'
      ]),
      role('depthTo', 'Depth To', 'Interval end depth.', false, 'number', 'intervals.depthTo', [
        'intervals.depthTo',
        'intervals.depth_to',
        'to',
        'depth_to'
      ]),
      role('sampleId', 'Sample ID', 'Sample identity.', false, 'string', 'intervals.sampleId', [
        'intervals.sampleId',
        'sample_id'
      ]),
      role('lithology', 'Lithology', 'Lithology log value.', false, 'string', 'intervals.lithology', [
        'intervals.lithology',
        'rock_type',
        'lithology'
      ]),
      role('grade', 'Grade', 'Assay or grade value.', false, 'number', 'intervals.grade', [
        'intervals.grade',
        'grade',
        'assay'
      ]),
      role('attributeValue', 'Attribute Value', 'Generic sampled attribute value.', false, 'number', 'intervals.value', [
        'intervals.value',
        'value'
      ]),
      role('surveyDate', 'Survey Date', 'Survey or sample date.', false, 'datetime', 'intervals.surveyDate', [
        'surveyDate',
        'date',
        'timestamp'
      ])
    ],
    constraints: [
      'Borehole ids should be unique.',
      'Collar position should be valid.',
      'Trajectory should be valid if provided.',
      'Depth intervals should have depthFrom <= depthTo.',
      'Sample intervals should reference valid borehole ids.'
    ]
  },
  {
    id: 'GeologicalStructureContract',
    class: 'GeologicalStructure',
    taxonomyClass: 'Geology & Resource Datasets',
    label: 'Geological Structure',
    description: 'Faults, fractures, folds, broken zones, and other geological structures.',
    requiredTemplates: ['Registry', 'Geometry', 'Relation'],
    roles: [
      role('structureId', 'Structure ID', 'Stable geological structure identity.', true, 'string', 'structures.structureId', [
        'structures.structureId',
        'structures.structure_id',
        'structures.id'
      ]),
      role('structureName', 'Structure Name', 'Human-readable structure name.', false, 'string', 'structures.name', [
        'structures.name',
        'structures.structureName'
      ]),
      role('structureType', 'Structure Type', 'Fault, fracture, fold, joint, broken zone, or structural zone.', true, 'string', 'structures.structureType', [
        'structures.structureType',
        'structures.type'
      ]),
      role('geometrySupport', 'Geometry Support', 'Structure trace, surface, mesh, or zone geometry.', false, 'string', 'structures.geometry', [
        'structures.geometry',
        'structures.trace',
        'structures.surface',
        'structures.mesh'
      ]),
      role('strike', 'Strike', 'Structure strike.', false, 'number', 'structures.strike', ['structures.strike', 'strike']),
      role('dip', 'Dip', 'Structure dip.', false, 'number', 'structures.dip', ['structures.dip', 'dip']),
      role('throw', 'Throw', 'Fault throw or displacement.', false, 'number', 'structures.throw', [
        'structures.throw',
        'throw'
      ]),
      role('width', 'Width', 'Structure or zone width.', false, 'number', 'structures.width', ['structures.width', 'width']),
      role('confidence', 'Confidence', 'Interpretation confidence.', false, 'number', 'structures.confidence', [
        'structures.confidence',
        'confidence'
      ]),
      role('waterConductivity', 'Water Conductivity', 'Water-conducting property.', false, 'number', 'structures.waterConductivity', [
        'structures.waterConductivity',
        'water_conductivity'
      ]),
      role('activity', 'Activity', 'Structure activity state.', false, 'string', 'structures.activity', [
        'structures.activity',
        'activity'
      ]),
      role('riskLevel', 'Risk Level', 'Structure-related risk level.', false, 'string', 'structures.riskLevel', [
        'structures.riskLevel',
        'risk_level'
      ])
    ],
    constraints: [
      'Structure ids should be unique.',
      'Structure type should be valid.',
      'Geometry should be valid.',
      'Attributes should be numeric or categorical according to role.',
      'Relation targets should be valid if provided.'
    ]
  },
  {
    id: 'GeologicalAttributeModelContract',
    class: 'GeologicalAttributeModel',
    taxonomyClass: 'Geology & Resource Datasets',
    label: 'Geological Attribute Model',
    description: 'Spatial geological attribute fields including resource block models, seam attributes, and risk or uncertainty models.',
    requiredTemplates: ['Geometry', 'Field'],
    roles: [
      role('modelId', 'Model ID', 'Attribute model identity.', false, 'string', 'modelId', ['modelId', 'model_id']),
      role('attributeName', 'Attribute Name', 'Name of a model attribute.', false, 'string', 'attributeName', [
        'attributeName',
        'elements.attributeName',
        'name'
      ]),
      role('attributeValue', 'Attribute Value', 'Value of a model attribute.', false, 'number', 'attributeValue', [
        'attributeValue',
        'elements.attributeValue',
        'value'
      ]),
      role('valueType', 'Value Type', 'Attribute value type.', false, 'string', 'valueType', ['valueType', 'value_type']),
      role('unit', 'Unit', 'Physical unit.', false, 'string', 'unit', ['unit', 'units']),
      role('spatialSupport', 'Spatial Support', 'Spatial support type for the field.', false, 'string', 'spatialSupport', [
        'spatialSupport',
        'support'
      ]),
      role('supportElementId', 'Support Element ID', 'Spatial support element identity.', false, 'string', 'supportElementId', [
        'supportElementId',
        'elementId',
        'blockId'
      ]),
      role('spatialReference', 'Spatial Reference', 'Coordinate reference or spatial frame.', false, 'string', 'spatialReference', [
        'spatialReference'
      ]),
      role('geologicalUnitId', 'Geological Unit ID', 'Related geological unit identity.', false, 'string', 'geologicalUnitId', [
        'geologicalUnitId',
        'unitId'
      ]),
      role('uncertainty', 'Uncertainty', 'Uncertainty value.', false, 'number', 'uncertainty', [
        'uncertainty',
        'elements.uncertainty'
      ]),
      role('classification', 'Classification', 'Classification or category.', false, 'string', 'classification', [
        'classification',
        'category'
      ]),
      role('blockId', 'Block ID', 'Resource block identity.', false, 'string', 'blockId', [
        'blockId',
        'block_id',
        'elements.blockId'
      ]),
      role('centroidX', 'Centroid X', 'Element or block centroid X.', false, 'number', 'x', ['x', 'centroid_x', 'elements.x']),
      role('centroidY', 'Centroid Y', 'Element or block centroid Y.', false, 'number', 'y', ['y', 'centroid_y', 'elements.y']),
      role('centroidZ', 'Centroid Z', 'Element or block centroid Z.', false, 'number', 'z', ['z', 'centroid_z', 'elements.z']),
      role('blockSizeX', 'Block Size X', 'Block size in X.', false, 'number', 'dx', ['dx', 'size_x', 'block_size_x']),
      role('blockSizeY', 'Block Size Y', 'Block size in Y.', false, 'number', 'dy', ['dy', 'size_y', 'block_size_y']),
      role('blockSizeZ', 'Block Size Z', 'Block size in Z.', false, 'number', 'dz', ['dz', 'size_z', 'block_size_z']),
      role('grade', 'Grade', 'Ore or resource grade.', false, 'number', 'grade', ['grade', 'au', 'cu', 'fe']),
      role('density', 'Density', 'Density or specific gravity.', false, 'number', 'density', ['density', 'sg']),
      role('tonnage', 'Tonnage', 'Tonnage or resource quantity.', false, 'number', 'tonnage', ['tonnage']),
      role('oreType', 'Ore Type', 'Ore or lithology type.', false, 'string', 'oreType', ['oreType', 'ore_type', 'lithology']),
      role('resourceCategory', 'Resource Category', 'Resource classification category.', false, 'string', 'resourceCategory', [
        'resourceCategory',
        'category'
      ]),
      role('orebodyId', 'Orebody ID', 'Related orebody identity.', false, 'string', 'orebodyId', ['orebodyId', 'orebody_id']),
      role('domainId', 'Domain ID', 'Resource domain identity.', false, 'string', 'domainId', ['domainId', 'domain_id']),
      role('seamId', 'Seam ID', 'Coal seam identity.', false, 'string', 'seamId', ['seamId', 'seam_id']),
      role('surfaceId', 'Surface ID', 'Surface or grid support identity.', false, 'string', 'surfaceId', ['surfaceId', 'surface_id']),
      role('gridX', 'Grid X', 'Surface grid X coordinate.', false, 'number', 'gridX', ['gridX', 'grid_x']),
      role('gridY', 'Grid Y', 'Surface grid Y coordinate.', false, 'number', 'gridY', ['gridY', 'grid_y']),
      role('elevation', 'Elevation', 'Surface elevation.', false, 'number', 'elevation', ['elevation']),
      role('thickness', 'Thickness', 'Coal seam or layer thickness.', false, 'number', 'thickness', ['thickness']),
      role('ash', 'Ash', 'Coal ash value.', false, 'number', 'ash', ['ash']),
      role('sulfur', 'Sulfur', 'Coal sulfur value.', false, 'number', 'sulfur', ['sulfur']),
      role('calorificValue', 'Calorific Value', 'Coal calorific value.', false, 'number', 'calorificValue', [
        'calorificValue',
        'calorific_value'
      ]),
      role('gasContent', 'Gas Content', 'Coal seam gas content.', false, 'number', 'gasContent', ['gasContent', 'gas_content']),
      role('waterContent', 'Water Content', 'Coal seam water content.', false, 'number', 'waterContent', [
        'waterContent',
        'water_content'
      ]),
      role('riskValue', 'Risk Value', 'Risk or hazard probability value.', false, 'number', 'riskValue', [
        'riskValue',
        'risk_value'
      ]),
      role('riskType', 'Risk Type', 'Risk category or type.', false, 'string', 'riskType', ['riskType', 'risk_type']),
      role('probability', 'Probability', 'Probability value.', false, 'number', 'probability', ['probability']),
      role('threshold', 'Threshold', 'Threshold associated with classification.', false, 'number', 'threshold', ['threshold']),
      role('category', 'Category', 'Generic category.', false, 'string', 'category', ['category'])
    ],
    constraints: [
      'Attribute values must match valueType.',
      'Geometry support must be valid.',
      'Field support must match geometry support.',
      'Unit should be specified for physical quantities.',
      'Block ids should be unique if block registry is provided.',
      'Block sizes must be valid.',
      'Spatial reference should be recorded.',
      'Relation targets should reference valid geological units, roadway edges, or boreholes when provided.'
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
