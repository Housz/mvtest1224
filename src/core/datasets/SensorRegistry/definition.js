import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { SensorRegistryDataset } from './runtime.js';
import { SensorRegistryContract } from './contract.js';
import { SensorRegistryDatasetValidators } from './validators.js';

export const SensorRegistryDatasetDefinition = defineBuiltInDataset({
  id: 'sensor-registry',
  datasetType: 'SensorRegistryDataset',
  semanticClass: 'SensorRegistry',
  taxonomyId: 'monitoring-sensing',
  DatasetClass: SensorRegistryDataset,
  materializerId: 'SensorRegistry',
  materialize: null,
  contract: SensorRegistryContract,
  templateBindings: {
  registry: {
    kind: "Registry",
    semanticRole: "sensorRegistry"
  },
  pointGeometry: {
    kind: "Geometry",
    semanticRole: "sensorLocations"
  },
  mountedOnRoadway: {
    kind: "Relation",
    semanticRole: "mountedOnRoadway"
  }
},
  validators: SensorRegistryDatasetValidators
});
