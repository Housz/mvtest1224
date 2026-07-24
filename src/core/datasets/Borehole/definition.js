import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { BoreholeDataset } from './runtime.js';
import { BoreholeContract } from './contract.js';
import { BoreholeDatasetValidators } from './validators.js';

export const BoreholeDatasetDefinition = defineBuiltInDataset({
  id: 'borehole',
  datasetType: 'BoreholeDataset',
  semanticClass: 'Borehole',
  taxonomyId: 'geology-resources',
  DatasetClass: BoreholeDataset,
  materializerId: 'Borehole',
  materialize: null,
  contract: BoreholeContract,
  templateBindings: {
  registry: {
    kind: "Registry",
    semanticRole: "boreholeRegistry"
  },
  trajectoryGeometry: {
    kind: "Geometry",
    semanticRole: "boreholeTrajectory"
  },
  logField: {
    kind: "Field",
    semanticRole: "boreholeLogs"
  },
  relation: {
    kind: "Relation",
    semanticRole: "boreholeRelations"
  }
},
  validators: BoreholeDatasetValidators
});
