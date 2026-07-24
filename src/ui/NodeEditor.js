import { generateCssGradient } from '../utils/colors.js';
import { semanticizeDataNode } from '../core/nodes/DataNodes.js';

const NODE_DRAG_THRESHOLD_PX = 4;
const RENAME_AFTER_DRAG_SUPPRESSION_MS = 500;
const TITLE_DOUBLE_CLICK_MS = 500;

/**
 * SVG/DOM based node editor with pan/zoom and typed ports.
 */
export class NodeEditor {
  constructor(container, graphModel) {
    this.container = container;
    this.graph = graphModel;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('node-svg');
    this.edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.edgeLayer.classList.add('edge-world-layer');
    this.tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempPath.classList.add('node-edge', 'node-edge-temporary');
    this.tempPath.setAttribute('fill', 'none');
    this.tempPath.setAttribute('stroke', 'rgba(255,255,255,0.6)');
    this.tempPath.setAttribute('stroke-width', '2');
    this.tempPath.setAttribute('stroke-linecap', 'round');
    this.tempPath.setAttribute('stroke-linejoin', 'round');
    this.tempPath.setAttribute('vector-effect', 'non-scaling-stroke');
    this.tempPath.style.pointerEvents = 'none';
    this.tempPath.style.display = 'none';
    this.edgeLayer.appendChild(this.tempPath);
    this.svg.appendChild(this.edgeLayer);
    this.container.appendChild(this.svg);

    this.nodeLayer = document.createElement('div');
    this.nodeLayer.className = 'node-layer';
    this.activeEdgeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.activeEdgeSvg.classList.add('node-active-edge-svg');
    this.activeEdgeSvg.setAttribute('aria-hidden', 'true');
    this.activeEdgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.activeEdgeSvg.appendChild(this.activeEdgeLayer);
    this.nodeLayer.appendChild(this.activeEdgeSvg);
    this.container.appendChild(this.nodeLayer);

    this.nodeElements = new Map();
    this.nodePortSignatures = new Map();
    this.nodePortKeys = new Map();
    this.portElements = new Map();
    this.portPositions = new Map();
    this.portOffsets = new Map();
    this.nodeBounds = new Map();
    this.edgeElements = new Map();
    this.activeEdgeElements = new Map();
    this.edgeBounds = new Map();
    this.visibleNodeIds = new Set();

    this.draggingNode = null;
    this.draggingOffset = { x: 0, y: 0 };
    this.nodeDragCandidate = null;
    this.suppressRenameNodeId = null;
    this.suppressRenameUntil = 0;
    this.lastTitlePointerDown = null;
    this.activeRenameNodeId = null;
    this.panOrigin = null;
    this.pendingLink = null;
    this.selectedNodeId = null;
    this.onSelect = null;
    this.onDelete = null;
    this.onNodeChange = null;
    this.onCanvasContextMenu = null;
    this.highlight = null;
    this.draggingPointerTarget = null;
    this.spacePanning = false;
    this.latestPointer = null;
    this.containerRect = null;
    this.currentLod = null;
    this.rendered = false;

    this.frameHandle = null;
    this.frameFlags = { camera: false, culling: false, pointer: false, allEdges: false };
    this.dirtyNodePositions = new Set();
    this.dirtyGeometry = new Set();
    this.dirtyEdges = new Set();
    this.interactionTimer = null;

    this.semanticRevisions = new Map();
    this.semanticFreshRevisions = new Map();
    this.semanticStatusJobs = new Map();
    this.semanticStatusQueue = [];
    this.semanticQueuedIds = new Set();
    this.semanticActiveCount = 0;
    this.semanticConcurrency = 3;
    this.semanticGeneration = 0;

    const resizeFallback = { observe() {}, unobserve() {}, disconnect() {} };
    this.nodeResizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver((entries) => {
            entries.forEach((entry) => {
              const nodeId = entry.target?.dataset?.id;
              if (!nodeId || entry.target.style.display === 'none') return;
              this.invalidateNodeGeometry(nodeId);
            });
          })
        : resizeFallback;
    this.containerResizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            this.invalidateContainerRect();
            this.requestFrame({ camera: true, culling: true });
          })
        : resizeFallback;

    this.registerEvents();
    this.containerResizeObserver.observe(this.container);
    window.addEventListener('resize', () => {
      this.invalidateContainerRect();
      this.requestFrame({ camera: true, culling: true });
    });
    window.addEventListener('keydown', (event) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
      if (event.code === 'Space') this.spacePanning = true;
      if (event.key === 'Escape') {
        this.pendingLink = null;
        this.updateTempLink(null);
        this.clearCompatible();
      }
      if (this.selectedNodeId && (event.key === 'Delete' || event.key === 'Backspace')) {
        const nodeId = this.selectedNodeId;
        this.graph.removeNode(nodeId);
        this.onDelete?.();
      }
    });
    window.addEventListener('keyup', (event) => {
      if (event.code === 'Space') this.spacePanning = false;
    });
  }

  worldToScreen(pos) {
    return {
      x: pos.x * this.graph.view.zoom + this.graph.view.panX,
      y: pos.y * this.graph.view.zoom + this.graph.view.panY
    };
  }

  screenToWorld(pos) {
    return {
      x: (pos.x - this.graph.view.panX) / this.graph.view.zoom,
      y: (pos.y - this.graph.view.panY) / this.graph.view.zoom
    };
  }

  updateGrid() {
    const zoom = this.graph.view.zoom || 1;
    const minor = Math.max(10, 24 * zoom);
    const major = minor * 5;
    this.container.style.setProperty('--grid-size', `${minor}px`);
    this.container.style.setProperty('--grid-major-size', `${major}px`);
    this.container.style.setProperty('--grid-offset-x', `${this.graph.view.panX}px`);
    this.container.style.setProperty('--grid-offset-y', `${this.graph.view.panY}px`);
  }

  portKey(nodeId, portId) {
    return `${nodeId}:${portId}`;
  }

  edgeKey(edge) {
    return edge?.id || `${edge?.from?.nodeId}:${edge?.from?.portId}->${edge?.to?.nodeId}:${edge?.to?.portId}`;
  }

  portTheme(port) {
    const type = port?.type || '';
    if (type === 'Dataset' || type.endsWith('Dataset')) return 'data';
    if (type === 'OperatorRef' || type === 'Function') return 'function';
    return 'neutral';
  }

  nodeDefinition(node) {
    return this.graph.definitionRegistry?.get?.(node.typeId);
  }

  nodeCollapsed(node) {
    return node.params?.uiCollapsed === true;
  }

  nodeExpansionPreference(node) {
    if (!Object.prototype.hasOwnProperty.call(node.params || {}, 'uiCollapsed')) return 'auto';
    return this.nodeCollapsed(node) ? 'collapsed' : 'expanded';
  }

  lodForZoom(zoom = this.graph.view.zoom || 1) {
    return zoom >= 0.75 ? 'full' : zoom >= 0.55 ? 'compact' : 'overview';
  }

  nodeEffectivelyCollapsed(node, lod = this.currentLod || this.lodForZoom()) {
    const preference = this.nodeExpansionPreference(node);
    if (preference === 'collapsed') return true;
    if (preference === 'expanded') return false;
    return lod !== 'full';
  }

  applyNodeExpansionState(nodeId) {
    const node = this.graph.getNode?.(nodeId) ||
      this.graph.nodes.find((candidate) => candidate.id === nodeId);
    const element = this.nodeElements.get(nodeId);
    if (!node || !element) return;
    const preference = this.nodeExpansionPreference(node);
    const collapsed = this.nodeEffectivelyCollapsed(node);
    element.dataset.nodeExpansion = preference;
    element.classList.toggle('node-effectively-collapsed', collapsed);
    const toggle = element.querySelector('.node-collapse-toggle');
    if (!toggle) return;
    const action = collapsed ? 'Expand node' : 'Collapse node';
    toggle.title = action;
    toggle.setAttribute('aria-label', action);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? '+' : '-';
  }

  toggleNodeExpansion(node) {
    node.params = node.params || {};
    node.params.uiCollapsed = !this.nodeEffectivelyCollapsed(node);
    this.notifyNodeChange(node, { source: 'inline-collapse', refreshInspector: false });
    this.updateNodeView(node.id);
    this.requestFrame({ culling: true, allEdges: true });
  }

  renameNode(node, value) {
    const nextLabel = value.trim() || this.nodeDefinition(node)?.label || 'Node';
    node.label = nextLabel;
    if (node.kind === 'module') {
      node.params = node.params || {};
      node.params.workspaceName = nextLabel;
    }
    this.graph.syncModuleNodes?.();
    this.notifyNodeChange(node, { source: 'inline-rename', refreshInspector: this.selectedNodeId === node.id });
    this.updateNodeView(node.id);
  }

  startInlineRename(node, titleEl) {
    if (!titleEl || this.activeRenameNodeId) return;
    this.activeRenameNodeId = node.id;
    const input = document.createElement('input');
    input.className = 'node-title-input';
    input.value = node.label || '';
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let finalized = false;
    const finish = (commit) => {
      if (finalized) return;
      finalized = true;
      this.activeRenameNodeId = null;
      if (commit) this.renameNode(node, input.value);
      else this.updateNodeView(node.id);
    };
    ['pointerdown', 'pointerup', 'click', 'dblclick'].forEach((eventName) => {
      input.addEventListener(eventName, (event) => event.stopPropagation());
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  setAllCollapsed(collapsed) {
    this.graph.nodes.forEach((node) => {
      node.params = node.params || {};
      node.params.uiCollapsed = collapsed;
      this.updateNodeView(node.id);
    });
    this.requestFrame({ culling: true, allEdges: true });
  }

  notifyNodeChange(node, options = {}) {
    this.onNodeChange?.(node, options);
  }

  semanticRevision(nodeId) {
    return this.semanticRevisions.get(nodeId) || 0;
  }

  markSemanticStale(node) {
    if (!node?.params) return;
    const revision = this.semanticRevision(node.id) + 1;
    this.semanticRevisions.set(node.id, revision);
    this.semanticFreshRevisions.delete(node.id);
    delete node.params.semanticStatus;
    delete node.params.detectedRange;
  }

  markSemanticFresh(node) {
    if (!node?.id) return;
    this.semanticFreshRevisions.set(node.id, this.semanticRevision(node.id));
  }

  hasConfiguredSource(node) {
    return Object.values(node.params?.sources || {}).some(
      (source) => source?.path || source?.name || source?.text || source?.arrayBuffer
    );
  }

  requestDataStatusRefresh(node) {
    if (!node || node.kind !== 'data' || !this.hasConfiguredSource(node)) return;
    const revision = this.semanticRevision(node.id);
    if (node.params?.semanticStatus && this.semanticFreshRevisions.get(node.id) === revision) return;
    if (this.semanticStatusJobs.get(node.id)?.revision === revision) return;
    if (this.semanticStatusQueue.some((item) => item.nodeId === node.id && item.revision === revision)) return;

    this.semanticStatusQueue.push({
      nodeId: node.id,
      revision,
      generation: this.semanticGeneration
    });
    this.semanticQueuedIds.add(node.id);
    if (this.nodeElements.has(node.id)) queueMicrotask(() => this.updateNodeView(node.id));
    this.pumpSemanticStatusQueue();
  }

  pumpSemanticStatusQueue() {
    while (this.semanticActiveCount < this.semanticConcurrency && this.semanticStatusQueue.length) {
      const item = this.semanticStatusQueue.shift();
      this.semanticQueuedIds.delete(item.nodeId);
      const node = this.graph.getNode?.(item.nodeId) || this.graph.nodes.find((candidate) => candidate.id === item.nodeId);
      if (!node || item.generation !== this.semanticGeneration) continue;
      if (item.revision !== this.semanticRevision(node.id)) {
        this.requestDataStatusRefresh(node);
        continue;
      }

      this.semanticActiveCount += 1;
      const job = {
        revision: item.revision,
        generation: item.generation,
        promise: null
      };
      job.promise = Promise.resolve()
        .then(() => semanticizeDataNode(node))
        .then(() => {
          if (job.generation !== this.semanticGeneration) return;
          if (job.revision === this.semanticRevision(node.id)) this.markSemanticFresh(node);
        })
        .catch((error) => {
          if (job.generation !== this.semanticGeneration) return;
          node.params = node.params || {};
          node.params.semanticStatus = {
            valid: false,
            errors: 1,
            warnings: 0,
            summary: { message: error.message || String(error) }
          };
          if (job.revision === this.semanticRevision(node.id)) this.markSemanticFresh(node);
        })
        .finally(() => {
          this.semanticActiveCount = Math.max(0, this.semanticActiveCount - 1);
          if (this.semanticStatusJobs.get(item.nodeId) === job) this.semanticStatusJobs.delete(item.nodeId);
          const currentNode =
            this.graph.getNode?.(item.nodeId) || this.graph.nodes.find((candidate) => candidate.id === item.nodeId);
          if (currentNode && job.generation === this.semanticGeneration) {
            this.updateNodeView(currentNode.id);
            this.notifyNodeChange(currentNode, {
              source: 'semantic-status',
              refreshInspector: this.selectedNodeId === currentNode.id
            });
            if (job.revision !== this.semanticRevision(currentNode.id)) this.requestDataStatusRefresh(currentNode);
          }
          this.pumpSemanticStatusQueue();
        });
      this.semanticStatusJobs.set(item.nodeId, job);
    }
  }

  refreshDataStatuses({ force = false } = {}) {
    this.graph.nodes
      .filter((node) => node.kind === 'data')
      .forEach((node) => {
        if (force) this.semanticFreshRevisions.delete(node.id);
        this.requestDataStatusRefresh(node);
      });
  }

  resetSemanticStatusQueue() {
    this.semanticGeneration += 1;
    this.semanticStatusQueue = [];
    this.semanticQueuedIds.clear();
    this.semanticStatusJobs.clear();
    this.semanticFreshRevisions.clear();
  }

  stopControlPointer(event) {
    event.stopPropagation();
  }

  sourceDisplayLabel(sourceKey, source) {
    const fallback = String(sourceKey).replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
    return (source?.label || fallback).replace(/\b(JSON|OBJ|CSV)\b/g, '').replace(/\s+/g, ' ').trim() || fallback;
  }

  sourceStatus(node, source) {
    if (!source?.path && !source?.name && !source?.text) {
      return source?.required ? { label: 'Missing', tone: 'missing' } : { label: 'Optional', tone: 'set' };
    }
    if (this.semanticStatusJobs.has(node.id) || this.semanticQueuedIds.has(node.id)) return { label: 'Checking', tone: 'set' };
    const semantic = node.params?.semanticStatus;
    if (semantic?.valid === true) return { label: 'Ready', tone: 'ready' };
    if (semantic?.valid === false) return { label: 'Check', tone: 'warning' };
    return { label: 'Source set', tone: 'set' };
  }

  incomingNode(node, portId) {
    const edge =
      this.graph.getIncomingEdge?.(node.id, portId) ||
      this.graph.edges.find((item) => item.to.nodeId === node.id && item.to.portId === portId);
    return edge
      ? this.graph.getNode?.(edge.from.nodeId) || this.graph.nodes.find((item) => item.id === edge.from.nodeId)
      : null;
  }

  inputRangeForOperator(node) {
    const readings = this.incomingNode(node, 'sensorReadings');
    return readings?.params?.detectedRange || null;
  }

  async applyAutoRange(node, button) {
    const readings = this.incomingNode(node, 'sensorReadings');
    if (!readings) return;
    let range = this.inputRangeForOperator(node);
    if (!range) {
      const oldText = button.textContent;
      button.textContent = '...';
      button.disabled = true;
      try {
        const result = await semanticizeDataNode(readings);
        range = result.dataset?.validation?.summary?.valueRange || null;
        if (range) readings.params.detectedRange = range;
        this.markSemanticFresh(readings);
        this.notifyNodeChange(readings, { source: 'semantic-status', refreshInspector: this.selectedNodeId === readings.id });
      } catch (error) {
        console.warn('Failed to detect readings range for operator auto range.', error);
      } finally {
        button.textContent = oldText;
        button.disabled = false;
      }
    }
    if (!range) return;
    node.params.minValue = Number(range.min);
    node.params.maxValue = Number(range.max);
    this.updateNodeView(node.id);
    this.notifyNodeChange(node, { source: 'inline-control', refreshInspector: true });
  }

  bindInlineEvents(el) {
    ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel'].forEach((eventName) => {
      el.addEventListener(eventName, (event) => event.stopPropagation());
    });
  }

  renderInlineControls(node) {
    const definition = this.nodeDefinition(node);
    const controls = definition?.inlineControls || [];
    if (!controls.length || this.nodeCollapsed(node)) return null;
    const wrap = document.createElement('div');
    wrap.className = 'node-inline-controls';

    controls.forEach((control) => {
      if (control.type === 'sources') {
        Object.entries(node.params?.sources || {}).forEach(([sourceKey, source]) => {
          const row = document.createElement('label');
          row.className = 'node-inline-source';
          const status = this.sourceStatus(node, source);
          row.innerHTML = `
            <div class="node-inline-row-head">
              <span>${this.sourceDisplayLabel(sourceKey, source)}</span>
              <small class="node-source-status ${status.tone}">${status.label}</small>
            </div>
          `;
          const input = document.createElement('input');
          input.value = source.path || source.name || '';
          input.placeholder = '/data/source.csv';
          this.bindInlineEvents(input);
          input.addEventListener('change', () => {
            node.params.sources[sourceKey].path = input.value.trim();
            delete node.params.sources[sourceKey].text;
            delete node.params.sources[sourceKey].name;
            this.markSemanticStale(node);
            this.requestDataStatusRefresh(node);
            this.notifyNodeChange(node, { source: 'inline-source', refreshInspector: true });
            this.updateNodeView(node.id);
          });
          const sourceInputRow = document.createElement('div');
          sourceInputRow.className = 'node-inline-source-input';
          sourceInputRow.appendChild(input);

          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          if (Array.isArray(source.acceptedFormats) && source.acceptedFormats.length) {
            fileInput.accept = source.acceptedFormats
              .map((format) => {
                const clean = String(format).replace(/^\./, '');
                return clean.includes('/') ? clean : `.${clean}`;
              })
              .join(',');
          }
          fileInput.hidden = true;
          this.bindInlineEvents(fileInput);
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
            this.markSemanticStale(node);
            this.requestDataStatusRefresh(node);
            this.notifyNodeChange(node, { source: 'inline-source', refreshInspector: true });
            this.updateNodeView(node.id);
          });
          sourceInputRow.appendChild(fileInput);

          const openButton = document.createElement('button');
          openButton.type = 'button';
          openButton.className = 'node-inline-open-file';
          openButton.textContent = 'Open';
          openButton.title = 'Open local file';
          this.bindInlineEvents(openButton);
          openButton.addEventListener('click', () => fileInput.click());
          sourceInputRow.appendChild(openButton);

          row.appendChild(sourceInputRow);
          wrap.appendChild(row);
        });
        return;
      }

      if (control.type === 'displayRange') {
        const row = document.createElement('div');
        row.className = 'node-inline-range';
        row.innerHTML = `<span>${control.label || 'Range'}</span>`;
        ['min', 'max'].forEach((key) => {
          const input = document.createElement('input');
          input.type = 'number';
          input.step = control.step || '0.1';
          input.value = node.params?.displayRange?.[key] ?? '';
          input.placeholder = key;
          this.bindInlineEvents(input);
          input.addEventListener('change', () => {
            node.params.displayRange = node.params.displayRange || {};
            node.params.displayRange[key] = Number(input.value);
            this.notifyNodeChange(node, { source: 'inline-control', refreshInspector: true });
          });
          row.appendChild(input);
        });
        wrap.appendChild(row);
        return;
      }

      if (control.type === 'rangeAuto') {
        const row = document.createElement('div');
        row.className = 'node-inline-auto-range';
        const readings = this.incomingNode(node, 'sensorReadings');
        const range = this.inputRangeForOperator(node);
        const text = range ? `${range.min ?? '-'} - ${range.max ?? '-'}` : readings ? 'Detect from readings' : 'Connect readings';
        row.innerHTML = `<span>${control.label || 'Range'}</span><small>${text}</small>`;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Auto';
        button.disabled = !readings;
        this.bindInlineEvents(button);
        button.addEventListener('click', async () => {
          await this.applyAutoRange(node, button);
        });
        row.appendChild(button);
        wrap.appendChild(row);
        return;
      }

      if (control.type === 'colormap') {
        const row = document.createElement('label');
        row.className = 'node-inline-colormap';
        row.innerHTML = `<span>${control.label || 'Color map'}</span>`;
        const select = document.createElement('select');
        (control.options || ['rainbow', 'viridis', 'heat']).forEach((optionValue) => {
          const option = document.createElement('option');
          option.value = optionValue;
          option.textContent = optionValue;
          select.appendChild(option);
        });
        select.value = node.params?.[control.key] || control.options?.[0] || 'rainbow';
        this.bindInlineEvents(select);
        const preview = document.createElement('div');
        preview.className = 'node-colormap-preview';
        preview.style.background = generateCssGradient(select.value);
        select.addEventListener('change', () => {
          node.params[control.key] = select.value;
          preview.style.background = generateCssGradient(select.value);
          this.notifyNodeChange(node, { source: 'inline-control', refreshInspector: true });
        });
        row.appendChild(select);
        row.appendChild(preview);
        wrap.appendChild(row);
        return;
      }

      if (control.type === 'numberPair') {
        const row = document.createElement('div');
        row.className = 'node-inline-number-pair';
        row.innerHTML = `<span>${control.label || ''}</span>`;
        (control.fields || []).forEach((field) => {
          const fieldLabel = document.createElement('label');
          fieldLabel.innerHTML = `<span>${field.label || field.key}</span>`;
          const input = document.createElement('input');
          input.type = 'number';
          if (field.step) input.step = field.step;
          input.value = node.params?.[field.key] ?? '';
          this.bindInlineEvents(input);
          input.addEventListener('change', () => {
            node.params[field.key] = Number(input.value);
            this.notifyNodeChange(node, { source: 'inline-control', refreshInspector: true });
          });
          fieldLabel.appendChild(input);
          row.appendChild(fieldLabel);
        });
        wrap.appendChild(row);
        return;
      }

      if (control.type === 'select') {
        const row = document.createElement('label');
        row.className = 'node-inline-field';
        row.innerHTML = `<span>${control.label || control.key}</span>`;
        const select = document.createElement('select');
        (control.options || []).forEach((optionValue) => {
          const option = document.createElement('option');
          option.value = optionValue;
          option.textContent = optionValue;
          select.appendChild(option);
        });
        select.value = node.params?.[control.key] || control.options?.[0] || '';
        this.bindInlineEvents(select);
        select.addEventListener('change', () => {
          node.params[control.key] = select.value;
          this.notifyNodeChange(node, { source: 'inline-control', refreshInspector: true });
        });
        row.appendChild(select);
        wrap.appendChild(row);
        return;
      }

      if (control.type === 'checkbox') {
        const row = document.createElement('label');
        row.className = 'node-inline-checkbox';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = node.params?.[control.key] !== false;
        this.bindInlineEvents(input);
        input.addEventListener('change', () => {
          node.params[control.key] = input.checked;
          this.notifyNodeChange(node, { source: 'inline-control', refreshInspector: true });
        });
        row.append(input, document.createTextNode(control.label || control.key));
        wrap.appendChild(row);
        return;
      }

      const row = document.createElement('label');
      row.className = `node-inline-field ${control.type === 'number' ? 'number' : ''}`;
      row.innerHTML = `<span>${control.label || control.key}</span>`;
      const input = document.createElement('input');
      input.type = control.type === 'number' ? 'number' : 'text';
      if (control.step) input.step = control.step;
      input.value = node.params?.[control.key] ?? '';
      this.bindInlineEvents(input);
      input.addEventListener('change', () => {
        node.params[control.key] = input.type === 'number' ? Number(input.value) : input.value;
        if (node.kind === 'module' && control.key === 'workspaceName') {
          node.label = input.value.trim() || 'Workspace';
        }
        if (node.kind === 'data') {
          this.markSemanticStale(node);
          this.requestDataStatusRefresh(node);
        }
        this.notifyNodeChange(node, { source: 'inline-control', refreshInspector: true });
        this.updateNodeView(node.id);
      });
      row.appendChild(input);
      wrap.appendChild(row);
    });

    return wrap;
  }

  isModuleAddFunctionPort(node, port) {
    if (node?.kind !== 'module' || port?.direction !== 'in' || port?.type !== 'OperatorRef') return false;
    const slot = node.params?.functions?.find((fn) => fn.id === port.id);
    return slot?.placeholder === true || port.name === 'Add Function' || port.name === '(Add Function)';
  }

  setPortHighlight({ highlightedPorts = [], compatiblePorts = [], incompatiblePorts = [], highlightedEdges = [] } = {}) {
    this.highlight = {
      mode: 'ports',
      highlightedPorts: new Set(highlightedPorts),
      compatiblePorts: new Set(compatiblePorts),
      incompatiblePorts: new Set(incompatiblePorts),
      highlightedEdges: new Set(highlightedEdges)
    };
    this.applyVisualState();
  }

  setSelectedNode(nodeId, { notify = true } = {}) {
    const previous = this.selectedNodeId;
    this.selectedNodeId = nodeId || null;
    if (this.selectedNodeId) this.raiseNode(this.selectedNodeId);
    if (previous) this.applyNodeVisualState(previous);
    if (this.selectedNodeId) this.applyNodeVisualState(this.selectedNodeId);
    this.syncActiveEdgeLayer();
    if (notify) {
      const node = this.selectedNodeId
        ? this.graph.getNode?.(this.selectedNodeId) ||
          this.graph.nodes.find((candidate) => candidate.id === this.selectedNodeId)
        : null;
      this.onSelect?.(node || null);
    }
    this.requestFrame({ culling: true });
  }

  applyNodeVisualState(nodeId) {
    const element = this.nodeElements.get(nodeId);
    if (!element) return;
    const functionMode = this.highlight?.mode === 'function';
    element.classList.toggle('selected', nodeId === this.selectedNodeId);
    element.classList.toggle('function-related', functionMode && this.highlight.nodes?.has(nodeId));
    element.classList.toggle('function-dimmed', functionMode && !this.highlight.nodes?.has(nodeId));
  }

  raiseNode(nodeId) {
    const element = this.nodeElements.get(nodeId);
    if (element?.parentNode === this.nodeLayer) this.nodeLayer.appendChild(element);
  }

  syncActiveEdgeClone(edgeId) {
    const source = this.edgeElements.get(edgeId);
    const clone = this.activeEdgeElements.get(edgeId);
    if (!source || !clone) return;
    clone.setAttribute('class', (source.getAttribute('class') || 'node-edge') + ' node-edge-active-overlay');
    ['d', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'vector-effect'].forEach((attribute) => {
      const value = source.getAttribute(attribute);
      if (value == null) clone.removeAttribute(attribute);
      else clone.setAttribute(attribute, value);
    });
    clone.style.display = source.style.display;
    clone.style.pointerEvents = 'none';
  }

  syncActiveEdgeLayer() {
    this.activeEdgeLayer.replaceChildren();
    this.activeEdgeElements.clear();
    if (!this.selectedNodeId) return;
    const edges = this.graph.getIncidentEdges?.(this.selectedNodeId) ||
      this.graph.edges.filter((edge) => edge.from.nodeId === this.selectedNodeId || edge.to.nodeId === this.selectedNodeId);
    edges.forEach((edge) => {
      const source = this.edgeElements.get(edge.id);
      if (!source) return;
      const clone = source.cloneNode(false);
      clone.removeAttribute('data-edge-id');
      clone.setAttribute('aria-hidden', 'true');
      clone.style.pointerEvents = 'none';
      this.activeEdgeLayer.appendChild(clone);
      this.activeEdgeElements.set(edge.id, clone);
      this.syncActiveEdgeClone(edge.id);
    });
  }

  applyPortVisualState(portKey) {
    const record = this.portElements.get(portKey);
    if (!record) return;
    record.row.classList.toggle('highlighted', Boolean(this.highlight?.highlightedPorts?.has(portKey)));
    record.row.classList.toggle('compatible', Boolean(this.highlight?.compatiblePorts?.has(portKey)));
    record.row.classList.toggle('incompatible', Boolean(this.highlight?.incompatiblePorts?.has(portKey)));
  }

  applyEdgeVisualState(edgeId) {
    const path = this.edgeElements.get(edgeId);
    const edge = this.graph.getEdge?.(edgeId) || this.graph.edges.find((candidate) => candidate.id === edgeId);
    if (!path || !edge) return;
    const edgeKey = this.edgeKey(edge);
    const highlighted = Boolean(this.highlight?.highlightedEdges?.has(edgeKey));
    const hasGraphHighlight = this.highlight?.mode === 'function';
    const hasPortHighlight = this.highlight?.mode === 'ports' && this.highlight.highlightedEdges?.size;
    const dimmed = !highlighted && Boolean(hasGraphHighlight || hasPortHighlight);
    path.setAttribute('stroke', highlighted ? 'rgba(231,233,238,0.82)' : dimmed ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.3)');
    path.setAttribute('stroke-width', highlighted ? '3' : '2');
    path.classList.toggle('highlighted-edge', highlighted);
    path.classList.toggle('dimmed-edge', dimmed);
    this.syncActiveEdgeClone(edgeId);
  }

  applyVisualState() {
    this.nodeElements.forEach((_element, nodeId) => this.applyNodeVisualState(nodeId));
    this.portElements.forEach((_record, portKey) => this.applyPortVisualState(portKey));
    this.edgeElements.forEach((_path, edgeId) => this.applyEdgeVisualState(edgeId));
    this.requestFrame({ culling: true });
  }

  buildUpstreamSubgraph(rootNodeId) {
    const nodes = new Set();
    const edges = new Set();
    const visit = (nodeId) => {
      if (!nodeId || nodes.has(nodeId)) return;
      nodes.add(nodeId);
      const node = this.graph.getNode?.(nodeId) || this.graph.nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.kind === 'data') return;
      const incident = this.graph.getIncidentEdges?.(nodeId) || this.graph.edges.filter((edge) => edge.to.nodeId === nodeId);
      incident
        .filter((edge) => edge.to.nodeId === nodeId)
        .forEach((edge) => {
          edges.add(this.edgeKey(edge));
          visit(edge.from.nodeId);
        });
    };
    visit(rootNodeId);
    return { nodes, edges };
  }

  setFunctionHighlight(rootOperatorId, moduleNodeId, modulePortId) {
    const subgraph = this.buildUpstreamSubgraph(rootOperatorId);
    this.highlight = {
      mode: 'function',
      nodes: subgraph.nodes,
      highlightedEdges: subgraph.edges,
      highlightedPorts: new Set([this.portKey(moduleNodeId, modulePortId)]),
      compatiblePorts: new Set(),
      incompatiblePorts: new Set()
    };
    this.applyVisualState();
  }

  highlightForPort(node, port) {
    const key = this.portKey(node.id, port.id);
    if (port.direction === 'out') {
      this.pendingLink = { fromNode: node, fromPort: port };
      if (port.type === 'OperatorRef') {
        const connectedModuleEdges = (
          this.graph.getOutgoingEdges?.(node.id, port.id) ||
          this.graph.edges.filter((edge) => edge.from.nodeId === node.id && edge.from.portId === port.id)
        ).filter((edge) => {
          const target = this.graph.getNode?.(edge.to.nodeId) || this.graph.nodes.find((item) => item.id === edge.to.nodeId);
          return target?.kind === 'module';
        });
        if (connectedModuleEdges.length) {
          this.setPortHighlight({
            highlightedPorts: [key, ...connectedModuleEdges.map((edge) => this.portKey(edge.to.nodeId, edge.to.portId))],
            highlightedEdges: connectedModuleEdges.map((edge) => this.edgeKey(edge))
          });
          return;
        }
        const addFunctionPorts = [];
        this.graph.nodes
          .filter((item) => item.kind === 'module')
          .forEach((moduleNode) => {
            moduleNode.ports
              .filter((candidate) => this.isModuleAddFunctionPort(moduleNode, candidate))
              .forEach((candidate) => addFunctionPorts.push(this.portKey(moduleNode.id, candidate.id)));
          });
        this.setPortHighlight({ highlightedPorts: [key], compatiblePorts: addFunctionPorts });
        return;
      }
      const compatiblePorts = [];
      const incompatiblePorts = [];
      this.graph.nodes
        .filter((candidateNode) => candidateNode.kind === 'operator')
        .forEach((candidateNode) => {
          candidateNode.ports
            .filter((candidatePort) => candidatePort.direction === 'in')
            .forEach((candidatePort) => {
              const targetKey = this.portKey(candidateNode.id, candidatePort.id);
              if (candidatePort.type === port.type) compatiblePorts.push(targetKey);
              else incompatiblePorts.push(targetKey);
            });
        });
      this.setPortHighlight({ highlightedPorts: [key], compatiblePorts, incompatiblePorts });
      return;
    }

    const inbound =
      this.graph.getIncomingEdge?.(node.id, port.id) ||
      this.graph.edges.find((edge) => edge.to.nodeId === node.id && edge.to.portId === port.id);
    if (node.kind === 'module' && port.type === 'OperatorRef') {
      if (inbound) this.setFunctionHighlight(inbound.from.nodeId, node.id, port.id);
      else this.setPortHighlight({ highlightedPorts: [key] });
      return;
    }
    if (inbound) {
      this.setPortHighlight({
        highlightedPorts: [key, this.portKey(inbound.from.nodeId, inbound.from.portId)],
        highlightedEdges: [this.edgeKey(inbound)]
      });
      return;
    }

    const compatibleOutputs = [];
    this.graph.nodes
      .filter((candidateNode) => candidateNode.kind === 'data' || candidateNode.kind === 'operator')
      .forEach((candidateNode) => {
        candidateNode.ports
          .filter((candidatePort) => candidatePort.direction === 'out' && candidatePort.type === port.type)
          .forEach((candidatePort) => compatibleOutputs.push(this.portKey(candidateNode.id, candidatePort.id)));
      });
    this.setPortHighlight({ highlightedPorts: [key], compatiblePorts: compatibleOutputs });
  }

  handlePortPointerDown(event, portElement) {
    event.stopPropagation();
    const node = this.graph.getNode?.(portElement.dataset.nodeId) ||
      this.graph.nodes.find((candidate) => candidate.id === portElement.dataset.nodeId);
    const port = node?.ports.find((candidate) => candidate.id === portElement.dataset.portId);
    if (!node || !port) return;
    if (port.direction === 'in') {
      const inbound =
        this.graph.getIncomingEdge?.(node.id, port.id) ||
        this.graph.edges.find((edge) => edge.to.nodeId === node.id && edge.to.portId === port.id);
      if (inbound) {
        const fromNode = this.graph.getNode?.(inbound.from.nodeId) ||
          this.graph.nodes.find((candidate) => candidate.id === inbound.from.nodeId);
        const fromPort = fromNode?.ports.find((candidate) => candidate.id === inbound.from.portId);
        if (fromNode && fromPort) {
          this.pendingLink = {
            fromNode,
            fromPort,
            detachEdgeId: inbound.id,
            detachStart: { x: event.clientX, y: event.clientY },
            detachArmed: false,
            originalTarget: { nodeId: node.id, portId: port.id }
          };
        }
      }
    }
    this.highlightForPort(node, port);
  }

  handlePortPointerUp(event, portElement) {
    if (!this.pendingLink) return;
    const node = this.graph.getNode?.(portElement.dataset.nodeId) ||
      this.graph.nodes.find((candidate) => candidate.id === portElement.dataset.nodeId);
    const port = node?.ports.find((candidate) => candidate.id === portElement.dataset.portId);
    if (!node || !port || port.direction !== 'in') return;
    event.stopPropagation();
    if (this.pendingLink.detachEdgeId) {
      const sameOriginal =
        this.pendingLink.originalTarget?.nodeId === node.id &&
        this.pendingLink.originalTarget?.portId === port.id;
      if (!this.pendingLink.detachArmed || sameOriginal) {
        this.pendingLink = null;
        this.updateTempLink(null);
        this.clearCompatible();
        return;
      }
      this.graph.removeEdge(this.pendingLink.detachEdgeId);
    }
    this.graph.connect(
      { nodeId: this.pendingLink.fromNode.id, portId: this.pendingLink.fromPort.id },
      { nodeId: node.id, portId: port.id }
    );
    this.pendingLink = null;
    this.updateTempLink(null);
    this.clearCompatible();
  }

  promoteNodeDragCandidate(clientX, clientY) {
    const candidate = this.nodeDragCandidate;
    if (!candidate || this.draggingNode) return false;
    const dx = clientX - candidate.startClientX;
    const dy = clientY - candidate.startClientY;
    if (Math.hypot(dx, dy) <= NODE_DRAG_THRESHOLD_PX) return false;
    candidate.moved = true;
    this.lastTitlePointerDown = null;
    this.draggingPointerTarget = candidate.nodeElement;
    this.draggingNode = candidate.node;
    try {
      candidate.nodeElement.setPointerCapture(candidate.pointerId);
    } catch {
      // Window-level pointer tracking keeps dragging functional when capture is unavailable.
    }
    this.suppressRenameNodeId = candidate.node.id;
    this.suppressRenameUntil = performance.now() + RENAME_AFTER_DRAG_SUPPRESSION_MS;
    this.setInteracting(true);
    return true;
  }

  handleNodePointerDown(event) {
    const portElement = event.target.closest?.('.port');
    if (portElement) {
      this.handlePortPointerDown(event, portElement);
      return;
    }

    const nodeElement = event.target.closest?.('.node');
    if (!nodeElement) return;
    const node = this.graph.getNode?.(nodeElement.dataset.id) ||
      this.graph.nodes.find((candidate) => candidate.id === nodeElement.dataset.id);
    if (!node) return;

    if (event.target.closest('.node-collapse-toggle')) {
      event.stopPropagation();
      return;
    }

    const titleElement = event.target.closest('.node-title');
    if (event.button === 0 && titleElement) {
      const now = performance.now();
      const previous = this.lastTitlePointerDown;
      const repeated = previous?.nodeId === node.id && now - previous.at <= TITLE_DOUBLE_CLICK_MS;
      this.lastTitlePointerDown = repeated ? null : { nodeId: node.id, at: now };
      const renameSuppressed = this.suppressRenameNodeId === node.id &&
        now < this.suppressRenameUntil;
      if (repeated && !renameSuppressed) {
        event.preventDefault();
        event.stopPropagation();
        this.nodeDragCandidate = null;
        this.setSelectedNode(node.id);
        this.startInlineRename(node, titleElement);
        return;
      }
    } else {
      this.lastTitlePointerDown = null;
    }

    event.stopPropagation();
    this.setSelectedNode(node.id);
    if (event.button !== 0 || !event.target.closest('.node-header')) return;
    this.invalidateContainerRect();
    const screen = this.clientToScreen(event.clientX, event.clientY);
    const world = this.screenToWorld(screen);
    this.draggingOffset = { x: world.x - node.position.x, y: world.y - node.position.y };
    this.nodeDragCandidate = {
      node,
      nodeElement,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false
    };
  }

  handleNodePointerUp(event) {
    const portElement = event.target.closest?.('.port');
    if (portElement) this.handlePortPointerUp(event, portElement);
  }

  handleNodeClick(event) {
    const toggle = event.target.closest?.('.node-collapse-toggle');
    if (!toggle) return;
    const nodeElement = toggle.closest('.node');
    const nodeId = nodeElement?.dataset.id;
    const node = this.graph.getNode?.(nodeId) ||
      this.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    this.toggleNodeExpansion(node);
  }

  handleNodeDoubleClick(event) {
    const titleElement = event.target.closest?.('.node-title');
    if (titleElement) {
      const nodeElement = titleElement.closest('.node');
      const nodeId = nodeElement?.dataset.id;
      const node = this.graph.getNode?.(nodeId) ||
        this.graph.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      const renameSuppressed = this.suppressRenameNodeId === node.id &&
        performance.now() < this.suppressRenameUntil;
      if (renameSuppressed) return;
      this.suppressRenameNodeId = null;
      this.suppressRenameUntil = 0;
      this.startInlineRename(node, titleElement);
      return;
    }

    const portElement = event.target.closest?.('.port');
    if (!portElement) return;
    event.stopPropagation();
    const nodeId = portElement.dataset.nodeId;
    const portId = portElement.dataset.portId;
    const edges = (this.graph.getIncidentEdges?.(nodeId) || this.graph.edges.filter(
      (edge) => edge.from.nodeId === nodeId || edge.to.nodeId === nodeId
    )).filter(
      (edge) =>
        (edge.from.nodeId === nodeId && edge.from.portId === portId) ||
        (edge.to.nodeId === nodeId && edge.to.portId === portId)
    );
    [...edges].forEach((edge) => this.graph.removeEdge(edge.id));
  }

  finishPointerInteraction(event, { cancelled = false } = {}) {
    const hasInteraction = this.panOrigin || this.draggingNode || this.nodeDragCandidate ||
      this.draggingPointerTarget || this.pendingLink;
    if (!hasInteraction) return;
    if (!cancelled && (this.panOrigin || this.draggingNode || this.pendingLink)) {
      this.latestPointer = { clientX: event.clientX, clientY: event.clientY };
      this.requestFrame({ pointer: true });
      this.flushScheduledFrameNow();
    }
    if (this.panOrigin && this.container.hasPointerCapture?.(event.pointerId)) {
      this.container.releasePointerCapture(event.pointerId);
    }
    if (this.draggingPointerTarget?.hasPointerCapture?.(event.pointerId)) {
      this.draggingPointerTarget.releasePointerCapture(event.pointerId);
    }
    if (!cancelled && this.pendingLink?.detachEdgeId && this.pendingLink.detachArmed) {
      this.graph.removeEdge(this.pendingLink.detachEdgeId);
    }
    this.panOrigin = null;
    this.draggingNode = null;
    this.nodeDragCandidate = null;
    this.draggingPointerTarget = null;
    this.pendingLink = null;
    this.latestPointer = null;
    this.updateTempLink(null);
    this.clearCompatible();
    this.setInteracting(false);
    this.requestFrame({ culling: true });
  }
  registerEvents() {
    this.nodeLayer.addEventListener('pointerdown', (event) => this.handleNodePointerDown(event));
    this.nodeLayer.addEventListener('pointerup', (event) => this.handleNodePointerUp(event));
    this.nodeLayer.addEventListener('click', (event) => this.handleNodeClick(event));
    this.nodeLayer.addEventListener('dblclick', (event) => this.handleNodeDoubleClick(event));

    this.svg.addEventListener('click', (event) => {
      const path = event.target.closest?.('.node-edge[data-edge-id]');
      if (!path) return;
      event.stopPropagation();
      this.graph.removeEdge(path.dataset.edgeId);
    });

    this.container.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.invalidateContainerRect();
        const pointer = this.clientToScreen(event.clientX, event.clientY);
        const worldBefore = this.screenToWorld(pointer);
        const factor = event.deltaY > 0 ? 0.92 : 1.08;
        const nextZoom = Math.max(0.45, Math.min(2.5, this.graph.view.zoom * factor));
        this.graph.view.zoom = nextZoom;
        this.graph.view.panX = pointer.x - worldBefore.x * nextZoom;
        this.graph.view.panY = pointer.y - worldBefore.y * nextZoom;
        this.setInteracting(true);
        this.setInteracting(false);
        this.requestFrame({ camera: true, culling: true });
      },
      { passive: false }
    );

    const startPan = (event) => {
      this.container.setPointerCapture(event.pointerId);
      this.invalidateContainerRect();
      this.panOrigin = {
        x: event.clientX,
        y: event.clientY,
        panX: this.graph.view.panX,
        panY: this.graph.view.panY
      };
      this.setInteracting(true);
    };
    const isBackgroundTarget = (target) =>
      target === this.container ||
      target === this.nodeLayer ||
      target === this.svg ||
      target === this.edgeLayer;

    this.container.addEventListener('pointerdown', (event) => {
      const isBackground = isBackgroundTarget(event.target);
      if (isBackground && event.button === 0) {
        this.setSelectedNode(null);
        this.pendingLink = null;
        this.updateTempLink(null);
        this.clearCompatible();
      }
      if (event.button === 1 || event.altKey || this.spacePanning || (isBackground && event.button === 0)) {
        startPan(event);
      }
    });

    this.container.addEventListener('contextmenu', (event) => {
      if (!isBackgroundTarget(event.target)) return;
      event.preventDefault();
      this.setSelectedNode(null);
      this.pendingLink = null;
      this.updateTempLink(null);
      this.clearCompatible();
      this.invalidateContainerRect();
      const screen = this.clientToScreen(event.clientX, event.clientY);
      this.onCanvasContextMenu?.({
        clientX: event.clientX,
        clientY: event.clientY,
        screen,
        world: this.screenToWorld(screen)
      });
    });

    window.addEventListener('pointermove', (event) => {
      this.promoteNodeDragCandidate(event.clientX, event.clientY);
      if (!this.panOrigin && !this.draggingNode && !this.pendingLink) return;
      this.latestPointer = {
        clientX: event.clientX,
        clientY: event.clientY
      };
      this.requestFrame({ pointer: true });
    });

    window.addEventListener('pointerup', (event) => {
      this.finishPointerInteraction(event);
    });
    window.addEventListener('pointercancel', (event) => {
      this.finishPointerInteraction(event, { cancelled: true });
    });
  }

  render() {
    this.activeRenameNodeId = null;
    if (this.frameHandle != null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.nodeResizeObserver.disconnect();
    this.nodeLayer.replaceChildren(this.activeEdgeSvg);
    this.activeEdgeLayer.replaceChildren();
    this.activeEdgeElements.clear();
    this.edgeLayer.replaceChildren();
    this.edgeLayer.appendChild(this.tempPath);
    this.tempPath.style.display = 'none';

    this.nodeElements.clear();
    this.nodePortSignatures.clear();
    this.nodePortKeys.clear();
    this.portElements.clear();
    this.portPositions.clear();
    this.portOffsets.clear();
    this.nodeBounds.clear();
    this.edgeElements.clear();
    this.edgeBounds.clear();
    this.visibleNodeIds.clear();
    this.dirtyNodePositions.clear();
    this.dirtyGeometry.clear();
    this.dirtyEdges.clear();

    const fragment = document.createDocumentFragment();
    this.graph.nodes.forEach((node) => fragment.appendChild(this.createNodeElement(node)));
    this.nodeLayer.appendChild(fragment);
    this.graph.edges.forEach((edge) => this.createEdgeView(edge));
    this.syncActiveEdgeLayer();

    this.applyCameraTransform();
    this.nodeElements.forEach((_element, nodeId) => this.dirtyGeometry.add(nodeId));
    this.rendered = true;
    this.requestFrame({ culling: true, allEdges: true });
  }

  createNodeElement(node) {
    const element = document.createElement('div');
    element.className = `node kind-${node.kind}`;
    element.dataset.id = node.id;
    element.style.transform = `translate(${node.position.x}px, ${node.position.y}px)`;

    const header = document.createElement('div');
    header.className = 'node-header';
    const title = document.createElement('span');
    title.className = 'node-title';
    title.textContent = node.label;
    title.title = 'Double-click to rename';
    header.appendChild(title);

    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'node-collapse-toggle';
    header.appendChild(collapse);
    element.appendChild(header);

    const body = document.createElement('div');
    body.className = 'node-body';
    const inlineControls = this.renderInlineControls(node);
    if (inlineControls) body.appendChild(inlineControls);

    const portsElement = document.createElement('div');
    portsElement.className = 'ports';
    const portKeys = new Set();
    const buildPort = (port) => {
      const row = document.createElement('div');
      row.className = `port ${port.direction}`;
      row.dataset.nodeId = node.id;
      row.dataset.portId = port.id;
      row.dataset.type = port.type;
      row.dataset.portTheme = this.portTheme(port);
      row.title = port.name;

      const dot = document.createElement('span');
      dot.className = 'dot';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = port.name;
      row.append(dot, label);

      const key = this.portKey(node.id, port.id);
      portKeys.add(key);
      this.portElements.set(key, { row, dot, nodeId: node.id, portId: port.id });
      portsElement.appendChild(row);
    };
    node.ports.filter((port) => port.direction === 'in').forEach(buildPort);
    node.ports.filter((port) => port.direction === 'out').forEach(buildPort);
    body.appendChild(portsElement);
    element.appendChild(body);

    this.nodeElements.set(node.id, element);
    this.nodePortKeys.set(node.id, portKeys);
    this.nodePortSignatures.set(node.id, this.portSignature(node));
    this.visibleNodeIds.add(node.id);
    this.nodeResizeObserver.observe(element);
    this.applyNodeVisualState(node.id);
    this.applyNodeExpansionState(node.id);
    portKeys.forEach((key) => this.applyPortVisualState(key));
    return element;
  }

  cleanupNodeRegistration(nodeId) {
    const element = this.nodeElements.get(nodeId);
    if (element) this.nodeResizeObserver.unobserve(element);
    (this.nodePortKeys.get(nodeId) || []).forEach((key) => {
      this.portElements.delete(key);
      this.portPositions.delete(key);
      this.portOffsets.delete(key);
    });
    this.nodePortKeys.delete(nodeId);
    this.nodePortSignatures.delete(nodeId);
    this.nodeBounds.delete(nodeId);
    this.visibleNodeIds.delete(nodeId);
    this.nodeElements.delete(nodeId);
  }

  updateNodeView(nodeId) {
    if (this.activeRenameNodeId === nodeId) return this.nodeElements.get(nodeId) || null;
    const node = this.graph.getNode?.(nodeId) || this.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      this.removeNodeView(nodeId);
      return null;
    }
    const oldElement = this.nodeElements.get(nodeId);
    const wasHidden = oldElement?.style.display === 'none';
    if (oldElement) this.cleanupNodeRegistration(nodeId);
    const element = this.createNodeElement(node);
    if (oldElement) oldElement.replaceWith(element);
    else this.nodeLayer.appendChild(element);
    if (wasHidden) {
      element.style.display = 'none';
      this.visibleNodeIds.delete(nodeId);
    }
    this.invalidateNodeGeometry(nodeId);
    return element;
  }

  removeNodeView(nodeId) {
    if (this.activeRenameNodeId === nodeId) this.activeRenameNodeId = null;
    const element = this.nodeElements.get(nodeId);
    this.cleanupNodeRegistration(nodeId);
    element?.remove();
    this.semanticRevisions.delete(nodeId);
    this.semanticFreshRevisions.delete(nodeId);
    this.semanticQueuedIds.delete(nodeId);
    this.semanticStatusJobs.delete(nodeId);
  }

  portSignature(node) {
    return (node.ports || [])
      .map((port) => `${port.id}|${port.name}|${port.direction}|${port.type}`)
      .join(';');
  }

  syncModuleViews() {
    this.graph.nodes
      .filter((node) => node.kind === 'module')
      .forEach((node) => {
        if (this.nodePortSignatures.get(node.id) !== this.portSignature(node)) this.updateNodeView(node.id);
      });
  }

  createEdgeView(edge) {
    if (!edge || this.edgeElements.has(edge.id)) return this.edgeElements.get(edge?.id);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('node-edge');
    path.dataset.edgeId = edge.id;
    path.setAttribute('data-edge-id', edge.id);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.style.pointerEvents = 'auto';
    this.edgeLayer.insertBefore(path, this.tempPath);
    this.edgeElements.set(edge.id, path);
    this.applyEdgeVisualState(edge.id);
    this.dirtyEdges.add(edge.id);
    this.requestFrame();
    return path;
  }

  removeEdgeView(edgeId) {
    this.edgeElements.get(edgeId)?.remove();
    this.activeEdgeElements.get(edgeId)?.remove();
    this.edgeElements.delete(edgeId);
    this.activeEdgeElements.delete(edgeId);
    this.edgeBounds.delete(edgeId);
    this.dirtyEdges.delete(edgeId);
  }

  applyGraphChange(change = {}) {
    if (!this.rendered) return;
    if (change.type === 'graph-loaded') {
      this.resetSemanticStatusQueue();
      this.render();
      this.refreshDataStatuses({ force: true });
      return;
    }
    if (change.type === 'node-created') {
      const nodeId = change.nodeId || change.node?.id;
      this.updateNodeView(nodeId);
      this.requestDataStatusRefresh(change.node || this.graph.getNode?.(nodeId));
      this.syncModuleViews();
      this.requestFrame({ culling: true });
      return;
    }
    if (change.type === 'node-removed') {
      (change.removedEdgeIds || []).forEach((edgeId) => this.removeEdgeView(edgeId));
      this.removeNodeView(change.nodeId);
      if (this.selectedNodeId === change.nodeId) {
        this.selectedNodeId = null;
        this.onSelect?.(null);
        this.syncActiveEdgeLayer();
      }
      this.syncModuleViews();
      this.requestFrame({ culling: true });
      return;
    }
    if (change.type === 'edge-connected') {
      (change.removedEdgeIds || []).forEach((edgeId) => this.removeEdgeView(edgeId));
      this.syncModuleViews();
      this.createEdgeView(change.edge || this.graph.getEdge?.(change.edgeId));
      this.syncActiveEdgeLayer();
      (change.affectedNodeIds || []).forEach((nodeId) => this.updateIncidentEdges(nodeId));
      this.requestFrame({ culling: true });
      return;
    }
    if (change.type === 'edge-removed') {
      this.removeEdgeView(change.edgeId);
      this.syncActiveEdgeLayer();
      this.syncModuleViews();
      (change.affectedNodeIds || []).forEach((nodeId) => this.updateIncidentEdges(nodeId));
      this.requestFrame({ culling: true });
      return;
    }
    (change.affectedNodeIds || []).forEach((nodeId) => this.updateNodeView(nodeId));
  }

  requestFrame({ camera = false, culling = false, pointer = false, allEdges = false } = {}) {
    this.frameFlags.camera ||= camera;
    this.frameFlags.culling ||= culling;
    this.frameFlags.pointer ||= pointer;
    this.frameFlags.allEdges ||= allEdges;
    if (this.frameHandle != null) return;
    this.frameHandle = requestAnimationFrame(() => this.flushFrame());
  }

  flushScheduledFrameNow() {
    if (this.frameHandle != null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.flushFrame();
  }

  flushFrame() {
    this.frameHandle = null;
    const flags = this.frameFlags;
    this.frameFlags = { camera: false, culling: false, pointer: false, allEdges: false };

    if (flags.pointer) this.processPointerState(flags);
    if (flags.camera) this.applyCameraTransform();

    const dirtyPositions = [...this.dirtyNodePositions];
    this.dirtyNodePositions.clear();
    dirtyPositions.forEach((nodeId) => this.applyNodePosition(nodeId));

    if (flags.culling) this.updateViewportCulling();
    this.measureDirtyNodes();

    if (flags.allEdges) this.edgeElements.forEach((_path, edgeId) => this.dirtyEdges.add(edgeId));
    const dirtyEdges = [...this.dirtyEdges];
    this.dirtyEdges.clear();
    dirtyEdges.forEach((edgeId) => this.updateEdgePath(edgeId));

    if (flags.culling) this.updateEdgeCulling();
    else if (dirtyEdges.length) this.updateEdgeCulling(dirtyEdges);
    if (
      this.frameFlags.camera ||
      this.frameFlags.culling ||
      this.frameFlags.pointer ||
      this.frameFlags.allEdges ||
      this.dirtyNodePositions.size ||
      this.dirtyGeometry.size ||
      this.dirtyEdges.size
    ) {
      this.requestFrame();
    }
  }

  processPointerState(flags) {
    const pointer = this.latestPointer;
    this.latestPointer = null;
    if (!pointer) return;
    if (this.panOrigin) {
      this.graph.view.panX = this.panOrigin.panX + pointer.clientX - this.panOrigin.x;
      this.graph.view.panY = this.panOrigin.panY + pointer.clientY - this.panOrigin.y;
      flags.camera = true;
      flags.culling = true;
    }
    if (this.draggingNode) {
      const screen = this.clientToScreen(pointer.clientX, pointer.clientY);
      const world = this.screenToWorld(screen);
      this.draggingNode.position.x = world.x - this.draggingOffset.x;
      this.draggingNode.position.y = world.y - this.draggingOffset.y;
      const bounds = this.nodeBounds.get(this.draggingNode.id);
      if (bounds) {
        bounds.x = this.draggingNode.position.x;
        bounds.y = this.draggingNode.position.y;
      }
      this.dirtyNodePositions.add(this.draggingNode.id);
      this.updatePortPositionsFromOffsets(this.draggingNode.id);
      this.updateIncidentEdges(this.draggingNode.id);
    }
    if (this.pendingLink?.detachEdgeId && !this.pendingLink.detachArmed) {
      const dx = pointer.clientX - this.pendingLink.detachStart.x;
      const dy = pointer.clientY - this.pendingLink.detachStart.y;
      if (Math.hypot(dx, dy) > 5) this.pendingLink.detachArmed = true;
    }
    if (this.pendingLink) {
      const showTemp = !this.pendingLink.detachEdgeId || this.pendingLink.detachArmed;
      this.updateTempLink(showTemp ? this.screenToWorld(this.clientToScreen(pointer.clientX, pointer.clientY)) : null);
    }
  }

  applyCameraTransform() {
    const { panX, panY, zoom } = this.graph.view;
    this.updateGrid();
    this.nodeLayer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    this.edgeLayer.setAttribute('transform', `translate(${panX} ${panY}) scale(${zoom})`);
    this.svg.setAttribute('width', String(this.container.clientWidth));
    this.svg.setAttribute('height', String(this.container.clientHeight));

    const lod = this.lodForZoom(zoom);
    if (lod !== this.currentLod) {
      this.currentLod = lod;
      this.container.dataset.nodeLod = lod;
      this.nodeElements.forEach((_element, nodeId) => this.applyNodeExpansionState(nodeId));
      this.visibleNodeIds.forEach((nodeId) => this.dirtyGeometry.add(nodeId));
    }
  }

  applyNodePosition(nodeId) {
    const node = this.graph.getNode?.(nodeId) || this.graph.nodes.find((candidate) => candidate.id === nodeId);
    const element = this.nodeElements.get(nodeId);
    if (!node || !element) return;
    element.style.transform = `translate(${node.position.x}px, ${node.position.y}px)`;
  }

  invalidateNodeGeometry(nodeId) {
    if (!nodeId || !this.nodeElements.has(nodeId)) return;
    this.dirtyGeometry.add(nodeId);
    this.requestFrame();
  }

  measureDirtyNodes() {
    if (!this.dirtyGeometry.size) return;
    const containerRect = this.ensureContainerRect();
    const { panX, panY, zoom } = this.graph.view;
    const nodeIds = [...this.dirtyGeometry];
    this.dirtyGeometry.clear();

    nodeIds.forEach((nodeId) => {
      const node = this.graph.getNode?.(nodeId) || this.graph.nodes.find((candidate) => candidate.id === nodeId);
      const element = this.nodeElements.get(nodeId);
      if (!node || !element || element.style.display === 'none') return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.nodeBounds.set(nodeId, {
        x: node.position.x,
        y: node.position.y,
        width: rect.width / zoom,
        height: rect.height / zoom
      });
      (this.nodePortKeys.get(nodeId) || []).forEach((key) => {
        const dot = this.portElements.get(key)?.dot;
        if (!dot) return;
        const dotRect = dot.getBoundingClientRect();
        const world = {
          x: (dotRect.left + dotRect.width / 2 - containerRect.left - panX) / zoom,
          y: (dotRect.top + dotRect.height / 2 - containerRect.top - panY) / zoom
        };
        this.portPositions.set(key, world);
        this.portOffsets.set(key, {
          x: world.x - node.position.x,
          y: world.y - node.position.y
        });
      });
      this.updateIncidentEdges(nodeId);
    });
  }

  updatePortPositionsFromOffsets(nodeId) {
    const node = this.graph.getNode?.(nodeId) || this.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    (this.nodePortKeys.get(nodeId) || []).forEach((key) => {
      const offset = this.portOffsets.get(key);
      if (!offset) return;
      this.portPositions.set(key, {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y
      });
    });
  }

  updateIncidentEdges(nodeId) {
    const edges =
      this.graph.getIncidentEdges?.(nodeId) ||
      this.graph.edges.filter((edge) => edge.from.nodeId === nodeId || edge.to.nodeId === nodeId);
    edges.forEach((edge) => this.dirtyEdges.add(edge.id));
    this.requestFrame();
  }

  fallbackPortPosition(node, direction) {
    const bounds = this.nodeBounds.get(node.id);
    return {
      x: node.position.x + (direction === 'out' ? bounds?.width || 300 : 0),
      y: node.position.y + 24
    };
  }

  updateEdgePath(edgeId) {
    const edge = this.graph.getEdge?.(edgeId) || this.graph.edges.find((candidate) => candidate.id === edgeId);
    const path = this.edgeElements.get(edgeId);
    if (!edge || !path) return;
    const fromNode = this.graph.getNode?.(edge.from.nodeId) ||
      this.graph.nodes.find((candidate) => candidate.id === edge.from.nodeId);
    const toNode = this.graph.getNode?.(edge.to.nodeId) ||
      this.graph.nodes.find((candidate) => candidate.id === edge.to.nodeId);
    if (!fromNode || !toNode) return;
    const from =
      this.portPositions.get(this.portKey(fromNode.id, edge.from.portId)) ||
      this.fallbackPortPosition(fromNode, 'out');
    const to =
      this.portPositions.get(this.portKey(toNode.id, edge.to.portId)) ||
      this.fallbackPortPosition(toNode, 'in');
    const handle = Math.max(36, Math.min(120, Math.abs(to.x - from.x) * 0.35));
    path.setAttribute('d', `M${from.x},${from.y} C${from.x + handle},${from.y} ${to.x - handle},${to.y} ${to.x},${to.y}`);
    this.edgeBounds.set(edgeId, {
      left: Math.min(from.x, to.x, from.x + handle, to.x - handle),
      right: Math.max(from.x, to.x, from.x + handle, to.x - handle),
      top: Math.min(from.y, to.y),
      bottom: Math.max(from.y, to.y)
    });
    this.applyEdgeVisualState(edgeId);
  }

  updateTempLink(cursorWorld, link = this.pendingLink) {
    if (!cursorWorld || !link?.fromNode || !link?.fromPort) {
      this.tempPath.style.display = 'none';
      this.tempPath.removeAttribute('d');
      return;
    }
    const from =
      this.portPositions.get(this.portKey(link.fromNode.id, link.fromPort.id)) ||
      this.fallbackPortPosition(link.fromNode, 'out');
    const handle = Math.max(36, Math.min(120, Math.abs(cursorWorld.x - from.x) * 0.35));
    this.tempPath.setAttribute(
      'd',
      `M${from.x},${from.y} C${from.x + handle},${from.y} ${cursorWorld.x - handle},${cursorWorld.y} ${cursorWorld.x},${cursorWorld.y}`
    );
    this.tempPath.style.display = '';
  }

  renderLinks(tempLink, cursor) {
    const graphEdgeIds = new Set(this.graph.edges.map((edge) => edge.id));
    [...this.edgeElements.keys()].forEach((edgeId) => {
      if (!graphEdgeIds.has(edgeId)) this.removeEdgeView(edgeId);
    });
    this.graph.edges.forEach((edge) => {
      if (!this.edgeElements.has(edge.id)) this.createEdgeView(edge);
      this.dirtyEdges.add(edge.id);
    });
    this.syncActiveEdgeLayer();
    if (tempLink && cursor) this.updateTempLink(this.screenToWorld(cursor), tempLink);
    else if (!this.pendingLink) this.updateTempLink(null);
    this.requestFrame({ culling: true });
  }

  ensureContainerRect() {
    if (!this.containerRect) this.containerRect = this.container.getBoundingClientRect();
    return this.containerRect;
  }

  invalidateContainerRect() {
    this.containerRect = null;
  }

  clientToScreen(clientX, clientY) {
    const rect = this.ensureContainerRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  worldViewport() {
    const rect = this.ensureContainerRect();
    const zoom = this.graph.view.zoom || 1;
    const margin = 240 / zoom;
    return {
      left: -this.graph.view.panX / zoom - margin,
      top: -this.graph.view.panY / zoom - margin,
      right: (rect.width - this.graph.view.panX) / zoom + margin,
      bottom: (rect.height - this.graph.view.panY) / zoom + margin
    };
  }

  intersectsViewport(bounds, viewport) {
    return !(
      bounds.right < viewport.left ||
      bounds.left > viewport.right ||
      bounds.bottom < viewport.top ||
      bounds.top > viewport.bottom
    );
  }

  updateViewportCulling() {
    this.invalidateContainerRect();
    const viewport = this.worldViewport();
    const forced = new Set([
      this.selectedNodeId,
      this.draggingNode?.id,
      this.pendingLink?.fromNode?.id,
      this.pendingLink?.originalTarget?.nodeId
    ].filter(Boolean));

    this.nodeElements.forEach((element, nodeId) => {
      const node = this.graph.getNode?.(nodeId) || this.graph.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      const measured = this.nodeBounds.get(nodeId);
      const bounds = {
        left: node.position.x,
        top: node.position.y,
        right: node.position.x + (measured?.width || 300),
        bottom: node.position.y + (measured?.height || 140)
      };
      const visible = forced.has(nodeId) || this.intersectsViewport(bounds, viewport);
      const isVisible = element.style.display !== 'none';
      if (visible === isVisible) return;
      element.style.display = visible ? '' : 'none';
      if (visible) {
        this.visibleNodeIds.add(nodeId);
        this.dirtyGeometry.add(nodeId);
      } else {
        this.visibleNodeIds.delete(nodeId);
      }
    });
  }

  updateEdgeCulling(edgeIds = null) {
    const viewport = this.worldViewport();
    const update = (edgeId) => {
      const path = this.edgeElements.get(edgeId);
      if (!path) return;
      const bounds = this.edgeBounds.get(edgeId);
      const highlighted = this.highlight?.highlightedEdges?.has(edgeId);
      path.style.display = !bounds || highlighted || this.intersectsViewport(bounds, viewport) ? '' : 'none';
      this.syncActiveEdgeClone(edgeId);
    };
    if (edgeIds) edgeIds.forEach(update);
    else this.edgeElements.forEach((_path, edgeId) => update(edgeId));
  }

  setInteracting(active) {
    clearTimeout(this.interactionTimer);
    if (active) {
      this.container.classList.add('is-interacting');
      return;
    }
    this.interactionTimer = setTimeout(() => this.container.classList.remove('is-interacting'), 120);
  }

  portKeyForElement(portElement) {
    return this.portKey(portElement.dataset.nodeId, portElement.dataset.portId);
  }

  highlightCompatible(type) {
    this.portElements.forEach((record) => {
      if (!record.row.classList.contains('in')) return;
      record.row.classList.toggle('compatible', record.row.dataset.type === type);
      record.row.classList.toggle('incompatible', record.row.dataset.type !== type);
    });
  }

  clearCompatible() {
    this.highlight = null;
    this.applyVisualState();
  }
}
