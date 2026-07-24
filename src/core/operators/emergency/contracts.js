export const WaterInrushSimulationInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  }
};

export const SafeRouteAnalysisInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  people: {
    class: 'People',
    requiredTemplates: ['Registry', 'Geometry', 'State', 'Relation'],
    requiredRoles: ['personIdentity', 'personPosition', 'personCurrentState', 'personRoadwayAnchor']
  },
  emergencyResources: {
    class: 'EmergencyResources',
    requiredTemplates: ['Registry', 'Geometry', 'Relation'],
    requiredRoles: ['resourceIdentity', 'resourcePosition', 'resourceRoadwayAnchor']
  },
  hazardState: {
    class: 'RoadwayHazardState',
    optional: true,
    requiredTemplates: ['State', 'Field', 'Relation'],
    requiredRoles: ['roadwayHazardTimeState', 'roadwayHazardField', 'hazardRoadwaySupport']
  }
};

export const FireAndSmokeSimulationInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  ventilationNetwork: {
    class: 'VentilationNetwork',
    optional: true,
    requiredTemplates: ['Graph', 'Registry', 'Relation'],
    requiredRoles: ['ventilationNetworkStructure', 'facilityIdentity', 'roadwayReference']
  },
  airflowState: {
    class: 'AirflowState',
    optional: true,
    requiredTemplates: ['State', 'Field', 'Relation'],
    requiredRoles: ['branchState', 'airflowField', 'branchStateRelation']
  }
};
