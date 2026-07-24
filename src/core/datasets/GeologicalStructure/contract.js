import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const GeologicalStructureContract = defineSemanticContract({
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
  });
