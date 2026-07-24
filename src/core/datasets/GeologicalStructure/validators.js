export const GeologicalStructureDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'geological-structure-non-empty',
    severity: 'error',
    description: 'Geological Structure must contain at least one structure.',
    validate(dataset) {
      if (Boolean(dataset?.listStructures?.().length)) return true;
      return {
        message: 'Geological Structure must contain at least one structure.',
        path: 'templates'
      };
    }
  })
]);
