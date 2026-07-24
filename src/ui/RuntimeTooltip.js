const VIEWPORT_MARGIN = 8;
const POINTER_OFFSET = 12;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class RuntimeTooltip {
  constructor({ className = '', role = 'tooltip' } = {}) {
    this.element = document.createElement('div');
    this.element.className = `minevis-runtime-tooltip ${className}`.trim();
    this.element.setAttribute('role', role);
    this.element.hidden = true;
    this.element.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.element);
  }

  position(clientX, clientY) {
    if (!this.element?.isConnected || this.element.hidden) return;
    const rect = this.element.getBoundingClientRect();
    let x = Number(clientX) + POINTER_OFFSET;
    let y = Number(clientY) + POINTER_OFFSET;
    if (x + rect.width > window.innerWidth - VIEWPORT_MARGIN) {
      x = Number(clientX) - rect.width - POINTER_OFFSET;
    }
    if (y + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
      y = Number(clientY) - rect.height - POINTER_OFFSET;
    }
    x = clamp(x, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN));
    y = clamp(y, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN));
    this.element.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  showHtml(html, clientX, clientY) {
    if (!this.element) return;
    this.element.innerHTML = html || '';
    this.element.hidden = false;
    this.element.setAttribute('aria-hidden', 'false');
    this.position(clientX, clientY);
  }

  showText(text, clientX, clientY) {
    if (!this.element) return;
    this.element.textContent = text || '';
    this.element.hidden = false;
    this.element.setAttribute('aria-hidden', 'false');
    this.position(clientX, clientY);
  }

  hide() {
    if (!this.element) return;
    this.element.hidden = true;
    this.element.setAttribute('aria-hidden', 'true');
  }

  dispose() {
    this.element?.remove?.();
    this.element = null;
  }
}
