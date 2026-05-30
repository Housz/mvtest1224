import * as echarts from 'echarts';
import * as THREE from 'three';

const normalizeSeriesPoints = (data = []) =>
  data
    .map((d) => {
      const timeValue = Number(d.timeValue ?? new Date(d.time ?? d.timestamp).getTime());
      const value = Number(d.value);
      return Number.isFinite(timeValue) && Number.isFinite(value) ? { ...d, timeValue, value } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.timeValue - b.timeValue);

const interpolateSeriesPoints = (points = [], maxPoints = 360) => {
  if (points.length <= 2) return points.map((point) => [new Date(point.timeValue), point.value]);
  const min = points[0].timeValue;
  const max = points[points.length - 1].timeValue;
  const range = max - min;
  if (range <= 0) return points.map((point) => [new Date(point.timeValue), point.value]);
  const intervals = [];
  for (let i = 1; i < points.length; i += 1) {
    const delta = points[i].timeValue - points[i - 1].timeValue;
    if (delta > 0) intervals.push(delta);
  }
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)] || range;
  const targetStep = Math.max(medianInterval / 8, range / maxPoints, 1);
  const steps = Math.max(1, Math.min(maxPoints, Math.ceil(range / targetStep)));
  const step = range / steps;
  const result = [];
  let cursor = 0;
  for (let i = 0; i <= steps; i += 1) {
    const timeValue = i === steps ? max : min + i * step;
    while (cursor < points.length - 2 && points[cursor + 1].timeValue < timeValue) cursor += 1;
    const left = points[cursor];
    const right = points[Math.min(cursor + 1, points.length - 1)];
    const span = right.timeValue - left.timeValue;
    const ratio = span === 0 ? 0 : (timeValue - left.timeValue) / span;
    result.push([new Date(timeValue), left.value + (right.value - left.value) * ratio]);
  }
  return result;
};

export class ChartManager {
  constructor(container, sceneManager) {
    this.container = container;
    this.sceneManager = sceneManager;
    this.chart = echarts.init(container, null, { renderer: 'canvas' });
    this.mode = 'overlay';
    this.billboard = null;
    this.currentTime = null;
    this.lastSensorID = null;
    this.lastData = [];
    this.metricLabel = 'Value';
    this.unit = '';
    this.titlePrefix = 'Sensor';
    this.onTimeChange = null;
    this.disposed = false;
    this.chart.getZr().on('click', (event) => this.handleChartClick(event));
  }

  isDisposed() {
    return this.disposed || this.chart?.isDisposed?.() === true;
  }

  setMetric({ label = 'Value', unit = '' } = {}) {
    if (this.isDisposed()) return;
    this.metricLabel = label;
    this.unit = unit;
    if (this.lastSensorID) this.updateSeries(this.lastSensorID, this.lastData, this.currentTime);
  }

  setTitlePrefix(prefix = 'Sensor') {
    if (this.isDisposed()) return;
    this.titlePrefix = prefix;
    if (this.lastSensorID) this.updateSeries(this.lastSensorID, this.lastData, this.currentTime);
  }

  setVisible(flag) {
    if (this.isDisposed()) return;
    this.container.style.display = flag ? 'block' : 'none';
    if (flag) {
      this.chart.resize();
    }
  }

  setTimeChangeHandler(handler) {
    this.onTimeChange = handler;
  }

  handleChartClick(event) {
    if (this.isDisposed()) return;
    if (!this.onTimeChange || !this.lastData.length) return;
    const point = [event.offsetX, event.offsetY];
    if (!this.chart.containPixel({ gridIndex: 0 }, point)) return;
    const value = this.chart.convertFromPixel({ gridIndex: 0 }, point);
    const rawTime = Array.isArray(value) ? value[0] : value;
    const time = new Date(rawTime).getTime();
    if (Number.isFinite(time)) this.onTimeChange(time);
  }

  updateSeries(sensorID, data, currentTime = this.currentTime) {
    if (this.isDisposed()) return;
    this.lastSensorID = sensorID;
    this.lastData = data;
    this.currentTime = currentTime;
    const samplePoints = normalizeSeriesPoints(data);
    const interpolatedPoints = interpolateSeriesPoints(samplePoints);
    const sampleScatter = samplePoints.map((point) => [new Date(point.timeValue), point.value]);
    const unitSuffix = this.unit ? ` (${this.unit})` : '';
    this.chart.setOption({
      title: {
        text: `${this.titlePrefix} ${sensorID}`,
        subtext: this.metricLabel,
        left: 8,
        top: 4,
        textStyle: { color: '#edf3ff', fontSize: 12, fontWeight: 650 },
        subtextStyle: { color: '#9aa6b8', fontSize: 10 }
      },
      grid: { left: 64, top: 54, right: 18, bottom: 34, containLabel: true },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(18, 22, 30, 0.94)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#edf3ff' } },
      xAxis: {
        type: 'time',
        axisLabel: { color: '#b8c0cc', fontSize: 10 },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.18)' } },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        name: `${this.metricLabel}${unitSuffix}`,
        nameLocation: 'middle',
        nameGap: 44,
        axisLabel: { color: '#b8c0cc', fontSize: 10 },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.18)' } },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        nameTextStyle: { color: '#b8c0cc', fontSize: 10, align: 'center' }
      },
      series: [
        {
          name: 'Interpolated',
          data: interpolatedPoints,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: '#ffd166' },
          itemStyle: { color: '#ffd166' },
          markLine:
            currentTime != null
              ? {
                  symbol: 'none',
                  lineStyle: { color: '#ffd166', type: 'dashed' },
                  label: { color: '#ffd166', formatter: 'time' },
                  data: [{ xAxis: new Date(Number(currentTime)) }]
                }
              : undefined
        },
        {
          name: 'Samples',
          data: sampleScatter,
          type: 'scatter',
          symbolSize: 5,
          itemStyle: { color: '#ffffff', borderColor: '#ffd166', borderWidth: 1.5 },
          emphasis: { scale: 1.6 },
          tooltip: { valueFormatter: (value) => `${value}${unitSuffix}` }
        }
      ]
    });
    this.chart.resize();
    this.refreshBillboardTexture();
  }

  setMode(mode) {
    if (this.isDisposed()) return;
    this.mode = mode;
    this.refreshBillboardTexture();
  }

  ensureBillboard() {
    if (this.isDisposed()) return null;
    if (this.billboard) return this.billboard;
    const texture = new THREE.CanvasTexture(this.chart.getRenderedCanvas());
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(10, 6);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(0, 8, 0);
    mesh.name = 'chart-billboard';
    this.sceneManager.scene.add(mesh);
    this.billboard = mesh;
    return mesh;
  }

  refreshBillboardTexture() {
    if (this.isDisposed()) return;
    if (this.mode === 'overlay') {
      if (this.billboard) this.billboard.visible = false;
      return;
    }
    const mesh = this.ensureBillboard();
    mesh.visible = true;
    mesh.lookAt(this.sceneManager.camera.position);
    const canvas = this.chart.getRenderedCanvas();
    if (canvas) {
      mesh.material.map = new THREE.CanvasTexture(canvas);
      mesh.material.needsUpdate = true;
    }
  }

  setCurrentTime(time) {
    if (this.isDisposed()) return;
    this.currentTime = time;
    if (this.lastSensorID) {
      this.updateSeries(this.lastSensorID, this.lastData, time);
    }
  }

  dispose() {
    if (this.isDisposed()) return;
    if (this.billboard) {
      this.sceneManager.scene.remove(this.billboard);
      this.billboard.geometry.dispose();
      this.billboard.material.map?.dispose?.();
      this.billboard.material.dispose();
      this.billboard = null;
    }
    this.chart.dispose();
    this.disposed = true;
  }
}
