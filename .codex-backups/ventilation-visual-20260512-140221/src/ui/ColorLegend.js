import { generateCssGradient } from '../utils/colors.js';

export class ColorLegend {
  constructor(container) {
    this.container = container;
    this.bar = container.querySelector('.bar');
    this.minLabel = container.querySelector('.min');
    this.maxLabel = container.querySelector('.max');
  }

  update(map, min, max, unit = '') {
    this.bar.style.background = generateCssGradient(map);
    const suffix = unit ? ` ${unit}` : '';
    this.minLabel.textContent = `${min.toFixed(1)}${suffix}`;
    this.maxLabel.textContent = `${max.toFixed(1)}${suffix}`;
  }
}
