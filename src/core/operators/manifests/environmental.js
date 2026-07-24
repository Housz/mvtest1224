import { contribution, interaction, operatorManifest } from './manifestUtils.js';

const scalarContext = {
  consumes: ['selectedRoadwaySegment', 'selectedSensor', 'selection', 'selectionSet', 'hoveredSelection', 'timeCursor'],
  publishes: ['selectedRoadwaySegment', 'selectedSensor', 'selection', 'selectionSet', 'hoveredSelection', 'timeCursor']
};

function scalarManifest(typeId) {
  return operatorManifest({
    context: scalarContext,
    processing: {
      processorId: `${typeId}.scalar-state-analysis`,
      inputs: ['roadway', 'sensorRegistry', 'sensorReadings'],
      result: 'roadwayScalarState'
    },
    contributions: [
      contribution('roadway-scalar-layer', 'main-3d-scene', 'layer', 'state', 'roadway', {
        color: 'scalarValue',
        opacity: 'confidence'
      }),
      contribution('roadway-scalar-controls', 'right-panel', 'control', 'control', 'roadwayScalarState'),
      contribution('roadway-scalar-trend', 'bottom-panel', 'chart', 'detail', 'sensorReadings'),
      contribution('roadway-scalar-legend', 'legend', 'legend', 'legend', 'roadwayScalarState', {}, {
        mergePolicy: 'replace'
      })
    ],
    interactions: [
      interaction(
        'pick-roadway-scalar',
        'Select a roadway segment or sensor from the 3D state layer.',
        ['pointer'],
        ['selectedRoadwaySegment', 'selectedSensor', 'selection', 'selectionSet', 'hoveredSelection']
      ),
      interaction(
        'inspect-scalar-time',
        'Move the temporal cursor and update the scalar state.',
        ['timeCursor'],
        ['timeCursor']
      )
    ]
  });
}

export const EnvironmentalOperatorManifests = new Map([
  'RoadwayTemperatureAnalysisOperator',
  'RoadwayCOConcentrationAnalysisOperator',
  'RoadwayHumidityAnalysisOperator',
  'RoadwayCH4ConcentrationAnalysisOperator',
  'RoadwayScalarStateAnalysisOperator'
].map((typeId) => [typeId, scalarManifest(typeId)]));
