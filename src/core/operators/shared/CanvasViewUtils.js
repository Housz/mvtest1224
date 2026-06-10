export function resizeCanvasToDisplaySize(canvas, fallbackWidth = 640, fallbackHeight = 360) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round((canvas.clientWidth || fallbackWidth) * dpr));
  const height = Math.max(1, Math.round((canvas.clientHeight || fallbackHeight) * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: width / dpr, height: height / dpr, dpr };
}
