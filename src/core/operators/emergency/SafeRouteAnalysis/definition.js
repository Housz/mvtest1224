import { SafeRouteAnalysisRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { SafeRouteAnalysisInputRequirements } from '../contracts.js';

export const SafeRouteAnalysisDefinition = defineOperator({
  RuntimeClass: SafeRouteAnalysisRuntime,
  typeId: 'SafeRouteAnalysisOperator',
  label: 'Safe Route Analysis (Legacy)',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Topological',
  deprecated: true,
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Topological',
    auxiliaryTags: [
      'emergency',
      'evacuation',
      'routing',
      'hazard-aware',
      'people',
      'resource',
      'consumes-derived-dataset',
      'scene',
      'path'
    ]
  },
  inputRequirements: SafeRouteAnalysisInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'people', name: 'People', direction: 'in', type: 'PeopleDataset' },
    { id: 'emergencyResources', name: 'Emergency Resources', direction: 'in', type: 'EmergencyResourcesDataset' },
    { id: 'hazardState', name: 'Hazard State', direction: 'in', type: 'RoadwayHazardStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    routeMode: 'nearest-safe',
    destinationMode: 'nearest-resource',
    resourceTypes: ['refuge', 'exit'],
    avoidRiskySegments: true,
    riskPenalty: 5,
    walkingSpeed: 1.2,
    showAllRoutes: true,
    showOnlyAtRiskPeople: false,
    enableQuickHazardSketch: true,
    manualMode: false,
    manualMarkMode: 'blocked'
  },
  paramSchema: [
    { key: 'riskPenalty', label: 'Risk penalty', type: 'number' },
    { key: 'walkingSpeed', label: 'Walking speed', type: 'number' },
    { key: 'manualMode', label: 'Manual constraints', type: 'boolean' },
    { key: 'manualMarkMode', label: 'Mark mode', type: 'select', options: ['blocked', 'risky', 'clear'] }
  ],
  inlineControls: [
    { type: 'checkbox', key: 'manualMode', label: 'Manual constraints' },
    { type: 'select', key: 'manualMarkMode', label: 'Mark', options: ['blocked', 'risky', 'clear'] }
  ],
});
