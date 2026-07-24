export const VentilationNetworkOverviewInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  ventilationNetwork: {
    class: 'VentilationNetwork',
    requiredTemplates: ['Graph', 'Registry', 'Relation'],
    requiredRoles: ['ventilationNetworkStructure', 'facilityIdentity', 'roadwayReference']
  }
};

export const AirflowDistributionInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  ventilationNetwork: {
    class: 'VentilationNetwork',
    requiredTemplates: ['Graph', 'Registry', 'Relation'],
    requiredRoles: ['ventilationNetworkStructure', 'facilityIdentity', 'roadwayReference']
  },
  airflowState: {
    class: 'AirflowState',
    requiredTemplates: ['State', 'Field', 'Relation'],
    requiredRoles: ['branchState', 'airflowField', 'branchStateRelation']
  }
};

export const BranchAirflowTrendInputRequirements = {
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  ventilationNetwork: {
    class: 'VentilationNetwork',
    requiredTemplates: ['Graph', 'Registry', 'Relation'],
    requiredRoles: ['ventilationNetworkStructure', 'facilityIdentity', 'roadwayReference']
  },
  airflowState: {
    class: 'AirflowState',
    requiredTemplates: ['State', 'Field', 'Relation'],
    requiredRoles: ['branchState', 'airflowField', 'branchStateRelation']
  }
};

export const VentilationAnomalyInputRequirements = AirflowDistributionInputRequirements;

export const AIRFLOW_VARIABLES = {
  airQuantity: {
    label: 'Air Quantity',
    unit: 'm3/s',
    valueKey: 'airQuantity',
    colormap: 'viridis'
  },
  velocity: {
    label: 'Velocity',
    unit: 'm/s',
    valueKey: 'velocity',
    colormap: 'rainbow'
  },
  pressureDrop: {
    label: 'Pressure Drop',
    unit: 'Pa',
    valueKey: 'pressureDrop',
    colormap: 'heat'
  }
};
