import { escapeHtml } from './RuntimeControls.js';

const MARKERS = new Set(['swatch', 'dot', 'line']);

export const legendItem = ({
  label,
  color,
  marker = 'swatch',
  meta = '',
  className = ''
} = {}) => {
  const markerType = MARKERS.has(marker) ? marker : 'swatch';
  const markerClass = markerType === 'line' ? 'legend-line' : markerType === 'dot' ? 'legend-dot' : 'legend-swatch';
  return `
    <div class="legend-row ${escapeHtml(className)}">
      <span class="${markerClass}" style="background:${escapeHtml(color)}" aria-hidden="true"></span>
      <span class="legend-label">${escapeHtml(label)}</span>
      ${meta ? `<span class="legend-meta">${escapeHtml(meta)}</span>` : ''}
    </div>
  `;
};

export const legendRow = (label, color, options = {}) =>
  legendItem({ label, color, ...options });

export const legendList = (items = [], { title = '', className = '' } = {}) => `
  <section class="runtime-legend ${escapeHtml(className)}">
    ${title ? `<div class="runtime-legend-section-title">${escapeHtml(title)}</div>` : ''}
    <div class="runtime-legend-list">
      ${items.map((item) => legendItem(item)).join('')}
    </div>
  </section>
`;

export const legendGradient = ({
  label,
  gradient,
  range = '',
  className = ''
} = {}) => `
  <div class="runtime-legend-gradient ${escapeHtml(className)}">
    <span class="runtime-legend-gradient-label">${escapeHtml(label)}</span>
    <span class="runtime-legend-gradient-range">${escapeHtml(range)}</span>
    <span class="runtime-legend-gradient-bar" style="background:${escapeHtml(gradient)}" aria-hidden="true"></span>
  </div>
`;

export const legendEmptyState = (message = 'No legend entries') =>
  `<div class="empty-state">${escapeHtml(message)}</div>`;
