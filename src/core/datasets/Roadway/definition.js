import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { RoadwayDataset } from './runtime.js';
import { RoadwayContract } from './contract.js';
import { RoadwayDatasetValidators } from './validators.js';

export const RoadwayDatasetDefinition = defineBuiltInDataset({
  id: 'roadway',
  datasetType: 'RoadwayDataset',
  semanticClass: 'Roadway',
  taxonomyId: 'roadways-infrastructure',
  DatasetClass: RoadwayDataset,
  materializerId: 'Roadway',
  materialize: null,
  contract: RoadwayContract,
  templateBindings: {
  graph: {
    kind: "Graph",
    semanticRole: "roadwayTopology"
  },
  geometry: {
    kind: "Geometry",
    semanticRole: "roadwayGeometry"
  },
  geometryToGraph: {
    kind: "Relation",
    semanticRole: "geometryToGraph"
  }
},
  validators: RoadwayDatasetValidators
});
