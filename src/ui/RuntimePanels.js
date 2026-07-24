export function createWorkspacePanel(title, className, body = '') {
  const staging = document.querySelector('.workspace-panel-staging');
  const host = staging || document.querySelector('.runtime-shell') || document.body;
  const panel = document.createElement('section');
  panel.className = 'runtime-panel-content ' + className;
  panel.innerHTML = body;
  panel.dataset.workspacePanelTitle = title;
  panel.setAttribute('aria-label', title);
  host.appendChild(panel);
  return panel;
}