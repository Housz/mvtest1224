import { describe, expect, it } from 'vitest';
import { listBuiltInGraphs } from '../../src/core/graph/BuiltInGraphRegistry.js';

const EXPECTED_PRESETS = [
  ['Emergency_Response.json', 9, 11, 'PersonnelEmergencyAnalysisOperator'],
  ['Environmental_Monitoring.json', 11, 12, 'RoadwayTemperatureAnalysisOperator'],
  ['Geological Analysis.json', 12, 16, 'GeologicalModelOverviewOperator'],
  ['Ventilation_Analysis.json', 8, 15, 'VentilationNetworkOverviewOperator']
];

describe('BuiltInGraphRegistry', () => {
  it('discovers all representative graph JSON files in deterministic filename order', () => {
    const graphs = listBuiltInGraphs();
    expect(graphs.map((graph) => graph.name)).toEqual(EXPECTED_PRESETS.map(([name]) => name));
    graphs.forEach(({ document }, index) => {
      expect(document.nodes).toHaveLength(EXPECTED_PRESETS[index][1]);
      expect(document.edges).toHaveLength(EXPECTED_PRESETS[index][2]);
      expect(document.nodes.map((node) => node.typeId)).toContain(EXPECTED_PRESETS[index][3]);
    });
  });

  it('returns isolated graph documents', () => {
    const first = listBuiltInGraphs();
    first[0].document.nodes.length = 0;
    expect(listBuiltInGraphs()[0].document.nodes).toHaveLength(9);
  });

  it('keeps all preset Modules and operator families semantically distinct', () => {
    const graphs = listBuiltInGraphs();
    const moduleLabels = graphs.map(({ document }) => document.nodes.find((node) => node.kind === 'module')?.label);
    expect(new Set(moduleLabels).size).toBe(graphs.length);
    const operatorSets = graphs.map(({ document }) => new Set(
      document.nodes.filter((node) => node.kind === 'operator').map((node) => node.typeId)
    ));
    operatorSets.forEach((operators, index) => {
      expect(operators.has(EXPECTED_PRESETS[index][3])).toBe(true);
    });
  });

  it('keeps built-in presets lean by referencing bundled data instead of embedding source payloads', () => {
    listBuiltInGraphs().forEach(({ name, document }) => {
      document.nodes.forEach((node) => {
        Object.values(node.params?.sources || {}).forEach((source) => {
          expect(source.text || '', `${name}: ${node.label} embeds source text`).toBe('');
          if (source.path) {
            expect(source.path, `${name}: ${node.label} uses a non-deployable source path`)
              .toMatch(/^\/data\//);
          }
        });
      });
    });
  });
});
