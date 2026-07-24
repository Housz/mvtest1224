export const GeologicalAttributeModelDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'geological-attribute-model-non-empty',
    severity: 'error',
    description: 'Geological Attribute Model must expose at least one attribute.',
    validate(dataset) {
      if (Boolean(dataset?.listAttributes?.().length)) return true;
      return {
        message: 'Geological Attribute Model must expose at least one attribute.',
        path: 'templates'
      };
    }
  })
]);
