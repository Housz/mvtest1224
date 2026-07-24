import { describe, expect, it, vi } from 'vitest';
import { SharedContext } from '../../src/core/modules/SharedContext.js';
import {
  SelectionSetController,
  chartPresentationFromParams,
  selectionPresentationForCount
} from '../../src/core/selection/SelectionSetController.js';

function createContext() {
  return new SharedContext({}, {
    allowedKeys: ['selection', 'selectionSet', 'hoveredSelection', 'selectedSensor']
  });
}

describe('SelectionSetController', () => {
  it('keeps the comparison set and legacy primary selection synchronized', () => {
    const context = createContext();
    const controller = new SelectionSetController({
      context,
      type: 'sensor',
      primaryContextKey: 'selectedSensor',
      maxItems: 8
    });

    controller.replace('S01');
    controller.add('S04');
    controller.setPrimary('S01');

    expect(controller.getState()).toEqual({
      type: 'sensor',
      ids: ['S01', 'S04'],
      primaryId: 'S01'
    });
    expect(context.get('selectionSet')).toEqual(controller.getState());
    expect(context.get('selectedSensor')).toBe('S01');
    expect(context.get('selection')).toEqual({ type: 'sensor', id: 'S01' });

    controller.dispose();
  });

  it('supports toggle and ordered range selection with a stable primary', () => {
    const controller = new SelectionSetController({
      context: createContext(),
      type: 'sensor',
      primaryContextKey: 'selectedSensor',
      maxItems: 8
    });

    controller.replace('S01');
    controller.selectRange(['S01', 'S02', 'S03', 'S04'], 'S03', { additive: false });
    expect(controller.getState()).toEqual({
      type: 'sensor',
      ids: ['S01', 'S02', 'S03'],
      primaryId: 'S03'
    });

    controller.toggle('S02');
    expect(controller.getState().ids).toEqual(['S01', 'S03']);
    expect(controller.getState().primaryId).toBe('S03');
  });

  it('enforces the comparison limit without silently dropping members', () => {
    const onLimit = vi.fn();
    const controller = new SelectionSetController({
      context: createContext(),
      type: 'sensor',
      primaryContextKey: 'selectedSensor',
      maxItems: 2,
      onLimit
    });

    controller.replace('S01');
    controller.add('S02');
    expect(controller.add('S03')).toBe(false);
    expect(controller.getState().ids).toEqual(['S01', 'S02']);
    expect(onLimit).toHaveBeenCalledWith(expect.objectContaining({ id: 'S03', limit: 2 }));
  });

  it('keeps entity colors stable while primary selection changes', () => {
    const controller = new SelectionSetController({
      context: createContext(),
      type: 'sensor',
      primaryContextKey: 'selectedSensor'
    });

    controller.replace('S01');
    controller.add('S02');
    const before = controller.colorsFor();
    controller.setPrimary('S01');
    expect(controller.colorsFor()).toEqual(before);
    expect(before.S01).not.toBe(before.S02);
  });
});

describe('chart comparison compatibility', () => {
  it('maps legacy chartMode values to the new presentation model', () => {
    expect(chartPresentationFromParams({ chartMode: 'overlay' })).toBe('docked');
    expect(chartPresentationFromParams({ chartMode: 'billboard' })).toBe('world-billboard');
    expect(chartPresentationFromParams({ chartPresentation: 'scene-callout' })).toBe('scene-callout');
  });

  it('uses small multiples for five or more series or mixed units', () => {
    expect(selectionPresentationForCount(4, 'auto', ['m/s'])).toBe('superimposed');
    expect(selectionPresentationForCount(5, 'auto', ['m/s'])).toBe('small-multiples');
    expect(selectionPresentationForCount(2, 'auto', ['m/s', 'Pa'])).toBe('small-multiples');
    expect(selectionPresentationForCount(8, 'superimposed', ['m/s'])).toBe('superimposed');
  });
});
