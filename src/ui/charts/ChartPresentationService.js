import * as THREE from 'three';

export const CHART_PRESENTATIONS = Object.freeze([
  'docked',
  'scene-callout',
  'world-billboard',
  'world-plane'
]);

export function normalizeChartPresentation(value) {
  const normalized = String(value || 'docked');
  return CHART_PRESENTATIONS.includes(normalized) ? normalized : 'docked';
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function resolveAnchor(anchor) {
  if (!anchor) return null;
  if (anchor.isVector3) return anchor.clone();
  if (anchor.isObject3D) return anchor.getWorldPosition(new THREE.Vector3());
  const x = Number(anchor.x ?? anchor[0]);
  const y = Number(anchor.y ?? anchor[1]);
  const z = Number(anchor.z ?? anchor[2]);
  return [x, y, z].every(Number.isFinite) ? new THREE.Vector3(x, y, z) : null;
}

export class ChartPresentationService {
  constructor({
    id = 'chart-presentation',
    sceneManager,
    chartView,
    chartElement,
    dockHost,
    anchorProvider = null,
    avoidAnchorProvider = null,
    onRequestDocked = null,
    onPresentationChange = null,
    worldScale = 1,
    occlusion = 'depth-aware'
  } = {}) {
    if (!sceneManager) throw new Error('ChartPresentationService requires a SceneManager.');
    if (!chartView || !chartElement || !dockHost) {
      throw new Error('ChartPresentationService requires a chart view, chart element, and dock host.');
    }
    this.id = id;
    this.sceneManager = sceneManager;
    this.chartView = chartView;
    this.chartElement = chartElement;
    this.dockHost = dockHost;
    this.anchorProvider = anchorProvider;
    this.avoidAnchorProvider = avoidAnchorProvider;
    this.onRequestDocked = onRequestDocked;
    this.onPresentationChange = onPresentationChange;
    this.worldScale = Math.max(0.25, Number(worldScale) || 1);
    this.occlusion = occlusion;
    this.presentation = 'docked';
    this.sceneVisible = true;
    this.dockVisible = true;
    this.disposed = false;
    this.frame = 0;
    this.textureDirty = true;
    this.worldOffset = new THREE.Vector3(0, 9, 0);
    this.planeOrientation = new THREE.Quaternion();
    this.textureCanvas = document.createElement('canvas');
    this.textureCanvas.width = 640;
    this.textureCanvas.height = 360;
    this.textureContext = this.textureCanvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.textureCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.createHosts();
    this.createWorldObjects();
    this.removeRenderListener = chartView.onRendered(() => {
      this.textureDirty = true;
      if (this.isWorldPresentation()) this.refreshTexture();
    });
    this.setPresentation('docked', { notify: false });
  }

  createHosts() {
    this.dockPlaceholder = document.createElement('div');
    this.dockPlaceholder.className = 'chart-presentation-placeholder empty-state';
    this.dockPlaceholder.innerHTML = '<span>Chart is displayed in the 3D scene.</span><button type="button">Open docked chart</button>';
    this.dockPlaceholder.querySelector('button').addEventListener('click', () => this.requestDocked());

    this.textureHost = document.createElement('div');
    this.textureHost.className = 'chart-texture-render-host';
    this.sceneManager.container.appendChild(this.textureHost);

    this.calloutOverlay = document.createElement('div');
    this.calloutOverlay.className = 'scene-chart-overlay';
    this.calloutOverlay.hidden = true;
    this.calloutOverlay.innerHTML = `
      <svg class="scene-chart-leader" aria-hidden="true">
        <line x1="0" y1="0" x2="0" y2="0"></line>
        <circle cx="0" cy="0" r="3"></circle>
      </svg>
      <section class="scene-chart-callout" aria-label="Linked time-series chart">
        <div class="scene-chart-callout-toolbar">
          <span>Linked Chart</span>
          <button type="button" class="scene-chart-dock" title="Open as docked panel">Dock</button>
        </div>
        <div class="scene-chart-callout-content"></div>
      </section>
    `;
    this.callout = this.calloutOverlay.querySelector('.scene-chart-callout');
    this.calloutContent = this.calloutOverlay.querySelector('.scene-chart-callout-content');
    this.leaderLine = this.calloutOverlay.querySelector('line');
    this.leaderDot = this.calloutOverlay.querySelector('circle');
    this.calloutOverlay.style.pointerEvents = 'none';
    this.callout.style.pointerEvents = 'auto';
    const leaderSvg = this.leaderLine?.ownerSVGElement;
    [leaderSvg, this.leaderLine, this.leaderDot].filter(Boolean).forEach((element) => {
      element.setAttribute('pointer-events', 'none');
      element.style.setProperty('pointer-events', 'none', 'important');
    });
    this.calloutOverlay.querySelector('.scene-chart-dock').addEventListener('click', () => this.requestDocked());
    this.sceneManager.container.appendChild(this.calloutOverlay);
  }

  createWorldObjects() {
    const spriteMaterial = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthTest: this.occlusion === 'depth-aware',
      depthWrite: false,
      toneMapped: false
    });
    this.billboard = new THREE.Sprite(spriteMaterial);
    this.billboard.name = this.id + '-world-billboard';
    this.billboard.visible = false;
    this.billboard.renderOrder = 88;
    this.sceneManager.scene.add(this.billboard);

    const planeMaterial = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: this.occlusion === 'depth-aware',
      depthWrite: false,
      toneMapped: false
    });
    this.worldPlane = new THREE.Mesh(new THREE.PlaneGeometry(24, 13.5), planeMaterial);
    this.worldPlane.name = this.id + '-world-plane';
    this.worldPlane.visible = false;
    this.worldPlane.renderOrder = 88;
    this.sceneManager.scene.add(this.worldPlane);
    this.sceneManager.registerChartPresentationPick?.(
      this.id,
      [this.billboard, this.worldPlane],
      () => this.requestDocked()
    );
  }

  requestDocked() {
    this.onRequestDocked?.();
  }

  isWorldPresentation() {
    return this.presentation === 'world-billboard' || this.presentation === 'world-plane';
  }

  setAnchorProvider(provider) {
    this.anchorProvider = provider;
    this.updateFrame();
  }

  getAnchor() {
    return resolveAnchor(this.anchorProvider?.());
  }

  setPresentation(value, { notify = true } = {}) {
    if (this.disposed) return;
    const next = normalizeChartPresentation(value);
    this.presentation = next;
    this.chartView.setSeriesMode?.(this.isWorldPresentation() ? 'primary-only' : 'full');
    this.calloutOverlay.hidden = next !== 'scene-callout' || !this.sceneVisible;
    this.billboard.visible = next === 'world-billboard' && this.sceneVisible;
    this.worldPlane.visible = next === 'world-plane' && this.sceneVisible;
    this.mountChartForPresentation();
    if (next === 'world-plane') this.reorientToCamera();
    if (this.isWorldPresentation()) this.refreshTexture();
    if (notify) this.onPresentationChange?.(next, { docked: next === 'docked' });
    this.updateFrame();
    this.ensureFrame();
  }

  mountChartForPresentation() {
    if (this.presentation === 'docked') {
      this.dockPlaceholder.remove();
      if (this.chartElement.parentElement !== this.dockHost) this.dockHost.appendChild(this.chartElement);
      this.chartElement.classList.remove('scene-callout-chart');
      this.chartElement.classList.remove('texture-chart');
    } else if (this.presentation === 'scene-callout') {
      if (!this.dockPlaceholder.isConnected) this.dockHost.appendChild(this.dockPlaceholder);
      if (this.chartElement.parentElement !== this.calloutContent) this.calloutContent.appendChild(this.chartElement);
      this.chartElement.classList.add('scene-callout-chart');
      this.chartElement.classList.remove('texture-chart');
    } else {
      if (!this.dockPlaceholder.isConnected) this.dockHost.appendChild(this.dockPlaceholder);
      if (this.chartElement.parentElement !== this.textureHost) this.textureHost.appendChild(this.chartElement);
      this.chartElement.classList.remove('scene-callout-chart');
      this.chartElement.classList.add('texture-chart');
    }
    requestAnimationFrame(() => {
      this.chartView.resizeToContainer();
      if (this.isWorldPresentation()) {
        this.chartView.render();
        this.textureDirty = true;
      }
    });
  }

  setSceneVisible(visible) {
    this.sceneVisible = Boolean(visible);
    this.calloutOverlay.hidden = this.presentation !== 'scene-callout' || !this.sceneVisible;
    this.billboard.visible = this.presentation === 'world-billboard' && this.sceneVisible;
    this.worldPlane.visible = this.presentation === 'world-plane' && this.sceneVisible;
  }

  setDockVisible(visible) {
    this.dockVisible = Boolean(visible);
    if (this.presentation === 'docked' && visible) this.chartView.resizeToContainer();
  }

  setWorldScale(value) {
    this.worldScale = clamp(Number(value) || 1, 0.25, 4);
    this.updateWorldScale(this.getAnchor());
  }

  setOcclusion(value) {
    this.occlusion = value === 'always-visible' ? 'always-visible' : 'depth-aware';
    const depthTest = this.occlusion === 'depth-aware';
    this.billboard.material.depthTest = depthTest;
    this.worldPlane.material.depthTest = depthTest;
    this.billboard.material.needsUpdate = true;
    this.worldPlane.material.needsUpdate = true;
  }

  setWorldOffset(offset = {}) {
    const next = resolveAnchor(offset);
    if (next) this.worldOffset.copy(next);
  }

  reorientToCamera() {
    this.planeOrientation.copy(this.sceneManager.camera.quaternion);
    this.worldPlane.quaternion.copy(this.planeOrientation);
  }

  refreshTexture() {
    if (this.disposed || !this.textureDirty) return;
    const source = this.chartView.getRenderedCanvas();
    if (!source || !source.width || !source.height || !this.textureContext) return;
    const context = this.textureContext;
    context.clearRect(0, 0, this.textureCanvas.width, this.textureCanvas.height);
    context.fillStyle = 'rgba(8, 15, 24, 0.94)';
    context.fillRect(0, 0, this.textureCanvas.width, this.textureCanvas.height);
    context.drawImage(source, 0, 0, this.textureCanvas.width, this.textureCanvas.height);
    this.texture.needsUpdate = true;
    this.textureDirty = false;
  }

  ensureFrame() {
    if (this.frame || this.disposed || this.presentation === 'docked') return;
    const tick = () => {
      this.frame = 0;
      if (this.disposed || this.presentation === 'docked') return;
      this.updateFrame();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  updateFrame() {
    if (this.disposed) return;
    const anchor = this.getAnchor();
    if (!anchor) {
      this.calloutOverlay.hidden = true;
      this.billboard.visible = false;
      this.worldPlane.visible = false;
      return;
    }
    if (this.presentation === 'scene-callout') this.updateCallout(anchor);
    if (this.isWorldPresentation()) this.updateWorldObject(anchor);
  }

  updateCallout(anchor) {
    if (!this.sceneVisible) return;
    const container = this.sceneManager.container;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const projected = anchor.clone().project(this.sceneManager.camera);
    const visible = projected.z >= -1 && projected.z <= 1;
    this.calloutOverlay.hidden = !visible;
    if (!visible) return;
    const anchorX = (projected.x * 0.5 + 0.5) * width;
    const anchorY = (-projected.y * 0.5 + 0.5) * height;
    const calloutWidth = Math.min(
      clamp(width * 0.32, 220, 380),
      Math.max(140, width * 0.48),
      Math.max(1, width - 16)
    );
    const calloutHeight = Math.min(
      clamp(height * 0.3, 160, 250),
      Math.max(110, height * 0.46),
      Math.max(1, height - 16)
    );
    const maxLeft = Math.max(8, width - calloutWidth - 8);
    const maxTop = Math.max(8, height - calloutHeight - 8);
    const nearTop = clamp(anchorY - calloutHeight * 0.5, 8, maxTop);
    const candidates = [
      { left: clamp(anchorX + 24, 8, maxLeft), top: nearTop },
      { left: clamp(anchorX - calloutWidth - 24, 8, maxLeft), top: nearTop },
      { left: 8, top: 8 },
      { left: maxLeft, top: 8 },
      { left: 8, top: maxTop },
      { left: maxLeft, top: maxTop },
      { left: clamp(anchorX - calloutWidth * 0.5, 8, maxLeft), top: 8 },
      { left: clamp(anchorX - calloutWidth * 0.5, 8, maxLeft), top: maxTop }
    ];
    const obstaclePoints = (this.avoidAnchorProvider?.() || [])
      .map(resolveAnchor)
      .filter(Boolean)
      .map((point) => point.project(this.sceneManager.camera))
      .filter((point) => point.z >= -1 && point.z <= 1)
      .map((point) => ({
        x: (point.x * 0.5 + 0.5) * width,
        y: (-point.y * 0.5 + 0.5) * height
      }));
    const score = ({ left, top }) => {
      const right = left + calloutWidth;
      const bottom = top + calloutHeight;
      const covered = obstaclePoints.reduce((count, point) => (
        point.x >= left - 10 && point.x <= right + 10 &&
        point.y >= top - 10 && point.y <= bottom + 10
          ? count + 1
          : count
      ), 0);
      const anchorCovered = anchorX >= left && anchorX <= right && anchorY >= top && anchorY <= bottom;
      const closestX = clamp(anchorX, left, right);
      const closestY = clamp(anchorY, top, bottom);
      return covered * 10000
        + (anchorCovered ? 50000 : 0)
        + Math.hypot(anchorX - closestX, anchorY - closestY);
    };
    const placement = candidates.reduce(
      (best, candidate) => score(candidate) < score(best) ? candidate : best,
      candidates[0]
    );
    const { left, top } = placement;
    this.callout.style.width = calloutWidth + 'px';
    this.callout.style.height = calloutHeight + 'px';
    this.callout.style.transform = 'translate3d(' + Math.round(left) + 'px,' + Math.round(top) + 'px,0)';
    const targetX = anchorX < left ? left : anchorX > left + calloutWidth ? left + calloutWidth : clamp(anchorX, left, left + calloutWidth);
    const targetY = clamp(anchorY, top + 20, top + calloutHeight - 12);
    this.leaderLine.setAttribute('x1', String(anchorX));
    this.leaderLine.setAttribute('y1', String(anchorY));
    this.leaderLine.setAttribute('x2', String(targetX));
    this.leaderLine.setAttribute('y2', String(targetY));
    this.leaderDot.setAttribute('cx', String(anchorX));
    this.leaderDot.setAttribute('cy', String(anchorY));
  }

  updateWorldScale(anchor) {
    if (!anchor) return;
    const distance = this.sceneManager.camera.position.distanceTo(anchor);
    const distanceFactor = clamp(distance / 240, 0.65, 2.4);
    const width = 24 * this.worldScale * distanceFactor;
    const height = 13.5 * this.worldScale * distanceFactor;
    this.billboard.scale.set(width, height, 1);
    this.worldPlane.scale.setScalar(this.worldScale);
    const opacity = distance > 2200 ? clamp(1 - (distance - 2200) / 1200, 0, 1) : 1;
    this.billboard.material.opacity = opacity;
    this.worldPlane.material.opacity = opacity;
  }

  updateWorldObject(anchor) {
    const position = anchor.clone().add(this.worldOffset);
    this.billboard.position.copy(position);
    this.worldPlane.position.copy(position);
    this.worldPlane.quaternion.copy(this.planeOrientation);
    this.billboard.visible = this.sceneVisible && this.presentation === 'world-billboard';
    this.worldPlane.visible = this.sceneVisible && this.presentation === 'world-plane';
    this.updateWorldScale(anchor);
    this.refreshTexture();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.removeRenderListener?.();
    this.sceneManager.unregisterChartPresentationPick?.(this.id);
    this.sceneManager.scene.remove(this.billboard);
    this.sceneManager.scene.remove(this.worldPlane);
    this.billboard.material.dispose();
    this.worldPlane.geometry.dispose();
    this.worldPlane.material.dispose();
    this.texture.dispose();
    this.calloutOverlay.remove();
    this.textureHost.remove();
    this.dockPlaceholder.remove();
  }
}
