import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { GeologicalAttributeModelDataset } from './runtime.js';
import { GeologicalAttributeModelContract } from './contract.js';
import { GeologicalAttributeModelDatasetValidators } from './validators.js';

export const GeologicalAttributeModelDatasetDefinition = defineBuiltInDataset({
  id: 'geological-attribute-model',
  datasetType: 'GeologicalAttributeModelDataset',
  semanticClass: 'GeologicalAttributeModel',
  taxonomyId: 'geology-resources',
  DatasetClass: GeologicalAttributeModelDataset,
  materializerId: 'GeologicalAttributeModel',
  materialize: null,
  contract: GeologicalAttributeModelContract,
  templateBindings: {
  geometry: {
    kind: "Geometry",
    semanticRole: "attributeGeometry"
  },
  field: {
    kind: "Field",
    semanticRole: "attributeField"
  },
  registry: {
    kind: "Registry",
    semanticRole: "attributeRegistry"
  },
  relation: {
    kind: "Relation",
    semanticRole: "attributeRelations"
  }
},
  validators: GeologicalAttributeModelDatasetValidators
});
