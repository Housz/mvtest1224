let nodeId = 0;

export class NodeBase {
  constructor(type, label, position = { x: 60, y: 60 }, config = {}) {
    this.id = `${type}-${nodeId++}`;
    this.type = type;
    this.label = label;
    this.position = position;
    this.config = config;
  }

  serialize() {
    return {
      id: this.id,
      type: this.type,
      position: this.position,
      config: this.config
    };
  }
}
