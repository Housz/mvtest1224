import { DefaultSourceAdaptorRegistry } from '../core/adaptors/SourceAdaptorRegistry.js';
import { SemanticContractRegistry } from '../core/semantics/SemanticContractRegistry.js';
import { normalizeDataNodeParams, semanticizeDataNode } from '../core/nodes/DataNodes.js';
import { generateCssGradient } from '../utils/colors.js';
import {
  createInspectorDeleteFooter,
  createInspectorEmptyState,
  createInspectorNodeSummary,
  createInspectorSection
} from './InspectorComponents.js';

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
    this.sectionState = new Map();
    this.renderRevision = 0;
    this.onNodeChange = null;
  }

  createSection(node, sectionKey, title, options = {}) {
    return createInspectorSection({
      nodeId: node.id,
      sectionKey,
      title,
      stateStore: this.sectionState,
      ...options
    });
  }

  notifyNodeChange(node, options = {}) {
    this.onNodeChange?.(node, options);
  }

  async showNode(node) {
    const slot = this.container.querySelector('.node-config');
    if (!slot) return;
    const revision = ++this.renderRevision;
    slot.innerHTML = '';
    if (!node) {
      this.currentNode = null;
      slot.appendChild(createInspectorEmptyState());
      return;
    }
    this.currentNode = node;

    if (node.kind === 'data') await this.renderDataNode(slot, node);
    else if (node.kind === 'operator') this.renderOperatorNode(slot, node);
    else if (node.kind === 'module') this.renderModuleNode(slot, node);
    else slot.appendChild(document.createTextNode('No editable params.'));

    if (revision !== this.renderRevision || this.currentNode?.id !== node.id) return;

    slot.appendChild(createInspectorDeleteFooter(() => {
      window.minevisGraph?.removeNode(node.id);
      this.currentNode = null;
      this.showNode(null);
    }));
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
    if (this.currentNode?.id !== node.id) return;
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

    this.renderDataSummary(slot, node, contract, preview);
    this.renderReadingSettings(slot, node);
    this.renderRepresentationSettings(slot, node);
    this.renderSources(slot, node, preview);
    this.renderRoleMapping(slot, node, contract, preview);
    this.renderValidation(slot, node, preview?.dataset, preview?.error);
    this.renderDeveloperDetails(slot, node, contract, preview);
  }

  renderDataSummary(slot, node, contract, preview) {
    const validation = preview?.dataset?.validation;
    const errors = validation?.errors?.length || (preview?.error ? 1 : 0);
    const warnings = validation?.warnings?.length || 0;
    const status = errors
      ? { label: `${errors} error${errors === 1 ? '' : 's'}`, tone: 'error' }
      : warnings
        ? { label: `${warnings} warning${warnings === 1 ? '' : 's'}`, tone: 'warning' }
        : validation?.valid
          ? { label: 'Ready', tone: 'success' }
          : { label: 'Not ready', tone: 'neutral' };
    slot.appendChild(createInspectorNodeSummary({
      node,
      category: 'Data node',
      meta: [node.params.datasetType, contract?.class || node.params.semanticClass].filter(Boolean).join(' / '),
      description: contract?.description || 'Project data organized as a reusable mining object.',
      status
    }));
  }

  renderReadingSettings(slot, node) {
    if (node.params.datasetType !== 'SensorReadings') return;
    const { root: section, body } = this.createSection(node, 'observation-settings', 'Observation Settings', {
      defaultOpen: true
    });
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
    body.appendChild(variableRow);

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
    body.appendChild(unitRow);
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
    const { root: section, body } = this.createSection(node, 'representation-profile', 'Representation Profile', {
      defaultOpen: true,
      summary: node.params.representationProfile || profileOptions[0]
    });
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
    body.appendChild(row);
    const hint = document.createElement('p');
    hint.className = 'small';
    hint.textContent = 'Controls how the dataset interprets geometry and field support.';
    body.appendChild(hint);
    slot.appendChild(section);
  }

  renderSources(slot, node, preview) {
    const sources = Object.entries(node.params.sources || {});
    const sourceErrors = preview?.sourceErrors || [];
    const requiredCount = sources.filter(([, source]) => source.required).length;
    const isConfigured = (source) => Boolean(
      source.path || source.name || source.text || source.arrayBuffer || source.data
    );
    const missingCount = sources.filter(([, source]) => source.required && !isConfigured(source)).length;
    const failedCount = sourceErrors.length;
    const sourceSummary = [
      sources.length + ' sources',
      requiredCount + ' required',
      missingCount
        ? missingCount + ' missing'
        : failedCount
          ? failedCount + ' failed'
          : 'configured'
    ].join(' / ');
    const { root: section, body } = this.createSection(node, 'sources', 'Sources', {
      defaultOpen: true,
      forceOpen: missingCount > 0 || failedCount > 0,
      summary: sourceSummary,
      tone: missingCount || failedCount ? 'error' : 'neutral'
    });

    sources.forEach(([sourceKey, source]) => {
      const result = preview?.adaptorResults?.[sourceKey];
      const configured = isConfigured(source);
      const sourceError = sourceErrors.find((entry) => entry.sourceKey === sourceKey)?.error;
      const failed = Boolean(result?.error || sourceError);
      const requiredLabel = source.required ? 'Required' : 'Optional';
      const statusLabel = failed
        ? 'Error'
        : source.required && !configured
          ? 'Missing'
          : result
            ? 'Ready'
            : configured
              ? 'Configured'
              : 'Optional';
      const statusTone = failed || (source.required && !configured)
        ? 'error'
        : result
          ? 'success'
          : 'neutral';
      const fullPath = source.name || source.path || 'No file';
      const fileLabel = String(fullPath).split(/[\\/]/).pop();
      const sourcePanel = this.createSection(node, 'source-' + sourceKey, source.label || sourceLabel(sourceKey), {
        defaultOpen: false,
        forceOpen: failed || (source.required && !configured),
        summary: [requiredLabel, fileLabel, statusLabel].join(' / '),
        className: 'source-card inspector-source-slot',
        tone: statusTone
      });
      const card = sourcePanel.root;
      const cardBody = sourcePanel.body;
      if (sourceError) card.title = sourceError.message || String(sourceError);

      const controls = document.createElement('div');
      controls.className = 'source-path-row';
      const input = document.createElement('input');
      input.value = source.path || source.name || '';
      input.placeholder = '/data/example.csv';
      input.setAttribute('aria-label', (source.label || sourceLabel(sourceKey)) + ' path');
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
      openButton.textContent = 'Open';
      openButton.title = 'Choose a local source file';
      openButton.addEventListener('click', () => fileInput.click());
      controls.appendChild(openButton);
      cardBody.appendChild(controls);

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
      cardBody.appendChild(adaptorRow);

      const details = document.createElement('details');
      details.className = 'source-details';
      const summary = document.createElement('summary');
      summary.textContent = 'File details';
      details.appendChild(summary);
      appendFriendlyList(details, sourceSummaryRows(source, result));
      cardBody.appendChild(details);
      body.appendChild(card);
    });
    slot.appendChild(section);
  }

  renderRoleMapping(slot, node, contract, preview) {
    const roles = contract?.roles || [];
    const resolvedMapping = {
      ...(preview?.roleMapping || {}),
      ...(node.params.roleMapping || {})
    };
    const mappedCount = roles.filter((role) => resolvedMapping[role.key] || role.defaultPath).length;
    const missingRequired = roles.filter(
      (role) => role.required && !(resolvedMapping[role.key] || role.defaultPath)
    );
    const mappingSummary = [
      roles.length + ' roles',
      mappedCount + ' mapped',
      missingRequired.length ? missingRequired.length + ' required missing' : 'required complete'
    ].join(' / ');
    const { root: section, body } = this.createSection(node, 'field-meaning', 'Field Meaning', {
      defaultOpen: false,
      forceOpen: missingRequired.length > 0,
      summary: mappingSummary,
      tone: missingRequired.length ? 'error' : 'neutral'
    });
    const intro = document.createElement('p');
    intro.className = 'small';
    intro.textContent = 'Map source fields to mining-domain roles. Inferred values remain editable.';
    body.appendChild(intro);

    const candidates = new Set();
    Object.values(preview?.adaptorResults || {}).forEach((result) => {
      (result.paths || result.fields || []).forEach((field) => candidates.add(field));
    });
    Object.values(resolvedMapping).forEach((field) => {
      if (field) candidates.add(field);
    });
    const options = ['', ...[...candidates].sort()];

    roles.forEach((role) => {
      const row = document.createElement('label');
      row.className = 'role-row';
      const meta = document.createElement('div');
      meta.className = 'role-meta';
      const roleTitle = document.createElement('strong');
      roleTitle.textContent = role.label + (role.required ? ' *' : '');
      roleTitle.title = role.description || role.label;
      meta.appendChild(roleTitle);
      const description = document.createElement('span');
      description.textContent = role.description || '';
      description.title = role.description || '';
      meta.appendChild(description);
      const requirement = document.createElement('small');
      requirement.textContent = role.required ? 'Required' : 'Optional';
      meta.appendChild(requirement);
      row.appendChild(meta);

      const input = document.createElement('input');
      const datalist = document.createElement('datalist');
      const listId = 'role-options-' + node.id + '-' + role.key.replace(/[^a-zA-Z0-9_-]/g, '-');
      datalist.id = listId;
      options.filter(Boolean).forEach((candidate) => {
        const option = document.createElement('option');
        option.value = candidate;
        option.textContent = candidate;
        datalist.appendChild(option);
      });
      input.setAttribute('list', listId);
      input.placeholder = role.defaultPath || '(not assigned)';
      input.value = resolvedMapping[role.key] || role.defaultPath || '';
      input.addEventListener('change', () => {
        node.params.roleMapping = node.params.roleMapping || {};
        node.params.roleMapping[role.key] = input.value.trim();
        this.refreshNode(node);
      });
      row.appendChild(input);
      row.appendChild(datalist);
      body.appendChild(row);
    });
    slot.appendChild(section);
  }

  renderValidation(slot, node, dataset, error) {
    const validation = dataset?.validation || { valid: false, warnings: [], errors: ['Not materialized.'], summary: {} };
    const errors = error ? [error.message || String(error)] : (validation.errors || []);
    const warnings = validation.warnings || [];
    const summary = errors.length
      ? errors.length + ' error' + (errors.length === 1 ? '' : 's')
      : warnings.length
        ? 'Ready / ' + warnings.length + ' warning' + (warnings.length === 1 ? '' : 's')
        : validation.valid
          ? 'Ready'
          : 'Not ready';
    const tone = errors.length ? 'error' : warnings.length ? 'warning' : validation.valid ? 'success' : 'neutral';
    const { root: section, body } = this.createSection(node, 'data-check', 'Data Check', {
      defaultOpen: false,
      forceOpen: errors.length > 0,
      summary,
      tone
    });

    const status = document.createElement('div');
    status.className = errors.length
      ? 'validation-error'
      : warnings.length
        ? 'validation-warning'
        : 'validation-ok';
    status.textContent = errors.length
      ? 'Needs attention'
      : warnings.length
        ? 'Ready with warnings'
        : validation.valid
          ? 'Ready to use'
          : 'Not ready';
    body.appendChild(status);
    appendFriendlyList(body, validationSummaryRows(validation.summary || {}));

    if (errors.length) {
      const list = document.createElement('ul');
      list.className = 'semantic-list';
      errors.forEach((message) => {
        const item = document.createElement('li');
        item.textContent = message;
        list.appendChild(item);
      });
      body.appendChild(list);
    }
    if (warnings.length) {
      const list = document.createElement('ul');
      list.className = 'semantic-list';
      warnings.forEach((message) => {
        const item = document.createElement('li');
        item.textContent = 'Warning: ' + message;
        list.appendChild(item);
      });
      body.appendChild(list);
    }
    slot.appendChild(section);
  }

  renderDeveloperDetails(slot, node, contract, preview) {
    const { root: details, body } = this.createSection(node, 'developer-details', 'Developer details', {
      defaultOpen: false,
      summary: 'Adaptors / contract / templates',
      className: 'developer-details'
    });
    body.classList.add('developer-details-body');
    this.renderDeveloperSourceAdaptors(body, node, preview);
    this.renderSemanticContract(body, node, contract);
    this.renderDataTemplates(body, node, preview?.dataset);
    this.renderDatasetOutput(body, node);
    slot.appendChild(details);
  }

  renderDeveloperSourceAdaptors(slot, node, preview) {
    const { root: section, body } = this.createSection(node, 'resolved-adaptors', 'Resolved Source Adaptors', {
      defaultOpen: false,
      summary: Object.keys(node.params.sources || {}).length + ' sources'
    });
    Object.entries(node.params.sources || {}).forEach(([sourceKey, source]) => {
      const result = preview?.adaptorResults?.[sourceKey];
      const inferred = DefaultSourceAdaptorRegistry.infer(source);
      const row = document.createElement('div');
      row.className = 'template-card';
      const title = document.createElement('strong');
      title.textContent = sourceLabel(sourceKey);
      const label = document.createElement('span');
      label.textContent = result?.adaptorLabel || inferred?.label || 'Not resolved';
      const id = document.createElement('small');
      id.textContent = result?.adaptorId || inferred?.id || '-';
      row.append(title, label, id);
      body.appendChild(row);
    });
    slot.appendChild(section);
  }

  renderSemanticContract(slot, node, contract) {
    const { root: section, body } = this.createSection(node, 'semantic-contract', 'Semantic Contract', {
      defaultOpen: false,
      summary: contract?.class || 'Not resolved'
    });
    addTextRow(body, 'Class', contract?.class);
    addTextRow(body, 'Taxonomy', contract?.taxonomyClass);
    const templates = document.createElement('div');
    templates.className = 'semantic-line';
    templates.innerHTML = '<span>Required templates</span><div>' + renderBadges(contract?.requiredTemplates || []) + '</div>';
    body.appendChild(templates);
    const roles = document.createElement('div');
    roles.className = 'semantic-line';
    roles.innerHTML = '<span>Roles</span><div>' + renderBadges((contract?.roles || []).map((role) => role.key)) + '</div>';
    body.appendChild(roles);
    const constraints = document.createElement('ul');
    constraints.className = 'semantic-list';
    (contract?.constraints || []).forEach((constraint) => {
      const item = document.createElement('li');
      item.textContent = constraint;
      constraints.appendChild(item);
    });
    body.appendChild(constraints);
    slot.appendChild(section);
  }

  renderDataTemplates(slot, node, dataset) {
    const templates = Object.values(dataset?.templates || {});
    const { root: section, body } = this.createSection(node, 'data-templates', 'Data Templates', {
      defaultOpen: false,
      summary: templates.length + ' materialized'
    });
    if (!templates.length) {
      const empty = document.createElement('p');
      empty.className = 'small';
      empty.textContent = 'No templates materialized.';
      body.appendChild(empty);
    }
    templates.forEach((template) => {
      const card = document.createElement('div');
      card.className = 'template-card';
      const title = document.createElement('strong');
      title.textContent = template.label;
      const meta = document.createElement('span');
      meta.textContent = template.type + ' / ' + template.role;
      const preview = document.createElement('pre');
      preview.textContent = JSON.stringify(template.summary(), null, 2);
      card.append(title, meta, preview);
      body.appendChild(card);
    });
    slot.appendChild(section);
  }

  renderDatasetOutput(slot, node) {
    const outputs = node.ports.filter((port) => port.direction === 'out');
    const { root: outputSection, body } = this.createSection(node, 'dataset-output', 'Dataset Output', {
      defaultOpen: false,
      summary: outputs.length + ' port' + (outputs.length === 1 ? '' : 's')
    });
    const outputList = document.createElement('div');
    outputList.className = 'output-list';
    outputs.forEach((port) => {
      const row = document.createElement('div');
      row.className = 'output-row';
      row.textContent = port.name + ': ' + port.type;
      outputList.appendChild(row);
    });
    body.appendChild(outputList);
    slot.appendChild(outputSection);
  }
  renderOperatorNode(slot, node) {
    const definition = window.minevisGraph?.definitionRegistry?.get(node.typeId);
    const requirements = Object.entries(definition?.inputRequirements || {});
    const schema = definition?.paramSchema || [];
    const primaryClass = definition?.taxonomy?.primaryClass || 'Operator';
    slot.appendChild(createInspectorNodeSummary({
      node,
      category: 'Operator',
      meta: primaryClass + ' / ' + requirements.length + ' inputs',
      description: 'Consumes semantic datasets and creates visual contributions.'
    }));

    if (requirements.length) {
      const { root: requirementsSection, body: requirementsBody } = this.createSection(
        node,
        'input-requirements',
        'Input Requirements',
        {
          defaultOpen: false,
          summary: requirements.length + ' input' + (requirements.length === 1 ? '' : 's')
        }
      );
      requirements.forEach(([inputName, requirement]) => {
        const row = document.createElement('div');
        row.className = 'template-card';
        const title = document.createElement('strong');
        title.textContent = inputName;
        const semanticClass = document.createElement('span');
        semanticClass.textContent = requirement.class;
        const badges = document.createElement('div');
        badges.innerHTML = renderBadges(requirement.requiredTemplates || []);
        const roles = document.createElement('small');
        roles.textContent = (requirement.requiredRoles || []).join(', ');
        row.append(title, semanticClass, badges, roles);
        requirementsBody.appendChild(row);
      });
      slot.appendChild(requirementsSection);
    }

    if (!schema.length) return;
    const { root: section, body } = this.createSection(node, 'parameters', 'Parameters', {
      defaultOpen: true,
      summary: schema.length + ' parameter' + (schema.length === 1 ? '' : 's')
    });
    const notifyParameterChange = () => this.notifyNodeChange(node, { source: 'inspector', refreshInspector: false });
    schema.forEach((field) => {
      if (field.type === 'select') {
        addField(body, node, field.label || field.key, field.key, {
          options: field.options,
          onChange: notifyParameterChange
        });
      } else {
        addField(body, node, field.label || field.key, field.key, {
          type: field.type === 'boolean' ? 'checkbox' : field.type || 'text',
          onChange: notifyParameterChange
        });
      }
      if (field.key === 'colormap') {
        const preview = document.createElement('div');
        preview.className = 'inspector-colormap-preview';
        preview.style.background = generateCssGradient(node.params?.colormap || 'rainbow');
        body.appendChild(preview);
        const select = body.querySelector('label:last-of-type select');
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

    const functions = (node.params?.functions || []).filter((fn) => !fn.placeholder);
    slot.appendChild(createInspectorNodeSummary({
      node,
      category: 'Module',
      meta: 'Workspace / ' + functions.length + ' functions',
      description: 'Composes connected operators into an interactive analysis workspace.'
    }));

    const { root: section, body } = this.createSection(node, 'workspace', 'Workspace', {
      defaultOpen: true,
      summary: node.params?.workspaceName || node.label || 'Workspace'
    });
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
      const title = this.container.querySelector('.inspector-node-title');
      if (title) {
        title.textContent = node.label;
        title.title = node.label;
      }
      this.notifyNodeChange(node, { source: 'inspector', refreshInspector: false });
    });
    row.appendChild(input);
    body.appendChild(row);
    const description = document.createElement('p');
    description.className = 'small';
    description.textContent =
      'Connected operators become functions in this workspace; the list order controls the runtime sidebar.';
    body.appendChild(description);
    slot.appendChild(section);

    this.renderModuleFunctions(slot, node);
  }
  renderModuleFunctions(slot, node) {
    const functions = (node.params?.functions || []).filter((fn) => !fn.placeholder);
    const { root: section, body } = this.createSection(node, 'functions', 'Functions', {
      defaultOpen: true,
      summary: functions.length + ' function' + (functions.length === 1 ? '' : 's')
    });
    if (!functions.length) {
      const empty = document.createElement('p');
      empty.className = 'small';
      empty.textContent = 'Connect an operator to the Add Function port on this workspace.';
      body.appendChild(empty);
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
    body.appendChild(list);
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
