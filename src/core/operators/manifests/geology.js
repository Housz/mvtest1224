import { contribution, interaction, operatorManifest } from './manifestUtils.js';

const geologicalSelectionKeys = [
  'selectedGeologicalUnit',
  'selectedGeologicalBody',
  'selectedSurface',
  'selectedBorehole',
  'selectedStructure',
  'selectedBlock',
  'selectedRoadwaySegment',
  'activeGeologicalAttribute',
  'selection'
];

const overview = operatorManifest({
  context: {
    consumes: geologicalSelectionKeys,
    publishes: geologicalSelectionKeys
  },
  processing: {
    processorId: 'geology.model-overview',
    inputs: ['geologicalBody', 'roadway', 'borehole', 'geologicalStructure', 'attributeModel'],
    result: 'geologicalModelView'
  },
  contributions: [
    contribution('geological-body-layer', 'main-3d-scene', 'layer', 'structure', 'geologicalBody', {
      color: 'geologicalUnit',
      opacity: 'layerOpacity'
    }),
    contribution('borehole-layer', 'main-3d-scene', 'layer', 'structure', 'borehole', {
      color: 'lithology',
      line: 'trajectory'
    }),
    contribution('geological-structure-layer', 'main-3d-scene', 'layer', 'structure', 'geologicalStructure', {
      color: 'structureType',
      opacity: 'confidence'
    }),
    contribution('geological-attribute-layer', 'main-3d-scene', 'layer', 'state', 'geologicalAttributeModel', {
      color: 'activeGeologicalAttribute',
      opacity: 'attributeOpacity'
    }),
    contribution('roadway-context-layer', 'main-3d-scene', 'layer', 'context', 'roadway'),
    contribution('geological-model-controls', 'right-panel', 'control', 'control', 'geologicalModel'),
    contribution('geological-object-detail', 'right-panel', 'panel', 'detail', 'geologicalModel'),
    contribution('geological-model-legend', 'legend', 'legend', 'legend', 'geologicalModel', {}, {
      mergePolicy: 'replace'
    })
  ],
  interactions: [
    interaction('pick-geological-object', 'Pick a geological object in 3D.', ['pointer'], geologicalSelectionKeys),
    interaction(
      'change-geological-attribute',
      'Change the active geological attribute.',
      ['activeGeologicalAttribute'],
      ['activeGeologicalAttribute']
    )
  ]
});

const section = operatorManifest({
  context: {
    consumes: [...geologicalSelectionKeys, 'sectionFrame'],
    publishes: [...geologicalSelectionKeys, 'sectionFrame', 'selectedSectionElement']
  },
  processing: {
    processorId: 'geology.section-analysis',
    inputs: ['geologicalBody', 'roadway', 'borehole', 'geologicalStructure', 'attributeModel'],
    result: 'geologicalSectionResult'
  },
  contributions: [
    contribution('geological-section-layer', 'main-3d-scene', 'layer', 'state', 'geologicalSection', {
      color: 'geologicalUnitOrAttribute',
      opacity: 'sectionOpacity'
    }),
    contribution('geological-section-view', 'bottom-panel', 'panel', 'detail', 'geologicalSection'),
    contribution('geological-section-controls', 'right-panel', 'control', 'control', 'geologicalSection'),
    contribution('geological-section-summary', 'right-panel', 'panel', 'detail', 'geologicalSection'),
    contribution('geological-section-legend', 'legend', 'legend', 'legend', 'geologicalSection', {}, {
      mergePolicy: 'replace'
    })
  ],
  interactions: [
    interaction('define-section-frame', 'Define and update the section frame.', ['pointer'], ['sectionFrame']),
    interaction(
      'pick-section-element',
      'Select an element from the linked 2D section.',
      ['pointer'],
      ['selectedSectionElement', ...geologicalSelectionKeys]
    )
  ]
});

const borehole = operatorManifest({
  context: {
    consumes: [...geologicalSelectionKeys, 'sectionFrame', 'selectedBoreholeInterval'],
    publishes: [
      'selectedBorehole',
      'selectedBoreholeInterval',
      'selectedGeologicalUnit',
      'activeGeologicalAttribute',
      'selection'
    ]
  },
  processing: {
    processorId: 'geology.borehole-correlation',
    inputs: ['borehole', 'geologicalBody', 'geologicalStructure', 'attributeModel', 'roadway'],
    result: 'boreholeCorrelationModel'
  },
  contributions: [
    contribution('borehole-correlation-layer', 'main-3d-scene', 'layer', 'structure', 'borehole', {
      color: 'lithology',
      line: 'trajectory'
    }),
    contribution('borehole-log-panel', 'right-panel', 'panel', 'detail', 'borehole'),
    contribution('borehole-correlation-canvas', 'bottom-panel', 'panel', 'detail', 'boreholeCorrelation'),
    contribution('borehole-correlation-controls', 'right-panel', 'control', 'control', 'boreholeCorrelation'),
    contribution('borehole-interval-detail', 'right-panel', 'panel', 'detail', 'borehole'),
    contribution('borehole-legend', 'legend', 'legend', 'legend', 'borehole', {}, {
      mergePolicy: 'replace'
    })
  ],
  interactions: [
    interaction('select-borehole', 'Select a borehole in 3D or a log view.', ['pointer'], ['selectedBorehole', 'selection']),
    interaction(
      'select-borehole-interval',
      'Select a stratigraphic interval.',
      ['pointer'],
      ['selectedBoreholeInterval', 'selectedGeologicalUnit', 'selection']
    ),
    interaction(
      'select-correlation',
      'Select a stratigraphic correlation line.',
      ['pointer'],
      ['selectedGeologicalUnit', 'selection']
    )
  ]
});

const attribute = operatorManifest({
  context: {
    consumes: [
      ...geologicalSelectionKeys,
      'attributeRangeFilter',
      'attributeRangePreview',
      'attributeCategoryFilter',
      'sectionFrame'
    ],
    publishes: [
      'activeGeologicalAttribute',
      'attributeRangeFilter',
      'attributeRangePreview',
      'attributeCategoryFilter',
      'selectedAttributeElement',
      'selectedGeologicalRegion',
      'selectedBlock',
      'selection'
    ]
  },
  processing: {
    processorId: 'geology.attribute-distribution',
    inputs: ['attributeModel', 'geologicalBody', 'roadway', 'borehole', 'geologicalStructure'],
    result: 'geologicalTargetZone'
  },
  contributions: [
    contribution('attribute-distribution-layer', 'main-3d-scene', 'layer', 'state', 'geologicalAttributeModel', {
      color: 'activeGeologicalAttribute',
      opacity: 'filterState',
      halo: 'targetZone'
    }),
    contribution('attribute-histogram-view', 'bottom-panel', 'chart', 'detail', 'geologicalAttributeModel'),
    contribution('attribute-distribution-controls', 'right-panel', 'control', 'control', 'geologicalAttributeModel'),
    contribution('attribute-element-detail', 'right-panel', 'panel', 'detail', 'geologicalAttributeModel'),
    contribution('attribute-distribution-summary', 'right-panel', 'panel', 'detail', 'geologicalAttributeModel'),
    contribution('attribute-distribution-legend', 'legend', 'legend', 'legend', 'geologicalAttributeModel', {}, {
      mergePolicy: 'replace'
    })
  ],
  interactions: [
    interaction(
      'brush-attribute-range',
      'Brush a value range and update the linked 3D layer.',
      ['pointer'],
      ['attributeRangePreview', 'attributeRangeFilter']
    ),
    interaction(
      'pick-attribute-element',
      'Pick an attribute element in 3D.',
      ['pointer'],
      ['selectedAttributeElement', 'selectedBlock', 'selection']
    )
  ]
});

const roadwayGeology = operatorManifest({
  context: {
    consumes: geologicalSelectionKeys,
    publishes: [
      'selectedRoadwaySegment',
      'selectedGeologicalUnit',
      'selectedStructure',
      'activeGeologicalAttribute',
      'roadwayGeologyAnalysisMode',
      'sectionFrame',
      'selection'
    ]
  },
  processing: {
    processorId: 'geology.roadway-relationship',
    inputs: ['roadway', 'geologicalBody', 'geologicalStructure', 'attributeModel', 'borehole'],
    result: 'roadwayGeologyRelation'
  },
  contributions: [
    contribution('roadway-geology-layer', 'main-3d-scene', 'layer', 'diagnostic', 'roadway', {
      color: 'roadwayGeologyRelation',
      halo: 'riskLevel'
    }),
    contribution('roadway-geology-map', 'topology-view', 'panel', 'detail', 'roadwayGeologyRelation'),
    contribution('roadway-geology-profile', 'bottom-panel', 'panel', 'detail', 'roadwayProfile'),
    contribution('roadway-geology-controls', 'right-panel', 'control', 'control', 'roadwayGeologyRelation'),
    contribution('roadway-geology-relation-table', 'right-panel', 'panel', 'detail', 'roadwayGeologyRelation'),
    contribution('roadway-geology-detail', 'right-panel', 'panel', 'detail', 'roadwayGeologyRelation'),
    contribution('roadway-geology-legend', 'legend', 'legend', 'legend', 'roadwayGeologyRelation', {}, {
      mergePolicy: 'replace'
    })
  ],
  interactions: [
    interaction(
      'select-roadway-relation',
      'Select a roadway segment and inspect its geological relation.',
      ['pointer'],
      ['selectedRoadwaySegment', 'selection']
    ),
    interaction(
      'create-roadway-section',
      'Create a section frame from the selected roadway segment.',
      ['selectedRoadwaySegment'],
      ['sectionFrame']
    )
  ]
});

export const GeologyOperatorManifests = new Map([
  ['GeologicalModelOverviewOperator', overview],
  ['GeologicalSectionAnalysisOperator', section],
  ['BoreholeStratigraphyCorrelationOperator', borehole],
  ['GeologicalAttributeDistributionAnalysisOperator', attribute],
  ['RoadwayGeologyRelationshipAnalysisOperator', roadwayGeology]
]);
