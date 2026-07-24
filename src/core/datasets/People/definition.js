import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { PeopleDataset } from './runtime.js';
import { PeopleContract } from './contract.js';
import { PeopleDatasetValidators } from './validators.js';

export const PeopleDatasetDefinition = defineBuiltInDataset({
  id: 'people',
  datasetType: 'PeopleDataset',
  semanticClass: 'People',
  taxonomyId: 'people-vehicles',
  DatasetClass: PeopleDataset,
  materializerId: 'People',
  materialize: null,
  contract: PeopleContract,
  templateBindings: {
  registry: {
    kind: "Registry",
    semanticRole: "personRegistry"
  },
  pointGeometry: {
    kind: "Geometry",
    semanticRole: "personLocation"
  },
  currentState: {
    kind: "State",
    semanticRole: "personState"
  },
  roadwayRelation: {
    kind: "Relation",
    semanticRole: "personToRoadway"
  }
},
  validators: PeopleDatasetValidators
});
