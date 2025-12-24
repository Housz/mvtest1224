/**
 * Registry describing available node kinds, ports and runtime creation.
 */
export class NodeDefinitionRegistry {
  constructor() {
    this.defs = new Map();
  }

  register(def) {
    this.defs.set(def.typeId, def);
  }

  get(typeId) {
    return this.defs.get(typeId);
  }

  list() {
    return Array.from(this.defs.values());
  }
}
