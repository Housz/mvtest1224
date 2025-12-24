export class ContractRegistryClass {
  constructor() {
    this.contracts = new Map();
    this.bootstrap();
  }

  bootstrap() {
    const base = [
      {
        id: 'RoadwayTopology',
        name: 'Roadway Topology',
        required_roles: [
          { roleKey: 'node_id', label: 'Node id', dataType: 'string', description: 'Unique node id', defaultField: 'id' },
          { roleKey: 'node_name', label: 'Node name', dataType: 'string', defaultField: 'name' },
          { roleKey: 'node_pos', label: 'Node position', dataType: 'vec3', defaultField: 'position' },
          { roleKey: 'edge_id', label: 'Edge id', dataType: 'string', defaultField: 'id' },
          { roleKey: 'from_node', label: 'From', dataType: 'string', defaultField: 'source' },
          { roleKey: 'to_node', label: 'To', dataType: 'string', defaultField: 'target' }
        ],
        binding_requirements: [],
        structure_kind: 'Graph',
        facet_capabilities: [{ type: 'Graph', label: 'Graph view', outputType: 'RoadwayGraph', requires: ['node_id', 'edge_id'] }]
      },
      {
        id: 'RoadwayGeometry',
        name: 'Roadway Geometry',
        required_roles: [
          { roleKey: 'mesh_part_id', label: 'Mesh part name', dataType: 'string', defaultField: 'name' },
          { roleKey: 'topo_ref_id', label: 'Topo ref id', dataType: 'string', defaultField: 'name' }
        ],
        binding_requirements: [
          { fromRoleKey: 'topo_ref_id', toContractId: 'RoadwayTopology', toRoleKey: 'edge_id', description: 'map mesh to topo' }
        ],
        structure_kind: 'ModelLibrary',
        facet_capabilities: [{ type: 'MeshParts', label: 'Mesh parts', outputType: 'RoadwayMeshParts' }]
      },
      {
        id: 'SensorStationRegistry',
        name: 'Sensor Registry',
        required_roles: [
          { roleKey: 'sensor_id', label: 'Sensor id', dataType: 'string', defaultField: 'sensorID' },
          { roleKey: 'x', label: 'X', dataType: 'number', defaultField: 'x' },
          { roleKey: 'y', label: 'Y', dataType: 'number', defaultField: 'y' },
          { roleKey: 'z', label: 'Z', dataType: 'number', defaultField: 'z' },
          { roleKey: 'roadway_node_ref', label: 'Roadway node', dataType: 'string', defaultField: 'roadwayID' }
        ],
        binding_requirements: [
          {
            fromRoleKey: 'roadway_node_ref',
            toContractId: 'RoadwayTopology',
            toRoleKey: 'node_id',
            description: 'anchor sensors onto roadway nodes'
          }
        ],
        structure_kind: 'Table',
        facet_capabilities: [
          { type: 'Registry', label: 'Registry table', outputType: 'SensorRegistry' },
          { type: 'Points', label: 'Points3D', outputType: 'SensorPoints3D', requires: ['x', 'y', 'z'] }
        ]
      },
      {
        id: 'SensorReadingTimeSeries',
        name: 'Sensor Time Series',
        required_roles: [
          { roleKey: 'sensor_id', label: 'Sensor id', dataType: 'string', defaultField: 'sensorID' },
          { roleKey: 'timestamp', label: 'Timestamp', dataType: 'datetime', defaultField: 'time' },
          { roleKey: 'value', label: 'Value', dataType: 'number', defaultField: 'value' }
        ],
        binding_requirements: [
          {
            fromRoleKey: 'sensor_id',
            toContractId: 'SensorStationRegistry',
            toRoleKey: 'sensor_id',
            description: 'link readings to registry rows'
          }
        ],
        structure_kind: 'Table',
        facet_capabilities: [
          { type: 'Series', label: 'Series', outputType: 'SensorDataset', requires: ['sensor_id', 'timestamp', 'value'] },
          { type: 'Snapshot', label: 'Snapshot', outputType: 'SensorDataset', requires: ['sensor_id', 'timestamp', 'value'] },
          { type: 'Value', label: 'Latest value', outputType: 'SensorDataset', requires: ['sensor_id', 'timestamp', 'value'] }
        ]
      },
      {
        id: 'ModelLibrary',
        name: 'Model Library',
        required_roles: [
          { roleKey: 'model_id', label: 'Model id', dataType: 'string', defaultField: 'name' },
          { roleKey: 'model_uri', label: 'Model URI', dataType: 'string', defaultField: 'uri' }
        ],
        binding_requirements: [],
        structure_kind: 'ModelLibrary',
        facet_capabilities: [{ type: 'ModelSet', label: 'Models', outputType: 'ModelLibrary' }]
      }
    ];
    base.forEach((c) => this.contracts.set(c.id, c));
  }

  list() {
    return Array.from(this.contracts.values());
  }

  get(id) {
    return this.contracts.get(id);
  }
}

export const ContractRegistry = new ContractRegistryClass();
