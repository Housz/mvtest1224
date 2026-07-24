export const AirflowStateDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'airflow-state-non-empty',
    severity: 'error',
    description: 'Airflow State must contain at least one branch series.',
    validate(dataset) {
      if (Boolean(dataset?.listBranchIDs?.().length)) return true;
      return {
        message: 'Airflow State must contain at least one branch series.',
        path: 'templates'
      };
    }
  })
]);
