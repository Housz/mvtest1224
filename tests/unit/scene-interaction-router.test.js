import { describe, expect, it, vi } from 'vitest';
import { SceneInteractionRouter } from '../../src/scene/SceneInteractionRouter.js';

describe('SceneInteractionRouter', () => {
  it('routes to the active owner without callback overwrite chains', () => {
    const router = new SceneInteractionRouter();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    router.register('sensor', 'first', first);
    router.register('sensor', 'second', second);
    router.setActiveOwner('first');

    expect(router.dispatch('sensor', 'S01')).toBe(true);
    expect(first).toHaveBeenCalledWith('S01');
    expect(second).not.toHaveBeenCalled();
  });

  it('falls through handlers that explicitly decline an interaction', () => {
    const router = new SceneInteractionRouter();
    const passive = vi.fn(() => false);
    const handler = vi.fn(() => true);
    router.register('roadway', 'passive', passive);
    router.register('roadway', 'handler', handler);
    router.setActiveOwner('passive');

    expect(router.dispatch('roadway', { id: 'E01' })).toBe(true);
    expect(passive).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('removes only the disposing owner and keeps other Functions interactive', () => {
    const router = new SceneInteractionRouter();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const disposeFirst = router.register('ventilation-branch', 'first', first);
    router.register('ventilation-branch', 'second', second);
    router.setActiveOwner('first');
    disposeFirst();

    expect(router.dispatch('ventilation-branch', 'B01')).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('B01');
  });
});
