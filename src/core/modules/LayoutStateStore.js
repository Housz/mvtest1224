function hashText(value = '') {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function graphLayoutIdentity(graph) {
  const nodes = (graph?.nodes || [])
    .map((node) => `${node.id}:${node.typeId || node.kind || ''}`)
    .sort()
    .join('|');
  const edges = (graph?.edges || [])
    .map((edge) => `${edge.from?.nodeId}:${edge.from?.portId}>${edge.to?.nodeId}:${edge.to?.portId}`)
    .sort()
    .join('|');
  return hashText(`${nodes}#${edges}`);
}

export function previewViewportClass(width = window.innerWidth) {
  if (width >= 1400) return 'wide';
  if (width >= 1100) return 'medium';
  return 'compact';
}

export class LayoutStateStore {
  constructor(prefix = 'minevis.preview.layout.v6') {
    this.prefix = prefix;
  }

  key({ graphId = 'graph', workspaceId = 'workspace', viewportClass = previewViewportClass() } = {}) {
    return `${this.prefix}:${graphId}:${workspaceId}:${viewportClass}`;
  }

  load(scope) {
    try {
      const raw = localStorage.getItem(this.key(scope));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn('[MineVis layout] Failed to read saved workspace layout.', error);
      return null;
    }
  }

  save(scope, state) {
    if (!state) return;
    try {
      localStorage.setItem(this.key(scope), JSON.stringify(state));
    } catch (error) {
      console.warn('[MineVis layout] Failed to save workspace layout.', error);
    }
  }

  clear(scope) {
    try {
      localStorage.removeItem(this.key(scope));
    } catch (error) {
      console.warn('[MineVis layout] Failed to clear workspace layout.', error);
    }
  }
}
