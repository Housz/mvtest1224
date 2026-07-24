const ALL_DOCK_TARGETS = Object.freeze(['left', 'right', 'top', 'bottom', 'center', 'floating']);
const EDGE_POSITIONS = Object.freeze(['left', 'right', 'top', 'bottom']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class DockingPolicy {
  constructor(service, { minimumDocumentShare = 0.45 } = {}) {
    this.service = service;
    this.minimumDocumentShare = minimumDocumentShare;
  }

  recordZone(record) {
    return record?.layout?.zone || (record?.layout?.role === 'primary-view' ? 'document' : 'tool');
  }

  recordsForGroup(group) {
    return (group?.panels || [])
      .map((panel) => this.service.getRecord(panel.id))
      .filter(Boolean);
  }

  groupZone(group) {
    const records = this.recordsForGroup(group);
    return records.some((record) => this.recordZone(record) === 'document') ? 'document' : 'tool';
  }

  allowedDock(record) {
    const configured = record?.layout?.allowedDock;
    return new Set(Array.isArray(configured) && configured.length ? configured : ALL_DOCK_TARGETS);
  }

  canDrag(record) {
    return Boolean(record && record.layout?.dockable !== false && !record.layout?.documentRoot);
  }

  canDragGroup(group) {
    const records = this.recordsForGroup(group);
    return Boolean(records.length && !records.some((record) => record.layout?.documentRoot) &&
      records.every((record) => this.canDrag(record)));
  }

  isCompatible({ record, sourceGroup, targetGroup = null, position, scope = 'group' }) {
    if (!this.canDrag(record) || !this.allowedDock(record).has(position)) return false;
    if (scope === 'workspace') {
      if (!EDGE_POSITIONS.includes(position)) return false;
      if (this.recordZone(record) === 'tool') {
        return this.service.canOpenEdge(position, record, this.minimumDocumentShare);
      }
      return this.service.canSplitDocument(position, record, this.minimumDocumentShare);
    }

    if (!targetGroup || sourceGroup?.id === targetGroup.id && position === 'center') return false;
    const sourceZone = this.recordZone(record);
    const targetZone = this.groupZone(targetGroup);
    if (sourceZone !== targetZone) return false;

    const targetLocation = targetGroup.api?.location?.type;
    if (targetLocation === 'edge' && position !== 'center') return false;
    if (sourceZone === 'tool' && position !== 'center') return false;
    return Boolean(this.hintRect({ record, targetGroup, position, scope }));
  }

  hintRect({ record, targetGroup = null, position, scope = 'group' }) {
    const workspace = this.service.getWorkspaceBounds();
    if (!workspace?.width || !workspace?.height) return null;
    const targetBox = scope === 'workspace'
      ? { x: 0, y: 0, width: workspace.width, height: workspace.height }
      : this.service.getGroupBounds(targetGroup);
    if (!targetBox?.width || !targetBox?.height) return null;
    if (position === 'center') return { ...targetBox };

    const preferred = record?.layout?.preferredSize || {};
    const isWorkspace = scope === 'workspace';
    const splitWidth = isWorkspace
      ? clamp(Number(preferred.width) || targetBox.width * 0.25, 180, targetBox.width * 0.32)
      : targetBox.width * 0.5;
    const splitHeight = isWorkspace
      ? clamp(Number(preferred.height) || targetBox.height * 0.28, 140, targetBox.height * 0.38)
      : targetBox.height * 0.5;

    if (position === 'left') {
      return { x: targetBox.x, y: targetBox.y, width: splitWidth, height: targetBox.height };
    }
    if (position === 'right') {
      return {
        x: targetBox.x + targetBox.width - splitWidth,
        y: targetBox.y,
        width: splitWidth,
        height: targetBox.height
      };
    }
    if (position === 'top') {
      return { x: targetBox.x, y: targetBox.y, width: targetBox.width, height: splitHeight };
    }
    if (position === 'bottom') {
      return {
        x: targetBox.x,
        y: targetBox.y + targetBox.height - splitHeight,
        width: targetBox.width,
        height: splitHeight
      };
    }
    return null;
  }

  targetsFor({ record, sourceGroup, targetGroup = null, scope = 'group' }) {
    return ['left', 'right', 'top', 'bottom', 'center'].filter((position) => this.isCompatible({
      record,
      sourceGroup,
      targetGroup,
      position,
      scope
    }));
  }

  dock({ panel = null, group = null, targetGroup = null, position, scope = 'group' }) {
    const source = panel || group;
    if (!source) return false;
    if (scope === 'workspace') {
      const record = panel
        ? this.service.getRecord(panel.id)
        : this.service.recordForGroup(group);
      if (this.recordZone(record) === 'tool') {
        return this.service.moveSourceToEdge(source, position);
      }
      return this.service.moveSourceToDocumentEdge(source, position);
    }
    source.api.moveTo({ group: targetGroup, position });
    return true;
  }
}

export { ALL_DOCK_TARGETS, EDGE_POSITIONS };
