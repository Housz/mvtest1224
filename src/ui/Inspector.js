import { DefaultSourceAdaptorRegistry } from '../core/adaptors/SourceAdaptorRegistry.js';
import { SemanticContractRegistry } from '../core/semantics/SemanticContractRegistry.js';
import { normalizeDataNodeParams, semanticizeDataNode } from '../core/nodes/DataNodes.js';
import { DatasetTaxonomy } from '../core/semantics/Taxonomies.js';
import { generateCssGradient } from '../utils/colors.js';

const SourceLabels = {
  topology: 'Topology Source',
  geometry: 'Geometry Source',
  registry: 'Registry Source',
  readings: 'Readings Source',
  network: 'Network Source',
  state: 'State Source',
  body: 'Geological Body Source',
  geology: 'Geology Source',
  descriptor: 'Dataset Descriptor',
  boreholes: 'Borehole Source',
  trajectories: 'Borehole Trajectories',
  intervals: 'Borehole Intervals',
  assays: 'Borehole Assays',
  logs: 'Borehole Log Source',
  structures: 'Geological Structure Source',
  traces: 'Structure Trace Source',
  relations: 'Relations Source',
  units: 'Units / Bodies Source',
  surfaces: 'Surface Semantics Source',
  blocks: 'Block Table Source',
  grid: 'Grid Metadata Source',
  binary: 'Attribute Binary Source',
  schema: 'Attribute Schema Source',
  preview: 'Preview / Sample Source',
  elements: 'Attribute Elements Source',
  legacy: 'Legacy Single Source',
  model: 'Attribute Model Source',
  attributes: 'Attribute Table Source'
};

const SourceAccepts = {
  topology: '.json,application/json',
  geometry: '.obj,.stl,.gltf,.glb,text/plain',
  registry: '.csv,.txt,text/csv,text/plain',
  readings: '.csv,.txt,text/csv,text/plain',
  network: '.json,application/json',
  state: '.csv,.txt,text/csv,text/plain',
  body: '.json,.obj,.gltf,.glb,.csv,application/json,text/csv,text/plain',
  geology: '.json,.obj,.gltf,.glb,application/json,text/plain',
  descriptor: '.minevis.json,.json,application/json',
  boreholes: '.json,.csv,.txt,application/json,text/csv,text/plain',
  trajectories: '.json,.csv,.txt,application/json,text/csv,text/plain',
  intervals: '.csv,.txt,text/csv,text/plain',
  assays: '.csv,.txt,text/csv,text/plain',
  logs: '.json,.csv,.txt,application/json,text/csv,text/plain',
  structures: '.json,.csv,.txt,.obj,.stl,.gltf,.glb,application/json,text/csv,text/plain',
  traces: '.csv,.txt,text/csv,text/plain',
  relations: '.csv,.txt,text/csv,text/plain',
  units: '.csv,.txt,text/csv,text/plain',
  surfaces: '.csv,.txt,text/csv,text/plain',
  blocks: '.csv,.txt,text/csv,text/plain',
  grid: '.json,application/json',
  binary: '.bin,.raw,application/octet-stream',
  schema: '.csv,.txt,text/csv,text/plain',
  preview: '.csv,.txt,text/csv,text/plain',
  elements: '.csv,.json,.txt,text/csv,application/json,text/plain',
  legacy: '.json,.csv,.txt,application/json,text/csv,text/plain',
  model: '.json,.csv,.txt,application/json,text/csv,text/plain',
  attributes: '.json,.csv,.txt,application/json,text/csv,text/plain'
};

const FriendlySummaryLabels = {
  rowCount: 'Rows',
  fieldCount: 'Columns',
  pathCount: 'Detected fields',
  nodeCount: 'Roadway nodes',
  edgeCount: 'Roadway edges',
  meshPartCount: 'Mesh parts',
  sensorCount: 'Sensors',
  anchoredSensorCount: 'Mounted sensors',
  seriesCount: 'Sensor series',
  variable: 'Measured variable',
  valueRange: 'Detected value range',
  timeRange: 'Time range',
  representationProfile: 'Representation profile',
  unitCount: 'Geological units',
  bodyCount: 'Geological bodies',
  surfaceCount: 'Surfaces',
  blockCount: 'Blocks',
  boreholeCount: 'Boreholes',
  intervalCount: 'Intervals',
  sampleCount: 'Samples',
  structureCount: 'Structures',
  elementCount: 'Spatial elements',
  attributeCount: 'Attributes'
};

function createSection(title) {
  const wrap = document.createElement('div');
  wrap.className = 'section';
  const header = document.createElement('div');
  header.className = 'section-title';
  header.textContent = title;
  wrap.appendChild(header);
  return wrap;
}

function addTextRow(section, label, value) {
  const row = document.createElement('div');
  row.className = 'semantic-row';
  row.innerHTML = `<span>${label}</span><strong>${value ?? '-'}</strong>`;
  section.appendChild(row);
}

function bindInput(row, node, key, { type = 'text', options = null, onChange = null } = {}) {
  let input;
  if (options) {
    input = document.createElement('select');
    options.forEach((optionValue) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionValue;
      input.appendChild(option);
    });
    input.value = node.params[key] ?? options[0];
  } else {
    input = document.createElement('input');
    input.type = type;
    if (type === 'checkbox') input.checked = Boolean(node.params[key]);
    else input.value = node.params[key] ?? '';
  }
  const eventName = (options || type === 'checkbox') ? 'change' : 'input';
  input.addEventListener(eventName, () => {
    if (type === 'number') node.params[key] = Number(input.value);
    else if (type === 'checkbox') node.params[key] = input.checked;
    else node.params[key] = input.value;
    onChange?.(node, key, input);
  });
  row.appendChild(input);
}

function addField(section, node, label, key, options = {}) {
  const row = document.createElement('label');
  row.className = 'field-row';
  const span = document.createElement('span');
  span.textContent = label;
  row.appendChild(span);
  bindInput(row, node, key, options);
  section.appendChild(row);
}

function renderBadges(values = []) {
  return values.map((value) => `<span class="semantic-badge">${value}</span>`).join('');
}

function sourcePathKey(sourceKey) {
  return ['sources', sourceKey, 'path'];
}

function setNested(object, path, value) {
  let current = object;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (!current[path[i]]) current[path[i]] = {};
    current = current[path[i]];
  }
  current[path[path.length - 1]] = value;
}

function sourceLabel(sourceKey) {
  return SourceLabels[sourceKey] || `${sourceKey} Source`;
}

function sourceAccept(sourceKey) {
  return SourceAccepts[sourceKey] || '';
}

function sourceAcceptedFormats(source = {}, sourceKey) {
  if (Array.isArray(source.acceptedFormats) && source.acceptedFormats.length) {
    return source.acceptedFormats.map((format) => {
      const clean = String(format).replace(/^\./, '');
      if (clean.includes('/')) return clean;
      return `.${clean}`;
    }).join(',');
  }
  return sourceAccept(sourceKey);
}

function shortList(values = [], limit = 12) {
  const list = values.filter((value) => value != null && value !== '');
  if (list.length <= limit) return list.join(', ');
  return `${list.slice(0, limit).join(', ')} ... +${list.length - limit} more`;
}

function friendlyKey(key) {
  return FriendlySummaryLabels[key] || String(key).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function formatTime(value) {
  if (value == null || value === '') return '-';
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 1000000000) return new Date(numeric).toLocaleString();
  return String(value);
}

function formatSummaryValue(value) {
  if (value == null) return '-';
  if (Array.isArray(value)) return shortList(value.map((item) => (typeof item === 'object' ? item.label || item.id : item)));
  if (typeof value === 'object') {
    if ('min' in value || 'max' in value) return `${formatTime(value.min)} to ${formatTime(value.max)}`;
    return Object.entries(value)
      .map(([key, nestedValue]) => `${friendlyKey(key)}: ${formatSummaryValue(nestedValue)}`)
      .join(', ');
  }
  return String(value);
}

function appendFriendlyList(parent, rows) {
  const list = document.createElement('div');
  list.className = 'friendly-list';
  rows.forEach(([label, value]) => {
    if (value == null || value === '') return;
    const row = document.createElement('div');
    row.className = 'friendly-list-row';
    row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    list.appendChild(row);
  });
  if (!list.children.length) {
    const empty = document.createElement('p');
    empty.className = 'small';
    empty.textContent = 'No details available yet.';
    parent.appendChild(empty);
    return;
  }
  parent.appendChild(list);
}

function sourceSummaryRows(source, result) {
  const rows = [];
  const inferred = result || {};
  const adaptor = result ? null : DefaultSourceAdaptorRegistry.infer(source);
  rows.push(['Detected format', inferred.kind || adaptor?.kind || 'Unknown']);
  rows.push(['Current file', source.name || source.path || '-']);

  const summary = inferred.summary || {};
  if (summary.rowCount != null) rows.push(['Rows', summary.rowCount]);
  if (summary.fieldCount != null) rows.push(['Columns', summary.fieldCount]);
  if (summary.nodeCount != null) rows.push(['Roadway nodes', summary.nodeCount]);
  if (summary.edgeCount != null) rows.push(['Roadway edges', summary.edgeCount]);
  if (summary.meshPartCount != null) rows.push(['Mesh parts', summary.meshPartCount]);

  const fields = inferred.fields || inferred.paths || summary.fields || [];
  if (fields.length) rows.push(['Fields', shortList(fields)]);
  const meshParts = (inferred.meshParts || []).map((part) => part.name);
  if (meshParts.length) rows.push(['Mesh part names', shortList(meshParts, 10)]);
  return rows;
}

function validationSummaryRows(summary = {}) {
  return Object.entries(summary)
    .filter(([key]) => key !== 'templates')
    .map(([key, value]) => [friendlyKey(key), formatSummaryValue(value)]);
}

export class Inspector {
  constructor(container) {
    this.container = container;
    this.currentNode = null;
    this.semanticCache = new Map();
    this.onNodeChange = null;
  }

  notifyNodeChange(node, options = {}) {
    this.onNodeChange?.(node, options);
  }

  async showNode(node) {
    const slot = this.container.querySelector('.node-config');
    if (!slot) return;
    slot.innerHTML = '';
    if (!node) {
      this.currentNode = null;
      slot.textContent = 'Select a node';
      return;
    }
    this.currentNode = node;
    const title = document.createElement('h4');
    title.textContent = node.label;
    slot.appendChild(title);

    if (node.kind === 'data') await this.renderDataNode(slot, node);
    else if (node.kind === 'operator') this.renderOperatorNode(slot, node);
    else if (node.kind === 'module') this.renderModuleNode(slot, node);
    else slot.appendChild(document.createTextNode('No editable params.'));

    const deleteWrap = document.createElement('div');
    deleteWrap.className = 'section';
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete this node';
    delBtn.addEventListener('click', () => {
      window.minevisGraph?.removeNode(node.id);
      this.currentNode = null;
      this.showNode(null);
      window.minevisEditor?.render();
    });
    deleteWrap.appendChild(delBtn);
    slot.appendChild(deleteWrap);
  }

  cacheKey(node) {
    return `${node.id}:${JSON.stringify(node.params)}`;
  }

  async getSemanticPreview(node) {
    normalizeDataNodeParams(node);
    const key = this.cacheKey(node);
    if (!this.semanticCache.has(key)) {
      const pending = semanticizeDataNode(node, { updateNode: false }).catch((error) => ({ error }));
      this.semanticCache.set(key, pending);
    }
    return this.semanticCache.get(key);
  }

  invalidateSemanticCache(node) {
    [...this.semanticCache.keys()].forEach((key) => {
      if (key.startsWith(`${node.id}:`)) this.semanticCache.delete(key);
    });
  }

  async refreshNode(node) {
    this.invalidateSemanticCache(node);
    await this.showNode(node);
    window.minevisEditor?.markSemanticFresh?.(node);
    this.notifyNodeChange(node, { source: 'inspector', refreshInspector: false });
  }

  async renderDataNode(slot, node) {
    normalizeDataNodeParams(node);
    const preview = await this.getSemanticPreview(node);
    const contract = SemanticContractRegistry.get(node.params.contractId);
    if (preview?.dataset?.validation) {
      node.params.semanticStatus = {
        valid: preview.dataset.validation.valid === true,
        errors: preview.dataset.validation.errors?.length || 0,
        warnings: preview.dataset.validation.warnings?.length || 0,
        summary: preview.dataset.validation.summary || {}
      };
      if (preview.dataset.validation.summary?.valueRange && node.params.datasetType === 'SensorReadings') {
        node.params.detectedRange = preview.dataset.validation.summary.valueRange;
      }
      window.minevisEditor?.markSemanticFresh?.(node);
      this.notifyNodeChange(node, { source: 'semantic-preview', refreshInspector: false });
    }

    this.renderDataMeaning(slot, node, contract);
    this.renderReadingSettings(slot, node);
    this.renderRepresentationSettings(slot, node);
    this.renderSources(slot, node, preview);
    this.renderRoleMapping(slot, node, contract, preview);
    this.renderValidation(slot, preview?.dataset, preview?.error);
    this.renderDeveloperDetails(slot, node, contract, preview);
  }

  renderDataMeaning(slot, node, contract) {
    const section = createSection('Data Meaning');
    const taxonomy = DatasetTaxonomy.find((item) => item.class === contract?.taxonomyClass);
    const card = document.createElement('div');
    card.className = 'dataset-card';
    card.innerHTML = `
      <strong>${node.label || contract?.label}</strong>
      <span>${contract?.description || 'Project data organized as a reusable mining object.'}</span>
      <small>${contract?.taxonomyClass || ''}${taxonomy ? ` - ${taxonomy.objectSystemFocus}` : ''}</small>
    `;
    section.appendChild(card);
    slot.appendChild(section);
  }

  renderReadingSettings(slot, node) {
    if (node.params.datasetType !== 'SensorReadings') return;
    const section = createSection('Observation Settings');
    const variableRow = document.createElement('label');
    variableRow.className = 'field-row';
    variableRow.innerHTML = '<span>Variable</span>';
    const variableInput = document.createElement('input');
    variableInput.value = node.params.variable ?? '';
    variableInput.addEventListener('change', () => {
      node.params.variable = variableInput.value.trim();
      this.refreshNode(node);
    });
    variableRow.appendChild(variableInput);
    section.appendChild(variableRow);

    const unitRow = document.createElement('label');
    unitRow.className = 'field-row';
    unitRow.innerHTML = '<span>Unit</span>';
    const unitInput = document.createElement('input');
    unitInput.value = node.params.unit ?? '';
    unitInput.addEventListener('change', () => {
      node.params.unit = unitInput.value.trim();
      this.refreshNode(node);
    });
    unitRow.appendChild(unitInput);
    section.appendChild(unitRow);
    slot.appendChild(section);
  }

  renderRepresentationSettings(slot, node) {
    const profileOptions =
      node.params.profileOptions ||
      (node.params.datasetType === 'GeologicalBody'
        ? ['layered-surface', 'volumetric-block', 'hybrid', 'generic']
        : node.params.datasetType === 'GeologicalAttributeModel'
          ? ['resource-block', 'coal-seam-attribute', 'risk-uncertainty', 'surface-attribute', 'generic']
          : null);
    if (!profileOptions?.length) return;
    const section = createSection('Representation Profile');
    const row = document.createElement('label');
    row.className = 'field-row';
    row.innerHTML = '<span>Profile</span>';
    const select = document.createElement('select');
    profileOptions.forEach((profile) => {
      const option = document.createElement('option');
      option.value = profile;
      option.textContent = profile;
      select.appendChild(option);
    });
    select.value = node.params.representationProfile || profileOptions[0];
    select.addEventListener('change', () => {
      node.params.representationProfile = select.value;
      this.refreshNode(node);
    });
    row.appendChild(select);
    section.appendChild(row);
    const hint = document.createElement('p');
    hint.className = 'small';
    hint.textContent = 'Controls how the semantic dataset interprets geometry and field support; role mapping remains editable below.';
    section.appendChild(hint);
    slot.appendChild(section);
  }

  renderSources(slot, node, preview) {
    const section = createSection('Sources');
    Object.entries(node.params.sources || {}).forEach(([sourceKey, source]) => {
      const card = document.createElement('div');
      card.className = 'source-card';

      const header = document.createElement('div');
      header.className = 'source-card-header';
      const requiredLabel = source.required ? 'Required' : 'Optional';
      const templateLabel = source.template ? `${source.template} - ${requiredLabel}` : requiredLabel;
      header.innerHTML = `<strong>${source.label || sourceLabel(sourceKey)}</strong><small>${templateLabel}</small>`;
      card.appendChild(header);

      const controls = document.createElement('div');
      controls.className = 'source-path-row';
      const input = document.createElement('input');
      input.value = source.path || source.name || '';
      input.placeholder = '/data/example.csv';
      input.addEventListener('change', () => {
        setNested(node.params, sourcePathKey(sourceKey), input.value.trim());
        delete node.params.sources[sourceKey].text;
        delete node.params.sources[sourceKey].name;
        this.refreshNode(node);
      });
      controls.appendChild(input);

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = sourceAcceptedFormats(source, sourceKey);
      fileInput.hidden = true;
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        node.params.sources[sourceKey].path = file.name;
        node.params.sources[sourceKey].name = file.name;
        if (/\.(bin|raw)$/i.test(file.name) || sourceKey === 'binary') {
          node.params.sources[sourceKey].arrayBuffer = await file.arrayBuffer();
          delete node.params.sources[sourceKey].text;
        } else {
          node.params.sources[sourceKey].text = await file.text();
          delete node.params.sources[sourceKey].arrayBuffer;
        }
        delete node.params.sources[sourceKey].data;
        await this.refreshNode(node);
      });
      controls.appendChild(fileInput);

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'inline-button';
      openButton.textContent = 'Open file';
      openButton.addEventListener('click', () => fileInput.click());
      controls.appendChild(openButton);
      card.appendChild(controls);

      const adaptorRow = document.createElement('label');
      adaptorRow.className = 'field-row';
      adaptorRow.innerHTML = '<span>Adapter</span>';
      const adaptorSelect = document.createElement('select');
      const inferredAdaptor = DefaultSourceAdaptorRegistry.infer(source);
      const adaptors = DefaultSourceAdaptorRegistry.list();
      adaptors.forEach((adaptor) => {
        const option = document.createElement('option');
        option.value = adaptor.id;
        option.textContent = adaptor.label || adaptor.id;
        adaptorSelect.appendChild(option);
      });
      adaptorSelect.value = source.adaptor || inferredAdaptor?.id || adaptors[0]?.id || '';
      adaptorSelect.addEventListener('change', () => {
        node.params.sources[sourceKey].adaptor = adaptorSelect.value;
        this.refreshNode(node);
      });
      adaptorRow.appendChild(adaptorSelect);
      card.appendChild(adaptorRow);

      const details = document.createElement('details');
      details.className = 'source-details';
      const summary = document.createElement('summary');
      summary.textContent = 'File details';
      details.appendChild(summary);
      appendFriendlyList(details, sourceSummaryRows(source, preview?.adaptorResults?.[sourceKey]));
      card.appendChild(details);

      section.appendChild(card);
    });
    slot.appendChild(section);
  }

  renderRoleMapping(slot, node, contract, preview) {
    const section = createSection('Field Meaning');
    const intro = document.createElement('p');
    intro.className = 'small';
    intro.textContent = 'Confirm which source field plays each mining-domain role. Defaults are inferred from the source and can be changed here.';
    section.appendChild(intro);

    const candidates = new Set();
    Object.values(preview?.adaptorResults || {}).forEach((result) => {
      (result.paths || result.fields || []).forEach((field) => candidates.add(field));
    });
    Object.values(preview?.roleMapping || node.params.roleMapping || {}).forEach((field) => {
      if (field) candidates.add(field);
    });
    const options = ['', ...[...candidates].sort()];

    (contract?.roles || []).forEach((role) => {
      const row = document.createElement('label');
      row.className = 'role-row';
      const meta = document.createElement('div');
      meta.className = 'role-meta';
      meta.innerHTML = `
        <strong>${role.label}${role.required ? ' *' : ''}</strong>
        <span>${role.description}</span>
        <small>${role.required ? 'Required' : 'Optional'}</small>
      `;
      row.appendChild(meta);
      const input = document.createElement('input');
      const datalist = document.createElement('datalist');
      const listId = `role-options-${node.id}-${role.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      datalist.id = listId;
      options
        .filter(Boolean)
        .forEach((candidate) => {
        const option = document.createElement('option');
        option.value = candidate;
          option.textContent = candidate;
          datalist.appendChild(option);
      });
      input.setAttribute('list', listId);
      input.placeholder = role.defaultPath || '(not assigned)';
      input.value = node.params.roleMapping?.[role.key] || role.defaultPath || '';
      input.addEventListener('change', () => {
        node.params.roleMapping = node.params.roleMapping || {};
        node.params.roleMapping[role.key] = input.value.trim();
        this.refreshNode(node);
      });
      row.appendChild(input);
      row.appendChild(datalist);
      section.appendChild(row);
    });
    slot.appendChild(section);
  }

  renderValidation(slot, dataset, error) {
    const section = createSection('Data Check');
    if (error) {
      const row = document.createElement('div');
      row.className = 'validation-error';
      row.textContent = error.message || String(error);
      section.appendChild(row);
      slot.appendChild(section);
      return;
    }
    const validation = dataset?.validation || { valid: false, warnings: [], errors: ['Not materialized.'], summary: {} };
    const status = document.createElement('div');
    status.className = validation.valid ? 'validation-ok' : 'validation-error';
    status.textContent = validation.valid ? 'Ready to use' : 'Needs attention';
    section.appendChild(status);
    appendFriendlyList(section, validationSummaryRows(validation.summary || {}));
    if (validation.errors?.length) {
      const list = document.createElement('ul');
      list.className = 'semantic-list';
      validation.errors.forEach((message) => {
        const item = document.createElement('li');
        item.textContent = message;
        list.appendChild(item);
      });
      section.appendChild(list);
    }
    if (validation.warnings?.length) {
      const list = document.createElement('ul');
      list.className = 'semantic-list';
      validation.warnings.forEach((message) => {
        const item = document.createElement('li');
        item.textContent = `Warning: ${message}`;
        list.appendChild(item);
      });
      section.appendChild(list);
    }
    slot.appendChild(section);
  }

  renderDeveloperDetails(slot, node, contract, preview) {
    const details = document.createElement('details');
    details.className = 'developer-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Developer details';
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'developer-details-body';
    this.renderDeveloperSourceAdaptors(body, node, preview);
    this.renderSemanticContract(body, contract);
    this.renderDataTemplates(body, preview?.dataset);
    this.renderDatasetOutput(body, node);
    details.appendChild(body);
    slot.appendChild(details);
  }

  renderDeveloperSourceAdaptors(slot, node, preview) {
    const section = createSection('Resolved Source Adaptors');
    Object.entries(node.params.sources || {}).forEach(([sourceKey, source]) => {
      const result = preview?.adaptorResults?.[sourceKey];
      const inferred = DefaultSourceAdaptorRegistry.infer(source);
      const row = document.createElement('div');
      row.className = 'template-card';
      row.innerHTML = `
        <strong>${sourceLabel(sourceKey)}</strong>
        <span>${result?.adaptorLabel || inferred?.label || 'Not resolved'}</span>
        <small>${result?.adaptorId || inferred?.id || '-'}</small>
      `;
      section.appendChild(row);
    });
    slot.appendChild(section);
  }

  renderSemanticContract(slot, contract) {
    const section = createSection('Semantic Contract');
    addTextRow(section, 'Class', contract?.class);
    addTextRow(section, 'Taxonomy', contract?.taxonomyClass);
    const templates = document.createElement('div');
    templates.className = 'semantic-line';
    templates.innerHTML = `<span>Required templates</span><div>${renderBadges(contract?.requiredTemplates || [])}</div>`;
    section.appendChild(templates);
    const roles = document.createElement('div');
    roles.className = 'semantic-line';
    roles.innerHTML = `<span>Roles</span><div>${renderBadges((contract?.roles || []).map((role) => role.key))}</div>`;
    section.appendChild(roles);
    const constraints = document.createElement('ul');
    constraints.className = 'semantic-list';
    (contract?.constraints || []).forEach((constraint) => {
      const item = document.createElement('li');
      item.textContent = constraint;
      constraints.appendChild(item);
    });
    section.appendChild(constraints);
    slot.appendChild(section);
  }

  renderDataTemplates(slot, dataset) {
    const section = createSection('Data Templates');
    const templates = Object.values(dataset?.templates || {});
    if (!templates.length) {
      section.appendChild(document.createTextNode('No templates materialized.'));
    }
    templates.forEach((template) => {
      const card = document.createElement('div');
      card.className = 'template-card';
      card.innerHTML = `
        <strong>${template.label}</strong>
        <span>${template.type} / ${template.role}</span>
        <pre>${JSON.stringify(template.summary(), null, 2)}</pre>
      `;
      section.appendChild(card);
    });
    slot.appendChild(section);
  }

  renderDatasetOutput(slot, node) {
    const outputSection = createSection('Dataset Output');
    const outputList = document.createElement('div');
    outputList.className = 'output-list';
    node.ports
      .filter((port) => port.direction === 'out')
      .forEach((port) => {
        const row = document.createElement('div');
        row.className = 'output-row';
        row.textContent = `${port.name}: ${port.type}`;
        outputList.appendChild(row);
      });
    outputSection.appendChild(outputList);
    slot.appendChild(outputSection);
  }

  renderOperatorNode(slot, node) {
    const definition = window.minevisGraph?.definitionRegistry?.get(node.typeId);
    const info = createSection('Capability');
    const card = document.createElement('div');
    card.className = 'dataset-card';
    card.innerHTML = `
      <strong>${node.label}</strong>
      <span>Consumes semantic datasets, module context, and parameters to create visual contributions.</span>
      <small>Primary class: ${definition?.taxonomy?.primaryClass || 'Operator'}${
        definition?.taxonomy?.auxiliaryTags?.length ? ` / tags: ${definition.taxonomy.auxiliaryTags.join(', ')}` : ''
      }</small>
    `;
    info.appendChild(card);
    if (definition?.inputRequirements) {
      Object.entries(definition.inputRequirements).forEach(([inputName, requirement]) => {
        const row = document.createElement('div');
        row.className = 'template-card';
        row.innerHTML = `
          <strong>${inputName}</strong>
          <span>${requirement.class}</span>
          <div>${renderBadges(requirement.requiredTemplates || [])}</div>
          <small>${(requirement.requiredRoles || []).join(', ')}</small>
        `;
        info.appendChild(row);
      });
    }
    slot.appendChild(info);

    const schema = definition?.paramSchema || [];
    if (!schema.length) return;
    const section = createSection('Parameters');
    const notifyParameterChange = () => this.notifyNodeChange(node, { source: 'inspector', refreshInspector: false });
    schema.forEach((field) => {
      if (field.type === 'select') {
        addField(section, node, field.label || field.key, field.key, {
          options: field.options,
          onChange: notifyParameterChange
        });
      }
      else addField(section, node, field.label || field.key, field.key, {
        type: field.type === 'boolean' ? 'checkbox' : field.type || 'text',
        onChange: notifyParameterChange
      });
      if (field.key === 'colormap') {
        const preview = document.createElement('div');
        preview.className = 'inspector-colormap-preview';
        preview.style.background = generateCssGradient(node.params?.colormap || 'rainbow');
        section.appendChild(preview);
        const select = section.querySelector('label:last-of-type select');
        select?.addEventListener('change', () => {
          preview.style.background = generateCssGradient(select.value);
        });
      }
    });
    slot.appendChild(section);
  }

  renderModuleNode(slot, node) {
    node.runtime?.syncFunctionSlots?.(node, {
      edges: window.minevisGraph?.edges || [],
      nodes: window.minevisGraph?.nodes || []
    });

    const section = createSection('Workspace');
    const row = document.createElement('label');
    row.className = 'field-row';
    const label = document.createElement('span');
    label.textContent = 'Workspace name';
    row.appendChild(label);
    const input = document.createElement('input');
    input.value = node.params?.workspaceName || node.label || '';
    input.addEventListener('input', () => {
      const value = input.value.trim();
      node.params = node.params || {};
      node.params.workspaceName = value;
      node.label = value || 'Workspace';
      const title = this.container.querySelector('.node-config h4');
      if (title) title.textContent = node.label;
      this.notifyNodeChange(node, { source: 'inspector', refreshInspector: false });
    });
    row.appendChild(input);
    section.appendChild(row);
    const description = document.createElement('p');
    description.className = 'small';
    description.textContent =
      'Each connected operator becomes one function in this workspace. Function order here is the runtime sidebar order.';
    section.appendChild(description);
    slot.appendChild(section);

    this.renderModuleFunctions(slot, node);
  }

  renderModuleFunctions(slot, node) {
    const section = createSection('Functions');
    const functions = (node.params?.functions || []).filter((fn) => !fn.placeholder);
    if (!functions.length) {
      const empty = document.createElement('p');
      empty.className = 'small';
      empty.textContent = 'Connect an operator to the Add Function port on this workspace.';
      section.appendChild(empty);
      slot.appendChild(section);
      return;
    }

    const list = document.createElement('div');
    list.className = 'module-function-list';
    let draggingId = null;
    functions.forEach((fn) => {
      const item = document.createElement('div');
      item.className = 'module-function-item';
      item.draggable = true;
      item.dataset.functionId = fn.id;

      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.textContent = '::';
      item.appendChild(handle);

      const field = document.createElement('label');
      field.className = 'field-row';
      const operatorName = this.operatorLabelForFunction(node, fn);
      field.innerHTML = `<span>${operatorName}</span>`;
      const input = document.createElement('input');
      input.value = fn.label || operatorName;
      input.addEventListener('change', () => {
        fn.label = input.value.trim() || operatorName;
        fn.customLabel = true;
        node.runtime?.refreshPorts?.(node);
        this.notifyNodeChange(node, { source: 'inspector', refreshInspector: false });
      });
      field.appendChild(input);
      item.appendChild(field);

      item.addEventListener('dragstart', (event) => {
        draggingId = fn.id;
        item.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', fn.id);
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        draggingId = null;
      });
      item.addEventListener('dragover', (event) => {
        event.preventDefault();
        item.classList.add('drop-target');
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drop-target');
      });
      item.addEventListener('drop', (event) => {
        event.preventDefault();
        item.classList.remove('drop-target');
        const sourceId = draggingId || event.dataTransfer.getData('text/plain');
        if (!sourceId || sourceId === fn.id) return;
        this.moveModuleFunction(node, sourceId, fn.id);
      });

      list.appendChild(item);
    });
    section.appendChild(list);
    slot.appendChild(section);
  }

  operatorLabelForFunction(node, fn) {
    const graph = window.minevisGraph;
    const edge = graph?.edges.find((item) => item.to.nodeId === node.id && item.to.portId === fn.id);
    const operator = edge ? graph?.nodes.find((item) => item.id === edge.from.nodeId) : null;
    return operator?.label || 'Function';
  }

  moveModuleFunction(node, sourceId, targetId) {
    const functions = node.params?.functions || [];
    const real = functions.filter((fn) => !fn.placeholder);
    const placeholder = functions.find((fn) => fn.placeholder);
    const from = real.findIndex((fn) => fn.id === sourceId);
    const to = real.findIndex((fn) => fn.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = real.splice(from, 1);
    real.splice(to, 0, moved);
    node.params.functions = placeholder ? [...real, placeholder] : real;
    node.runtime?.refreshPorts?.(node);
    this.notifyNodeChange(node, { source: 'inspector', refreshInspector: false });
    this.showNode(node);
  }
}
