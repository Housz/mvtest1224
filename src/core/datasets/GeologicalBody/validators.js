export const GeologicalBodyDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'geological-body-non-empty',
    severity: 'error',
    description: 'Geological Body must contain units, bodies, surfaces, or blocks.',
    validate(dataset) {
      if (Boolean((dataset?.listUnits?.().length || 0) + (dataset?.listBodies?.().length || 0) + (dataset?.listSurfaces?.().length || 0) + (dataset?.listBlocks?.().length || 0))) return true;
      return {
        message: 'Geological Body must contain units, bodies, surfaces, or blocks.',
        path: 'templates'
      };
    }
  })
]);
