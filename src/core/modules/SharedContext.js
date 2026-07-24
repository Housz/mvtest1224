import {
  canonicalContextKey,
  canonicalizeContextKeys,
  isSelectionContextKey
} from './ContextKeyRegistry.js';

function defaultEquals(left, right) {
  return Object.is(left, right);
}

export class SharedContext {
  constructor(initial = {}, {
    allowedKeys = null,
    equals = defaultEquals,
    workspaceId = ''
  } = {}) {
    this.workspaceId = workspaceId;
    this.allowedKeys = allowedKeys ? new Set(canonicalizeContextKeys(allowedKeys)) : null;
    this.equals = equals;
    this.entries = new Map();
    this.listeners = new Map();
    this.anyListeners = new Set();
    this.revision = 0;
    this.batchDepth = 0;
    this.pending = new Map();
    this.warnedUndeclaredKeys = new Set();
    Object.entries(initial).forEach(([key, value]) => {
      const canonicalKey = canonicalContextKey(key);
      this.entries.set(canonicalKey, { value, revision: 0, source: 'initial' });
    });
  }

  has(key) {
    return this.entries.has(canonicalContextKey(key));
  }

  get(key) {
    return this.entries.get(canonicalContextKey(key))?.value;
  }

  getEntry(key) {
    const entry = this.entries.get(canonicalContextKey(key));
    return entry ? { ...entry } : null;
  }

  snapshot(keys = null) {
    const selectedKeys = keys ? canonicalizeContextKeys(keys) : [...this.entries.keys()];
    return Object.fromEntries(selectedKeys.map((key) => [key, this.get(key)]));
  }

  isAllowed(key) {
    return !this.allowedKeys || this.allowedKeys.has(canonicalContextKey(key));
  }

  allowedSelectionKeys() {
    const keys = this.allowedKeys || new Set(this.entries.keys());
    return [...keys].filter(isSelectionContextKey);
  }

  set(key, value, options = {}) {
    const canonicalKey = canonicalContextKey(key);
    if (!this.isAllowed(canonicalKey) && !options.allowUndeclared) {
      if (!this.warnedUndeclaredKeys.has(canonicalKey)) {
        this.warnedUndeclaredKeys.add(canonicalKey);
        console.warn(
          'Shared context key ' + canonicalKey +
          ' is not declared for workspace ' + (this.workspaceId || '<unknown>') + '.'
        );
      }
      return false;
    }
    const previous = this.entries.get(canonicalKey);
    const equals = options.equals || this.equals;
    if (!options.force && previous && equals(previous.value, value)) return false;
    this.revision += 1;
    const change = {
      key: canonicalKey,
      value,
      previousValue: previous?.value,
      revision: this.revision,
      source: options.source || 'runtime',
      workspaceId: this.workspaceId
    };
    this.entries.set(canonicalKey, {
      value,
      revision: change.revision,
      source: change.source
    });
    if (this.batchDepth) this.pending.set(canonicalKey, change);
    else this.notify(change);
    return true;
  }

  update(values, options = {}) {
    return this.batch(() => {
      Object.entries(values || {}).forEach(([key, value]) => this.set(key, value, options));
    }, options);
  }

  batch(callback, options = {}) {
    this.batchDepth += 1;
    try {
      return callback();
    } finally {
      this.batchDepth -= 1;
      if (!this.batchDepth && this.pending.size) {
        const changes = [...this.pending.values()];
        this.pending.clear();
        changes.forEach((change) => this.notify({ ...change, batchSource: options.source }));
      }
    }
  }

  subscribe(key, listener, { immediate = false } = {}) {
    const canonicalKey = canonicalContextKey(key);
    if (!this.listeners.has(canonicalKey)) this.listeners.set(canonicalKey, new Set());
    this.listeners.get(canonicalKey).add(listener);
    if (immediate && this.entries.has(canonicalKey)) {
      const entry = this.entries.get(canonicalKey);
      listener(entry.value, {
        key: canonicalKey,
        value: entry.value,
        previousValue: undefined,
        revision: entry.revision,
        source: entry.source,
        workspaceId: this.workspaceId
      });
    }
    return () => {
      this.listeners.get(canonicalKey)?.delete(listener);
      if (!this.listeners.get(canonicalKey)?.size) this.listeners.delete(canonicalKey);
    };
  }

  subscribeMany(keys, listener, options = {}) {
    const canonicalKeys = canonicalizeContextKeys(keys);
    const disposers = canonicalKeys.map((key) => this.subscribe(
      key,
      (value, change) => listener(this.snapshot(canonicalKeys), change),
      options
    ));
    return () => disposers.forEach((dispose) => dispose());
  }

  subscribeAll(listener) {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  notify(change) {
    (this.listeners.get(change.key) || []).forEach((listener) => listener(change.value, change));
    this.anyListeners.forEach((listener) => listener(change));
  }

  clear({ notify = false, source = 'clear' } = {}) {
    if (!notify) {
      this.entries.clear();
      return;
    }
    this.batch(() => {
      [...this.entries.keys()].forEach((key) => this.set(key, undefined, { source, force: true }));
    }, { source });
  }

  clearDeclaredSelection({ source = 'workspace-blank-pick', keys = null } = {}) {
    const allowed = new Set(this.allowedSelectionKeys());
    const selectedKeys = keys
      ? canonicalizeContextKeys(keys).filter((key) => allowed.has(key))
      : [...allowed];
    return this.batch(() => {
      selectedKeys.forEach((key) => this.set(key, null, { source }));
    }, { source });
  }
}
