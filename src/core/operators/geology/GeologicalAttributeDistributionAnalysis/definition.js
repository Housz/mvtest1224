import { GeologicalAttributeDistributionAnalysisRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { GeologicalAttributeDistributionInputRequirements } from '../contracts.js';

export const GeologicalAttributeDistributionAnalysisDefinition = defineOperator({
  RuntimeClass: GeologicalAttributeDistributionAnalysisRuntime,
  typeId: 'GeologicalAttributeDistributionAnalysisOperator',
  label: 'Geological Attribute Distribution Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'resource',
      'attribute-field',
      'block-model',
      'volume',
      'surface-attribute',
      'threshold',
      'histogram',
      'linked-brushing',
      'target-zone',
      'resource-evaluation',
      'risk-analysis'
    ]
  },
  inputRequirements: GeologicalAttributeDistributionInputRequirements,
  ports: [
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset' },
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset', optional: true },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    activeAttribute: null,
    colorMode: 'continuous',
    colormap: 'viridis',
    valueRangeMode: 'auto',
    minValue: null,
    maxValue: null,
    filterMode: 'highlight',
    renderMode: 'volume',
    blockRenderMode: 'volume',
    maxRenderedElements: 8000,
    showHistogram: true,
    showTargetZone: true,
    showContextElements: true,
    selectedOpacity: 0.95,
    contextOpacity: 0.12,
    attributeLayerOpacity: 0.75,
    showRoadwayContext: true,
    showGeologicalBodyContext: true,
    showStructureContext: true
  },
  paramSchema: [
    { key: 'activeAttribute', label: 'Active attribute', type: 'text' },
    { key: 'colormap', label: 'Colormap', type: 'select', options: ['viridis', 'heat', 'rainbow'] },
    { key: 'filterMode', label: 'Filter mode', type: 'select', options: ['highlight', 'selected-only', 'hide-filtered'] },
    { key: 'blockRenderMode', label: 'Render mode', type: 'select', options: ['volume', 'isosurface', 'points'] },
    { key: 'maxRenderedElements', label: 'Max rendered elements', type: 'number' },
    { key: 'showHistogram', label: 'Show histogram', type: 'boolean' },
    { key: 'showTargetZone', label: 'Show target zone', type: 'boolean' },
    { key: 'showContextElements', label: 'Show context elements', type: 'boolean' },
    { key: 'attributeLayerOpacity', label: 'Attribute opacity', type: 'number' },
    { key: 'showRoadwayContext', label: 'Show roadway context', type: 'boolean' },
    { key: 'showGeologicalBodyContext', label: 'Show geological body context', type: 'boolean' },
    { key: 'showStructureContext', label: 'Show structure context', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'colormap', label: 'Colormap', options: ['viridis', 'heat', 'rainbow'] },
    { type: 'select', key: 'filterMode', label: 'Filter', options: ['highlight', 'selected-only', 'hide-filtered'] },
    { type: 'checkbox', key: 'showHistogram', label: 'Histogram' }
  ],
});
