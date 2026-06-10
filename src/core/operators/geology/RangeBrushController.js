export function startRangeBrushDrag(event, {
  update,
  preview,
  commit,
  shouldStart = null,
  preventDefault = true,
  stopPropagation = true
} = {}) {
  if (!event || (event.button != null && event.button !== 0)) return false;
  if (shouldStart && !shouldStart(event)) return false;
  if (preventDefault) event.preventDefault();
  if (stopPropagation) {
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  }

  let latestPayload = null;
  let frame = 0;
  let frameIsTimeout = false;
  const schedulePreview = (payload) => {
    latestPayload = payload;
    if (frame) return;
    const run = () => {
      frame = 0;
      preview?.(latestPayload);
    };
    if (window.requestAnimationFrame) {
      frameIsTimeout = false;
      frame = window.requestAnimationFrame(run);
    } else {
      frameIsTimeout = true;
      frame = window.setTimeout(run, 16);
    }
  };
  const cancelPreview = () => {
    if (!frame) return;
    if (frameIsTimeout) window.clearTimeout?.(frame);
    else window.cancelAnimationFrame?.(frame);
    frame = 0;
  };
  const apply = (pointerEvent, phase) => {
    const payload = update?.(pointerEvent, phase);
    if (!payload) return;
    if (phase === 'commit') {
      cancelPreview();
      commit?.({ ...payload, phase });
    } else {
      schedulePreview({ ...payload, phase });
    }
  };
  const onMove = (pointerEvent) => apply(pointerEvent, 'preview');
  const onUp = (pointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    apply(pointerEvent, 'commit');
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
  apply(event, 'preview');
  return true;
}
