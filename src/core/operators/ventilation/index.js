import { VentilationNetworkOverviewDefinition } from './VentilationNetworkOverview/index.js';
import { AirflowDistributionAnalysisDefinition } from './AirflowDistributionAnalysis/index.js';
import { BranchAirflowTrendInspectionDefinition } from './BranchAirflowTrendInspection/index.js';
import { VentilationAnomalyInspectionDefinition } from './VentilationAnomalyInspection/index.js';

export const VentilationOperatorNodeDefinitions = [
  VentilationNetworkOverviewDefinition,
  AirflowDistributionAnalysisDefinition,
  BranchAirflowTrendInspectionDefinition,
  VentilationAnomalyInspectionDefinition
];
