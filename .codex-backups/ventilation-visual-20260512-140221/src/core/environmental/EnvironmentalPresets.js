export const EnvironmentalReadingPresets = {
  temperature: {
    id: 'temperature',
    variable: 'temperature',
    unit: 'degC',
    label: 'Temperature Sensor Readings',
    sourcePath: '/data/Temperature_timeseries_20steps.csv',
    valueCandidates: ['value', 'temperature', 'temp', 'Temperature'],
    measuredValuePath: 'value',
    displayRange: { min: 18, max: 38 },
    colormap: 'rainbow'
  },
  CO: {
    id: 'CO',
    variable: 'CO',
    unit: 'ppm',
    label: 'CO Sensor Readings',
    sourcePath: '/data/CO_timeseries_mock.csv',
    valueCandidates: ['value', 'co', 'CO', 'carbon_monoxide'],
    measuredValuePath: 'value',
    displayRange: { min: 0, max: 100 },
    colormap: 'heat'
  },
  humidity: {
    id: 'humidity',
    variable: 'humidity',
    unit: '%',
    label: 'Humidity Sensor Readings',
    sourcePath: '/data/Humidity_timeseries_mock.csv',
    valueCandidates: ['value', 'humidity', 'Humidity', 'rh'],
    measuredValuePath: 'value',
    displayRange: { min: 20, max: 100 },
    colormap: 'viridis'
  },
  CH4: {
    id: 'CH4',
    variable: 'CH4',
    unit: '%',
    label: 'CH4 Sensor Readings',
    sourcePath: '/data/CH4_timeseries_mock.csv',
    valueCandidates: ['value', 'ch4', 'CH4', 'methane'],
    measuredValuePath: 'value',
    displayRange: { min: 0, max: 2 },
    colormap: 'heat'
  },
  environmental: {
    id: 'environmental',
    variable: 'environmentalScalar',
    unit: '',
    label: 'Environmental Sensor Readings',
    sourcePath: '/data/Temperature_timeseries_20steps.csv',
    valueCandidates: ['value', 'temperature', 'co', 'CO', 'humidity', 'ch4', 'CH4'],
    measuredValuePath: 'value',
    displayRange: { min: 0, max: 100 },
    colormap: 'rainbow'
  }
};

export const RoadwayScalarAnalysisPresets = {
  temperature: {
    id: 'temperature',
    variable: 'temperature',
    unit: 'degC',
    label: 'Roadway Temperature Analysis',
    legendLabel: 'Temperature',
    range: { min: 18, max: 38 },
    colormap: 'rainbow',
    tags: ['monitoring', 'environmental', 'temporal', 'scalar-state', 'scene', 'chart', 'legend', 'selection-linked', 'time-synchronized']
  },
  CO: {
    id: 'CO',
    variable: 'CO',
    unit: 'ppm',
    label: 'Roadway CO Concentration Analysis',
    legendLabel: 'CO concentration',
    range: { min: 0, max: 100 },
    colormap: 'heat',
    warningThreshold: 24,
    tags: ['monitoring', 'environmental', 'gas', 'temporal', 'scalar-state', 'scene', 'chart', 'legend', 'selection-linked', 'time-synchronized']
  },
  humidity: {
    id: 'humidity',
    variable: 'humidity',
    unit: '%',
    label: 'Roadway Humidity Analysis',
    legendLabel: 'Humidity',
    range: { min: 20, max: 100 },
    colormap: 'viridis',
    tags: ['monitoring', 'environmental', 'temporal', 'scalar-state', 'scene', 'chart', 'legend', 'selection-linked', 'time-synchronized']
  },
  CH4: {
    id: 'CH4',
    variable: 'CH4',
    unit: '%',
    label: 'Roadway CH4 Concentration Analysis',
    legendLabel: 'CH4 concentration',
    range: { min: 0, max: 2 },
    colormap: 'heat',
    warningThreshold: 1,
    tags: ['monitoring', 'environmental', 'gas', 'safety', 'temporal', 'scalar-state', 'scene', 'chart', 'legend', 'selection-linked', 'time-synchronized']
  },
  scalar: {
    id: 'scalar',
    variable: 'environmentalScalar',
    unit: '',
    label: 'Roadway Scalar State Analysis',
    legendLabel: 'Scalar value',
    range: { min: 0, max: 100 },
    colormap: 'rainbow',
    tags: ['monitoring', 'environmental', 'temporal', 'scalar-state', 'scene', 'chart', 'legend', 'selection-linked', 'time-synchronized']
  }
};
