import * as echarts from 'echarts';
import * as THREE from 'three';

export class ChartManager {
  constructor(container, sceneManager) {
    this.container = container;
    this.sceneManager = sceneManager;
    this.chart = echarts.init(container, null, { renderer: 'canvas' });
    this.mode = 'overlay';
    this.billboard = null;
  }

  setVisible(flag) {
    this.container.style.display = flag ? 'block' : 'none';
    if (flag) {
      this.chart.resize();
    }
  }

  updateSeries(sensorID, data) {
    const times = data.map((d) => new Date(d.time));
    const values = data.map((d) => d.value);
    this.chart.setOption({
      title: { text: `Sensor ${sensorID} temperature`, textStyle: { color: '#fff' } },
      grid: { left: 50, top: 30, right: 20, bottom: 40 },
      xAxis: { type: 'time', axisLabel: { color: '#ccc' } },
      yAxis: { type: 'value', axisLabel: { color: '#ccc' } },
      series: [{ data: times.map((t, i) => [t, values[i]]), type: 'line', smooth: true }]
    });
    this.chart.resize();
    this.refreshBillboardTexture();
  }

  setMode(mode) {
    this.mode = mode;
    this.refreshBillboardTexture();
  }

  ensureBillboard() {
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
}
