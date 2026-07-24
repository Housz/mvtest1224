import { WaterInrushSimulationDefinition } from './WaterInrushSimulation/index.js';
import { FireAndSmokeSimulationDefinition } from './FireAndSmokeSimulation/index.js';
import { PersonnelEmergencyAnalysisDefinition } from './PersonnelEmergencyAnalysis/index.js';
import { SafeRouteAnalysisDefinition } from './SafeRouteAnalysis/index.js';

export const EmergencyOperatorNodeDefinitions = [
  WaterInrushSimulationDefinition,
  FireAndSmokeSimulationDefinition,
  PersonnelEmergencyAnalysisDefinition,
  SafeRouteAnalysisDefinition
];
