export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export const formatScalar = (value, digits = 2) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits).replace(/\.?0+$/, '') : '-';
};

export const optionList = (values = [], selected, labelFor = (value) => value) =>
  values
    .map((value) => `<option value="${escapeHtml(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(labelFor(value))}</option>`)
    .join('');

export const formRow = (label, controlHtml, className = 'geology-form-row') =>
  `<label class="${className}"><span>${escapeHtml(label)}</span>${controlHtml}</label>`;

export const selectRow = ({ label, attr, value, options = [], includeNone = false, noneLabel = 'None' }) =>
  formRow(
    label,
    `<select ${attr}>${includeNone ? `<option value="">${escapeHtml(noneLabel)}</option>` : ''}${optionList(options, value)}</select>`
  );

export const numberRow = ({ label, attr, value, min = null, max = null, step = null }) =>
  formRow(
    label,
    `<input type="number" ${min == null ? '' : `min="${escapeHtml(min)}"`} ${max == null ? '' : `max="${escapeHtml(max)}"`} ${step == null ? '' : `step="${escapeHtml(step)}"`} ${attr} value="${escapeHtml(value ?? '')}">`
  );

export const toggleRow = ({ label, attr, checked }) =>
  `<label class="geology-toggle-row"><input type="checkbox" ${attr} ${checked ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`;

export const sliderRow = ({ label, attr, key, value, min, max, step, digits = 2 }) => {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : Number(min) || 0;
  const display = numeric.toFixed(digits).replace(/\.?0+$/, '');
  return `
    <label class="geology-slider-row">
      <span class="geology-slider-label">${escapeHtml(label)}</span>
      <input class="geology-slider" ${attr}="${escapeHtml(key)}" type="range" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}" value="${escapeHtml(numeric)}">
      <input class="geology-value-input" ${attr}="${escapeHtml(key)}" type="number" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}" value="${escapeHtml(display)}" inputmode="decimal">
    </label>
  `;
};

export const panelSection = (title, body) => `
  <section class="geology-form-section">
    <div class="geology-form-section-title">${escapeHtml(title)}</div>
    ${body}
  </section>
`;

export const emptyState = (message) => `<div class="empty-state">${escapeHtml(message)}</div>`;
