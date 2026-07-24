export const RoadwayHazardStateDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'roadway-hazard-state-non-empty',
    severity: 'error',
    description: 'Roadway Hazard State must contain at least one state row.',
    validate(dataset) {
      if (Boolean(dataset?.rows?.length)) return true;
      return {
        message: 'Roadway Hazard State must contain at least one state row.',
        path: 'templates'
      };
    }
  })
]);
