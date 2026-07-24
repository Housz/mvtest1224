import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const RoadwayContract = defineSemanticContract({
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
  });
