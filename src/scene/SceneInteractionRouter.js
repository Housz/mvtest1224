const DEFAULT_PRIORITY = 0;

/**
 * Routes scene interactions to owner-scoped handlers without allowing one
 * operator to overwrite another operator's callback.
 */
export class SceneInteractionRouter {
  constructor() {
    this.handlers = new Map();
    this.activeOwnerId = null;
    this.sequence = 0;
  }

  register(type, ownerId, handler, { priority = DEFAULT_PRIORITY } = {}) {
    if (!type || !ownerId || typeof handler !== 'function') return () => {};
    const key = String(type);
    const ownerKey = String(ownerId);
    const entries = this.handlers.get(key) || new Map();
    const token = Symbol(`${key}:${ownerKey}`);
    entries.set(token, {
      token,
      ownerId: ownerKey,
      handler,
      priority: Number(priority) || DEFAULT_PRIORITY,
      sequence: ++this.sequence
    });
    this.handlers.set(key, entries);
    return () => {
      const current = this.handlers.get(key);
      current?.delete(token);
      if (!current?.size) this.handlers.delete(key);
    };
  }

  setActiveOwner(ownerId) {
    this.activeOwnerId = ownerId == null ? null : String(ownerId);
  }

  dispatch(type, ...args) {
    const entries = [...(this.handlers.get(String(type))?.values() || [])];
    if (!entries.length) return false;
    entries.sort((left, right) => {
      const leftActive = left.ownerId === this.activeOwnerId ? 1 : 0;
      const rightActive = right.ownerId === this.activeOwnerId ? 1 : 0;
      return (rightActive - leftActive) ||
        (right.priority - left.priority) ||
        (right.sequence - left.sequence);
    });
    for (const entry of entries) {
      if (entry.handler(...args) !== false) return true;
    }
    return false;
  }

  clearOwner(ownerId) {
    const ownerKey = String(ownerId);
    this.handlers.forEach((entries, type) => {
      for (const [token, entry] of entries) {
        if (entry.ownerId === ownerKey) entries.delete(token);
      }
      if (!entries.size) this.handlers.delete(type);
    });
    if (this.activeOwnerId === ownerKey) this.activeOwnerId = null;
  }

  clear() {
    this.handlers.clear();
    this.activeOwnerId = null;
  }
}
