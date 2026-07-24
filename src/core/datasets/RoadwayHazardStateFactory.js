import { SemanticContractRegistry } from '../semantics/SemanticContractRegistry.js';
import { materializeDataset } from '../semantics/DatasetMaterializers.js';

const generatedRoleMapping = Object.freeze({
  time: 'time',
  roadwayEdgeId: 'roadwayEdgeId',
  roadwayNodeId: 'roadwayNodeId',
  hazardType: 'hazardType',
  hazardValue: 'hazardValue',
  severity: 'severity',
  passability: 'passability',
  arrivalTime: 'arrivalTime',
  scenarioId: 'scenarioId'
});

export function createRoadwayHazardStateDataset(rows = [], metadata = {}) {
  const contract = SemanticContractRegistry.get('RoadwayHazardStateContract');
  const dataset = materializeDataset({
    datasetType: 'RoadwayHazardState',
    contract,
    adaptorResults: { state: { rows } },
    roleMapping: generatedRoleMapping,
    sources: { state: { path: metadata.sourcePath || '', generated: true } }
  });
  dataset.metadata = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'MineVis operator',
    ...metadata
  };
  return dataset;
}

export const createRoadwayHazardDataset = createRoadwayHazardStateDataset;
