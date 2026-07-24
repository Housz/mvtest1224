import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const EmergencyResourcesContract = defineSemanticContract({
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
  });
