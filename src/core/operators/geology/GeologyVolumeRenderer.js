import * as THREE from 'three';
import { sampleColor } from '../../../utils/colors.js';

function numericRange(values = []) {
  let min = Infinity;
  let max = -Infinity;
  const source = values || [];
  for (let index = 0; index < source.length; index += 1) {
    const numeric = Number(source[index]);
    if (!Number.isFinite(numeric)) continue;
    if (numeric < min) min = numeric;
    if (numeric > max) max = numeric;
  }
  return min === Infinity ? { min: 0, max: 1 } : { min, max };
}

function numberOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function filterModeCode(params = {}) {
  return params.filterMode === 'selected-only' || params.filterMode === 'hide-filtered' ? 1 : 0;
}

function glyphUniforms(params = {}) {
  return {
    uFilterMin: { value: clamp01(params.volumeFilterMin ?? 0) },
    uFilterMax: { value: clamp01(params.volumeFilterMax ?? 1) },
    uFilterMode: { value: filterModeCode(params) },
    uSelectedOpacity: { value: Math.max(0, Math.min(1, numberOr(params.selectedOpacity ?? params.attributeModelOpacity ?? params.attributeLayerOpacity, 0.85))) },
    uContextOpacity: { value: Math.max(0, Math.min(0.75, numberOr(params.showContextElements === false ? 0 : params.contextOpacity, 0.12))) },
    uPointSize: { value: Math.max(1, Math.min(36, numberOr(params.volumePointSize, 7))) }
  };
}

function updateGlyphUniforms(material, params = {}) {
  if (!material?.userData?.attributeGlyph || !material.uniforms) return;
  material.uniforms.uFilterMin.value = clamp01(params.volumeFilterMin ?? 0);
  material.uniforms.uFilterMax.value = clamp01(params.volumeFilterMax ?? 1);
  material.uniforms.uFilterMode.value = filterModeCode(params);
  material.uniforms.uSelectedOpacity.value = Math.max(0, Math.min(1, numberOr(params.selectedOpacity ?? params.attributeModelOpacity ?? params.attributeLayerOpacity, 0.85)));
  material.uniforms.uContextOpacity.value = Math.max(0, Math.min(0.75, numberOr(params.showContextElements === false ? 0 : params.contextOpacity, 0.12)));
  material.uniforms.uPointSize.value = Math.max(1, Math.min(36, numberOr(params.volumePointSize, material.uniforms.uPointSize.value || 7)));
  material.needsUpdate = true;
}

export function resolveVolumeBinaryAttributeKey(dataset, active) {
  const keys = Object.keys(dataset?.binaryAttributes || {});
  if (!keys.length || !active) return null;
  if (dataset.binaryAttributes[active]) return active;
  const schema = (dataset.attributes || []).find((attribute) =>
    [attribute.attributeName, attribute.name, attribute.key].some((value) => String(value ?? '').toLowerCase() === String(active).toLowerCase())
  );
  if (schema) {
    const matched = [schema.key, schema.attributeName, schema.name].find((value) => dataset.binaryAttributes?.[value]);
    if (matched) return matched;
  }
  return keys.find((key) => key.toLowerCase() === String(active).toLowerCase()) || null;
}

export function gridDimensions(grid = {}) {
  return {
    nx: Number(grid.nx ?? grid.width ?? 0),
    ny: Number(grid.ny ?? grid.height ?? 0),
    nz: Number(grid.nz ?? grid.depth ?? 0)
  };
}

export function gridBounds(grid = {}) {
  const origin = grid.origin || grid.bounds?.min || [0, 0, 0];
  const cell = grid.cellSize || [1, 1, 1];
  const { nx, ny, nz } = gridDimensions(grid);
  const min = grid.bounds?.min || origin;
  const max =
    grid.bounds?.max ||
    [
      Number(origin[0] || 0) + nx * Number(cell[0] ?? cell ?? 1),
      Number(origin[1] || 0) + ny * Number(cell[1] ?? cell ?? 1),
      Number(origin[2] || 0) + nz * Number(cell[2] ?? cell ?? 1)
    ];
  return {
    min: new THREE.Vector3(Number(min[0]) || 0, Number(min[1]) || 0, Number(min[2]) || 0),
    max: new THREE.Vector3(Number(max[0]) || 0, Number(max[1]) || 0, Number(max[2]) || 0)
  };
}

export function volumeAttributeRange(dataset, active, fallbackValues = []) {
  const schema = (dataset?.attributes || []).find((attribute) =>
    [attribute.attributeName, attribute.name, attribute.key].some((value) => String(value ?? '').toLowerCase() === String(active).toLowerCase())
  );
  if (Number.isFinite(Number(schema?.min)) && Number.isFinite(Number(schema?.max))) return { min: Number(schema.min), max: Number(schema.max) };
  const cached = dataset?.getNumericRange?.(active, fallbackValues);
  if (cached) return cached;
  return numericRange(fallbackValues);
}

export function volumeAttributeMeta(dataset, active, values) {
  const schema = (dataset?.attributes || []).find((attribute) =>
    [attribute.attributeName, attribute.name, attribute.key].some((value) => String(value ?? '').toLowerCase() === String(active).toLowerCase())
  );
  const range = volumeAttributeRange(dataset, active, values);
  const name = String(schema?.label ?? schema?.attributeName ?? schema?.name ?? active);
  const valueType = String(schema?.valueType ?? schema?.dtype ?? schema?.type ?? '').toLowerCase();
  const lower = String(active).toLowerCase();
  const isDiscrete = lower.includes('lithology') || lower.includes('category') || lower.includes('class') || lower.endsWith('_id') || valueType.includes('category');
  return {
    name,
    unit: schema?.unit || '',
    min: range.min,
    max: range.max,
    nodata: schema?.nodata ?? schema?.noData,
    isDiscrete
  };
}

export function normalizedVolumeTextureData(values, total, meta) {
  const output = new Uint8Array(total);
  const range = meta.max - meta.min || 1;
  const nodata = meta.nodata == null || meta.nodata === '' ? null : Number(meta.nodata);
  for (let index = 0; index < total; index += 1) {
    const value = Number(values[index]);
    if (!Number.isFinite(value) || (nodata != null && value === nodata)) {
      output[index] = 0;
      continue;
    }
    output[index] = Math.round(Math.max(0, Math.min(1, (value - meta.min) / range)) * 255);
  }
  return output;
}

export function renderVolumePointsLayer({
  dataset,
  active,
  binaryKey = active,
  params = {},
  group,
  pickables = [],
  type = 'geologicalBlockCollection',
  id = 'attribute-points',
  renderOrder = 18,
  opacity = null
} = {}) {
  const grid = dataset?.grid;
  const values = dataset?.binaryAttributes?.[binaryKey];
  if (!grid || !values?.length || !group) return null;
  const { nx, ny, nz } = gridDimensions(grid);
  const total = Math.max(0, nx * ny * nz);
  const origin = grid.origin || grid.bounds?.min || [0, 0, 0];
  const cell = grid.cellSize || [1, 1, 1];
  const range = volumeAttributeRange(dataset, active, values);
  const positions = [];
  const colors = [];
  const valueNorms = [];
  const elements = [];
  const span = range.max - range.min || 1;
  for (let index = 0; index < total; index += 1) {
    const value = Number(values[index]);
    if (!Number.isFinite(value)) continue;
    const ix = index % nx;
    const iy = Math.floor(index / nx) % ny;
    const iz = Math.floor(index / (nx * ny));
    const x = Number(origin[0] || 0) + (ix + 0.5) * Number(cell[0] ?? cell ?? 1);
    const y = Number(origin[1] || 0) + (iy + 0.5) * Number(cell[1] ?? cell ?? 1);
    const z = Number(origin[2] || 0) + (iz + 0.5) * Number(cell[2] ?? cell ?? 1);
    positions.push(x, y, z);
    const valueNorm = clamp01((value - range.min) / span);
    const color = new THREE.Color(sampleColor(params.colormap || 'viridis', valueNorm));
    colors.push(color.r, color.g, color.b);
    valueNorms.push(valueNorm);
    elements.push({ elementId: `VOX_${ix}_${iy}_${iz}`, value, centroid: { x, y, z }, gridIndex: [ix, iy, iz] });
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('valueNorm', new THREE.Float32BufferAttribute(valueNorms, 1));
  const pointSize = Math.max(3, Math.min(18, Number(params.volumePointSize) || Number(cell[0] ?? cell ?? 1) * 0.18 || 7));
  const material = createAttributePointsMaterial({
    ...params,
    volumePointSize: pointSize,
    attributeLayerOpacity: opacity ?? params.attributeLayerOpacity,
    attributeModelOpacity: opacity ?? params.attributeModelOpacity
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = renderOrder;
  points.userData.geologyPick = { type, id, elements, activeAttribute: active };
  pickables.push(points);
  group.add(points);
  return points;
}

function createAttributePointsMaterial(params = {}) {
  const vertexShader = /* glsl */ `
    precision highp float;
    attribute vec3 position;
    attribute vec3 color;
    attribute float valueNorm;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    uniform float uFilterMin;
    uniform float uFilterMax;
    uniform float uPointSize;
    varying vec3 vColor;
    varying float vInRange;
    void main() {
      vColor = color;
      vInRange = step(uFilterMin, valueNorm) * step(valueNorm, uFilterMax);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = uPointSize * mix(0.72, 1.18, vInRange);
      gl_PointSize *= clamp(300.0 / max(80.0, -mvPosition.z), 0.45, 1.85);
      gl_Position = projectionMatrix * mvPosition;
    }
  `;
  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform float uFilterMode;
    uniform float uSelectedOpacity;
    uniform float uContextOpacity;
    varying vec3 vColor;
    varying float vInRange;
    void main() {
      vec2 p = gl_PointCoord - vec2(0.5);
      if (dot(p, p) > 0.25) discard;
      if (uFilterMode > 0.5 && vInRange < 0.5) discard;
      vec3 contextColor = vec3(0.28, 0.33, 0.41);
      vec3 color = mix(contextColor, vColor, mix(0.24, 1.0, vInRange));
      float alpha = mix(uContextOpacity, uSelectedOpacity, vInRange);
      if (alpha <= 0.01) discard;
      gl_FragColor = vec4(color, alpha);
    }
  `;
  const material = new THREE.RawShaderMaterial({
    uniforms: glyphUniforms({ ...params, volumePointSize: params.volumePointSize || 7 }),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  material.userData.attributeGlyph = true;
  return material;
}

export { createAttributePointsMaterial };

export function createAttributeBoxMaterial(params = {}) {
  const vertexShader = /* glsl */ `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    attribute mat4 instanceMatrix;
    attribute vec3 instanceBaseColor;
    attribute float instanceValueNorm;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    uniform mat3 normalMatrix;
    uniform float uFilterMin;
    uniform float uFilterMax;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vInRange;
    void main() {
      vColor = instanceBaseColor;
      vInRange = step(uFilterMin, instanceValueNorm) * step(instanceValueNorm, uFilterMax);
      vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }
  `;
  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform float uFilterMode;
    uniform float uSelectedOpacity;
    uniform float uContextOpacity;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vInRange;
    void main() {
      if (uFilterMode > 0.5 && vInRange < 0.5) discard;
      vec3 lightDir = normalize(vec3(0.35, 0.55, 0.76));
      float diffuse = max(dot(normalize(vNormal), lightDir), 0.0);
      vec3 contextColor = vec3(0.27, 0.32, 0.39);
      vec3 color = mix(contextColor, vColor, mix(0.22, 1.0, vInRange));
      color *= 0.48 + 0.52 * diffuse;
      float alpha = mix(uContextOpacity, uSelectedOpacity, vInRange);
      if (alpha <= 0.01) discard;
      gl_FragColor = vec4(color, alpha);
    }
  `;
  const material = new THREE.RawShaderMaterial({
    uniforms: glyphUniforms(params),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  material.userData.attributeGlyph = true;
  return material;
}

export function createAttributeSurfaceMaterial(params = {}) {
  const vertexShader = /* glsl */ `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec3 color;
    attribute float valueNorm;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    uniform mat3 normalMatrix;
    uniform float uFilterMin;
    uniform float uFilterMax;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vInRange;
    void main() {
      vColor = color;
      vNormal = normalize(normalMatrix * normal);
      vInRange = step(uFilterMin, valueNorm) * step(valueNorm, uFilterMax);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform float uFilterMode;
    uniform float uSelectedOpacity;
    uniform float uContextOpacity;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vInRange;
    void main() {
      if (uFilterMode > 0.5 && vInRange < 0.5) discard;
      vec3 contextColor = vec3(0.26, 0.31, 0.38);
      vec3 color = mix(contextColor, vColor, mix(0.18, 1.0, vInRange));
      vec3 lightDir = normalize(vec3(0.32, 0.48, 0.82));
      float diffuse = max(dot(normalize(vNormal), lightDir), 0.0);
      color *= 0.62 + 0.38 * diffuse;
      float alpha = mix(uContextOpacity, uSelectedOpacity, vInRange);
      if (alpha <= 0.01) discard;
      gl_FragColor = vec4(color, alpha);
    }
  `;
  const material = new THREE.RawShaderMaterial({
    uniforms: glyphUniforms(params),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  material.userData.attributeGlyph = true;
  return material;
}

export function updateAttributeGlyphLayerUniforms(group, params = {}) {
  group?.traverse?.((child) => {
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => updateGlyphUniforms(material, params));
  });
}

export function createVolumeRenderingMesh({
  dataset,
  active,
  binaryKey = active,
  params = {},
  mode = 'volume',
  group,
  pickables = [],
  type = 'geologicalVolume',
  id = `volume:${active}`,
  renderOrder = 18,
  opacityScale = 1
} = {}) {
  const grid = dataset?.grid;
  const values = dataset?.binaryAttributes?.[binaryKey];
  if (!grid || !values?.length || !THREE.Data3DTexture || !group) return null;
  const { nx, ny, nz } = gridDimensions(grid);
  const total = Math.max(0, nx * ny * nz);
  if (!total) return null;
  const meta = volumeAttributeMeta(dataset, active, values);
  const texture = new THREE.Data3DTexture(normalizedVolumeTextureData(values, total, meta), nx, ny, nz);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  const vertexShader = /* glsl */ `
    in vec3 position;
    uniform mat4 modelMatrix;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    uniform vec3 cameraPos;
    out vec3 vOrigin;
    out vec3 vDirection;
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vOrigin = vec3(inverse(modelMatrix) * vec4(cameraPos, 1.0)).xyz;
      vDirection = position - vOrigin;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;
  const fragmentShader = /* glsl */ `
    precision highp float;
    precision highp sampler3D;
    in vec3 vOrigin;
    in vec3 vDirection;
    out vec4 color;
    uniform sampler3D map;
    uniform float opacity;
    uniform float steps;
    uniform int uRenderMode;
    uniform float uIsoThreshold;
    uniform float uFilterMin;
    uniform float uFilterMax;
    uniform bool uIsDiscrete;
    uniform vec3 uVolDims;
    uniform vec3 uPickedCoord;
    uniform vec3 uClipMin;
    uniform vec3 uClipMax;

    vec3 discreteColor(float n) {
      float id = floor(n * 255.0 + 0.5);
      if (id < 0.5) return vec3(0.0);
      float r = fract(sin(id * 12.9898) * 43758.5453);
      float g = fract(sin(id * 78.233) * 43758.5453);
      float b = fract(sin(id * 34.123) * 43758.5453);
      return vec3(0.2) + 0.8 * vec3(r, g, b);
    }

    vec3 continuousColor(float t) {
      return vec3(
        smoothstep(0.5, 0.8, t) + smoothstep(0.95, 1.0, t) * 0.5,
        smoothstep(0.1, 0.45, t) - smoothstep(0.8, 1.0, t),
        smoothstep(0.0, 0.2, t) - smoothstep(0.6, 0.9, t)
      );
    }

    vec3 gradientAt(vec3 p) {
      vec3 eps = vec3(1.0) / uVolDims;
      float dx = texture(map, clamp(p + vec3(eps.x, 0.0, 0.0), 0.0, 1.0)).r - texture(map, clamp(p - vec3(eps.x, 0.0, 0.0), 0.0, 1.0)).r;
      float dy = texture(map, clamp(p + vec3(0.0, eps.y, 0.0), 0.0, 1.0)).r - texture(map, clamp(p - vec3(0.0, eps.y, 0.0), 0.0, 1.0)).r;
      float dz = texture(map, clamp(p + vec3(0.0, 0.0, eps.z), 0.0, 1.0)).r - texture(map, clamp(p - vec3(0.0, 0.0, eps.z), 0.0, 1.0)).r;
      return normalize(vec3(dx, dy, dz));
    }

    vec3 litColor(vec3 pos, vec3 normal, vec3 baseColor, vec3 viewDir) {
      vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
      vec3 ambient = 0.32 * baseColor;
      float diff = max(dot(normal, lightDir), 0.0);
      vec3 diffuse = diff * baseColor;
      vec3 reflectDir = reflect(-lightDir, normal);
      float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
      return ambient + diffuse + vec3(0.28) * spec;
    }

    vec2 hitBox(vec3 orig, vec3 dir) {
      const vec3 boxMin = vec3(-0.5);
      const vec3 boxMax = vec3(0.5);
      vec3 invDir = 1.0 / dir;
      vec3 tminTmp = (boxMin - orig) * invDir;
      vec3 tmaxTmp = (boxMax - orig) * invDir;
      vec3 tmin = min(tminTmp, tmaxTmp);
      vec3 tmax = max(tminTmp, tmaxTmp);
      float t0 = max(tmin.x, max(tmin.y, tmin.z));
      float t1 = min(tmax.x, min(tmax.y, tmax.z));
      return vec2(t0, t1);
    }

    void main() {
      vec3 rayDir = normalize(vDirection);
      vec2 bounds = hitBox(vOrigin, rayDir);
      if (bounds.x > bounds.y) discard;
      bounds.x = max(bounds.x, 0.0);
      vec3 p = vOrigin + bounds.x * rayDir;
      vec3 inc = 1.0 / abs(rayDir);
      float delta = min(inc.x, min(inc.y, inc.z)) / steps;
      vec4 ac = vec4(0.0);

      for (float t = bounds.x; t < bounds.y; t += delta) {
        vec3 texCoord = p + 0.5;
        if (any(lessThan(texCoord, uClipMin)) || any(greaterThan(texCoord, uClipMax))) {
          p += rayDir * delta;
          continue;
        }
        float val = texture(map, texCoord).r;
        if (uRenderMode == 1) {
          if (val >= uIsoThreshold && val >= uFilterMin && val <= uFilterMax) {
            vec3 col = uIsDiscrete ? discreteColor(val) : continuousColor(val);
            vec3 normal = gradientAt(texCoord);
            if (length(normal) < 0.1) normal = -rayDir;
            vec3 shaded = litColor(p, normal, col, -rayDir);
            color = vec4(shaded, 1.0);
            ivec3 currentIdx = ivec3(floor(texCoord * uVolDims));
            if (currentIdx == ivec3(uPickedCoord)) color.rgb = vec3(1.0);
            return;
          }
        } else {
          if (val >= uFilterMin && val <= uFilterMax) {
            vec3 col = uIsDiscrete ? discreteColor(val) : continuousColor(val);
            ivec3 currentIdx = ivec3(floor(texCoord * uVolDims));
            float localAlpha = opacity;
            if (currentIdx == ivec3(uPickedCoord)) {
              col = vec3(1.0);
              localAlpha = 1.0;
            } else if (uPickedCoord.x >= 0.0) {
              localAlpha *= 0.15;
              col *= 0.5;
            }
            ac.rgb += (1.0 - ac.a) * localAlpha * col;
            ac.a += (1.0 - ac.a) * localAlpha;
            if (ac.a >= 0.98) break;
          }
        }
        p += rayDir * delta;
      }
      color = ac;
      if (color.a <= 0.001) discard;
    }
  `;

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      map: { value: texture },
      cameraPos: { value: new THREE.Vector3() },
      uRenderMode: { value: mode === 'isosurface' ? 1 : 0 },
      uIsoThreshold: { value: numberOr(params.volumeIsoValue, 0.5) },
      uFilterMin: { value: numberOr(params.volumeFilterMin, 0) },
      uFilterMax: { value: numberOr(params.volumeFilterMax, 1) },
      opacity: { value: (0.62 + 0.38 * Math.max(0, Math.min(1, numberOr(params.attributeModelOpacity ?? params.attributeLayerOpacity, 1)))) * Math.max(0, Math.min(1, numberOr(params.volumeOpacity, 0.5))) * opacityScale },
      steps: { value: Number(params.volumeRaySteps) || Math.max(96, Math.min(320, Math.max(nx, ny, nz) * 3)) },
      uIsDiscrete: { value: !!meta.isDiscrete },
      uVolDims: { value: new THREE.Vector3(nx, ny, nz) },
      uPickedCoord: { value: new THREE.Vector3(-1, -1, -1) },
      uClipMin: { value: new THREE.Vector3(numberOr(params.volumeClipXMin, 0), numberOr(params.volumeClipYMin, 0), numberOr(params.volumeClipZMin, 0)) },
      uClipMax: { value: new THREE.Vector3(numberOr(params.volumeClipXMax, 1), numberOr(params.volumeClipYMax, 1), numberOr(params.volumeClipZMax, 1)) }
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  material.userData.volumeOpacity = numberOr(params.volumeOpacity, 0.5);
  material.userData.keepDepthWrite = false;

  const bounds = gridBounds(grid);
  const size = bounds.max.clone().sub(bounds.min);
  const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    material.uniforms.cameraPos.value.copy(camera.position);
  };
  mesh.name = `geological-volume:${active}`;
  mesh.scale.copy(size);
  mesh.position.copy(center);
  mesh.renderOrder = renderOrder;
  mesh.userData.geologyPick = {
    type,
    id,
    label: active,
    activeAttribute: active,
    centroid: { x: center.x, y: center.y, z: center.z },
    size: { x: size.x, y: size.y, z: size.z },
    value: `${meta.min} - ${meta.max}${meta.unit ? ` ${meta.unit}` : ''}`,
    volumeData: { grid, values, meta, active, nx, ny, nz }
  };
  pickables.push(mesh);
  group.add(mesh);
  return mesh;
}

export function updateVolumeLayerUniforms(group, params = {}, mode = 'volume') {
  group?.traverse?.((child) => {
    const material = child.material;
    if (material?.uniforms?.map) {
      material.userData.volumeOpacity = numberOr(params.volumeOpacity, 0.5);
      material.uniforms.uRenderMode.value = mode === 'isosurface' ? 1 : 0;
      material.uniforms.uIsoThreshold.value = numberOr(params.volumeIsoValue, 0.5);
      material.uniforms.uFilterMin.value = numberOr(params.volumeFilterMin, 0);
      material.uniforms.uFilterMax.value = numberOr(params.volumeFilterMax, 1);
      const layerOpacity = Math.max(0, Math.min(1, numberOr(params.attributeModelOpacity ?? params.attributeLayerOpacity, 1)));
      material.uniforms.opacity.value = (0.62 + 0.38 * layerOpacity) * Math.max(0, Math.min(1, numberOr(params.volumeOpacity, 0.5)));
      material.uniforms.steps.value = Number(params.volumeRaySteps) || 200;
      material.uniforms.uClipMin.value.set(numberOr(params.volumeClipXMin, 0), numberOr(params.volumeClipYMin, 0), numberOr(params.volumeClipZMin, 0));
      material.uniforms.uClipMax.value.set(numberOr(params.volumeClipXMax, 1), numberOr(params.volumeClipYMax, 1), numberOr(params.volumeClipZMax, 1));
      material.needsUpdate = true;
    }
    if (child.isPoints && child.material) {
      if (child.material.userData?.attributeGlyph) {
        updateGlyphUniforms(child.material, params);
      } else {
        child.material.size = Number(params.volumePointSize) || child.material.size;
        child.material.opacity = Number(params.attributeModelOpacity ?? params.attributeLayerOpacity ?? child.material.opacity);
        child.material.needsUpdate = true;
      }
    }
    if (material?.userData?.attributeGlyph) updateGlyphUniforms(material, params);
  });
}
