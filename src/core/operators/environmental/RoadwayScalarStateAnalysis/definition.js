import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { RoadwayScalarStateAnalysisRuntime } from './runtime.js';
import { RoadwayScalarAnalysisPresets, RoadwayScalarStateAnalysisInputRequirements, defaultParamsFromPreset, typeIdsByPreset } from './constants.js';

export function buildParamSchema(preset) {
  const schema = [
    { key: 'variable', label: 'Variable', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'text' },
    { key: 'legendLabel', label: 'Legend label', type: 'text' },
    { key: 'minValue', label: 'Min range', type: 'number' },
    { key: 'maxValue', label: 'Max range', type: 'number' },
    { key: 'colormap', label: 'Color map', type: 'select', options: ['rainbow', 'viridis', 'heat'] },
    { key: 'toleranceMinutes', label: 'Tolerance minutes', type: 'number' },
    { key: 'showSensors', label: 'Show sensors', type: 'boolean' },
    { key: 'chartMode', label: 'Chart mode', type: 'select', options: ['overlay', 'billboard'] }
  ];
  if (preset.warningThreshold != null) {
    schema.splice(5, 0, { key: 'warningThreshold', label: 'Warning threshold', type: 'number' });
  }
  return schema;
}

export function createRoadwayScalarAnalysisDefinition(preset) {
  return defineOperator({
    RuntimeClass: RoadwayScalarStateAnalysisRuntime,
    typeId: typeIdsByPreset[preset.id],
    label: preset.label,
    kind: 'operator',
    category: preset.id === 'scalar' ? 'Operator / Generic' : 'Operator',
    libraryCategory: 'Spatial',
    color: '#f2a51a',
    taxonomy: {
      primaryClass: 'Spatial',
      auxiliaryTags: preset.tags
    },
    inputRequirements: RoadwayScalarStateAnalysisInputRequirements,
    ports: [
      { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
      { id: 'sensorRegistry', name: 'Sensor Registry', direction: 'in', type: 'SensorRegistryDataset' },
      { id: 'sensorReadings', name: 'Sensor Readings', direction: 'in', type: 'SensorReadingsDataset' },
      { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
    ],
    defaultParams: defaultParamsFromPreset(preset),
    paramSchema: buildParamSchema(preset),
    inlineControls: [
      { type: 'rangeAuto', label: 'Range' },
      {
        type: 'numberPair',
        label: 'Min / Max',
        fields: [
          { key: 'minValue', label: 'Min', step: 0.1 },
          { key: 'maxValue', label: 'Max', step: 0.1 }
        ]
      },
      { type: 'colormap', key: 'colormap', label: 'Color map', options: ['rainbow', 'viridis', 'heat'] },
      { type: 'checkbox', key: 'showSensors', label: 'Show sensors' }
    ]
  });
}

export const RoadwayScalarStateAnalysisDefinitions = [
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.temperature),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.CO),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.humidity),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.CH4),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.scalar)
];
