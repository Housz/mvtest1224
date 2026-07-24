import { RoadwayScalarAnalysisPresets } from '../../../environmental/EnvironmentalPresets.js';

const RoadwayScalarStateAnalysisInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  sensorRegistry: {
    class: 'SensorRegistry',
    requiredTemplates: ['Registry', 'Geometry', 'Relation'],
    requiredRoles: ['sensorIdentity', 'sensorPosition', 'roadwayMountRelation']
  },
  sensorReadings: {
    class: 'EnvironmentalSensorReadings',
    acceptedClasses: ['EnvironmentalSensorReadings', 'SensorReadings'],
    requiredTemplates: ['State', 'Relation'],
    requiredRoles: ['observedEntity', 'timestamp', 'measuredValue']
  }
};

const typeIdsByPreset = {
  temperature: 'RoadwayTemperatureAnalysisOperator',
  CO: 'RoadwayCOConcentrationAnalysisOperator',
  humidity: 'RoadwayHumidityAnalysisOperator',
  CH4: 'RoadwayCH4ConcentrationAnalysisOperator',
  scalar: 'RoadwayScalarStateAnalysisOperator'
};

function presetForNode(nodeModel) {
  const presetId =
    nodeModel.params?.presetId ||
    Object.entries(typeIdsByPreset).find(([, typeId]) => typeId === nodeModel.typeId)?.[0] ||
    'scalar';
  return RoadwayScalarAnalysisPresets[presetId] || RoadwayScalarAnalysisPresets.scalar;
}

function defaultParamsFromPreset(preset) {
  return {
    presetId: preset.id,
    variable: preset.variable,
    unit: preset.unit,
    legendLabel: preset.legendLabel,
    minValue: preset.range.min,
    maxValue: preset.range.max,
    colormap: preset.colormap,
    toleranceMinutes: 60,
    showSensors: true,
    chartPresentation: 'docked',
    comparisonLayout: 'auto',
    selectionMode: 'multiple',
    maxComparedItems: 8,
    chartAnchor: 'primary-selection',
    worldChartScale: 1,
    worldChartOcclusion: 'depth-aware',
    ...(preset.warningThreshold != null ? { warningThreshold: preset.warningThreshold } : {})
  };
}

export { RoadwayScalarStateAnalysisInputRequirements, typeIdsByPreset, presetForNode, defaultParamsFromPreset };
export { RoadwayScalarAnalysisPresets };
