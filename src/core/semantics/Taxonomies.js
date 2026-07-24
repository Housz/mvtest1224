export const DatasetTaxonomy = [
  {
    id: 'roadways-infrastructure',
    class: 'Roadways & Infrastructure',
    aliases: [],
    representativeDatasets: ['Roadway', 'Roadway Segment', 'Support Structure', 'Underground Facility'],
    objectSystemFocus: 'Built underground structures'
  },
  {
    id: 'geology-resources',
    class: 'Geology & Resources',
    aliases: ['Geology & Resource Datasets'],
    representativeDatasets: [
      'Geological Body',
      'Borehole',
      'Geological Structure',
      'Geological Attribute Model',
      'Resource Block Model'
    ],
    objectSystemFocus: 'Geological bodies, structures, evidence, and resource fields'
  },
  {
    id: 'monitoring-sensing',
    class: 'Monitoring & Sensing',
    aliases: [],
    representativeDatasets: ['Sensor Registry', 'Sensor Readings', 'Monitoring Field', 'Warning State'],
    objectSystemFocus: 'Observed conditions and measurements'
  },
  {
    id: 'production-operations',
    class: 'Production & Operations',
    aliases: [],
    representativeDatasets: ['Working Face', 'Production Unit', 'Operation State', 'Process Record'],
    objectSystemFocus: 'Mining production activities'
  },
  {
    id: 'ventilation',
    class: 'Ventilation & Utility Networks',
    aliases: ['Ventilation & Utility Network'],
    representativeDatasets: ['Ventilation Network', 'Airflow State', 'Ventilation Facility'],
    objectSystemFocus: 'Air circulation and utility networks'
  },
  {
    id: 'people-vehicles',
    class: 'People, Vehicles & Mobile Assets',
    aliases: ['People & Vehicles', 'Equipment, People & Mobile Asset'],
    representativeDatasets: ['People', 'Personnel Registry', 'Mobility Trace', 'Vehicle State'],
    objectSystemFocus: 'Human and mobile asset presence'
  },
  {
    id: 'robots-equipment',
    class: 'Robots & Equipment',
    aliases: [],
    representativeDatasets: ['Equipment Registry', 'Robot Model', 'Equipment State'],
    objectSystemFocus: 'Mining machinery and robots'
  },
  {
    id: 'safety-emergency',
    class: 'Safety & Emergency',
    aliases: ['Safety, Hazard & Emergency'],
    representativeDatasets: ['Emergency Resources', 'Roadway Hazard State', 'Hazard Field', 'Hazard Region'],
    objectSystemFocus: 'Risk and emergency response scenarios'
  }
];

export function resolveDatasetTaxonomy(value) {
  return DatasetTaxonomy.find((item) => (
    item.id === value || item.class === value || item.aliases.includes(value)
  )) || null;
}

export const DataTemplateTaxonomy = {
  Geometry: {
    formalDefinition:
      'Point, Polyline, ParametricCurve, MeshSurface, ParametricSurface, and VolumeGrid spatial supports.',
    role: 'Provides spatial support and geometric form.'
  },
  Graph: {
    formalDefinition: '<nodes:N, edges:E, incidence:E -> N x N>',
    role: 'Captures connectivity and topological structure.'
  },
  Registry: {
    formalDefinition: '<key:K, attrs:A>',
    role: 'Provides stable identity anchors and descriptive attributes.'
  },
  State: {
    formalDefinition: '<subject:K, time:T, attrs:A>',
    role: 'Captures dynamic observations or conditions.'
  },
  Field: {
    formalDefinition: '<support:S, values:S -> V>',
    role: 'Represents scalar or vector quantities over a support.'
  },
  Relation: {
    formalDefinition: '<source:Ks, target:Kt, attrs:A>',
    role: 'Represents attachment, mapping, ownership, grouping, or structural linkage.'
  }
};

export const OperatorTaxonomy = {
  Spatial: {
    representativeOperators: ['spatial coloring', 'slicing', 'region query', 'geometry inspection', 'field overlay'],
    typicalInputs: ['geometry-rich datasets', 'registries with spatial support', 'fields']
  },
  Topological: {
    representativeOperators: ['routing', 'subnetwork extraction', 'connectivity inspection', 'propagation analysis'],
    typicalInputs: ['graph-based datasets', 'networked infrastructures']
  },
  Temporal: {
    representativeOperators: ['trend inspection', 'replay', 'time slicing', 'interval comparison', 'temporal aggregation'],
    typicalInputs: ['state datasets', 'temporal registries', 'time-indexed fields or graphs']
  },
  Simulation: {
    representativeOperators: ['scenario exploration', 'predictive spread', 'response comparison', 'evacuation planning'],
    typicalInputs: ['roadway datasets', 'hazard-related datasets', 'ventilation datasets', 'scenario parameters']
  }
};

export function assertTemplateType(type) {
  if (!DataTemplateTaxonomy[type]) {
    throw new Error(`Unsupported MineVis data template type: ${type}`);
  }
}

export function assertOperatorPrimaryClass(primaryClass) {
  if (!OperatorTaxonomy[primaryClass]) {
    throw new Error(`Unsupported MineVis operator primary class: ${primaryClass}`);
  }
}
