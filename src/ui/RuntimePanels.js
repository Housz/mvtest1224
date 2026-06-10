export function createWorkspacePanel(title, className, body = '') {
  const host = document.querySelector('.runtime-shell') || document.body;
  const panel = document.createElement('section');
  panel.className = `glass-panel ventilation-panel ${className}`;
  panel.innerHTML = `<div class="panel-title"><span>${title}</span><button class="panel-collapse-toggle" type="button">-</button></div>${body}`;
  host.appendChild(panel);

  const button = panel.querySelector('.panel-collapse-toggle');
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const collapsed = panel.classList.toggle('panel-collapsed');
    button.textContent = collapsed ? '+' : '-';
  });

  let drag = null;
  panel.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.panel-title') || event.target.closest('button,input,select') || event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    panel.setPointerCapture(event.pointerId);
    panel.classList.add('dragging');
  });
  panel.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, event.clientX - drag.offsetX))}px`;
    panel.style.top = `${Math.max(72, Math.min(window.innerHeight - panel.offsetHeight - 8, event.clientY - drag.offsetY))}px`;
  });
  const stopDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    panel.releasePointerCapture(event.pointerId);
    panel.classList.remove('dragging');
    drag = null;
  };
  panel.addEventListener('pointerup', stopDrag);
  panel.addEventListener('pointercancel', stopDrag);
  return panel;
}
