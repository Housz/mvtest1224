import { escapeHtml } from './RuntimeControls.js';

export const listItemButton = ({ id, title, subtitle = '', selected = false, attrs = '' }) =>
  `<button type="button" class="runtime-list-item${selected ? ' selected' : ''}" data-id="${escapeHtml(id)}" ${attrs}><span>${escapeHtml(title)}</span>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}</button>`;
