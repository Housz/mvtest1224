export const GeologicalModelOverviewInputRequirements = {
  geologicalBody: {
    class: 'GeologicalBody',
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  }
};

export const GeologicalSectionAnalysisInputRequirements = {
  geologicalBody: {
    class: 'GeologicalBody',
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  }
};

export const BoreholeStratigraphyCorrelationInputRequirements = {
  borehole: {
    class: 'Borehole',
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalBody: {
    class: 'GeologicalBody',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  }
};

export const GeologicalAttributeDistributionInputRequirements = {
  attributeModel: {
    class: 'GeologicalAttributeModel',
    requiredTemplates: ['Geometry', 'Field']
  },
  geologicalBody: {
    class: 'GeologicalBody',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  }
};

export const RoadwayGeologyRelationshipInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  geologicalBody: {
    class: 'GeologicalBody',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  }
};
