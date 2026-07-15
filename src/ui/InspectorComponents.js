function appendText(parent, className, value) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = value || '';
  parent.appendChild(element);
  return element;
}

export function createInspectorSection({
  nodeId,
  sectionKey,
  title,
  summary = '',
  defaultOpen = false,
  forceOpen = false,
  stateStore = null,
  className = '',
  tone = 'neutral'
}) {
  const root = document.createElement('details');
  root.className = ['section', 'inspector-section', className].filter(Boolean).join(' ');
  root.dataset.sectionKey = sectionKey;
  root.dataset.tone = tone;

  const stateKey = `${nodeId}:${sectionKey}`;
  const storedOpen = stateStore?.get(stateKey);
  root.open = forceOpen || (storedOpen ?? defaultOpen);

  const header = document.createElement('summary');
  header.className = 'section-title inspector-section-header';
  appendText(header, 'inspector-section-label', title);
  const summaryElement = appendText(header, 'inspector-section-summary', summary);
  summaryElement.title = summary;
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'inspector-section-body';
  root.appendChild(body);

  root.addEventListener('toggle', () => {
    stateStore?.set(stateKey, root.open);
  });

  return {
    root,
    body,
    setSummary(value) {
      summaryElement.textContent = value || '';
      summaryElement.title = value || '';
    }
  };
}

export function createInspectorNodeSummary({
  node,
  category,
  meta = '',
  description = '',
  status = null
}) {
  const root = document.createElement('div');
  root.className = 'inspector-node-summary';

  const heading = document.createElement('div');
  heading.className = 'inspector-node-heading';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'inspector-node-title-wrap';
  appendText(titleWrap, 'inspector-node-kind', category);
  const title = appendText(titleWrap, 'inspector-node-title', node.label || 'Node');
  title.title = node.label || 'Node';
  heading.appendChild(titleWrap);

  if (status?.label) {
    const badge = appendText(heading, 'inspector-status-badge', status.label);
    badge.dataset.tone = status.tone || 'neutral';
    badge.title = status.title || status.label;
  }
  root.appendChild(heading);

  if (meta) {
    const metaElement = appendText(root, 'inspector-node-meta', meta);
    metaElement.title = meta;
  }
  if (description) {
    const descriptionElement = document.createElement('p');
    descriptionElement.className = 'inspector-node-description';
    descriptionElement.textContent = description;
    descriptionElement.title = description;
    root.appendChild(descriptionElement);
  }
  return root;
}

export function createInspectorEmptyState(message = 'Select a node') {
  const root = document.createElement('div');
  root.className = 'inspector-empty-state';
  root.textContent = message;
  return root;
}

export function createInspectorDeleteFooter(onDelete) {
  const footer = document.createElement('div');
  footer.className = 'inspector-footer';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'delete-node-btn';
  button.textContent = 'Delete node';
  button.addEventListener('click', onDelete);
  footer.appendChild(button);
  return footer;
}
