export class NodeRegistry {
  constructor() {
    this.constructors = new Map();
  }

  register(type, ctor) {
    this.constructors.set(type, ctor);
  }

  create(type, position, config = {}) {
    const ctor = this.constructors.get(type);
    if (!ctor) throw new Error(`Unknown node type ${type}`);
    return new ctor(position, config);
  }
}
