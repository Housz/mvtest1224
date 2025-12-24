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
    this.draggingPointerTarget = null;
    this.spacePanning = false;
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
        this.renderLinks();
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

  registerEvents() {
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.graph.view.zoom = Math.max(0.5, Math.min(2.5, this.graph.view.zoom * delta));
      this.render();
    });

    const startPan = (e) => {
      this.container.setPointerCapture(e.pointerId);
      this.panOrigin = { x: e.clientX, y: e.clientY, panX: this.graph.view.panX, panY: this.graph.view.panY };
    };
    ['pointerdown'].forEach((evt) => {
      this.container.addEventListener(evt, (e) => {
        const isBackground = e.target === this.container || e.target === this.nodeLayer || e.target === this.svg;
        if (e.button === 1 || e.button === 2 || e.altKey || this.spacePanning || isBackground) {
          startPan(e);
        }
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
      if (this.pendingLink) {
        this.renderLinks(this.pendingLink, { x: e.clientX - this.container.getBoundingClientRect().left, y: e.clientY - this.container.getBoundingClientRect().top });
      }
    });

    this.container.addEventListener('pointerup', (e) => {
      if (this.panOrigin) {
        this.container.releasePointerCapture(e.pointerId);
      }
      if (this.draggingPointerTarget && this.draggingPointerTarget.hasPointerCapture?.(e.pointerId)) {
        this.draggingPointerTarget.releasePointerCapture(e.pointerId);
      }
      if (this.pendingLink?.detachEdgeId) {
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
    this.nodeLayer.innerHTML = '';
    this.portPositions.clear();
    for (const node of this.graph.nodes) {
      const el = document.createElement('div');
      el.className = `node kind-${node.kind}`;
      if (node.id === this.selectedNodeId) el.classList.add('selected');
      const pos = this.worldToScreen(node.position);
      el.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${this.graph.view.zoom})`;
      el.dataset.id = node.id;

      const header = document.createElement('div');
      header.className = 'node-header';
      header.textContent = node.label;
      header.addEventListener('pointerdown', (e) => {
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
      const portsEl = document.createElement('div');
      portsEl.className = 'ports';
      const inPorts = node.ports.filter((p) => p.direction === 'in');
      const outPorts = node.ports.filter((p) => p.direction === 'out');
      const buildPort = (port, side) => {
        const pEl = document.createElement('div');
        pEl.className = `port ${port.direction}`;
        pEl.dataset.portId = port.id;
        pEl.dataset.type = port.type;
        pEl.title = `${port.name} : ${port.type}`;
        pEl.innerHTML = `<span class="dot"></span><span class="label">${port.name}</span><span class="type">${port.type}</span>`;
        pEl.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          // start link from output normally; from input only when rerouting existing edge
          if (port.direction === 'out') {
            this.pendingLink = { fromNode: node, fromPort: port };
            this.highlightCompatible(port.type);
            return;
          }
          if (port.direction === 'in') {
            const existing = this.graph.edges.find((edge) => edge.to.nodeId === node.id && edge.to.portId === port.id);
            if (existing) {
              const srcNode = this.graph.nodes.find((n) => n.id === existing.from.nodeId);
              const srcPort = srcNode?.ports.find((p) => p.id === existing.from.portId);
              if (srcNode && srcPort) {
                this.pendingLink = { fromNode: srcNode, fromPort: srcPort, detachEdgeId: existing.id };
                this.highlightCompatible(srcPort.type);
              }
            }
          }
        });
        pEl.addEventListener('pointerup', (e) => {
          if (!this.pendingLink) return;
          if (port.direction !== 'in') return;
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
        const rect = p.getBoundingClientRect();
        const cRect = this.container.getBoundingClientRect();
        const dir = p.classList.contains('out') ? 1 : -1;
        const x = dir === 1 ? rect.left - cRect.left + rect.width - 4 : rect.left - cRect.left + 4;
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
    const drawPath = (fromPos, toPos, color = 'rgba(255,255,255,0.3)') => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = `M${fromPos.x},${fromPos.y} C${fromPos.x + 60},${fromPos.y} ${toPos.x - 60},${toPos.y} ${toPos.x},${toPos.y}`;
      path.setAttribute('d', d);
      path.setAttribute('stroke', color);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '2');
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
      const path = drawPath(fromPos, toPos);
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
    this.nodeLayer.querySelectorAll('.port.in').forEach((p) => {
      p.classList.remove('compatible', 'incompatible');
    });
  }
}
