export class WorkspaceHostRegistry {
  constructor() {
    this.hosts = new Map();
  }

  register(id, host) {
    if (!id || !host) throw new Error('Workspace host registration requires id and host.');
    this.hosts.set(id, host);
    return host;
  }

  unregister(id) {
    this.hosts.delete(id);
  }

  get(id) {
    return this.hosts.get(id) || null;
  }

  require(id) {
    const host = this.get(id);
    if (!host) throw new Error(`Workspace host is not registered: ${id}.`);
    return host;
  }

  list() {
    return [...this.hosts.entries()].map(([id, host]) => ({ id, host }));
  }

  registerDefaults({
    scene,
    rightPanel,
    bottomPanel = null,
    topologyView = null,
    legend = null,
    timeline = null
  }) {
    if (scene) this.register('main-3d-scene', scene);
    if (rightPanel) {
      this.register('right-panel', rightPanel);
      this.register('control', rightPanel);
    }
    if (bottomPanel) this.register('bottom-panel', bottomPanel);
    if (topologyView) this.register('topology-view', topologyView);
    if (legend) this.register('legend', legend);
    if (timeline) this.register('timeline', timeline);
    return this;
  }
}
