import * as echarts from 'echarts';
import { selectionPresentationForCount } from '../../core/selection/SelectionSetController.js';

const FALLBACK_WIDTH = 420;
const FALLBACK_HEIGHT = 250;
const MAX_VISIBLE_POINTS = 360;

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function normalizeTimeSeriesPoints(data = []) {
  return (data || [])
    .map((item) => {
      const timeValue = toFiniteNumber(
        item?.timeValue ?? item?.time ?? item?.timestamp ?? item?.date
      );
      const parsedTime = timeValue ?? new Date(
        item?.time ?? item?.timestamp ?? item?.date
      ).getTime();
      const value = toFiniteNumber(item?.value);
      if (!Number.isFinite(parsedTime) || value == null) return null;
      return { ...item, timeValue: parsedTime, value };
    })
    .filter(Boolean)
    .sort((left, right) => left.timeValue - right.timeValue);
}

export function resampleTimeSeries(points = [], maxPoints = MAX_VISIBLE_POINTS) {
  if (points.length <= maxPoints) {
    return points.map((point) => [point.timeValue, point.value]);
  }
  const first = points[0].timeValue;
  const last = points[points.length - 1].timeValue;
  const span = last - first;
  if (!(span > 0)) {
    return points.slice(0, maxPoints).map((point) => [point.timeValue, point.value]);
  }
  const bucketSize = span / Math.max(1, maxPoints - 2);
  const result = [[points[0].timeValue, points[0].value]];
  let bucketStart = first;
  let bucket = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    while (point.timeValue > bucketStart + bucketSize && bucket.length) {
      const minPoint = bucket.reduce((best, item) => item.value < best.value ? item : best, bucket[0]);
      const maxPoint = bucket.reduce((best, item) => item.value > best.value ? item : best, bucket[0]);
      [minPoint, maxPoint]
        .sort((left, right) => left.timeValue - right.timeValue)
        .forEach((item) => result.push([item.timeValue, item.value]));
      bucket = [];
      bucketStart += bucketSize;
      if (result.length >= maxPoints - 1) break;
    }
    if (result.length >= maxPoints - 1) break;
    bucket.push(point);
  }
  result.push([points[points.length - 1].timeValue, points[points.length - 1].value]);
  return result.slice(0, maxPoints);
}

function containerSize(container) {
  const rect = container?.getBoundingClientRect?.();
  return {
    width: Math.max(1, Math.round(rect?.width || container?.clientWidth || FALLBACK_WIDTH)),
    height: Math.max(1, Math.round(rect?.height || container?.clientHeight || FALLBACK_HEIGHT))
  };
}

function axisStyle() {
  return {
    axisLabel: { color: '#b8c0cc', fontSize: 9.5, hideOverlap: true },
    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.18)' } },
    axisTick: { lineStyle: { color: 'rgba(255,255,255,0.14)' } },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.075)' } }
  };
}

function tooltipStyle(unit = '') {
  return {
    trigger: 'axis',
    renderMode: 'html',
    appendToBody: true,
    className: 'minevis-chart-tooltip',
    confine: false,
    backgroundColor: 'rgba(8, 15, 24, 0.96)',
    borderColor: 'rgba(148, 163, 184, 0.3)',
    borderWidth: 1,
    padding: [7, 9],
    textStyle: { color: '#edf3ff', fontSize: 10.5, lineHeight: 15 },
    valueFormatter: (value) => String(value) + (unit ? ' ' + unit : ''),
    extraCssText: 'z-index:700;max-width:300px;box-sizing:border-box;pointer-events:none;box-shadow:0 10px 28px rgba(0,0,0,.42);border-radius:6px;'
  };
}

function timeCursorMarkLine(currentTime, color) {
  if (currentTime == null || !Number.isFinite(Number(currentTime))) return undefined;
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { color: color || '#f8fafc', type: 'dashed', width: 1, opacity: 0.76 },
    label: { show: false },
    data: [{ xAxis: Number(currentTime) }]
  };
}

function lineSeries(model, index, axisIndex, currentTime) {
  return {
    id: String(model.id),
    name: model.label || String(model.id),
    type: 'line',
    xAxisIndex: axisIndex,
    yAxisIndex: axisIndex,
    data: model.points,
    smooth: model.smooth !== false,
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 4,
    sampling: 'lttb',
    connectNulls: false,
    animation: false,
    lineStyle: {
      color: model.color,
      width: model.primary ? 2.8 : 1.8,
      opacity: model.primary ? 1 : 0.82
    },
    itemStyle: { color: model.color },
    emphasis: {
      focus: 'series',
      lineStyle: { width: 3.4, opacity: 1 }
    },
    markLine: timeCursorMarkLine(currentTime, model.primary ? model.color : '#e2e8f0'),
    encode: { x: 0, y: 1 },
    z: model.primary ? 5 : 3,
    seriesEntityId: String(model.id),
    seriesOrder: index
  };
}

function superimposedOption({
  title,
  subtitle,
  metricLabel,
  unit,
  models,
  currentTime,
  size
}) {
  const compact = size.height < 220 || size.width < 420;
  const multiple = models.length > 1;
  return {
    backgroundColor: 'transparent',
    animation: false,
    title: {
      text: title,
      subtext: subtitle,
      left: compact ? 5 : 8,
      top: compact ? 2 : 4,
      textStyle: { color: '#edf3ff', fontSize: compact ? 11 : 12, fontWeight: 650 },
      subtextStyle: { color: '#9aa6b8', fontSize: compact ? 9 : 10 }
    },
    legend: {
      show: multiple,
      type: 'scroll',
      top: compact ? 3 : 5,
      right: 7,
      left: Math.min(size.width * 0.42, 185),
      textStyle: { color: '#cbd5e1', fontSize: 9.5 },
      pageTextStyle: { color: '#94a3b8', fontSize: 9 },
      pageIconColor: '#38bdf8',
      pageIconInactiveColor: '#475569',
      itemWidth: 12,
      itemHeight: 7,
      itemGap: 8
    },
    grid: {
      left: compact ? 44 : 52,
      top: multiple ? 43 : 40,
      right: 10,
      bottom: compact ? 24 : 28,
      containLabel: true
    },
    tooltip: tooltipStyle(unit),
    xAxis: {
      type: 'time',
      ...axisStyle(),
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      name: metricLabel + (unit ? ' (' + unit + ')' : ''),
      nameLocation: 'middle',
      nameGap: compact ? 34 : 42,
      nameTextStyle: { color: '#b8c0cc', fontSize: 9.5 },
      scale: true,
      ...axisStyle()
    },
    series: models.map((model, index) => lineSeries(model, index, 0, currentTime))
  };
}

function smallMultiplesOption({
  title,
  subtitle,
  metricLabel,
  unit,
  models,
  currentTime,
  size
}) {
  const columns = size.width >= 440 ? 2 : 1;
  const rows = Math.ceil(models.length / columns);
  const topStart = 52;
  const bottom = 18;
  const horizontalGap = columns === 2 ? 5 : 0;
  const verticalGap = 8;
  const availableHeight = Math.max(80, size.height - topStart - bottom);
  const rowHeight = Math.max(36, (availableHeight - verticalGap * Math.max(0, rows - 1)) / rows);
  const columnWidth = (100 - horizontalGap) / columns;
  const grids = [];
  const xAxes = [];
  const yAxes = [];
  const titles = [{
    text: title,
    subtext: subtitle,
    left: 7,
    top: 2,
    textStyle: { color: '#edf3ff', fontSize: 11.5, fontWeight: 650 },
    subtextStyle: { color: '#9aa6b8', fontSize: 9.5 }
  }];
  models.forEach((model, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const leftPercent = column * columnWidth + (column ? horizontalGap : 0);
    const top = topStart + row * (rowHeight + verticalGap);
    grids.push({
      left: (leftPercent + (columns === 2 ? 5 : 8)) + '%',
      width: (columnWidth - (columns === 2 ? 8 : 12)) + '%',
      top,
      height: Math.max(30, rowHeight),
      containLabel: true
    });
    xAxes.push({
      gridIndex: index,
      type: 'time',
      ...axisStyle(),
      splitLine: { show: false },
      axisLabel: {
        ...axisStyle().axisLabel,
        show: row === rows - 1
      }
    });
    yAxes.push({
      gridIndex: index,
      type: 'value',
      scale: true,
      ...axisStyle(),
      name: index === 0 ? metricLabel + (unit ? ' (' + unit + ')' : '') : '',
      nameTextStyle: { color: '#94a3b8', fontSize: 8.5 },
      nameGap: 28
    });
    titles.push({
      text: model.label || String(model.id),
      left: (leftPercent + (columns === 2 ? 6 : 9)) + '%',
      top: Math.max(34, top - 4),
      textStyle: {
        color: model.primary ? model.color : '#cbd5e1',
        fontSize: 9.5,
        fontWeight: model.primary ? 700 : 550
      }
    });
  });
  return {
    backgroundColor: 'transparent',
    animation: false,
    title: titles,
    legend: {
      show: models.length > 1,
      type: 'scroll',
      top: 5,
      right: 7,
      left: Math.min(size.width * 0.42, 185),
      textStyle: { color: '#cbd5e1', fontSize: 9.5 },
      itemWidth: 12,
      itemHeight: 7,
      itemGap: 7
    },
    tooltip: tooltipStyle(unit),
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    series: models.map((model, index) => lineSeries(model, index, index, currentTime))
  };
}

export class TimeSeriesChartView {
  constructor(container, {
    renderer = 'canvas',
    maxVisiblePoints = MAX_VISIBLE_POINTS
  } = {}) {
    if (!container) throw new Error('TimeSeriesChartView requires a container.');
    this.container = container;
    this.maxVisiblePoints = maxVisiblePoints;
    this.model = {
      title: 'Time Series',
      subtitle: '',
      metricLabel: 'Value',
      unit: '',
      series: [],
      currentTime: null,
      comparisonLayout: 'auto'
    };
    this.callbacks = {};
    this.seriesMode = 'full';
    this.disposed = false;
    this.resizeFrame = 0;
    this.lastSize = containerSize(container);
    this.chart = echarts.init(container, null, { renderer, ...this.lastSize });
    this.chartRoot = container.firstElementChild;
    this.chartRoot?.classList?.add('minevis-echarts-root');
    this.renderListeners = new Set();
    this.handlePanelResize = () => this.requestResize();
    container.addEventListener('minevis:panel-resize', this.handlePanelResize);
    this.installEvents();
  }

  installEvents() {
    this.chart.on('click', (params) => {
      const id = params?.seriesId == null ? null : String(params.seriesId);
      if (id) this.callbacks.onPrimaryChange?.(id, params);
      const rawTime = Array.isArray(params?.value) ? params.value[0] : null;
      const time = new Date(rawTime).getTime();
      if (Number.isFinite(time)) this.callbacks.onTimeChange?.(time, params);
    });
    this.chart.on('mouseover', (params) => {
      const id = params?.seriesId == null ? null : String(params.seriesId);
      if (id) this.callbacks.onHoverChange?.(id, params);
    });
    this.chart.on('mouseout', () => this.callbacks.onHoverChange?.(null));
    this.chart.on('legendselectchanged', (params) => {
      const model = this.model.series.find((series) => series.label === params.name);
      if (model) this.callbacks.onPrimaryChange?.(String(model.id), params);
    });
    this.chart.on('finished', () => {
      this.renderListeners.forEach((listener) => listener(this.getRenderedCanvas()));
    });
    this.chart.getZr().on('click', (event) => this.handlePlotClick(event));
  }

  handlePlotClick(event) {
    const point = [event.offsetX, event.offsetY];
    const gridCount = this.activeLayout === 'small-multiples'
      ? this.model.series.length
      : 1;
    for (let index = 0; index < gridCount; index += 1) {
      if (!this.chart.containPixel({ gridIndex: index }, point)) continue;
      const value = this.chart.convertFromPixel({ gridIndex: index }, point);
      const rawTime = Array.isArray(value) ? value[0] : value;
      const time = new Date(rawTime).getTime();
      if (Number.isFinite(time)) this.callbacks.onTimeChange?.(time, event);
      return;
    }
  }

  setCallbacks(callbacks = {}) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  onRendered(listener) {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  }

  setModel(model = {}) {
    if (this.isDisposed()) return;
    this.model = {
      ...this.model,
      ...model,
      series: (model.series || this.model.series || []).map((series) => ({
        ...series,
        id: String(series.id),
        label: series.label || String(series.id),
        color: series.color || '#38bdf8',
        points: resampleTimeSeries(
          normalizeTimeSeriesPoints(series.data || series.points || []),
          this.maxVisiblePoints
        )
      }))
    };
    this.render();
  }

  setTimeCursor(time) {
    if (this.isDisposed() || Object.is(this.model.currentTime, time)) return;
    this.model.currentTime = time;
    this.render();
  }

  setComparisonLayout(layout) {
    if (this.isDisposed() || this.model.comparisonLayout === layout) return;
    this.model.comparisonLayout = layout;
    this.render();
  }
  setSeriesMode(mode) {
    const next = mode === 'primary-only' ? 'primary-only' : 'full';
    if (this.isDisposed() || this.seriesMode === next) return;
    this.seriesMode = next;
    this.render();
  }


  render() {
    if (this.isDisposed()) return;
    const size = containerSize(this.container);
    this.lastSize = size;
    const primary = this.model.series.find((series) => series.primary) || this.model.series[0];
    const visibleSeries = this.seriesMode === 'primary-only'
      ? (primary ? [primary] : [])
      : this.model.series;
    const units = visibleSeries.map((series) => series.unit || this.model.unit);
    this.activeLayout = selectionPresentationForCount(
      visibleSeries.length,
      this.model.comparisonLayout,
      units
    );
    this.container.dataset.comparisonLayout = this.activeLayout;
    this.container.dataset.seriesCount = String(visibleSeries.length);
    this.container.dataset.seriesMode = this.seriesMode;
    this.container.setAttribute(
      'aria-label',
      (this.model.title || 'Time Series')
        + ': ' + visibleSeries.length
        + ' series, ' + this.activeLayout
    );
    const prepared = visibleSeries.map((series) => ({
      ...series,
      unit: series.unit || this.model.unit
    }));
    const optionInput = {
      title: this.model.title || 'Time Series',
      subtitle: this.model.subtitle || (
        prepared.length === 1 ? prepared[0].label : prepared.length + ' compared'
      ),
      metricLabel: this.model.metricLabel || 'Value',
      unit: this.model.unit || prepared[0]?.unit || '',
      models: prepared,
      currentTime: this.model.currentTime,
      size
    };
    const option = this.activeLayout === 'small-multiples'
      ? smallMultiplesOption(optionInput)
      : superimposedOption(optionInput);
    this.chart.setOption(option, { notMerge: true, lazyUpdate: false });
    this.chart.resize(size);
  }

  requestResize() {
    if (this.isDisposed() || this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      if (!this.container?.isConnected) return;
      const rect = this.container.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const nextSize = containerSize(this.container);
      const layoutChanged = (
        (this.lastSize.width < 440) !== (nextSize.width < 440) ||
        Math.abs(this.lastSize.height - nextSize.height) > 24
      );
      this.lastSize = nextSize;
      this.chart.resize(nextSize);
      if (layoutChanged && this.model.series.length) this.render();
    });
  }

  resizeToContainer() {
    this.requestResize();
  }

  getRenderedCanvas() {
    if (this.isDisposed()) return null;
    if (typeof this.chart.renderToCanvas === 'function') {
      return this.chart.renderToCanvas({ pixelRatio: 1, backgroundColor: 'transparent' });
    }
    return this.chart.getRenderedCanvas?.({ pixelRatio: 1 })
      || this.container.querySelector('canvas');
  }

  isDisposed() {
    return this.disposed || this.chart?.isDisposed?.() === true;
  }

  dispose() {
    if (this.isDisposed()) return;
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.container.removeEventListener('minevis:panel-resize', this.handlePanelResize);
    this.renderListeners.clear();
    this.chart.dispose();
    this.disposed = true;
  }
}
