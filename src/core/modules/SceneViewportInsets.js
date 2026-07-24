const EMPTY_INSETS = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  safeRect: { x: 0, y: 0, width: 1, height: 1 }
});

export class SceneViewportInsets {
  constructor({
    workspaceElement,
    sceneManager,
    layoutService,
    systemChromeService = null,
    toolbarElement = null
  }) {
    this.workspaceElement = workspaceElement;
    this.sceneManager = sceneManager;
    this.layoutService = layoutService;
    this.systemChromeService = systemChromeService;
    this.toolbarElement = toolbarElement;
    this.frame = 0;
    this.unsubscribe = layoutService?.subscribeLayout?.(() => this.requestUpdate()) || null;
    this.chromeUnsubscribe = systemChromeService?.subscribe?.(() => this.requestUpdate()) || null;
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.requestUpdate())
      : null;
    if (workspaceElement) this.resizeObserver?.observe(workspaceElement);
    if (toolbarElement) this.resizeObserver?.observe(toolbarElement);
    this.requestUpdate();
  }

  requestUpdate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  update() {
    const rootRect = this.workspaceElement?.getBoundingClientRect?.();
    if (!rootRect?.width || !rootRect?.height) {
      this.sceneManager?.setViewportInsets?.(EMPTY_INSETS);
      return EMPTY_INSETS;
    }
    let top = 0;
    let left = 0;
    let right = 0;
    let bottom = 0;
    const tolerance = 12;
    const toolbarRect = this.toolbarElement?.getBoundingClientRect?.();
    if (toolbarRect?.height) top = Math.max(0, toolbarRect.bottom - rootRect.top + 6);
    const occludingRects = [
      ...(this.layoutService?.getOccludingRects?.(this.workspaceElement) || []),
      ...(this.systemChromeService?.getOccludingRects?.() || [])
    ];
    occludingRects.forEach((rect) => {
      if (!rect || rect.width < 1 || rect.height < 1) return;
      const localLeft = rect.left - rootRect.left;
      const localRight = rootRect.right - rect.right;
      const localTop = rect.top - rootRect.top;
      const localBottom = rootRect.bottom - rect.bottom;
      if (localLeft <= tolerance) left = Math.max(left, rect.right - rootRect.left + 6);
      if (localRight <= tolerance) right = Math.max(right, rootRect.right - rect.left + 6);
      if (localBottom <= tolerance) bottom = Math.max(bottom, rootRect.bottom - rect.top + 6);
      if (localTop <= tolerance) top = Math.max(top, rect.bottom - rootRect.top + 6);
    });
    left = Math.min(left, rootRect.width * 0.45);
    right = Math.min(right, rootRect.width * 0.45);
    top = Math.min(top, rootRect.height * 0.35);
    bottom = Math.min(bottom, rootRect.height * 0.55);
    const safeRect = {
      x: left,
      y: top,
      width: Math.max(1, rootRect.width - left - right),
      height: Math.max(1, rootRect.height - top - bottom)
    };
    const insets = { top, right, bottom, left, safeRect };
    this.sceneManager?.setViewportInsets?.(insets);
    return insets;
  }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.unsubscribe?.();
    this.chromeUnsubscribe?.();
    this.resizeObserver?.disconnect();
  }
}
