import { generateCssGradient } from '../utils/colors.js';

export class ColorLegend {
  constructor(container) {
    this.container = container;
    this.bar = container.querySelector('.bar');
    this.minLabel = container.querySelector('.min');
    this.maxLabel = container.querySelector('.max');
  }

  update(map, min, max) {
    this.bar.style.background = generateCssGradient(map);
    this.minLabel.textContent = min.toFixed(1);
    this.maxLabel.textContent = max.toFixed(1);
  }
}
