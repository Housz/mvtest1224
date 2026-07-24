// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedPanelContentHost } from '../../src/core/modules/UnifiedPanelContentHost.js';

describe('UnifiedPanelContentHost', () => {
  let observers;
  let originalResizeObserver;

  beforeEach(() => {
    observers = [];
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.unobserve = vi.fn();
        this.disconnect = vi.fn();
        observers.push(this);
      }
    };
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('owns one observer and applies a fill chart profile', () => {
    const staging = document.createElement('div');
    const dockHost = document.createElement('div');
    const panel = document.createElement('section');
    const chart = document.createElement('div');
    chart.className = 'chart-panel';
    panel.appendChild(chart);
    document.body.append(staging, dockHost);
    vi.spyOn(dockHost, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 320, width: 640, height: 320
    });
    const onResize = vi.fn();
    const resizeEvent = vi.fn();
    chart.addEventListener('minevis:panel-resize', resizeEvent);
    const host = new UnifiedPanelContentHost({
      id: 'chart',
      element: panel,
      stagingElement: staging,
      onResize,
      content: { profile: 'chart', padding: 'none', overflow: 'hidden' }
    });

    expect(observers).toHaveLength(1);
    host.mount(dockHost);
    host.activate();
    expect(panel.parentElement).toBe(dockHost);
    expect(panel.dataset.contentProfile).toBe('chart');
    expect(panel.dataset.contentPadding).toBe('none');
    expect(panel.classList.contains('workspace-content-chart')).toBe(true);
    expect(host.resize('test')).toBe(true);
    expect(onResize).toHaveBeenCalledWith(expect.objectContaining({ width: 640, height: 320, profile: 'chart' }));
    expect(resizeEvent).toHaveBeenCalledTimes(1);

    host.unmount();
    expect(panel.parentElement).toBe(staging);
    host.dispose();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
