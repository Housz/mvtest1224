import { defineBuiltInDataset } from '../shared/DatasetDefinitionFactory.js';
import { AirflowStateDataset } from './runtime.js';
import { AirflowStateContract } from './contract.js';
import { AirflowStateDatasetValidators } from './validators.js';

export const AirflowStateDatasetDefinition = defineBuiltInDataset({
  id: 'airflow-state',
  datasetType: 'AirflowStateDataset',
  semanticClass: 'AirflowState',
  taxonomyId: 'ventilation',
  DatasetClass: AirflowStateDataset,
  materializerId: 'AirflowState',
  materialize: null,
  contract: AirflowStateContract,
  templateBindings: {
  state: {
    kind: "State",
    semanticRole: "branchState"
  },
  airflowField: {
    kind: "Field",
    semanticRole: "airflowField"
  },
  stateOfBranch: {
    kind: "Relation",
    semanticRole: "stateOfBranch"
  }
},
  validators: AirflowStateDatasetValidators
});
