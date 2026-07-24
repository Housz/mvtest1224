export const PeopleDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'people-non-empty',
    severity: 'error',
    description: 'People Dataset must contain at least one person.',
    validate(dataset) {
      if (Boolean(dataset?.listPeople?.().length)) return true;
      return {
        message: 'People Dataset must contain at least one person.',
        path: 'templates'
      };
    }
  })
]);
