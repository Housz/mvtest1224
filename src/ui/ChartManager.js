import { TimeSeriesChartView } from './charts/TimeSeriesChartView.js';

/**
 * Compatibility facade for legacy operator code.
 *
 * New code should compose TimeSeriesChartView with ChartPresentationService.
 * This class intentionally contains no Three.js presentation logic.
 */
export class ChartManager {
  constructor(container) {
    this.container = container;
    this.view = new TimeSeriesChartView(container);
    this.chart = this.view.chart;
    this.metricLabel = 'Value';
    this.unit = '';
    this.titlePrefix = 'Sensor';
    this.currentTime = null;
    this.lastEntityId = null;
    this.lastData = [];
    this.onTimeChange = null;
    this.mode = 'overlay';
    this.view.setCallbacks({
      onTimeChange: (time, event) => this.onTimeChange?.(time, event)
    });
  }

  isDisposed() {
    return this.view?.isDisposed?.() !== false;
  }

  setMetric({ label = 'Value', unit = '' } = {}) {
    this.metricLabel = label;
    this.unit = unit;
    this.render();
  }

  setTitlePrefix(prefix = 'Sensor') {
    this.titlePrefix = prefix;
    this.render();
  }

  setVisible(flag) {
    this.container.hidden = !flag;
    if (flag) this.view?.resizeToContainer?.();
  }

  setTimeChangeHandler(handler) {
    this.onTimeChange = handler;
  }

  updateSeries(entityId, data, currentTime = this.currentTime) {
    this.lastEntityId = entityId == null ? null : String(entityId);
    this.lastData = data || [];
    this.currentTime = currentTime;
    this.render();
  }

  render() {
    if (!this.lastEntityId || this.isDisposed()) return;
    this.view.setModel({
      title: this.titlePrefix + ' ' + this.lastEntityId,
      subtitle: this.metricLabel,
      metricLabel: this.metricLabel,
      unit: this.unit,
      series: [{
        id: this.lastEntityId,
        label: this.lastEntityId,
        unit: this.unit,
        data: this.lastData,
        color: '#ffd166',
        primary: true
      }],
      currentTime: this.currentTime,
      comparisonLayout: 'superimposed'
    });
  }

  setMode(mode) {
    this.mode = mode;
  }

  setCurrentTime(time) {
    this.currentTime = time;
    this.view?.setTimeCursor?.(time);
  }

  resizeToContainer() {
    this.view?.resizeToContainer?.();
  }

  requestResize() {
    this.view?.requestResize?.();
  }

  dispose() {
    this.view?.dispose?.();
    this.view = null;
    this.chart = null;
  }
}
