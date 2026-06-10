import { escapeHtml } from './RuntimeControls.js';

export const legendRow = (label, color) =>
  `<div class="legend-row"><span class="legend-dot" style="background:${escapeHtml(color)}"></span><span>${escapeHtml(label)}</span></div>`;
