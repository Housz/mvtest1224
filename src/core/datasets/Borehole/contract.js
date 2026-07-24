import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const BoreholeContract = defineSemanticContract({
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
  });
