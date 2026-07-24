export const BoreholeDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'borehole-non-empty',
    severity: 'error',
    description: 'Borehole Dataset must contain at least one borehole.',
    validate(dataset) {
      if (Boolean(dataset?.listBoreholes?.().length)) return true;
      return {
        message: 'Borehole Dataset must contain at least one borehole.',
        path: 'templates'
      };
    }
  })
]);
