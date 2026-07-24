import { GeologicalSectionAnalysisRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { GeologicalSectionAnalysisInputRequirements } from '../contracts.js';

export const GeologicalSectionAnalysisDefinition = defineOperator({
  RuntimeClass: GeologicalSectionAnalysisRuntime,
  typeId: 'GeologicalSectionAnalysisOperator',
  label: 'Geological Section Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'section',
      'slice',
      'cutaway',
      'clipping',
      'mesh',
      'volume',
      'block-model',
      'borehole',
      'fault',
      'roadway',
      'linked-view',
      'produces-dataset'
    ]
  },
  inputRequirements: GeologicalSectionAnalysisInputRequirements,
  ports: [
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset' },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    sectionMode: 'axis-aligned',
    axis: 'X',
    position: 0,
    thickness: 5,
    showCutaway: true,
    clippingSide: 'positive',
    showSectionPlane: true,
    showGeologicalBody: true,
    showRoadway: true,
    showBoreholes: true,
    showStructures: true,
    showAttributeModel: true,
    activeAttribute: null,
    colorMode: 'geological-unit',
    autoUpdate: true,
    maxRenderedBlocksInSection: 5000
  },
  paramSchema: [
    { key: 'sectionMode', label: 'Section mode', type: 'select', options: ['axis-aligned', 'vertical-two-point'] },
    { key: 'axis', label: 'Axis', type: 'select', options: ['X', 'Y', 'Z'] },
    { key: 'position', label: 'Position', type: 'number' },
    { key: 'thickness', label: 'Thickness', type: 'number' },
    { key: 'showCutaway', label: 'Show cutaway', type: 'boolean' },
    { key: 'clippingSide', label: 'Clipping side', type: 'select', options: ['positive', 'negative', 'both'] },
    { key: 'showGeologicalBody', label: 'Show geological body', type: 'boolean' },
    { key: 'showRoadway', label: 'Show roadway', type: 'boolean' },
    { key: 'showBoreholes', label: 'Show boreholes', type: 'boolean' },
    { key: 'showStructures', label: 'Show structures', type: 'boolean' },
    { key: 'showAttributeModel', label: 'Show attribute model', type: 'boolean' },
    { key: 'colorMode', label: 'Color mode', type: 'select', options: ['geological-unit', 'lithology', 'attribute', 'uniform'] },
    { key: 'maxRenderedBlocksInSection', label: 'Max section blocks', type: 'number' },
    { key: 'autoUpdate', label: 'Auto update', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'axis', label: 'Axis', options: ['X', 'Y', 'Z'] },
    { type: 'number', key: 'position', label: 'Position' },
    { type: 'number', key: 'thickness', label: 'Thickness' },
    { type: 'checkbox', key: 'showCutaway', label: 'Cutaway' }
  ],
});
