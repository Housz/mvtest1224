import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { GeologicalBodyDataset } from './runtime.js';
import { GeologicalBodyContract } from './contract.js';
import { GeologicalBodyDatasetValidators } from './validators.js';

export const GeologicalBodyDatasetDefinition = defineBuiltInDataset({
  id: 'geological-body',
  datasetType: 'GeologicalBodyDataset',
  semanticClass: 'GeologicalBody',
  taxonomyId: 'geology-resources',
  DatasetClass: GeologicalBodyDataset,
  materializerId: 'GeologicalBody',
  materialize: null,
  contract: GeologicalBodyContract,
  templateBindings: {
  registry: {
    kind: "Registry",
    semanticRole: "geologicalUnitRegistry"
  },
  geometry: {
    kind: "Geometry",
    semanticRole: "geologicalGeometry"
  },
  field: {
    kind: "Field",
    semanticRole: "geologicalAttributeField",
    required: false
  },
  relation: {
    kind: "Relation",
    semanticRole: "geologicalRelations"
  }
},
  validators: GeologicalBodyDatasetValidators
});
