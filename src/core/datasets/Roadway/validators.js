export const RoadwayDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'roadway-non-empty',
    severity: 'error',
    description: 'Roadway must contain graph nodes and edges.',
    validate(dataset) {
      if (Boolean(dataset?.getNodes?.().length && dataset?.getEdges?.().length)) return true;
      return {
        message: 'Roadway must contain graph nodes and edges.',
        path: 'templates'
      };
    }
  })
]);
