// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { normalizeSingleGridLayout } from '../../src/core/modules/SingleGridContributionLayoutPolicy.js';

describe('single-grid contribution content profiles', () => {
  it('maps ECharts contributions to the fill chart profile', () => {
    const element = document.createElement('section');
    const chart = document.createElement('div');
    chart.className = 'chart-panel';
    element.appendChild(chart);

    const layout = normalizeSingleGridLayout({ type: 'chart', element });

    expect(layout.role).toBe('primary-view');
    expect(layout.content).toEqual(expect.objectContaining({
      profile: 'chart',
      padding: 'none',
      overflow: 'hidden'
    }));
  });

  it('maps canvas views and legends to their shared profiles', () => {
    const canvasPanel = document.createElement('section');
    canvasPanel.appendChild(document.createElement('canvas'));

    expect(normalizeSingleGridLayout({ type: 'panel', element: canvasPanel }).content.profile).toBe('canvas');
    expect(normalizeSingleGridLayout({ type: 'legend' }).content.profile).toBe('table');
  });
});
