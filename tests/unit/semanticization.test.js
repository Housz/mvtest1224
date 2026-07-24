import { describe, expect, it } from 'vitest';
import { SemanticizationService } from '../../src/core/semantics/SemanticizationService.js';

function roadwayParams(overrides = {}) {
  return {
    datasetType: 'Roadway',
    contractId: 'RoadwayContract',
    sources: {
      topology: {
        label: 'Topology',
        name: 'roadway.json',
        adaptor: 'JSONGraphAdaptor',
        required: true,
        data: {
          nodes: [
            { id: 'N1', position: { x: 0, y: 0, z: 0 } },
            { id: 'N2', position: { x: 10, y: 0, z: 0 } }
          ],
          edges: [{ id: 'E1', source: 'N1', target: 'N2', path: [] }]
        }
      },
      geometry: {
        label: 'Geometry',
        name: 'roadway.obj',
        adaptor: 'OBJGeometryAdaptor',
        required: true,
        text: 'o E1\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'
      },
      relations: { label: 'Relations', required: false }
    },
    roleMapping: {
      'graph.nodeId': 'nodes.id',
      'graph.nodePosition': 'nodes.position',
      'graph.edgeId': 'edges.id',
      'graph.fromNode': 'edges.source',
      'graph.toNode': 'edges.target',
      'graph.path': 'edges.path',
      'geometry.meshPartId': 'meshParts.name'
    },
    ...overrides
  };
}

describe('SemanticizationService', () => {
  it('runs the declared stages and returns a semantic Dataset', async () => {
    const nodeModel = { params: {}, runtime: {} };
    const result = await new SemanticizationService().semanticize({
      nodeModel,
      params: roadwayParams(),
      updateNode: true
    });

    expect(result.dataset.type).toBe('RoadwayDataset');
    expect(result.dataset.contract.id).toBe('RoadwayContract');
    expect(result.dataset.validation.valid).toBe(true);
    expect(Object.values(result.stages).every((stage) => ['ready', 'warning', 'skipped'].includes(stage.status))).toBe(true);
    expect(result.stages.sources.summary.loaded).toBe(2);
    expect(nodeModel.params.semanticStatus.valid).toBe(true);
  });

  it('returns an invalid Dataset for a missing required source without crashing', async () => {
    const params = roadwayParams();
    params.sources.geometry = { label: 'Geometry', required: true };
    const result = await new SemanticizationService().semanticize({
      nodeModel: { params: {}, runtime: {} },
      params,
      updateNode: false
    });

    expect(result.dataset.validation.valid).toBe(false);
    expect(result.diagnostics.some((item) => item.code === 'required-source-missing')).toBe(true);
  });

  it('treats a missing optional source as a warning', async () => {
    const result = await new SemanticizationService().semanticize({
      nodeModel: { params: {}, runtime: {} },
      params: roadwayParams(),
      updateNode: false
    });

    expect(result.diagnostics.some((item) => item.code === 'optional-source-missing')).toBe(true);
    expect(result.dataset.validation.errors).not.toContain('Optional source missing: Relations.');
  });
});
