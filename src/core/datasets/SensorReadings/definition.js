import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { SensorReadingsDataset } from './runtime.js';
import { SensorReadingsContract } from './contract.js';
import { SensorReadingsDatasetValidators } from './validators.js';

export const SensorReadingsDatasetDefinition = defineBuiltInDataset({
  id: 'sensor-readings',
  datasetType: 'SensorReadingsDataset',
  semanticClass: 'EnvironmentalSensorReadings',
  taxonomyId: 'monitoring-sensing',
  DatasetClass: SensorReadingsDataset,
  materializerId: 'SensorReadings',
  materialize: null,
  contract: SensorReadingsContract,
  templateBindings: {
  state: {
    kind: "State",
    semanticRole: "sensorState"
  },
  readingOfSensor: {
    kind: "Relation",
    semanticRole: "readingOfSensor"
  }
},
  validators: SensorReadingsDatasetValidators
});
