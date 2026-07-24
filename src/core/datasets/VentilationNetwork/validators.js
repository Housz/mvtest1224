export const VentilationNetworkDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'ventilation-network-non-empty',
    severity: 'error',
    description: 'Ventilation Network must contain nodes and branches.',
    validate(dataset) {
      if (Boolean(dataset?.listNodes?.().length && dataset?.listBranches?.().length)) return true;
      return {
        message: 'Ventilation Network must contain nodes and branches.',
        path: 'templates'
      };
    }
  })
]);
