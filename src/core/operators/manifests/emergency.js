import { contribution, interaction, operatorManifest } from './manifestUtils.js';

const hazardContext = {
  consumes: ['selectedRoadwaySegment', 'selectedHazardSegment', 'timeCursor', 'selection'],
  publishes: [
    'selectedRoadwaySegment',
    'selectedHazardSource',
    'selectedHazardSegment',
    'activeRoadwayHazardState',
    'timeCursor',
    'selection'
  ]
};

function simulationManifest(kind) {
  return operatorManifest({
    context: hazardContext,
    processing: {
      processorId: `emergency.${kind}-simulation`,
      kind: 'simulation',
      deterministic: true,
      inputs: ['roadway', 'ventilationNetwork'],
      result: 'roadwayHazardState'
    },
    contributions: [
      contribution(`${kind}-hazard-layer`, 'main-3d-scene', 'layer', 'state', 'roadwayHazardState', {
        color: 'hazardSeverity',
        opacity: 'hazardIntensity'
      }),
      contribution(`${kind}-simulation-controls`, 'right-panel', 'control', 'control', 'roadwayHazardState'),
      contribution(`${kind}-hazard-map`, 'bottom-panel', 'panel', 'detail', 'roadwayHazardState'),
      contribution(`${kind}-hazard-summary`, 'right-panel', 'panel', 'detail', 'roadwayHazardState'),
      contribution(`${kind}-hazard-legend`, 'legend', 'legend', 'legend', 'roadwayHazardState', {}, {
        mergePolicy: 'replace'
      })
    ],
    interactions: [
      interaction(
        'set-hazard-source',
        'Select the hazard source on the roadway network.',
        ['pointer'],
        ['selectedHazardSource', 'selectedRoadwaySegment', 'selection']
      ),
      interaction(
        'advance-hazard-time',
        'Advance or scrub the simulation time.',
        ['timeCursor'],
        ['timeCursor']
      )
    ],
    dependencyExposure: {
      exposeWhenRootActive: true,
      reason: 'Interactive upstream simulation'
    }
  });
}

const personnelContext = {
  consumes: [
    'selectedRoadwaySegment',
    'selectedHazardSource',
    'selectedHazardSegment',
    'activeRoadwayHazardState',
    'selectedPerson',
    'selectedEmergencyResource',
    'selectedEvacuationRoute',
    'timeCursor',
    'selection'
  ],
  publishes: [
    'selectedPerson',
    'selectedEmergencyResource',
    'selectedEvacuationRoute',
    'selectedRoadwaySegment',
    'selectedHazardSegment',
    'selection'
  ]
};

function personnelManifest(legacy = false) {
  return operatorManifest({
    context: personnelContext,
    processing: {
      processorId: legacy ? 'emergency.safe-route-legacy' : 'emergency.personnel-analysis',
      inputs: ['roadway', 'people', 'emergencyResources', 'hazardState'],
      result: 'personnelEmergencyAnalysis'
    },
    contributions: [
      contribution('personnel-emergency-layer', 'main-3d-scene', 'layer', 'diagnostic', 'emergencyResponse', {
        color: 'routeSafety',
        line: 'evacuationRoute',
        halo: 'personState'
      }),
      contribution('personnel-emergency-controls', 'right-panel', 'control', 'control', 'emergencyResponse'),
      contribution('personnel-hazard-map', 'bottom-panel', 'panel', 'detail', 'emergencyResponse'),
      contribution('personnel-emergency-detail', 'right-panel', 'panel', 'detail', 'emergencyResponse'),
      contribution('personnel-emergency-summary', 'right-panel', 'panel', 'detail', 'emergencyResponse'),
      contribution('personnel-emergency-legend', 'legend', 'legend', 'legend', 'emergencyResponse', {}, {
        mergePolicy: 'replace'
      })
    ],
    interactions: [
      interaction(
        'select-person',
        'Select a person and inspect evacuation status.',
        ['pointer'],
        ['selectedPerson', 'selection']
      ),
      interaction(
        'select-emergency-resource',
        'Select an emergency resource or destination.',
        ['pointer'],
        ['selectedEmergencyResource', 'selection']
      ),
      interaction(
        'recompute-safe-route',
        'Recompute the route using the current hazard state.',
        ['selectedPerson', 'timeCursor'],
        ['selectedRoadwaySegment']
      )
    ]
  });
}

export const EmergencyOperatorManifests = new Map([
  ['WaterInrushSimulationOperator', simulationManifest('water-inrush')],
  ['FireAndSmokeSimulationOperator', simulationManifest('fire-smoke')],
  ['PersonnelEmergencyAnalysisOperator', personnelManifest(false)],
  ['SafeRouteAnalysisOperator', personnelManifest(true)]
]);
