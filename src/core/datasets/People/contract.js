import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const PeopleContract = defineSemanticContract({
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
  });
