export const COMPARISON_SERIES_COLORS = Object.freeze([
  '#38bdf8',
  '#f59e0b',
  '#a78bfa',
  '#34d399',
  '#fb7185',
  '#22d3ee',
  '#facc15',
  '#c084fc'
]);

const normalizeId = (value) => {
  if (value == null || value === '') return null;
  return String(value);
};

export function normalizeSelectionSet(value, {
  type,
  maxItems = 8
} = {}) {
  const expectedType = type == null ? null : String(type);
  if (!value || typeof value !== 'object') {
    return { type: expectedType, ids: [], primaryId: null };
  }
  const actualType = value.type == null ? expectedType : String(value.type);
  if (expectedType && actualType !== expectedType) {
    return { type: expectedType, ids: [], primaryId: null };
  }
  const unique = [];
  const seen = new Set();
  for (const rawId of Array.isArray(value.ids) ? value.ids : []) {
    const id = normalizeId(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= Math.max(1, Number(maxItems) || 8)) break;
  }
  const requestedPrimary = normalizeId(value.primaryId);
  const primaryId = requestedPrimary && seen.has(requestedPrimary)
    ? requestedPrimary
    : unique[0] || null;
  return { type: actualType || expectedType, ids: unique, primaryId };
}

export function selectionSetsEqual(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.type !== right.type || left.primaryId !== right.primaryId) return false;
  if (left.ids?.length !== right.ids?.length) return false;
  return left.ids.every((id, index) => id === right.ids[index]);
}

export function selectionPresentationForCount(count, requested = 'auto', units = []) {
  const normalized = String(requested || 'auto');
  if (normalized === 'superimposed' || normalized === 'small-multiples') return normalized;
  const distinctUnits = new Set((units || []).filter(Boolean).map(String));
  if (distinctUnits.size > 1) return 'small-multiples';
  return Number(count) >= 5 ? 'small-multiples' : 'superimposed';
}

export function chartPresentationFromParams(params = {}) {
  if (params.chartPresentation) return String(params.chartPresentation);
  return params.chartMode === 'billboard' ? 'world-billboard' : 'docked';
}

export class SelectionSetController {
  constructor({
    context,
    type,
    selectionType = type,
    primaryContextKey = null,
    maxItems = 8,
    source = `selection-set:${type || 'entity'}`,
    onLimit = null,
    colors = COMPARISON_SERIES_COLORS
  } = {}) {
    if (!context) throw new Error('SelectionSetController requires a shared context.');
    if (!type) throw new Error('SelectionSetController requires an entity type.');
    this.context = context;
    this.type = String(type);
    this.selectionType = String(selectionType || type);
    this.primaryContextKey = primaryContextKey;
    this.maxItems = Math.max(1, Number(maxItems) || 8);
    this.source = source;
    this.onLimit = onLimit;
    this.colors = colors.length ? [...colors] : [...COMPARISON_SERIES_COLORS];
    this.colorAssignments = new Map();
    this.listeners = new Set();
    this.disposers = [];
    this.rangeAnchorId = null;
    this.state = this.initialState();
    this.assignColors(this.state.ids);
    this.installContextSync();
  }

  initialState() {
    const fromSet = normalizeSelectionSet(this.context.get('selectionSet'), {
      type: this.type,
      maxItems: this.maxItems
    });
    if (fromSet.ids.length) return fromSet;
    const selection = this.context.get('selection');
    if (selection?.type === this.selectionType && selection.id != null) {
      const id = String(selection.id);
      return { type: this.type, ids: [id], primaryId: id };
    }
    const typedId = this.primaryContextKey ? normalizeId(this.context.get(this.primaryContextKey)) : null;
    return typedId
      ? { type: this.type, ids: [typedId], primaryId: typedId }
      : { type: this.type, ids: [], primaryId: null };
  }

  installContextSync() {
    this.disposers.push(this.context.subscribe('selectionSet', (value, change) => {
      if (change?.source === this.source) return;
      const next = normalizeSelectionSet(value, { type: this.type, maxItems: this.maxItems });
      if (selectionSetsEqual(this.state, next)) return;
      this.state = next;
      this.assignColors(next.ids);
      this.emit(change);
    }));
    this.disposers.push(this.context.subscribe('selection', (selection, change) => {
      if (change?.source === this.source) return;
      if (!selection) {
        if (this.state.ids.length) this.adopt({ type: this.type, ids: [], primaryId: null }, change);
        return;
      }
      if (selection.type !== this.selectionType || selection.id == null) {
        if (this.state.ids.length) this.adopt({ type: this.type, ids: [], primaryId: null }, change);
        return;
      }
      const id = String(selection.id);
      const ids = this.state.ids.includes(id) ? this.state.ids : [id];
      this.adopt({ type: this.type, ids, primaryId: id }, change);
    }));
    if (this.primaryContextKey) {
      this.disposers.push(this.context.subscribe(this.primaryContextKey, (value, change) => {
        if (change?.source === this.source || value == null) return;
        const id = String(value);
        const ids = this.state.ids.includes(id) ? this.state.ids : [id];
        this.adopt({ type: this.type, ids, primaryId: id }, change);
      }));
    }
  }

  adopt(value, change = null) {
    const next = normalizeSelectionSet(value, { type: this.type, maxItems: this.maxItems });
    if (selectionSetsEqual(this.state, next)) return false;
    this.state = next;
    this.assignColors(next.ids);
    this.emit(change);
    return true;
  }

  getState() {
    return { type: this.state.type, ids: [...this.state.ids], primaryId: this.state.primaryId };
  }

  subscribe(listener, { immediate = false } = {}) {
    this.listeners.add(listener);
    if (immediate) listener(this.getState(), null);
    return () => this.listeners.delete(listener);
  }

  emit(change = null) {
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot, change));
  }

  assignColors(ids = []) {
    const used = new Set(this.colorAssignments.values());
    ids.forEach((id) => {
      if (this.colorAssignments.has(id)) return;
      const available = this.colors.find((color) => !used.has(color));
      const color = available || this.colors[this.colorAssignments.size % this.colors.length];
      this.colorAssignments.set(id, color);
      used.add(color);
    });
  }

  colorFor(id) {
    const normalized = normalizeId(id);
    if (!normalized) return this.colors[0];
    this.assignColors([normalized]);
    return this.colorAssignments.get(normalized);
  }

  colorsFor(ids = this.state.ids) {
    return Object.fromEntries(ids.map((id) => [id, this.colorFor(id)]));
  }

  publish(value, { updateRangeAnchor = true } = {}) {
    const requestedIds = [...new Set(
      (Array.isArray(value?.ids) ? value.ids : []).map(normalizeId).filter(Boolean)
    )];
    if (requestedIds.length > this.maxItems) {
      return this.rejectLimit(requestedIds[this.maxItems]);
    }
    const next = normalizeSelectionSet(value, { type: this.type, maxItems: this.maxItems });
    const changed = !selectionSetsEqual(this.state, next);
    this.state = next;
    this.assignColors(next.ids);
    if (updateRangeAnchor && next.primaryId) this.rangeAnchorId = next.primaryId;
    this.context.batch(() => {
      this.context.set('selectionSet', next.ids.length ? this.getState() : null, {
        source: this.source,
        equals: selectionSetsEqual
      });
      if (this.primaryContextKey) {
        this.context.set(this.primaryContextKey, next.primaryId, { source: this.source });
      }
      this.context.set(
        'selection',
        next.primaryId ? { type: this.selectionType, id: next.primaryId } : null,
        { source: this.source }
      );
    }, { source: this.source });
    if (changed) this.emit({ source: this.source });
    return true;
  }

  rejectLimit(id) {
    this.onLimit?.({ id: normalizeId(id), limit: this.maxItems, state: this.getState() });
    return false;
  }

  replace(id) {
    const normalized = normalizeId(id);
    return this.publish(normalized
      ? { type: this.type, ids: [normalized], primaryId: normalized }
      : { type: this.type, ids: [], primaryId: null });
  }

  add(id, { primary = true } = {}) {
    const normalized = normalizeId(id);
    if (!normalized) return false;
    if (this.state.ids.includes(normalized)) {
      return primary ? this.setPrimary(normalized) : true;
    }
    if (this.state.ids.length >= this.maxItems) return this.rejectLimit(normalized);
    return this.publish({
      type: this.type,
      ids: [...this.state.ids, normalized],
      primaryId: primary ? normalized : this.state.primaryId || normalized
    });
  }

  remove(id) {
    const normalized = normalizeId(id);
    if (!normalized || !this.state.ids.includes(normalized)) return false;
    const ids = this.state.ids.filter((item) => item !== normalized);
    const primaryId = this.state.primaryId === normalized
      ? ids[ids.length - 1] || null
      : this.state.primaryId;
    return this.publish({ type: this.type, ids, primaryId });
  }

  toggle(id) {
    const normalized = normalizeId(id);
    return this.state.ids.includes(normalized) ? this.remove(normalized) : this.add(normalized);
  }

  setPrimary(id) {
    const normalized = normalizeId(id);
    if (!normalized) return false;
    if (!this.state.ids.includes(normalized)) return this.add(normalized);
    return this.publish({ ...this.state, primaryId: normalized });
  }

  selectRange(orderedIds, targetId, { additive = true } = {}) {
    const order = (orderedIds || []).map(normalizeId).filter(Boolean);
    const target = normalizeId(targetId);
    if (!target || !order.includes(target)) return false;
    const anchor = this.rangeAnchorId && order.includes(this.rangeAnchorId)
      ? this.rangeAnchorId
      : this.state.primaryId && order.includes(this.state.primaryId)
        ? this.state.primaryId
        : target;
    const start = order.indexOf(anchor);
    const end = order.indexOf(target);
    const rangeIds = order.slice(Math.min(start, end), Math.max(start, end) + 1);
    const ids = additive
      ? [...this.state.ids, ...rangeIds.filter((id) => !this.state.ids.includes(id))]
      : rangeIds;
    if (ids.length > this.maxItems) return this.rejectLimit(target);
    return this.publish({ type: this.type, ids, primaryId: target });
  }

  applyPointerSelection(id, event = {}, { orderedIds = [], checkbox = false } = {}) {
    if (event.shiftKey && orderedIds.length) {
      return this.selectRange(orderedIds, id, { additive: Boolean(event.ctrlKey || event.metaKey) });
    }
    if (checkbox || event.ctrlKey || event.metaKey) return this.toggle(id);
    if (this.state.ids.includes(String(id))) return this.setPrimary(id);
    return this.replace(id);
  }

  setHovered(id) {
    const normalized = normalizeId(id);
    this.context.set(
      'hoveredSelection',
      normalized ? { type: this.selectionType, id: normalized } : null,
      { source: this.source }
    );
  }

  clear() {
    return this.replace(null);
  }

  dispose() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.listeners.clear();
    const hovered = this.context.get('hoveredSelection');
    if (hovered?.type === this.selectionType) this.setHovered(null);
  }
}
