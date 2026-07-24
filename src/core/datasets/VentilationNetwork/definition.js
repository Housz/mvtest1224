import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { VentilationNetworkDataset } from './runtime.js';
import { VentilationNetworkContract } from './contract.js';
import { VentilationNetworkDatasetValidators } from './validators.js';

export const VentilationNetworkDatasetDefinition = defineBuiltInDataset({
  id: 'ventilation-network',
  datasetType: 'VentilationNetworkDataset',
  semanticClass: 'VentilationNetwork',
  taxonomyId: 'ventilation',
  DatasetClass: VentilationNetworkDataset,
  materializerId: 'VentilationNetwork',
  materialize: null,
  contract: VentilationNetworkContract,
  templateBindings: {
  graph: {
    kind: "Graph",
    semanticRole: "ventilationTopology"
  },
  facilityRegistry: {
    kind: "Registry",
    semanticRole: "facilityRegistry"
  },
  roadwayRelation: {
    kind: "Relation",
    semanticRole: "branchToRoadway"
  },
  branchGeometry: {
    kind: "Geometry",
    semanticRole: "branchGeometry"
  }
},
  validators: VentilationNetworkDatasetValidators
});
