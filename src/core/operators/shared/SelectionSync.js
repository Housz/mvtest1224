export function setSelection(context, selection, extra = {}) {
  context?.set?.('selection', selection ?? null);
  Object.entries(extra).forEach(([key, value]) => context?.set?.(key, value));
}
