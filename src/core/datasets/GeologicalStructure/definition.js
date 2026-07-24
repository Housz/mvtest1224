import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { GeologicalStructureDataset } from './runtime.js';
import { GeologicalStructureContract } from './contract.js';
import { GeologicalStructureDatasetValidators } from './validators.js';

export const GeologicalStructureDatasetDefinition = defineBuiltInDataset({
  id: 'geological-structure',
  datasetType: 'GeologicalStructureDataset',
  semanticClass: 'GeologicalStructure',
  taxonomyId: 'geology-resources',
  DatasetClass: GeologicalStructureDataset,
  materializerId: 'GeologicalStructure',
  materialize: null,
  contract: GeologicalStructureContract,
  templateBindings: {
  registry: {
    kind: "Registry",
    semanticRole: "structureRegistry"
  },
  geometry: {
    kind: "Geometry",
    semanticRole: "structureGeometry"
  },
  field: {
    kind: "Field",
    semanticRole: "structureField",
    required: false
  },
  relation: {
    kind: "Relation",
    semanticRole: "structureRelations"
  }
},
  validators: GeologicalStructureDatasetValidators
});
