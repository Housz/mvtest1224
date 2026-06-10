import { sampleColor } from '../../../utils/colors.js';
import {
  escapeHtml,
  formatScalar,
  formRow,
  numberRow,
  optionList,
  panelSection as section,
  selectRow,
  sliderRow,
  toggleRow as toggle
} from '../../../ui/RuntimeControls.js';

const optionalFiniteNumber = (value) => {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function attributeDistributionControlsHtml(runtime, { compact = false } = {}) {
  const attributes = runtime.inputs.attributeModel?.listAttributes?.() || [];
  const active = runtime.getActiveAttribute?.() || '';
  const layerOptions = runtime.attributeLayerFilterOptions?.() || [];
  const stats = runtime.attributeStats || runtime.computeAttributeState().stats;
  const explicitMin = optionalFiniteNumber(runtime.params.minValue);
  const explicitMax = optionalFiniteNumber(runtime.params.maxValue);
  const useManualRange = runtime.params.valueRangeMode === 'manual' && (explicitMin != null || explicitMax != null);
  const min = useManualRange ? explicitMin ?? stats.range.min : stats.range.min;
  const max = useManualRange ? explicitMax ?? stats.range.max : stats.range.max;
  return `
    <div class="geology-analysis-form">
      ${section('Attribute', `<div class="geology-form-grid">
        ${selectRow({ label: 'Attribute', attr: 'data-attribute-param="activeAttribute"', value: active, options: attributes })}
        ${layerOptions.length > 1 ? formRow('Layer / seam', `<select data-attribute-param="seamFilter">${layerOptions
          .map((option) => `<option value="${escapeHtml(option.value)}" ${String(runtime.params.seamFilter || 'all') === String(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
          .join('')}</select>`) : ''}
        ${selectRow({ label: 'Colormap', attr: 'data-attribute-param="colormap"', value: runtime.params.colormap, options: ['viridis', 'heat', 'rainbow'] })}
        ${selectRow({ label: 'Filter mode', attr: 'data-attribute-param="filterMode"', value: runtime.params.filterMode, options: ['highlight', 'selected-only', 'hide-filtered'] })}
        ${selectRow({ label: 'Render mode', attr: 'data-volume-setting="blockRenderMode"', value: runtime.inputs.attributeModel?.grid ? (runtime.getVolumeRenderMode?.() || 'volume') : (runtime.params.blockRenderMode || 'interpolated-surface'), options: runtime.inputs.attributeModel?.grid ? ['volume', 'isosurface', 'points'] : ['interpolated-surface', 'points', 'sampled-boxes'] })}
      </div>`)}
      ${section('Range / Rendering', `<div class="geology-form-grid">
        ${numberRow({ label: 'Min', attr: 'data-attribute-param="minValue"', value: formatScalar(min, 4), step: 0.001 })}
        ${numberRow({ label: 'Max', attr: 'data-attribute-param="maxValue"', value: formatScalar(max, 4), step: 0.001 })}
        ${numberRow({ label: 'Max elements', attr: 'data-attribute-param="maxRenderedElements"', value: runtime.params.maxRenderedElements, min: 100, step: 100 })}
      </div>
      <div class="geology-control-stack compact">
        ${sliderRow({ label: 'Layer opacity', attr: 'data-attribute-param', key: 'attributeLayerOpacity', value: runtime.params.attributeLayerOpacity, min: 0.05, max: 1, step: 0.05, digits: 2 })}
      </div>
      ${runtime.inputs.attributeModel?.grid && runtime.volumeControlsHtml ? runtime.volumeControlsHtml() : ''}`)}
      ${section('Visible Context', `<div class="geology-toggle-grid">
        ${toggle({ label: 'Histogram', attr: 'data-attribute-param="showHistogram"', checked: runtime.params.showHistogram })}
        ${toggle({ label: 'Target zone', attr: 'data-attribute-param="showTargetZone"', checked: runtime.params.showTargetZone })}
        ${toggle({ label: 'Context', attr: 'data-attribute-param="showContextElements"', checked: runtime.params.showContextElements })}
        ${toggle({ label: 'Geological body', attr: 'data-attribute-param="showGeologicalBodyContext"', checked: runtime.params.showGeologicalBodyContext })}
        ${toggle({ label: 'Roadway', attr: 'data-attribute-param="showRoadwayContext"', checked: runtime.params.showRoadwayContext })}
        ${toggle({ label: 'Structures', attr: 'data-attribute-param="showStructureContext"', checked: runtime.params.showStructureContext })}
      </div>`)}
      ${compact ? '' : '<div class="geology-form-actions"><button type="button" data-attribute-reset-range>Reset range</button></div>'}
    </div>`;
}

export function attributeHistogramHtml(runtime) {
  const stats = runtime.attributeStats || runtime.computeAttributeState().stats;
  const values = stats.values || [];
  if (!values.length) return '<div class="empty-state">No numeric values available for this attribute.</div>';
  const bins = 24;
  const counts = Array.from({ length: bins }, () => 0);
  values.forEach((value) => {
    const t = (value - stats.range.min) / (stats.range.max - stats.range.min || 1);
    counts[Math.max(0, Math.min(bins - 1, Math.floor(t * bins)))] += 1;
  });
  const width = 720;
  const height = 220;
  const chartLeft = 46;
  const chartTop = 18;
  const chartWidth = width - chartLeft - 24;
  const chartHeight = 142;
  const maxCount = Math.max(...counts, 1);
  const filterMinT = Math.max(0, Math.min(1, (stats.filterMin - stats.range.min) / (stats.range.max - stats.range.min || 1)));
  const filterMaxT = Math.max(0, Math.min(1, (stats.filterMax - stats.range.min) / (stats.range.max - stats.range.min || 1)));
  const brushX = chartLeft + Math.min(filterMinT, filterMaxT) * chartWidth;
  const brushWidth = Math.max(1, Math.abs(filterMaxT - filterMinT) * chartWidth);
  const minHandleX = chartLeft + filterMinT * chartWidth;
  const maxHandleX = chartLeft + filterMaxT * chartWidth;
  const bars = counts.map((count, index) => {
    const x = chartLeft + (index / bins) * chartWidth;
    const w = chartWidth / bins - 2;
    const h = (count / maxCount) * chartHeight;
    const t = (index + 0.5) / bins;
    const selected = t >= Math.min(filterMinT, filterMaxT) && t <= Math.max(filterMinT, filterMaxT);
    return `<rect x="${x}" y="${chartTop + chartHeight - h}" width="${w}" height="${h}" fill="${sampleColor(runtime.params.colormap || 'viridis', t)}" opacity="${selected ? '0.95' : '0.28'}" />`;
  }).join('');
  return `
    <div class="attribute-histogram-content">
      <svg class="attribute-histogram-svg" data-attribute-histogram data-view-width="${width}" data-chart-left="${chartLeft}" data-chart-width="${chartWidth}" viewBox="0 0 ${width} ${height}" role="img">
        <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#101722" />
        <text x="16" y="22" font-size="11" fill="#a7b4c5">Count</text>
        <text x="${chartLeft}" y="${height - 18}" font-size="11" fill="#a7b4c5">${formatScalar(stats.range.min)}</text>
        <text x="${width - 96}" y="${height - 18}" font-size="11" fill="#a7b4c5">${formatScalar(stats.range.max)}</text>
        <line x1="${chartLeft}" y1="${chartTop + chartHeight}" x2="${chartLeft + chartWidth}" y2="${chartTop + chartHeight}" stroke="#526074" />
        ${bars}
        <rect data-histogram-brush-area x="${chartLeft}" y="${chartTop}" width="${chartWidth}" height="${chartHeight}" fill="transparent" style="cursor:crosshair" />
        <rect data-histogram-selection x="${brushX}" y="${chartTop}" width="${brushWidth}" height="${chartHeight}" fill="#facc15" opacity="0.12" stroke="#facc15" stroke-width="2" style="pointer-events:none" />
        <line data-histogram-handle-line="min" x1="${minHandleX}" y1="${chartTop - 4}" x2="${minHandleX}" y2="${chartTop + chartHeight + 4}" stroke="#facc15" stroke-width="2" style="pointer-events:none" />
        <line data-histogram-handle-line="max" x1="${maxHandleX}" y1="${chartTop - 4}" x2="${maxHandleX}" y2="${chartTop + chartHeight + 4}" stroke="#facc15" stroke-width="2" style="pointer-events:none" />
        <rect data-histogram-handle="min" x="${minHandleX - 5}" y="${chartTop + chartHeight - 22}" width="10" height="28" rx="4" fill="#facc15" opacity="0.95" style="cursor:ew-resize" />
        <rect data-histogram-handle="max" x="${maxHandleX - 5}" y="${chartTop - 6}" width="10" height="28" rx="4" fill="#facc15" opacity="0.95" style="cursor:ew-resize" />
        <text data-histogram-range-label x="${chartLeft}" y="${height - 44}" font-size="12" fill="#d7dde7">${escapeHtml(stats.active)}: ${formatScalar(stats.filterMin)} - ${formatScalar(stats.filterMax)}</text>
        <text data-histogram-filtered-label x="${chartLeft + 260}" y="${height - 44}" font-size="12" fill="#d7dde7">Filtered ${stats.filteredCount} / ${stats.count}</text>
      </svg>
    </div>`;
}

export function roadwayGeologyControlsHtml(runtime, { compact = false } = {}) {
  const attributes = runtime.inputs.attributeModel?.listAttributes?.() || [];
  const units = [...new Set((runtime.relationResult?.relations || []).map((relation) => relation.dominantGeologicalUnit).filter(Boolean))];
  return `
    <div class="geology-analysis-form">
      ${section('Analysis', `<div class="geology-form-grid">
        ${selectRow({ label: 'Analysis mode', attr: 'data-rg-param="analysisMode"', value: runtime.params.analysisMode, options: ['risk-level', 'geological-unit', 'structure-proximity', 'attribute-sampling'] })}
        ${selectRow({ label: 'Color mode', attr: 'data-rg-param="colorMode"', value: runtime.params.colorMode, options: ['risk-level', 'geological-unit', 'structure-distance', 'active-attribute', 'uniform'] })}
        ${selectRow({ label: 'Active attribute', attr: 'data-rg-param="activeAttribute"', value: runtime.params.activeAttribute, options: attributes, includeNone: true })}
      </div>`)}
      ${section('Thresholds', `<div class="geology-form-grid">
        ${numberRow({ label: 'Warning distance', attr: 'data-rg-param="structureWarningDistance"', value: runtime.params.structureWarningDistance })}
        ${numberRow({ label: 'Critical distance', attr: 'data-rg-param="structureCriticalDistance"', value: runtime.params.structureCriticalDistance })}
        ${numberRow({ label: 'Attribute threshold', attr: 'data-rg-param="attributeThreshold"', value: runtime.params.attributeThreshold ?? '' })}
        ${formRow('Risk direction', `<select data-rg-param="attributeRiskDirection">
          <option value="high" ${runtime.params.attributeRiskDirection === 'high' ? 'selected' : ''}>high is risky</option>
          <option value="low" ${runtime.params.attributeRiskDirection === 'low' ? 'selected' : ''}>low is risky</option>
        </select>`)}
        ${numberRow({ label: 'Sample interval', attr: 'data-rg-param="sampleInterval"', value: runtime.params.sampleInterval })}
      </div>`)}
      ${section('Filters', `<div class="geology-form-grid">
        ${selectRow({ label: 'Risk filter', attr: 'data-rg-param="filterRiskLevel"', value: runtime.params.filterRiskLevel, options: ['all', 'low', 'medium', 'high'] })}
        ${formRow('Unit filter', `<select data-rg-param="filterGeologicalUnit"><option value="all">all</option>${optionList(units, runtime.params.filterGeologicalUnit)}</select>`)}
      </div>`)}
      ${section('Visible Context', `<div class="geology-toggle-grid">
        ${toggle({ label: 'Roadway overlay', attr: 'data-rg-param="showRoadwayOverlay"', checked: runtime.params.showRoadwayOverlay })}
        ${toggle({ label: 'Geological body', attr: 'data-rg-param="showGeologicalBodyContext"', checked: runtime.params.showGeologicalBodyContext })}
        ${toggle({ label: 'Structures', attr: 'data-rg-param="showStructures"', checked: runtime.params.showStructures })}
        ${toggle({ label: 'Boreholes', attr: 'data-rg-param="showBoreholes"', checked: runtime.params.showBoreholes })}
        ${toggle({ label: 'Profile', attr: 'data-rg-param="showProfile"', checked: runtime.params.showProfile })}
      </div>`)}
      ${compact ? '' : '<div class="geology-form-actions"><button type="button" data-rg-create-section>Create Section Near Selected Roadway</button></div>'}
    </div>`;
}

export function roadwayGeologyTableHtml(runtime) {
  const rows = runtime.filteredRelations().slice().sort((a, b) => b.riskScore - a.riskScore || (a.distanceToStructure ?? Infinity) - (b.distanceToStructure ?? Infinity));
  return `
    <div class="relation-table-header">
      <span>Edge</span>
      <span>Risk</span>
      <span>Structure</span>
      <span>Attribute</span>
    </div>
    <div class="scroll-list relation-table">
      ${rows.map((relation) => `
        <button type="button" class="relation-row ${runtime.selected?.id === relation.edgeId ? 'selected' : ''}" data-rg-edge="${escapeHtml(relation.edgeId)}">
          <span>${escapeHtml(relation.edgeId)}</span>
          <span>${escapeHtml(relation.riskLevel)}</span>
          <span>${relation.distanceToStructure == null ? '-' : `${formatScalar(relation.distanceToStructure, 1)} m`}</span>
          <span>${relation.activeAttributeValue == null ? '-' : formatScalar(relation.activeAttributeValue, 3)}</span>
        </button>`).join('')}
    </div>
    ${runtime.selected ? runtime.detailRowsHtml(runtime.selected.id) : '<div class="empty-state">Select a roadway segment to inspect details.</div>'}`;
}
