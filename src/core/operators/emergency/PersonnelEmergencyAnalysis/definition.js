import { SafeRouteAnalysisRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { SafeRouteAnalysisInputRequirements } from '../contracts.js';

export const PersonnelEmergencyAnalysisDefinition = defineOperator({
  RuntimeClass: SafeRouteAnalysisRuntime,
  typeId: 'PersonnelEmergencyAnalysisOperator',
  label: 'Personnel Emergency Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Topological',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Topological',
    auxiliaryTags: [
      'emergency',
      'personnel',
      'evacuation',
      'hazard-aware',
      'routing',
      'resource',
      'risk',
      'spatial',
      'temporal',
      'scene',
      'response',
      'what-if',
      'consumes-derived-dataset'
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
    riskWeight: 5,
    riskPenalty: 5,
    blockedCost: Infinity,
    showAllRoutes: true,
    showOnlyAtRiskPeople: false,
    enableQuickHazardSketch: true,
    autoRecompute: true,
    travelSpeed: 1.2,
    walkingSpeed: 1.2,
    capacityAware: false,
    manualMode: false,
    manualMarkMode: 'blocked'
  },
  paramSchema: [
    { key: 'routeMode', label: 'Route mode', type: 'select', options: ['nearest-safe', 'shortest', 'lowest-risk'] },
    { key: 'destinationMode', label: 'Destination mode', type: 'select', options: ['nearest-resource', 'selected-resource', 'nearest-exit', 'nearest-refuge'] },
    { key: 'riskWeight', label: 'Risk weight', type: 'number' },
    { key: 'travelSpeed', label: 'Travel speed', type: 'number' },
    { key: 'avoidRiskySegments', label: 'Avoid risky segments', type: 'boolean' },
    { key: 'showAllRoutes', label: 'Show all routes', type: 'boolean' },
    { key: 'showOnlyAtRiskPeople', label: 'Show only at-risk people', type: 'boolean' },
    { key: 'enableQuickHazardSketch', label: 'Quick hazard sketch', type: 'boolean' },
    { key: 'manualMarkMode', label: 'Sketch mark', type: 'select', options: ['blocked', 'risky', 'clear'] }
  ],
  inlineControls: [
    { type: 'select', key: 'destinationMode', label: 'Destination', options: ['nearest-resource', 'selected-resource', 'nearest-exit', 'nearest-refuge'] },
    { type: 'checkbox', key: 'avoidRiskySegments', label: 'Avoid risky' },
    { type: 'checkbox', key: 'showOnlyAtRiskPeople', label: 'At-risk only' }
  ],
});
