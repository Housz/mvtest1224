import { generateCssGradient } from '../utils/colors.js';
import { semanticizeDataNode } from '../core/nodes/DataNodes.js';

/**
 * SVG/DOM based node editor with pan/zoom and typed ports.
 */
export class NodeEditor {
  constructor(container, graphModel) {
    this.container = container;
    this.graph = graphModel;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('node-svg');
    this.container.appendChild(this.svg);
    this.nodeLayer = document.createElement('div');
    this.nodeLayer.className = 'node-layer';
    this.container.appendChild(this.nodeLayer);
    this.portPositions = new Map();
    this.draggingNode = null;
    this.draggingOffset = { x: 0, y: 0 };
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
    this.semanticStatusKeys = new Map();
    this.semanticStatusJobs = new Map();
    this.registerEvents();
    window.addEventListener('resize', () => this.render());
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.code === 'Space') {
        this.spacePanning = true;
      }
      if (e.key === 'Escape') {
        this.pendingLink = null;
        this.clearCompatible();
        this.render();
      }
      if (this.selectedNodeId && (e.key === 'Delete' || e.key === 'Backspace')) {
        this.graph.removeNode(this.selectedNodeId);
        this.selectedNodeId = null;
        this.onSelect?.(null);
        this.render();
        this.onDelete?.();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spacePanning = false;
      }
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

  renameNode(node, value) {
    const nextLabel = value.trim() || this.nodeDefinition(node)?.label || 'Node';
    node.label = nextLabel;
    if (node.kind === 'module') {
      node.params = node.params || {};
      node.params.workspaceName = nextLabel;
    }
    this.graph.syncModuleNodes?.();
    this.notifyNodeChange(node, { source: 'inline-rename', refreshInspector: this.selectedNodeId === node.id });
    this.render();
  }

  startInlineRename(node, titleEl) {
    if (!titleEl) return;
    const input = document.createElement('input');
    input.className = 'node-title-input';
    input.value = node.label || '';
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => this.renameNode(node, input.value);
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commit();
      if (event.key === 'Escape') this.render();
    });
    input.addEventListener('blur', commit);
  }

  setAllCollapsed(collapsed) {
    this.graph.nodes.forEach((node) => {
      node.params = node.params || {};
      node.params.uiCollapsed = collapsed;
    });
    this.render();
  }

  notifyNodeChange(node, options = {}) {
    this.onNodeChange?.(node, options);
  }

  semanticSignature(node) {
    const params = node.params || {};
    return JSON.stringify({
      typeId: node.typeId,
      contractId: params.contractId,
      datasetType: params.datasetType,
      sources: params.sources || {},
      roleMapping: params.roleMapping || {},
      variable: params.variable,
      unit: params.unit
    });
  }

  markSemanticStale(node) {
    if (!node?.params) return;
    delete node.params.semanticStatus;
    delete node.params.detectedRange;
    this.semanticStatusKeys.delete(node.id);
  }

  markSemanticFresh(node) {
    if (!node?.params) return;
    this.semanticStatusKeys.set(node.id, this.semanticSignature(node));
  }

  hasConfiguredSource(node) {
    return Object.values(node.params?.sources || {}).some((source) => source?.path || source?.name || source?.text);
  }

  requestDataStatusRefresh(node) {
    if (!node || node.kind !== 'data' || !this.hasConfiguredSource(node)) return;
    const signature = this.semanticSignature(node);
    if (node.params?.semanticStatus && this.semanticStatusKeys.get(node.id) === signature) return;
    const pending = this.semanticStatusJobs.get(node.id);
    if (pending?.signature === signature) return;
    const job = semanticizeDataNode(node)
      .then(() => {
        this.semanticStatusKeys.set(node.id, this.semanticSignature(node));
      })
      .catch((error) => {
        node.params = node.params || {};
        node.params.semanticStatus = {
          valid: false,
          errors: 1,
          warnings: 0,
          summary: { message: error.message || String(error) }
        };
        this.semanticStatusKeys.set(node.id, signature);
      })
      .finally(() => {
        const current = this.semanticStatusJobs.get(node.id);
        if (current?.job === job) this.semanticStatusJobs.delete(node.id);
        this.render();
        this.notifyNodeChange(node, { source: 'semantic-status', refreshInspector: this.selectedNodeId === node.id });
      });
    this.semanticStatusJobs.set(node.id, { signature, job });
  }

  refreshDataStatuses() {
    this.graph.nodes.filter((node) => node.kind === 'data').forEach((node) => this.requestDataStatusRefresh(node));
  }

  stopControlPointer(event) {
    event.stopPropagation();
  }

  sourceDisplayLabel(sourceKey, source) {
    const fallback = String(sourceKey).replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
    return (source?.label || fallback).replace(/\b(JSON|OBJ|CSV)\b/g, '').replace(/\s+/g, ' ').trim() || fallback;
  }

  sourceStatus(node, source) {
    if (!source?.path && !source?.name && !source?.text) return { label: 'Missing', tone: 'missing' };
    if (this.semanticStatusJobs.has(node.id)) return { label: 'Checking', tone: 'set' };
    const semantic = node.params?.semanticStatus;
    if (semantic?.valid === true) return { label: 'Ready', tone: 'ready' };
    if (semantic?.valid === false) return { label: 'Check', tone: 'warning' };
    return { label: 'Source set', tone: 'set' };
  }

  incomingNode(node, portId) {
    const edge = this.graph.edges.find((item) => item.to.nodeId === node.id && item.to.portId === portId);
    return edge ? this.graph.nodes.find((item) => item.id === edge.from.nodeId) : null;
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
    this.render();
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
            this.render();
          });
          const sourceInputRow = document.createElement('div');
          sourceInputRow.className = 'node-inline-source-input';
          sourceInputRow.appendChild(input);

          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.hidden = true;
          this.bindInlineEvents(fileInput);
          fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            node.params.sources[sourceKey].path = file.name;
            node.params.sources[sourceKey].name = file.name;
            node.params.sources[sourceKey].text = await file.text();
            delete node.params.sources[sourceKey].data;
            this.markSemanticStale(node);
            this.requestDataStatusRefresh(node);
            this.notifyNodeChange(node, { source: 'inline-source', refreshInspector: true });
            this.render();
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
        this.render();
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
    this.render();
  }

  buildUpstreamSubgraph(rootNodeId) {
    const nodes = new Set();
    const edges = new Set();
    const visit = (nodeId) => {
      if (!nodeId || nodes.has(nodeId)) return;
      nodes.add(nodeId);
      const node = this.graph.nodes.find((item) => item.id === nodeId);
      if (!node || node.kind === 'data') return;
      this.graph.edges
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
    const highlightedPorts = [this.portKey(moduleNodeId, modulePortId)];
    this.highlight = {
      mode: 'function',
      nodes: subgraph.nodes,
      highlightedEdges: subgraph.edges,
      highlightedPorts: new Set(highlightedPorts),
      compatiblePorts: new Set(),
      incompatiblePorts: new Set()
    };
    this.render();
  }

  highlightForPort(node, port) {
    const key = this.portKey(node.id, port.id);
    if (port.direction === 'out') {
      this.pendingLink = { fromNode: node, fromPort: port };
      if (port.type === 'OperatorRef') {
        const connectedModuleEdges = this.graph.edges.filter(
          (edge) =>
            edge.from.nodeId === node.id &&
            edge.from.portId === port.id &&
            this.graph.nodes.find((item) => item.id === edge.to.nodeId)?.kind === 'module'
        );
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

    const inbound = this.graph.edges.find((edge) => edge.to.nodeId === node.id && edge.to.portId === port.id);
    if (node.kind === 'module' && port.type === 'OperatorRef') {
      if (inbound) {
        this.setFunctionHighlight(inbound.from.nodeId, node.id, port.id);
      } else {
        this.setPortHighlight({ highlightedPorts: [key] });
      }
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

  registerEvents() {
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.container.getBoundingClientRect();
      const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const worldBefore = this.screenToWorld(pointer);
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const nextZoom = Math.max(0.45, Math.min(2.5, this.graph.view.zoom * factor));
      this.graph.view.zoom = nextZoom;
      this.graph.view.panX = pointer.x - worldBefore.x * nextZoom;
      this.graph.view.panY = pointer.y - worldBefore.y * nextZoom;
      this.render();
    });

    const startPan = (e) => {
      this.container.setPointerCapture(e.pointerId);
      this.panOrigin = { x: e.clientX, y: e.clientY, panX: this.graph.view.panX, panY: this.graph.view.panY };
    };
    const isBackgroundTarget = (target) => target === this.container || target === this.nodeLayer || target === this.svg;
    ['pointerdown'].forEach((evt) => {
      this.container.addEventListener(evt, (e) => {
        const isBackground = isBackgroundTarget(e.target);
        if (isBackground && e.button === 0) {
          this.selectedNodeId = null;
          this.pendingLink = null;
          this.clearCompatible();
          this.onSelect?.(null);
          this.render();
        }
        if (e.button === 1 || e.altKey || this.spacePanning || (isBackground && e.button === 0)) {
          startPan(e);
        }
      });
    });

    this.container.addEventListener('contextmenu', (e) => {
      if (!isBackgroundTarget(e.target)) return;
      e.preventDefault();
      this.selectedNodeId = null;
      this.pendingLink = null;
      this.clearCompatible();
      this.onSelect?.(null);
      this.render();
      const rect = this.container.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.onCanvasContextMenu?.({
        clientX: e.clientX,
        clientY: e.clientY,
        screen,
        world: this.screenToWorld(screen)
      });
    });

    this.container.addEventListener('pointermove', (e) => {
      if (this.panOrigin) {
        const dx = e.clientX - this.panOrigin.x;
        const dy = e.clientY - this.panOrigin.y;
        this.graph.view.panX = this.panOrigin.panX + dx;
        this.graph.view.panY = this.panOrigin.panY + dy;
        this.render();
      }
      if (this.draggingNode) {
        const world = this.screenToWorld({ x: e.clientX - this.container.getBoundingClientRect().left, y: e.clientY - this.container.getBoundingClientRect().top });
        this.draggingNode.position.x = world.x - this.draggingOffset.x;
        this.draggingNode.position.y = world.y - this.draggingOffset.y;
        this.render();
      }
      if (this.pendingLink?.detachEdgeId && !this.pendingLink.detachArmed) {
        const dx = e.clientX - this.pendingLink.detachStart.x;
        const dy = e.clientY - this.pendingLink.detachStart.y;
        if (Math.hypot(dx, dy) > 5) this.pendingLink.detachArmed = true;
      }
      if (this.pendingLink) {
        const showTemp = !this.pendingLink.detachEdgeId || this.pendingLink.detachArmed;
        if (showTemp) {
          this.renderLinks(this.pendingLink, { x: e.clientX - this.container.getBoundingClientRect().left, y: e.clientY - this.container.getBoundingClientRect().top });
        }
      }
    });

    this.container.addEventListener('pointerup', (e) => {
      if (this.panOrigin) {
        this.container.releasePointerCapture(e.pointerId);
      }
      if (this.draggingPointerTarget && this.draggingPointerTarget.hasPointerCapture?.(e.pointerId)) {
        this.draggingPointerTarget.releasePointerCapture(e.pointerId);
      }
      if (this.pendingLink?.detachEdgeId && this.pendingLink.detachArmed) {
        this.graph.removeEdge(this.pendingLink.detachEdgeId);
      }
      this.panOrigin = null;
      this.draggingNode = null;
      this.draggingPointerTarget = null;
      this.pendingLink = null;
      this.clearCompatible();
      this.render();
    });
  }

  render() {
    this.updateGrid();
    this.refreshDataStatuses();
    this.nodeLayer.innerHTML = '';
    this.portPositions.clear();
    for (const node of this.graph.nodes) {
      const el = document.createElement('div');
      el.className = `node kind-${node.kind}`;
      if (node.id === this.selectedNodeId) el.classList.add('selected');
      if (this.highlight?.mode === 'function') {
        if (this.highlight.nodes?.has(node.id)) el.classList.add('function-related');
        else el.classList.add('function-dimmed');
      }
      const pos = this.worldToScreen(node.position);
      el.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${this.graph.view.zoom})`;
      el.dataset.id = node.id;

      const header = document.createElement('div');
      header.className = 'node-header';
      header.innerHTML = `<span class="node-title">${node.label}</span>`;
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'node-rename-toggle';
      rename.title = 'Rename node';
      rename.textContent = 'Edit';
      rename.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.startInlineRename(node, header.querySelector('.node-title'));
      });
      rename.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      const collapse = document.createElement('button');
      collapse.type = 'button';
      collapse.className = 'node-collapse-toggle';
      collapse.title = this.nodeCollapsed(node) ? 'Expand node' : 'Collapse node';
      collapse.textContent = this.nodeCollapsed(node) ? '+' : '-';
      collapse.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        node.params = node.params || {};
        node.params.uiCollapsed = !this.nodeCollapsed(node);
        this.render();
      });
      collapse.addEventListener('pointerup', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      collapse.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      header.appendChild(rename);
      header.appendChild(collapse);
      header.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.node-collapse-toggle,.node-rename-toggle,.node-title-input')) return;
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        this.draggingPointerTarget = el;
        const world = this.screenToWorld({ x: e.clientX - this.container.getBoundingClientRect().left, y: e.clientY - this.container.getBoundingClientRect().top });
        this.draggingNode = node;
        this.draggingOffset = { x: world.x - node.position.x, y: world.y - node.position.y };
        this.selectedNodeId = node.id;
        if (this.onSelect) this.onSelect(node);
      });
      el.appendChild(header);

      const body = document.createElement('div');
      body.className = 'node-body';
      body.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.selectedNodeId = node.id;
        this.onSelect?.(node);
      });
      const inlineControls = this.renderInlineControls(node);
      if (inlineControls) body.appendChild(inlineControls);
      const portsEl = document.createElement('div');
      portsEl.className = 'ports';
      const inPorts = node.ports.filter((p) => p.direction === 'in');
      const outPorts = node.ports.filter((p) => p.direction === 'out');
      const buildPort = (port, side) => {
        const pEl = document.createElement('div');
        pEl.className = `port ${port.direction}`;
        const pKey = this.portKey(node.id, port.id);
        if (this.highlight?.highlightedPorts?.has(pKey)) pEl.classList.add('highlighted');
        if (this.highlight?.compatiblePorts?.has(pKey)) pEl.classList.add('compatible');
        if (this.highlight?.incompatiblePorts?.has(pKey)) pEl.classList.add('incompatible');
        pEl.dataset.portId = port.id;
        pEl.dataset.type = port.type;
        pEl.dataset.portTheme = this.portTheme(port);
        pEl.title = port.name;
        pEl.innerHTML = `<span class="dot"></span><span class="label">${port.name}</span>`;
        pEl.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          if (port.direction === 'in') {
            const inbound = this.graph.edges.find((edge) => edge.to.nodeId === node.id && edge.to.portId === port.id);
            if (inbound) {
              const fromNode = this.graph.nodes.find((item) => item.id === inbound.from.nodeId);
              const fromPort = fromNode?.ports.find((item) => item.id === inbound.from.portId);
              if (fromNode && fromPort) {
                this.pendingLink = {
                  fromNode,
                  fromPort,
                  detachEdgeId: inbound.id,
                  detachStart: { x: e.clientX, y: e.clientY },
                  detachArmed: false,
                  originalTarget: { nodeId: node.id, portId: port.id }
                };
              }
            }
          }
          this.highlightForPort(node, port);
        });
        pEl.addEventListener('pointerup', (e) => {
          if (!this.pendingLink) return;
          if (port.direction !== 'in') return;
          if (this.pendingLink.detachEdgeId) {
            const sameOriginal =
              this.pendingLink.originalTarget?.nodeId === node.id && this.pendingLink.originalTarget?.portId === port.id;
            if (!this.pendingLink.detachArmed || sameOriginal) {
              this.pendingLink = null;
              this.clearCompatible();
              this.render();
              return;
            }
          }
          if (this.pendingLink.detachEdgeId) {
            this.graph.removeEdge(this.pendingLink.detachEdgeId);
          }
          const ok = this.graph.connect(
            { nodeId: this.pendingLink.fromNode.id, portId: this.pendingLink.fromPort.id },
            { nodeId: node.id, portId: port.id }
          );
          this.pendingLink = null;
          this.clearCompatible();
          if (ok) this.render();
        });
        pEl.addEventListener('dblclick', () => {
          const edges = this.graph.edges.filter((e) => e.from.portId === port.id && e.from.nodeId === node.id);
          const edgesIn = this.graph.edges.filter((e) => e.to.portId === port.id && e.to.nodeId === node.id);
          [...edges, ...edgesIn].forEach((ed) => this.graph.removeEdge(ed.id));
          this.render();
        });
        portsEl.appendChild(pEl);
      };
      inPorts.forEach((p) => buildPort(p, 'in'));
      outPorts.forEach((p) => buildPort(p, 'out'));
      body.appendChild(portsEl);
      el.appendChild(body);
      this.nodeLayer.appendChild(el);

      el.querySelectorAll('.port').forEach((p) => {
        const dot = p.querySelector('.dot');
        const rect = dot?.getBoundingClientRect() || p.getBoundingClientRect();
        const cRect = this.container.getBoundingClientRect();
        const x = rect.left - cRect.left + rect.width / 2;
        const y = rect.top - cRect.top + rect.height / 2;
        this.portPositions.set(`${node.id}:${p.dataset.portId}`, { x, y });
      });
    }
    this.renderLinks();
  }

  renderLinks(tempLink, cursor) {
    this.svg.setAttribute('width', this.container.clientWidth);
    this.svg.setAttribute('height', this.container.clientHeight);
    this.svg.innerHTML = '';
    const hasGraphHighlight = this.highlight?.mode === 'function';
    const hasPortHighlight = this.highlight?.mode === 'ports' && this.highlight.highlightedEdges?.size;
    const drawPath = (fromPos, toPos, color = 'rgba(255,255,255,0.3)', width = 2) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = `M${fromPos.x},${fromPos.y} C${fromPos.x + 60},${fromPos.y} ${toPos.x - 60},${toPos.y} ${toPos.x},${toPos.y}`;
      path.setAttribute('d', d);
      path.setAttribute('stroke', color);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', String(width));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.style.pointerEvents = 'auto';
      this.svg.appendChild(path);
      return path;
    };
    for (const edge of this.graph.edges) {
      const fromNode = this.graph.nodes.find((n) => n.id === edge.from.nodeId);
      const toNode = this.graph.nodes.find((n) => n.id === edge.to.nodeId);
      if (!fromNode || !toNode) continue;
      const fromPos = this.portPositions.get(`${fromNode.id}:${edge.from.portId}`) || this.worldToScreen({ x: fromNode.position.x + 180, y: fromNode.position.y + 20 });
      const toPos = this.portPositions.get(`${toNode.id}:${edge.to.portId}`) || this.worldToScreen({ x: toNode.position.x, y: toNode.position.y + 20 });
      const highlighted = this.highlight?.highlightedEdges?.has(this.edgeKey(edge));
      let color = 'rgba(255,255,255,0.3)';
      let width = 2;
      if (highlighted) {
        color = 'rgba(231, 233, 238, 0.82)';
        width = 3;
      } else if (hasGraphHighlight || hasPortHighlight) {
        color = 'rgba(255,255,255,0.08)';
      }
      const path = drawPath(fromPos, toPos, color, width);
      if (highlighted) path.classList.add('highlighted-edge');
      if (!highlighted && (hasGraphHighlight || hasPortHighlight)) path.classList.add('dimmed-edge');
      path.dataset.edgeId = edge.id;
      path.addEventListener('click', () => {
        this.graph.removeEdge(edge.id);
        this.render();
      });
    }
    if (tempLink && cursor) {
      const fromPos = this.portPositions.get(`${tempLink.fromNode.id}:${tempLink.fromPort.id}`) || this.worldToScreen({ x: tempLink.fromNode.position.x + 180, y: tempLink.fromNode.position.y + 20 });
      drawPath(fromPos, cursor, 'rgba(255,255,255,0.6)');
    }
  }

  highlightCompatible(type) {
    this.nodeLayer.querySelectorAll('.port.in').forEach((p) => {
      const portType = p.dataset.type;
      if (portType === type) p.classList.add('compatible');
      else p.classList.add('incompatible');
    });
  }

  clearCompatible() {
    this.highlight = null;
    this.nodeLayer.querySelectorAll('.port.in').forEach((p) => {
      p.classList.remove('compatible', 'incompatible', 'highlighted');
    });
    this.nodeLayer.querySelectorAll('.port.out').forEach((p) => {
      p.classList.remove('compatible', 'incompatible', 'highlighted');
    });
  }
}
