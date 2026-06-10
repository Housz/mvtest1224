import { escapeHtml } from './RuntimeControls.js';

export const tableHeader = (columns = []) =>
  `<div class="runtime-table-header">${columns.map((column) => `<span>${escapeHtml(column)}</span>`).join('')}</div>`;

export const tableRow = (cells = [], { selected = false, attrs = '' } = {}) =>
  `<button type="button" class="runtime-table-row${selected ? ' selected' : ''}" ${attrs}>${cells.map((cell) => `<span>${escapeHtml(cell ?? '-')}</span>`).join('')}</button>`;
