import { describe, expect, it, vi } from 'vitest';
import { SourceAdaptorRegistry } from '../../src/core/adaptors/SourceAdaptorRegistry.js';

describe('SourceAdaptorRegistry', () => {
  it('wraps legacy supports/load adaptors with canLoad and inspect', async () => {
    const registry = new SourceAdaptorRegistry();
    const load = vi.fn(async () => ({
      kind: 'table',
      fields: ['id', 'value'],
      summary: { rowCount: 2 },
      suggestedRoleMapping: { id: 'id' }
    }));

    const adaptor = registry.register({
      id: 'LegacyTableAdaptor',
      label: 'Legacy table',
      supports: (source) => source?.name?.endsWith('.legacy'),
      load
    });

    expect(adaptor.canLoad({ name: 'sample.legacy' })).toBe(true);
    expect(adaptor.supports({ name: 'sample.legacy' })).toBe(true);
    expect(registry.infer({ name: 'sample.legacy' })?.id).toBe('LegacyTableAdaptor');

    const preview = await registry.inspect({ name: 'sample.legacy' });
    expect(preview).toMatchObject({
      adaptorId: 'LegacyTableAdaptor',
      kind: 'table',
      fields: ['id', 'value'],
      summary: { rowCount: 2 }
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it('preserves a modern canLoad/load/inspect adaptor contract', async () => {
    const registry = new SourceAdaptorRegistry();
    const inspect = vi.fn(async () => ({
      kind: 'binary grid',
      fields: ['grade'],
      summary: { elementCount: 4 }
    }));
    registry.register({
      id: 'ModernGridAdaptor',
      label: 'Modern grid',
      canLoad: (source) => source?.name?.endsWith('.grid'),
      load: async () => ({ kind: 'binary grid', values: [1, 2, 3, 4] }),
      inspect
    });

    const source = { name: 'sample.grid' };
    expect(registry.get('ModernGridAdaptor').supports(source)).toBe(true);
    expect(await registry.inspect(source)).toMatchObject({
      adaptorId: 'ModernGridAdaptor',
      fields: ['grade'],
      summary: { elementCount: 4 }
    });
    expect(inspect).toHaveBeenCalledOnce();
  });

  it('falls back to a configured path when serialized source text is empty', async () => {
    const registry = new SourceAdaptorRegistry();
    const load = vi.fn(async (source) => ({ kind: 'table', source }));
    registry.register({
      id: 'PathFallbackAdaptor',
      label: 'Path fallback',
      canLoad: (source) => source?.path?.endsWith('.csv'),
      load
    });

    const result = await registry.load({ path: '/data/sample.csv', text: '' });
    expect(result.source.path).toBe('/data/sample.csv');
    expect(result.source).not.toHaveProperty('text');
    expect(load).toHaveBeenCalledOnce();
  });
});
