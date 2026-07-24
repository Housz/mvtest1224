import { createLucideIcon } from '../../ui/LucideIcons.js';

const GUIDE_META = Object.freeze({
  left: { icon: 'panel-left', label: 'Dock Left' },
  right: { icon: 'panel-right', label: 'Dock Right' },
  top: { icon: 'panel-top', label: 'Dock Top' },
  bottom: { icon: 'panel-bottom', label: 'Dock Bottom' },
  center: { icon: 'panels-top-left', label: 'Add as Tab' }
});

function contains(rect, x, y) {
  return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function clonePanelPreview(element) {
  if (!element) return null;
  const clone = element.cloneNode(true);
  clone.classList.add('workspace-drag-preview-content');
  clone.inert = true;
  clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  clone.querySelectorAll('button, input, select, textarea, a').forEach((node) => {
    node.tabIndex = -1;
  });
  const sourceControls = element.querySelectorAll('input, select, textarea');
  const cloneControls = clone.querySelectorAll('input, select, textarea');
  sourceControls.forEach((source, index) => {
    const target = cloneControls[index];
    if (!target) return;
    if ('checked' in source) target.checked = source.checked;
    if ('value' in source) target.value = source.value;
  });
  const sourceCanvases = element.querySelectorAll('canvas');
  const cloneCanvases = clone.querySelectorAll('canvas');
  sourceCanvases.forEach((source, index) => {
    const target = cloneCanvases[index];
    if (!target) return;
    try {
      target.width = source.width;
      target.height = source.height;
      target.getContext('2d')?.drawImage(source, 0, 0);
    } catch {
      target.classList.add('workspace-drag-preview-canvas-fallback');
    }
  });
  return clone;
}

function makeGuide(position, scope) {
  const meta = GUIDE_META[position];
  const guide = document.createElement('div');
  guide.className = `workspace-dock-guide workspace-dock-guide-${position}`;
  guide.dataset.position = position;
  guide.dataset.scope = scope;
  guide.setAttribute('role', 'presentation');
  guide.setAttribute('aria-label', meta.label);
  guide.title = meta.label;
  guide.appendChild(createLucideIcon(meta.icon, { class: 'workspace-dock-guide-icon' }));
  return guide;
}

export class DockingCompassOverlay {
  constructor({ container, service, policy }) {
    this.container = container;
    this.service = service;
    this.policy = policy;
    this.drag = null;
    this.currentTarget = null;

    this.element = document.createElement('div');
    this.element.className = 'workspace-docking-overlay';
    this.element.hidden = true;

    this.hint = document.createElement('div');
    this.hint.className = 'workspace-docking-hint';
    this.hint.hidden = true;

    this.ghost = document.createElement('div');
    this.ghost.className = 'workspace-drag-ghost';
    this.ghost.hidden = true;
    this.ghostHeader = document.createElement('div');
    this.ghostHeader.className = 'workspace-drag-ghost-header';
    this.ghostBody = document.createElement('div');
    this.ghostBody.className = 'workspace-drag-ghost-body';
    this.ghost.append(this.ghostHeader, this.ghostBody);

    this.edgeGuides = new Map();
    ['left', 'right', 'top', 'bottom'].forEach((position) => {
      const guide = makeGuide(position, 'workspace');
      guide.classList.add('workspace-edge-dock-guide');
      this.edgeGuides.set(position, guide);
      this.element.appendChild(guide);
    });

    this.compass = document.createElement('div');
    this.compass.className = 'workspace-docking-compass';
    this.compass.hidden = true;
    this.compassGuides = new Map();
    ['left', 'right', 'top', 'bottom', 'center'].forEach((position) => {
      const guide = makeGuide(position, 'group');
      this.compassGuides.set(position, guide);
      this.compass.appendChild(guide);
    });
    this.element.append(this.hint, this.compass, this.ghost);
    this.container.appendChild(this.element);
  }

  show(drag) {
    this.drag = drag;
    this.currentTarget = null;
    this.element.hidden = false;
    const bounds = drag.previewBounds || this.service.getGroupBounds(drag.group) || { width: 360, height: 260 };
    const maxWidth = Math.max(240, this.container.clientWidth * 0.58);
    const maxHeight = Math.max(150, this.container.clientHeight * 0.58);
    const width = clamp(bounds.width || 360, 220, Math.min(560, maxWidth));
    const height = clamp(bounds.height || 260, 130, Math.min(380, maxHeight));
    const scaleX = width / Math.max(1, bounds.width || width);
    const scaleY = height / Math.max(1, bounds.height || height);
    const sourceOffset = drag.pointerOffset || { x: 28, y: 14 };
    drag.preview = {
      width,
      height,
      offsetX: clamp(sourceOffset.x * scaleX, 12, Math.max(12, width - 12)),
      offsetY: clamp(sourceOffset.y * scaleY, 10, Math.max(10, height - 10))
    };
    this.ghost.style.width = `${width}px`;
    this.ghost.style.height = `${height}px`;
    this.ghost.hidden = false;
    this.ghostHeader.textContent = drag.title || 'Panel';
    this.ghostBody.replaceChildren();
    const preview = clonePanelPreview(drag.record?.element);
    if (preview) this.ghostBody.appendChild(preview);
    this.edgeGuides.forEach((guide, position) => {
      const enabled = this.policy.isCompatible({
        record: drag.record,
        sourceGroup: drag.group,
        position,
        scope: 'workspace'
      });
      guide.classList.toggle('disabled', !enabled);
    });
  }

  targetGroupAt(clientX, clientY) {
    const group = this.service.groupAtPoint(clientX, clientY);
    if (!group) return null;
    const location = group.api?.location?.type;
    if (location === 'floating' && group.id === this.drag?.group?.id) return null;
    return group;
  }

  renderCompass(targetGroup) {
    if (!targetGroup) {
      this.compass.hidden = true;
      this.compass.dataset.groupId = '';
      return;
    }
    const box = this.service.getGroupBounds(targetGroup);
    if (!box) {
      this.compass.hidden = true;
      return;
    }
    this.compass.hidden = false;
    this.compass.dataset.groupId = targetGroup.id;
    this.compass.style.left = `${box.x + box.width / 2}px`;
    this.compass.style.top = `${box.y + box.height / 2}px`;
    this.compassGuides.forEach((guide, position) => {
      const enabled = this.policy.isCompatible({
        record: this.drag.record,
        sourceGroup: this.drag.group,
        targetGroup,
        position,
        scope: 'group'
      });
      guide.classList.toggle('disabled', !enabled);
      guide.dataset.groupId = targetGroup.id;
    });
  }

  findHoveredGuide(clientX, clientY) {
    const ordered = [
      ...this.compassGuides.values(),
      ...this.edgeGuides.values()
    ];
    return ordered.find((guide) => (
      !guide.hidden &&
      !guide.classList.contains('disabled') &&
      contains(guide.getBoundingClientRect(), clientX, clientY)
    )) || null;
  }

  update(clientX, clientY) {
    if (!this.drag || this.element.hidden) return null;
    const containerRect = this.container.getBoundingClientRect();
    if (!this.ghost.hidden) {
      const preview = this.drag.preview || { width: 260, height: 160, offsetX: 28, offsetY: 14 };
      const x = clamp(
        clientX - containerRect.left - preview.offsetX,
        4,
        Math.max(4, containerRect.width - preview.width - 4)
      );
      const y = clamp(
        clientY - containerRect.top - preview.offsetY,
        4,
        Math.max(4, containerRect.height - preview.height - 4)
      );
      this.ghost.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }

    const targetGroup = this.targetGroupAt(clientX, clientY);
    this.renderCompass(targetGroup);
    const hovered = this.findHoveredGuide(clientX, clientY);
    this.element.querySelectorAll('.workspace-dock-guide.hovered').forEach((guide) => {
      guide.classList.remove('hovered');
    });

    if (!hovered) {
      this.currentTarget = null;
      this.hint.hidden = true;
      return null;
    }

    hovered.classList.add('hovered');
    const scope = hovered.dataset.scope;
    const position = hovered.dataset.position;
    const group = scope === 'group'
      ? this.service.api.getGroup?.(hovered.dataset.groupId)
      : null;
    const hintRect = this.policy.hintRect({
      record: this.drag.record,
      targetGroup: group,
      position,
      scope
    });
    if (!hintRect) {
      this.currentTarget = null;
      this.hint.hidden = true;
      return null;
    }
    this.hint.hidden = false;
    this.hint.style.left = `${hintRect.x}px`;
    this.hint.style.top = `${hintRect.y}px`;
    this.hint.style.width = `${hintRect.width}px`;
    this.hint.style.height = `${hintRect.height}px`;
    this.hint.dataset.position = position;
    this.currentTarget = { scope, position, group, hintRect };
    return this.currentTarget;
  }

  hide() {
    this.drag = null;
    this.currentTarget = null;
    this.element.hidden = true;
    this.hint.hidden = true;
    this.compass.hidden = true;
    this.ghost.hidden = true;
    this.ghost.style.removeProperty('transform');
    this.ghostBody.replaceChildren();
    this.element.querySelectorAll('.workspace-dock-guide.hovered').forEach((guide) => {
      guide.classList.remove('hovered');
    });
  }

  dispose() {
    this.hide();
    this.element.remove();
    this.edgeGuides.clear();
    this.compassGuides.clear();
  }
}
