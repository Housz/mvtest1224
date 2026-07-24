import { BoreholeStratigraphyCorrelationRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { BoreholeStratigraphyCorrelationInputRequirements } from '../contracts.js';

export const BoreholeStratigraphyCorrelationDefinition = defineOperator({
  RuntimeClass: BoreholeStratigraphyCorrelationRuntime,
  typeId: 'BoreholeStratigraphyCorrelationOperator',
  label: 'Borehole & Stratigraphy Correlation',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'borehole',
      'stratigraphy',
      'correlation',
      'well-log',
      'section',
      'linked-view',
      'model-validation',
      'attribute',
      'interpretation'
    ]
  },
  inputRequirements: BoreholeStratigraphyCorrelationInputRequirements,
  ports: [
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset' },
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    selectedBoreholeIds: [],
    displayMode: 'correlation-canvas',
    depthReference: 'depth',
    alignmentMode: 'depth',
    boreholeOrder: 'section-distance',
    show3DLayer: true,
    showLogPanel: true,
    showCorrelationCanvas: true,
    showCorrelationLines: true,
    showLithology: true,
    showAssays: true,
    showModelIntersections: true,
    activeAttribute: null,
    maxBoreholesInCanvas: 12,
    autoSelectBoreholesNearSection: true,
    sectionDistanceTolerance: 20,
    boreholeOpacity: 1,
    logPanelWidth: 160
  },
  paramSchema: [
    { key: 'displayMode', label: 'Display mode', type: 'select', options: ['single-log', 'correlation-canvas'] },
    { key: 'depthReference', label: 'Depth reference', type: 'select', options: ['depth', 'elevation'] },
    { key: 'alignmentMode', label: 'Alignment mode', type: 'select', options: ['depth', 'elevation'] },
    { key: 'boreholeOrder', label: 'Borehole order', type: 'select', options: ['user-selection', 'name', 'section-distance', 'spatial-x', 'spatial-y'] },
    { key: 'show3DLayer', label: 'Show 3D layer', type: 'boolean' },
    { key: 'showLogPanel', label: 'Show log panel', type: 'boolean' },
    { key: 'showCorrelationCanvas', label: 'Show correlation canvas', type: 'boolean' },
    { key: 'showCorrelationLines', label: 'Show correlation lines', type: 'boolean' },
    { key: 'showLithology', label: 'Show lithology', type: 'boolean' },
    { key: 'showAssays', label: 'Show assays', type: 'boolean' },
    { key: 'showModelIntersections', label: 'Show model intersections', type: 'boolean' },
    { key: 'maxBoreholesInCanvas', label: 'Max boreholes in canvas', type: 'number' },
    { key: 'autoSelectBoreholesNearSection', label: 'Auto select near section', type: 'boolean' },
    { key: 'boreholeOpacity', label: 'Borehole opacity', type: 'number' }
  ],
  inlineControls: [
    { type: 'select', key: 'displayMode', label: 'Mode', options: ['single-log', 'correlation-canvas'] },
    { type: 'select', key: 'boreholeOrder', label: 'Order', options: ['user-selection', 'name', 'section-distance', 'spatial-x', 'spatial-y'] },
    { type: 'checkbox', key: 'showCorrelationLines', label: 'Correlation lines' }
  ],
});
