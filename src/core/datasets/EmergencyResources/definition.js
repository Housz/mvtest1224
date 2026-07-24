import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { EmergencyResourcesDataset } from './runtime.js';
import { EmergencyResourcesContract } from './contract.js';
import { EmergencyResourcesDatasetValidators } from './validators.js';

export const EmergencyResourcesDatasetDefinition = defineBuiltInDataset({
  id: 'emergency-resources',
  datasetType: 'EmergencyResourcesDataset',
  semanticClass: 'EmergencyResources',
  taxonomyId: 'safety-emergency',
  DatasetClass: EmergencyResourcesDataset,
  materializerId: 'EmergencyResources',
  materialize: null,
  contract: EmergencyResourcesContract,
  templateBindings: {
  registry: {
    kind: "Registry",
    semanticRole: "resourceRegistry"
  },
  pointGeometry: {
    kind: "Geometry",
    semanticRole: "resourceLocation"
  },
  roadwayRelation: {
    kind: "Relation",
    semanticRole: "resourceToRoadway"
  }
},
  validators: EmergencyResourcesDatasetValidators
});
