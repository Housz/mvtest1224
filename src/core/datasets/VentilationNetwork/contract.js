import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const VentilationNetworkContract = defineSemanticContract({
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
  });
