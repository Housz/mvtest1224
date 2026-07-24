const scheduleFrame = (callback) => (
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 0)
);

const cancelFrame = (handle) => {
  if (!handle) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
};

const CONTENT_PROFILES = new Set(['scene', 'canvas', 'chart', 'form', 'table', 'mixed']);

function normalizeContent(content = {}) {
  const profile = CONTENT_PROFILES.has(content.profile) ? content.profile : 'form';
  return {
    profile,
    padding: content.padding || (['scene', 'canvas', 'chart'].includes(profile) ? 'none' : 'compact'),
    overflow: content.overflow || (['scene', 'canvas', 'chart'].includes(profile) ? 'hidden' : 'auto')
  };
}

function disposeSubscription(subscription) {
  if (typeof subscription === 'function') subscription();
  else subscription?.dispose?.();
}

function emitResize(element, detail) {
  element?.dispatchEvent?.(new CustomEvent('minevis:panel-resize', { detail }));
  element?.querySelectorAll?.('canvas, svg, .chart-host, .echarts-container').forEach((child) => {
    child.dispatchEvent(new CustomEvent('minevis:panel-resize', { detail }));
  });
}

/**
 * The only layout-facing host for visual-contribution content.
 * Dockview owns window geometry; this host owns mounting, activation and one
 * ResizeObserver per panel.
 */
export class PanelContentHost {
  constructor({ id, element, stagingElement = null, onResize = null, content = {} }) {
    this.id = id;
    this.element = element;
    this.stagingElement = stagingElement;
    this.onResize = onResize;
    this.content = normalizeContent(content);
    this.host = null;
    this.active = false;
    this.visible = true;
    this.location = null;
    this.frame = 0;
    this.retryTimer = 0;
    this.locationSubscription = null;
    this.observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.requestResize('observer'))
      : null;
  }

  update({ element = this.element, onResize = this.onResize, content = this.content } = {}) {
    if (element !== this.element && this.element?.parentElement === this.host) this.element.remove();
    this.element = element;
    this.onResize = onResize;
    this.content = normalizeContent(content);
    this.applyContentProfile();
    this.prepareInteractiveContent();
    this.requestResize('update');
  }

  applyContentProfile() {
    if (!this.element) return;
    [...CONTENT_PROFILES].forEach((profile) => {
      this.element.classList.toggle(`workspace-content-${profile}`, this.content.profile === profile);
    });
    this.element.dataset.contentProfile = this.content.profile;
    this.element.dataset.contentPadding = this.content.padding;
    this.element.dataset.contentOverflow = this.content.overflow;
  }

  prepareInteractiveContent() {
    this.element?.querySelectorAll?.('canvas, svg').forEach((view) => {
      view.style.pointerEvents = 'auto';
      view.style.touchAction = 'none';
    });
  }

  mount(host, params = null) {
    if (!host || !this.element) return false;
    if (this.host && this.host !== host) this.observer?.unobserve(this.host);
    this.host = host;
    host.replaceChildren(this.element);
    this.element.classList.add('workspace-panel-mounted');
    this.element.dataset.workspacePanelId = this.id;
    this.element.style.removeProperty('display');
    this.applyContentProfile();
    this.prepareInteractiveContent();
    this.observer?.observe(host);
    disposeSubscription(this.locationSubscription);
    this.locationSubscription = params?.api?.onDidLocationChange?.((event) => {
      this.locationChanged(event?.location || params.api.location);
    }) || null;
    this.visibilityChanged(true);
    this.requestResize('mount');
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.requestResize('settled'), 80);
    return true;
  }

  unmount(host = this.host) {
    disposeSubscription(this.locationSubscription);
    this.locationSubscription = null;
    if (host) this.observer?.unobserve(host);
    if (this.element && host?.contains?.(this.element)) {
      this.element.classList.remove('workspace-panel-mounted', 'workspace-panel-active');
      this.stagingElement?.appendChild(this.element);
    }
    if (host === this.host) this.host = null;
  }

  activate() {
    if (!this.active) {
      this.active = true;
      this.element?.classList.add('workspace-panel-active');
      this.element?.dispatchEvent?.(new CustomEvent('minevis:panel-activate'));
    }
    this.requestResize('activate');
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.element?.classList.remove('workspace-panel-active');
    this.element?.dispatchEvent?.(new CustomEvent('minevis:panel-deactivate'));
  }

  visibilityChanged(visible) {
    const next = Boolean(visible);
    if (!next && this.element?.contains?.(document.activeElement)) {
      this.element.closest('.runtime-shell')?.focus?.({ preventScroll: true });
    }
    this.visible = next;
    if (this.element) {
      this.element.dataset.panelVisible = String(next);
      this.element.inert = !next;
      this.element.dispatchEvent(new CustomEvent('minevis:panel-visibility-change', {
        detail: { visible: next }
      }));
    }
    if (next) this.requestResize('visible');
  }

  locationChanged(location) {
    this.location = location || null;
    this.element?.dispatchEvent?.(new CustomEvent('minevis:panel-location-change', {
      detail: { location: this.location }
    }));
    this.requestResize('location');
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.requestResize('location-settled'), 80);
  }

  requestResize(reason = 'layout') {
    if (this.frame || !this.visible) return;
    this.frame = scheduleFrame(() => {
      this.frame = 0;
      this.resize(reason);
    });
  }

  resize(reason = 'layout') {
    if (!this.host?.isConnected || !this.visible) return false;
    const rect = this.host.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    this.prepareInteractiveContent();
    const detail = {
      width: rect.width,
      height: rect.height,
      devicePixelRatio: window.devicePixelRatio || 1,
      reason,
      location: this.location,
      active: this.active,
      profile: this.content.profile
    };
    this.onResize?.(detail);
    emitResize(this.element, detail);
    return true;
  }

  dispose() {
    cancelFrame(this.frame);
    clearTimeout(this.retryTimer);
    disposeSubscription(this.locationSubscription);
    this.locationSubscription = null;
    this.observer?.disconnect();
    this.element?.classList.remove(
      'workspace-panel-mounted',
      'workspace-panel-active',
      ...[...CONTENT_PROFILES].map((profile) => `workspace-content-${profile}`)
    );
    this.host = null;
    this.frame = 0;
    this.retryTimer = 0;
  }
}

export { normalizeContent as normalizePanelContent };
