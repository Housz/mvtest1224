export class SensorList {
  constructor(container) {
    this.container = container;
    this.onSelect = null;
    this.sensors = [];
  }

  setSensors(list) {
    this.sensors = list || [];
    this.container.innerHTML = '';
    for (const sensor of this.sensors) {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `<div><strong>${sensor.sensorID}</strong><div class="small">roadway ${sensor.roadwayID}</div></div>`;
      const btn = document.createElement('button');
      btn.textContent = 'Select';
      btn.addEventListener('click', () => this.onSelect?.(sensor.sensorID));
      item.appendChild(btn);
      this.container.appendChild(item);
    }
  }

  selectFirst() {
    if (this.sensors.length && this.onSelect) {
      this.onSelect(this.sensors[0].sensorID);
    }
  }
}
