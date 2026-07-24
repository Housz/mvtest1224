import { describe, expect, it } from 'vitest';
import { DatasetDefinitionRegistry } from '../../src/core/datasets/definitions/index.js';
import { materializeRoadway } from '../../src/core/semantics/DatasetMaterializers.js';
import { SemanticContractRegistry } from '../../src/core/semantics/SemanticContractRegistry.js';
import { createRoadwayHazardStateDataset } from '../../src/core/datasets/RoadwayHazardStateFactory.js';

function roadwayMaterialization() {
  const contract = SemanticContractRegistry.get('RoadwayContract');
  return materializeRoadway({
    contract,
    adaptorResults: {
      topology: {
        nodes: [
          { id: 'N1', position: { x: 0, y: 0, z: 0 } },
          { id: 'N2', position: { x: 10, y: 0, z: 0 } }
        ],
        edges: [{ id: 'E1', source: 'N1', target: 'N2', path: [] }]
      },
      geometry: {
        objText: 'o E1\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3',
        meshParts: [{ name: 'E1', vertexCount: 3 }]
      }
    },
    roleMapping: Object.fromEntries(contract.roles.map((role) => [role.key, role.defaultPath])),
    sources: {
      topology: { path: '/data/roadway.json' },
      geometry: { path: '/data/roadway.obj' }
    }
  });
}

describe('Dataset definition registry', () => {
  it('maps one Dataset definition to contract, templates and runtime class', () => {
    const definition = DatasetDefinitionRegistry.get('roadway');
    expect(definition.datasetType).toBe('RoadwayDataset');
    expect(definition.semanticClass).toBe('Roadway');
    expect(Object.keys(definition.templateBindings)).toEqual(['graph', 'geometry', 'geometryToGraph']);
    expect(definition.constraints.every((constraint) => typeof constraint.validate === 'function')).toBe(true);
  });

  it('validates a materialized Dataset and preserves its accessors', () => {
    const dataset = roadwayMaterialization();
    const validation = DatasetDefinitionRegistry.validateDataset(dataset, 'roadway');

    expect(validation.valid).toBe(true);
    expect(dataset.getEdges()).toHaveLength(1);
    expect(dataset.getRenderableSupport().geometry.objText).toContain('o E1');
    expect(dataset.getSemanticDescriptor().templateBindings).toHaveLength(3);
  });

  it('rejects missing required template bindings', () => {
    const dataset = roadwayMaterialization();
    delete dataset.templates.geometryToGraph;
    const validation = DatasetDefinitionRegistry.validateDataset(dataset, 'roadway');

    expect(validation.valid).toBe(false);
    expect(validation.diagnostics.some((item) => item.code === 'required-template-missing')).toBe(true);
  });
  it('materializes generated operator output through the Dataset factory', () => {
    const dataset = createRoadwayHazardStateDataset([
      {
        time: 0,
        roadwayEdgeId: 'E1',
        hazardType: 'fire',
        hazardValue: 0.8,
        severity: 'high',
        passability: 'blocked',
        scenarioId: 'scenario-1'
      }
    ], { generatedBy: 'Unit test' });
    const validation = DatasetDefinitionRegistry.validateDataset(dataset, 'roadway-hazard-state');

    expect(validation.valid).toBe(true);
    expect(dataset.type).toBe('RoadwayHazardStateDataset');
    expect(dataset.getBlockedEdges(0)).toEqual(['E1']);
    expect(dataset.metadata.generatedBy).toBe('Unit test');
  });

});
