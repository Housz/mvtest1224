import { describe, expect, it } from 'vitest';
import {
  DataTemplate,
  GeometryTemplate,
  GraphTemplate,
  RegistryTemplate
} from '../../src/core/semantics/DataTemplates.js';
import { DataTemplateRegistry } from '../../src/core/semantics/DataTemplateRegistry.js';

describe('Data Template contracts', () => {
  it('registers the six paper-level template kinds', () => {
    expect(DataTemplateRegistry.list().map((item) => item.kind)).toEqual([
      'Geometry',
      'Graph',
      'Registry',
      'State',
      'Field',
      'Relation'
    ]);
  });

  it('validates graph incidence and registry identity', () => {
    const graph = new GraphTemplate({
      id: 'graph',
      data: {
        nodes: [{ id: 'N1' }],
        edges: [{ id: 'E1', source: 'N1', target: 'N2' }]
      }
    });
    const registry = new RegistryTemplate({
      id: 'registry',
      data: { entities: [{ sensorId: 'S1' }, { sensorId: 'S1' }] },
      metadata: { keyRole: 'sensorId' }
    });

    expect(graph.validate().valid).toBe(true);
    expect(graph.validate().warnings).toContain('Graph edge 0 references an unknown node.');
    expect(registry.validate().valid).toBe(false);
    expect(registry.validate().errors[0]).toContain('duplicate values');
  });

  it('reports empty spatial templates without throwing', () => {
    const geometry = new GeometryTemplate({ id: 'geometry', data: {} });
    const generic = new DataTemplate({ id: 'generic', type: 'Geometry', data: {} });

    expect(geometry.validate().warnings).toContain('Geometry template has no declared spatial support.');
    expect(generic.validate().valid).toBe(true);
  });
});
