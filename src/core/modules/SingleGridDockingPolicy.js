const ALL_DOCK_TARGETS = Object.freeze(['left', 'right', 'top', 'bottom', 'center', 'floating']);
const EDGE_POSITIONS = Object.freeze(['left', 'right', 'top', 'bottom']);

export class SingleGridDockingPolicy {
  constructor(service) {
    this.service = service;
  }

  recordsForGroup(group) {
    return (group?.panels || [])
      .map((panel) => this.service.getRecord(panel.id))
      .filter(Boolean);
  }

  canDrag(record) {
    return Boolean(record && record.layout?.dockable !== false);
  }

  canDragGroup(group) {
    const records = this.recordsForGroup(group);
    return Boolean(records.length && records.every((record) => this.canDrag(record)));
  }

  isCompatible({ record, sourceGroup, targetGroup = null, position, scope = 'group' }) {
    if (!this.canDrag(record) || !ALL_DOCK_TARGETS.includes(position)) return false;
    if (scope === 'workspace') return EDGE_POSITIONS.includes(position);
    if (!targetGroup || position === 'floating') return false;
    const sameGroup = sourceGroup?.id === targetGroup.id;
    if (!sameGroup) return true;
    if (position === 'center') return false;
    return (sourceGroup?.panels || []).length > 1;
  }

  hintRect({ targetGroup = null, position, scope = 'group' }) {
    const workspace = this.service.getWorkspaceBounds();
    if (!workspace?.width || !workspace?.height) return null;
    const box = scope === 'workspace'
      ? { x: 0, y: 0, width: workspace.width, height: workspace.height }
      : this.service.getGroupBounds(targetGroup);
    if (!box?.width || !box?.height) return null;
    if (position === 'center') return { ...box };
    const share = scope === 'workspace' ? 0.24 : 0.5;
    if (position === 'left') return { x: box.x, y: box.y, width: box.width * share, height: box.height };
    if (position === 'right') {
      const width = box.width * share;
      return { x: box.x + box.width - width, y: box.y, width, height: box.height };
    }
    if (position === 'top') return { x: box.x, y: box.y, width: box.width, height: box.height * share };
    if (position === 'bottom') {
      const height = box.height * share;
      return { x: box.x, y: box.y + box.height - height, width: box.width, height };
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
    if (scope === 'workspace') return this.service.moveSourceToRootEdge(source, position);
    source.api.moveTo({ group: targetGroup, position });
    this.service.noteDockingOperation();
    return true;
  }
}

export { ALL_DOCK_TARGETS, EDGE_POSITIONS };
