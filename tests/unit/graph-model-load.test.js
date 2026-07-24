import { describe, expect, it } from 'vitest';
import { GRAPH_SCHEMA_VERSION, GraphModel } from '../../src/core/graph/GraphModel.js';

function definition(typeId, createRuntime = () => ({})) {
  return {
    typeId,
    kind: 'data',
    label: typeId,
    defaultParams: {},
    ports: [],
    createRuntime
  };
}

function graphDocument(typeId = 'StableNode') {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      {
        id: 'node-1',
        typeId,
        label: typeId,
        position: { x: 10, y: 20 },
        params: {},
        ports: []
      }
    ],
    edges: [],
    view: { panX: 5, panY: 6, zoom: 1.2 }
  };
}

describe('GraphModel transactional loading', () => {
  it('preserves the current graph when schema migration fails', () => {
    const stable = definition('StableNode');
    const graph = new GraphModel({ get: (typeId) => (typeId === stable.typeId ? stable : null) });
    graph.load(graphDocument());
    const before = graph.serialize();

    expect(() =>
      graph.load({
        ...graphDocument(),
        schemaVersion: GRAPH_SCHEMA_VERSION + 1
      })
    ).toThrow('newer than supported');
    expect(graph.serialize()).toBe(before);
  });

  it('preserves the current graph when runtime construction fails', () => {
    const stable = definition('StableNode');
    const broken = definition('BrokenNode', () => {
      throw new Error('Runtime construction failed.');
    });
    const definitions = new Map([
      [stable.typeId, stable],
      [broken.typeId, broken]
    ]);
    const graph = new GraphModel({ get: (typeId) => definitions.get(typeId) || null });
    graph.load(graphDocument());
    const before = graph.serialize();

    expect(() => graph.load(graphDocument('BrokenNode'))).toThrow('Runtime construction failed.');
    expect(graph.serialize()).toBe(before);
  });
});