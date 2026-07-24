import { RoadwayGeologyRelationshipAnalysisRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { RoadwayGeologyRelationshipInputRequirements } from '../contracts.js';

export const RoadwayGeologyRelationshipAnalysisDefinition = defineOperator({
  RuntimeClass: RoadwayGeologyRelationshipAnalysisRuntime,
  typeId: 'RoadwayGeologyRelationshipAnalysisOperator',
  label: 'Roadway-Geology Relationship Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'roadway',
      'relationship',
      'fault-proximity',
      'attribute-sampling',
      'risk',
      'section',
      'profile',
      'topological-context',
      'linked-view',
      'diagnostic'
    ]
  },
  inputRequirements: RoadwayGeologyRelationshipInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    analysisMode: 'risk-level',
    showRoadwayOverlay: true,
    showGeologicalBodyContext: true,
    showStructures: true,
    showBoreholes: false,
    showProfile: true,
    activeAttribute: null,
    structureWarningDistance: 50,
    structureCriticalDistance: 20,
    attributeThreshold: null,
    attributeRiskDirection: 'high',
    colorMode: 'risk-level',
    sampleInterval: 10,
    maxSamplesPerEdge: 20,
    filterRiskLevel: 'all',
    filterGeologicalUnit: 'all',
    filterStructureProximity: 'all',
    roadwayOverlayOpacity: 0.9,
    contextOpacity: 0.2,
    autoCreateSectionFromSelectedRoadway: false
  },
  paramSchema: [
    { key: 'analysisMode', label: 'Analysis mode', type: 'select', options: ['geological-unit', 'structure-proximity', 'attribute-sampling', 'risk-level'] },
    { key: 'colorMode', label: 'Color mode', type: 'select', options: ['geological-unit', 'structure-distance', 'active-attribute', 'risk-level', 'uniform'] },
    { key: 'activeAttribute', label: 'Active attribute', type: 'text' },
    { key: 'structureWarningDistance', label: 'Structure warning distance', type: 'number' },
    { key: 'structureCriticalDistance', label: 'Structure critical distance', type: 'number' },
    { key: 'attributeThreshold', label: 'Attribute threshold', type: 'number' },
    { key: 'attributeRiskDirection', label: 'Attribute risk direction', type: 'select', options: ['high', 'low'] },
    { key: 'sampleInterval', label: 'Sample interval', type: 'number' },
    { key: 'maxSamplesPerEdge', label: 'Max samples per edge', type: 'number' },
    { key: 'filterRiskLevel', label: 'Risk filter', type: 'select', options: ['all', 'low', 'medium', 'high'] },
    { key: 'showRoadwayOverlay', label: 'Show roadway overlay', type: 'boolean' },
    { key: 'showGeologicalBodyContext', label: 'Show geological body context', type: 'boolean' },
    { key: 'showStructures', label: 'Show structures', type: 'boolean' },
    { key: 'showBoreholes', label: 'Show boreholes', type: 'boolean' },
    { key: 'showProfile', label: 'Show profile', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'analysisMode', label: 'Mode', options: ['risk-level', 'geological-unit', 'structure-proximity', 'attribute-sampling'] },
    { type: 'select', key: 'colorMode', label: 'Color', options: ['risk-level', 'geological-unit', 'structure-distance', 'active-attribute', 'uniform'] },
    { type: 'checkbox', key: 'showProfile', label: 'Profile' }
  ],
});
