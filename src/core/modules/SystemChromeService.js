import { previewViewportClass } from './LayoutStateStore.js';

const PANEL_NAMES = Object.freeze(['functions', 'contributions']);
const scheduleFrame = (callback) => (
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 0)
);

function storageAvailable() {
  return typeof localStorage !== 'undefined';
}

export class SystemChromeService {
  constructor({
    shell,
    toolbar,
    panels = {},
    toggles = {},
    scope = {}
  }) {
    this.shell = shell;
    this.toolbar = toolbar;
    this.panels = panels;
    this.toggles = toggles;
    this.scope = {
      graphId: scope.graphId || 'graph',
      workspaceId: scope.workspaceId || 'workspace',
      viewportClass: scope.viewportClass || previewViewportClass()
    };
    this.listeners = new Set();
    this.notificationFrame = 0;
    this.state = this.defaultState();
    this.restore();

    this.handleClick = (event) => {
      const toggle = event.target.closest('[data-system-panel-toggle]');
      if (toggle && PANEL_NAMES.includes(toggle.dataset.systemPanelToggle)) {
        event.preventDefault();
        event.stopPropagation();
        this.toggle(toggle.dataset.systemPanelToggle);
      }
    };
    this.shell?.addEventListener('click', this.handleClick);

    this.handleResize = () => {
      const nextClass = previewViewportClass();
      if (nextClass === this.scope.viewportClass) {
        this.requestNotification();
        return;
      }
      this.setScope({ ...this.scope, viewportClass: nextClass });
    };
    window.addEventListener('resize', this.handleResize);

    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.requestNotification())
      : null;
    [toolbar, ...Object.values(panels)].forEach((element) => {
      if (element) this.resizeObserver?.observe(element);
    });
    this.apply();
  }

  defaultState() {
    const compact = this.scope.viewportClass === 'compact';
    return {
      functionsCollapsed: compact,
      contributionsCollapsed: true
    };
  }

  storageKey() {
    const { graphId, workspaceId, viewportClass } = this.scope;
    return `minevis.preview.chrome.v4:${graphId}:${workspaceId}:${viewportClass}`;
  }

  restore() {
    this.state = this.defaultState();
    if (!storageAvailable()) return;
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey()) || 'null');
      if (!saved || saved.version !== 4) return;
      PANEL_NAMES.forEach((name) => {
        const key = `${name}Collapsed`;
        if (typeof saved[key] === 'boolean') this.state[key] = saved[key];
      });
    } catch (error) {
      console.warn('[MineVis chrome] Failed to restore system UI state.', error);
    }
  }

  save() {
    if (!storageAvailable()) return;
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify({
        version: 4,
        ...this.state
      }));
    } catch (error) {
      console.warn('[MineVis chrome] Failed to save system UI state.', error);
    }
  }

  setScope(scope = {}) {
    this.save();
    this.scope = {
      ...this.scope,
      ...scope,
      viewportClass: scope.viewportClass || this.scope.viewportClass || previewViewportClass()
    };
    this.restore();
    this.apply();
  }

  layoutState() {
    return {
      functionsCollapsed: this.isCollapsed('functions'),
      contributionsCollapsed: this.isCollapsed('contributions')
    };
  }

  applyLayoutState(state = {}) {
    let changed = false;
    PANEL_NAMES.forEach((name) => {
      const key = `${name}Collapsed`;
      if (typeof state[key] !== 'boolean') return;
      const next = Boolean(state[key]);
      if (this.state[key] === next) return;
      this.state[key] = next;
      changed = true;
    });
    if (changed) {
      this.apply();
      this.save();
    }
    return changed;
  }

  isCollapsed(name) {
    return Boolean(this.state[`${name}Collapsed`]);
  }

  isExpanded(name) {
    return !this.isCollapsed(name);
  }

  setCollapsed(name, collapsed) {
    if (!PANEL_NAMES.includes(name)) return false;
    const key = `${name}Collapsed`;
    const next = Boolean(collapsed);
    if (this.state[key] === next) return false;
    this.state[key] = next;
    this.apply();
    this.save();
    return true;
  }

  toggle(name) {
    return this.setCollapsed(name, !this.isCollapsed(name));
  }

  apply() {
    PANEL_NAMES.forEach((name) => {
      const collapsed = this.isCollapsed(name);
      const panel = this.panels[name];
      const toggle = this.toggles[name];
      this.shell?.classList.toggle('system-' + name + '-collapsed', collapsed);
      if (panel) {
        if (collapsed && panel.contains(document.activeElement)) {
          if (toggle) toggle.focus?.();
          else this.shell?.focus?.();
        }
        panel.inert = collapsed;
        panel.hidden = collapsed;
        panel.removeAttribute('aria-hidden');
      }
      if (toggle) {
        const expanded = !collapsed;
        const panelLabel = name === 'functions' ? 'Functions' : 'Visual Contributions';
        const label = (expanded ? 'Hide ' : 'Show ') + panelLabel;
        toggle.classList.toggle('active', expanded);
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-pressed', String(expanded));
        toggle.setAttribute('aria-label', label);
        toggle.title = label;
      }
    });
    this.shell?.style.removeProperty('--preview-system-right-reserve');
    this.requestNotification();
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return {
      ...this.state,
      scope: { ...this.scope },
      occludingRects: this.getOccludingRects()
    };
  }

  requestNotification() {
    if (this.notificationFrame) return;
    this.notificationFrame = scheduleFrame(() => {
      this.notificationFrame = 0;
      const snapshot = this.snapshot();
      this.listeners.forEach((listener) => listener(snapshot));
    });
  }

  visibleSystemElements() {
    return [
      this.toolbar,
      ...PANEL_NAMES
        .filter((name) => this.isExpanded(name))
        .map((name) => this.panels[name])
    ].filter(Boolean);
  }

  getOccludingRects() {
    return this.visibleSystemElements()
      .filter((element) => {
        const style = getComputedStyle(element);
        return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
  }

  reset() {
    if (storageAvailable()) localStorage.removeItem(this.storageKey());
    this.state = this.defaultState();
    this.apply();
  }

  dispose() {
    this.save();
    this.shell?.removeEventListener('click', this.handleClick);
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    if (this.notificationFrame) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.notificationFrame);
      else clearTimeout(this.notificationFrame);
    }
    this.listeners.clear();
  }
}
