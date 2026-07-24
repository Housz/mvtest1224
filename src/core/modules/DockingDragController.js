const DRAG_THRESHOLD_PX = 5;

const distance = (left, right) => Math.hypot(right.x - left.x, right.y - left.y);
const point = (event) => ({ x: event.clientX, y: event.clientY });

function listen(target, type, listener, options) {
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
}

export class DockingDragController {
  constructor({ service, overlay, policy, threshold = DRAG_THRESHOLD_PX }) {
    this.service = service;
    this.overlay = overlay;
    this.policy = policy;
    this.threshold = threshold;
    this.pending = null;
    this.drag = null;
    this.suppressClickUntil = 0;
    this.overlayFrame = 0;
    this.overlayPoint = null;
    this.disposers = [
      listen(service.container, 'pointerdown', (event) => this.handleWorkspacePointerDown(event), true),
      listen(window, 'pointermove', (event) => this.handlePointerMove(event), true),
      listen(window, 'pointerup', (event) => this.handlePointerUp(event), true),
      listen(window, 'pointercancel', (event) => this.handlePointerCancel(event), true),
      listen(window, 'keydown', (event) => this.handleKeyDown(event), true)
    ];
  }

  startPanelDrag(id, event) {
    if (event.button !== 0 || event.target.closest('button, input, select, textarea, a')) return false;
    const record = this.service.getRecord(id);
    const panel = this.service.api.getPanel?.(id);
    if (!record || !panel || !this.policy.canDrag(record)) return false;
    const group = panel.group;
    const floating = group?.api?.location?.type === 'floating';
    const moveWholeFloatingGroup = floating && (group.panels || []).length === 1;
    const sourceBounds = this.service.getGroupBounds(group);
    const bounds = floating ? sourceBounds : null;
    const workspaceRect = this.service.container.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    this.prepare({
      pointerId: event.pointerId,
      start: point(event),
      record,
      panel: moveWholeFloatingGroup ? null : panel,
      group,
      source: moveWholeFloatingGroup ? 'group' : 'panel',
      title: record.title,
      nativeFloating: moveWholeFloatingGroup,
      previewBounds: sourceBounds,
      initialFloatingBounds: bounds,
      pointerOffset: sourceBounds ? {
        x: event.clientX - workspaceRect.left - sourceBounds.x,
        y: event.clientY - workspaceRect.top - sourceBounds.y
      } : null
    });
    return true;
  }

  handleWorkspacePointerDown(event) {
    if (this.pending || this.drag || event.button !== 0) return;
    const voidHeader = event.target.closest('.dv-void-container, .dv-tabs-and-actions-container');
    if (!voidHeader || event.target.closest('.dv-tab, button, input, select, textarea, a')) return;
    const group = this.service.groupForElement(voidHeader.closest('.dv-groupview'));
    const record = this.service.recordForGroup(group);
    if (!record || !this.policy.canDragGroup(group)) return;
    const floating = group.api?.location?.type === 'floating';
    const sourceBounds = this.service.getGroupBounds(group);
    const bounds = floating ? sourceBounds : null;
    const workspaceRect = this.service.container.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    this.prepare({
      pointerId: event.pointerId,
      start: point(event),
      record,
      panel: null,
      group,
      source: 'group',
      title: group.activePanel?.title || record.title,
      nativeFloating: floating,
      previewBounds: sourceBounds,
      initialFloatingBounds: bounds,
      pointerOffset: sourceBounds ? {
        x: event.clientX - workspaceRect.left - sourceBounds.x,
        y: event.clientY - workspaceRect.top - sourceBounds.y
      } : null
    });
  }

  prepare(candidate) {
    this.cancel({ restore: false });
    this.pending = { ...candidate, last: candidate.start };
    this.service.container.classList.add('workspace-panel-drag-pending');
  }

  scheduleOverlayUpdate(clientX, clientY) {
    this.overlayPoint = { clientX, clientY };
    if (this.overlayFrame) return;
    this.overlayFrame = requestAnimationFrame(() => {
      this.overlayFrame = 0;
      const next = this.overlayPoint;
      this.overlayPoint = null;
      if (next && this.drag) this.overlay.update(next.clientX, next.clientY);
    });
  }

  flushOverlayUpdate(clientX, clientY) {
    if (this.overlayFrame) cancelAnimationFrame(this.overlayFrame);
    this.overlayFrame = 0;
    this.overlayPoint = null;
    if (this.drag) this.overlay.update(clientX, clientY);
  }

  begin(event) {
    if (!this.pending) return;
    this.drag = this.pending;
    this.pending = null;
    this.drag.last = point(event);
    this.service.container.classList.remove('workspace-panel-drag-pending');
    this.service.container.classList.add('workspace-panel-drag-active');
    document.documentElement.classList.add('minevis-docking-drag-active');
    this.overlay.show(this.drag);
    this.scheduleOverlayUpdate(event.clientX, event.clientY);
  }

  handlePointerMove(event) {
    const candidate = this.drag || this.pending;
    if (!candidate || event.pointerId !== candidate.pointerId) return;
    candidate.last = point(event);
    if (!this.drag && distance(candidate.start, candidate.last) >= this.threshold) this.begin(event);
    if (!this.drag) return;
    event.preventDefault();
    event.stopPropagation();
    this.scheduleOverlayUpdate(event.clientX, event.clientY);
  }

  handlePointerUp(event) {
    const candidate = this.drag || this.pending;
    if (!candidate || event.pointerId !== candidate.pointerId) return;
    if (!this.drag) {
      this.cancel({ restore: false });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.finish(event);
  }

  finish(event) {
    const drag = this.drag;
    this.flushOverlayUpdate(event.clientX, event.clientY);
    const target = this.overlay.currentTarget;
    let changed = false;
    try {
      if (target) {
        changed = this.service.transaction('dock-drop', () => this.policy.dock({
          panel: drag.source === 'panel' ? drag.panel : null,
          group: drag.source === 'group' ? drag.group : null,
          targetGroup: target.group,
          position: target.position,
          scope: target.scope
        }));
      } else if (drag.record.layout?.floatable !== false) {
        changed = this.service.transaction('float-drop', () => this.service.floatDragAtPointer(drag, event));
      }
    } catch (error) {
      console.warn('[MineVis docking] Drop operation failed.', error);
    } finally {
      this.suppressClickUntil = performance.now() + 250;
      this.cleanupDrag();
      if (changed) this.service.handleLayoutChange();
    }
  }

  handlePointerCancel(event) {
    const candidate = this.drag || this.pending;
    if (!candidate || event.pointerId !== candidate.pointerId) return;
    this.cancel({ restore: true });
  }

  handleKeyDown(event) {
    if (event.key !== 'Escape' || (!this.drag && !this.pending)) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel({ restore: true });
  }

  cancel() {
    this.cleanupDrag();
  }

  cleanupDrag() {
    if (this.overlayFrame) cancelAnimationFrame(this.overlayFrame);
    this.overlayFrame = 0;
    this.overlayPoint = null;
    this.pending = null;
    this.drag = null;
    this.overlay.hide();
    this.service.container.classList.remove('workspace-panel-drag-pending', 'workspace-panel-drag-active');
    document.documentElement.classList.remove('minevis-docking-drag-active');
  }

  shouldSuppressClick() {
    return performance.now() < this.suppressClickUntil;
  }

  dispose() {
    this.cancel();
    this.disposers.forEach((dispose) => dispose());
    this.disposers = [];
  }
}

export { DRAG_THRESHOLD_PX };
