export const EmergencyResourcesDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'emergency-resources-non-empty',
    severity: 'error',
    description: 'Emergency Resources must contain at least one resource.',
    validate(dataset) {
      if (Boolean(dataset?.listResources?.().length)) return true;
      return {
        message: 'Emergency Resources must contain at least one resource.',
        path: 'templates'
      };
    }
  })
]);
