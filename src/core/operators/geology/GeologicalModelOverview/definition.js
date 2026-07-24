import { GeologicalModelOverviewRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { GeologicalModelOverviewInputRequirements } from '../contracts.js';

export const GeologicalModelOverviewDefinition = defineOperator({
  RuntimeClass: GeologicalModelOverviewRuntime,
  typeId: 'GeologicalModelOverviewOperator',
  label: 'Geological Model Overview',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'resource',
      'overview',
      '3d-scene',
      'layer-control',
      'selection-linked',
      'borehole',
      'fault',
      'attribute-model'
    ]
  },
  inputRequirements: GeologicalModelOverviewInputRequirements,
  ports: [
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset' },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    showGeologicalBody: true,
    showRoadway: true,
    showBoreholes: true,
    showStructures: true,
    showAttributeModel: false,
    geologicalBodyOpacity: 0.55,
    roadwayOpacity: 0.25,
    boreholeOpacity: 1,
    structureOpacity: 0.7,
    attributeModelOpacity: 0.65,
    colorMode: 'geological-unit',
    activeAttribute: null,
    blockRenderMode: 'volume',
    volumeIsoValue: 0.5,
    volumeFilterMin: 0,
    volumeFilterMax: 1,
    volumeClipXMin: 0,
    volumeClipXMax: 1,
    volumeClipYMin: 0,
    volumeClipYMax: 1,
    volumeClipZMin: 0,
    volumeClipZMax: 1,
    volumeOpacity: 0.5,
    volumeRaySteps: 200,
    volumePointSize: 7,
    showLabels: false,
    showSelectedLabel: true,
    autoFocusOnSelection: true
  },
  paramSchema: [
    { key: 'showGeologicalBody', label: 'Show geological body', type: 'boolean' },
    { key: 'showRoadway', label: 'Show roadway', type: 'boolean' },
    { key: 'showBoreholes', label: 'Show boreholes', type: 'boolean' },
    { key: 'showStructures', label: 'Show structures', type: 'boolean' },
    { key: 'showAttributeModel', label: 'Show attribute model', type: 'boolean' },
    { key: 'geologicalBodyOpacity', label: 'Body opacity', type: 'number' },
    { key: 'roadwayOpacity', label: 'Roadway opacity', type: 'number' },
    { key: 'boreholeOpacity', label: 'Borehole opacity', type: 'number' },
    { key: 'structureOpacity', label: 'Structure opacity', type: 'number' },
    { key: 'attributeModelOpacity', label: 'Attribute opacity', type: 'number' },
    { key: 'colorMode', label: 'Color mode', type: 'select', options: ['geological-unit', 'lithology', 'attribute', 'uniform'] },
    { key: 'blockRenderMode', label: 'Block render mode', type: 'select', options: ['volume', 'points', 'isosurface'] },
    { key: 'volumeIsoValue', label: 'Default isosurface value', type: 'number' },
    { key: 'volumeFilterMin', label: 'Default volume filter min', type: 'number' },
    { key: 'volumeFilterMax', label: 'Default volume filter max', type: 'number' },
    { key: 'volumeOpacity', label: 'Default volume opacity', type: 'number' },
    { key: 'volumeRaySteps', label: 'Default ray steps', type: 'number' },
    { key: 'volumePointSize', label: 'Default point size', type: 'number' },
    { key: 'showLabels', label: 'Show labels', type: 'boolean' },
    { key: 'showSelectedLabel', label: 'Show selected label', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'colorMode', label: 'Color', options: ['geological-unit', 'lithology', 'attribute', 'uniform'] },
    { type: 'checkbox', key: 'showGeologicalBody', label: 'Body' },
    { type: 'checkbox', key: 'showBoreholes', label: 'Boreholes' },
    { type: 'checkbox', key: 'showStructures', label: 'Structures' }
  ],
});
