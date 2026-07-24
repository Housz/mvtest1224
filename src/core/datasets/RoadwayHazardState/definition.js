import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { RoadwayHazardStateDataset } from './runtime.js';
import { RoadwayHazardStateContract } from './contract.js';
import { RoadwayHazardStateDatasetValidators } from './validators.js';

export const RoadwayHazardStateDatasetDefinition = defineBuiltInDataset({
  id: 'roadway-hazard-state',
  datasetType: 'RoadwayHazardStateDataset',
  semanticClass: 'RoadwayHazardState',
  taxonomyId: 'safety-emergency',
  DatasetClass: RoadwayHazardStateDataset,
  materializerId: 'RoadwayHazardState',
  materialize: null,
  contract: RoadwayHazardStateContract,
  templateBindings: {
  hazardState: {
    kind: "State",
    semanticRole: "roadwayHazardState"
  },
  hazardField: {
    kind: "Field",
    semanticRole: "roadwayHazardField"
  },
  roadwayRelation: {
    kind: "Relation",
    semanticRole: "stateToRoadway"
  }
},
  validators: RoadwayHazardStateDatasetValidators
});
