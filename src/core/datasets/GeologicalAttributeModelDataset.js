import { BaseSemanticDataset } from '../semantics/BaseSemanticDataset.js';

const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

function normalizeElement(row = {}, index = 0) {
  const id = row.elementId ?? row.supportElementId ?? row.blockId ?? row.block_id ?? row.cellId ?? row.id ?? `GA_${index + 1}`;
  return {
    ...row,
    id: String(id),
    elementId: String(id),
    blockId: row.blockId ?? row.block_id ?? null,
    centroid: row.centroid ?? {
      x: Number(row.centroidX ?? row.centroid_x ?? row.x ?? row.X ?? row.gridX ?? 0),
      y: Number(row.centroidY ?? row.centroid_y ?? row.y ?? row.Y ?? row.gridY ?? 0),
      z: Number(row.centroidZ ?? row.centroid_z ?? row.z ?? row.Z ?? row.elevation ?? 0)
    },
    size: row.size ?? {
      x: Number(row.blockSizeX ?? row.block_size_x ?? row.dx ?? row.size_x ?? 0),
      y: Number(row.blockSizeY ?? row.block_size_y ?? row.dy ?? row.size_y ?? 0),
      z: Number(row.blockSizeZ ?? row.block_size_z ?? row.dz ?? row.size_z ?? 0)
    }
  };
}

const KNOWN_ATTRIBUTES = [
  'grade',
  'density',
  'tonnage',
  'thickness',
  'elevation',
  'confidence',
  'fault_influence',
  'faultInfluence',
  'ash',
  'sulfur',
  'calorificValue',
  'calorific_value',
  'gasContent',
  'gas_content',
  'waterContent',
  'water_content',
  'coal_quality_index',
  'porosity',
  'permeability',
  'water_bearing_index',
  'grain_size_index',
  'strength_index',
  'roof_stability_index',
  'clay_content',
  'softening_index',
  'floor_heave_risk',
  'carbonate_purity',
  'karst_water_risk',
  'fracture_index',
  'weathering_index',
  'loose_layer_water_risk',
  'riskValue',
  'risk_value',
  'uncertainty',
  'probability',
  'lithology'
];

const ATTRIBUTE_ALIAS_TO_SNAKE = {
  calorificValue: 'calorific_value',
  gasContent: 'gas_content',
  waterContent: 'water_content',
  riskValue: 'risk_value',
  faultInfluence: 'fault_influence'
};

const NON_ATTRIBUTE_KEYS = new Set([
  'id',
  'elementId',
  'element_id',
  'supportElementId',
  'support_element_id',
  'blockId',
  'block_id',
  'cellId',
  'modelId',
  'model_id',
  'unitId',
  'unit_id',
  'seamId',
  'seam_id',
  'surfaceId',
  'surface_id',
  'orebodyId',
  'orebody_id',
  'domainId',
  'domain_id',
  'lithology',
  'unitType',
  'unit_type',
  'category',
  'resourceCategory',
  'resource_category',
  'x',
  'X',
  'y',
  'Y',
  'z',
  'Z',
  'centroid',
  'centroidX',
  'centroidY',
  'centroidZ',
  'centroid_x',
  'centroid_y',
  'centroid_z',
  'gridX',
  'gridY',
  'grid_x',
  'grid_y',
  'blockSizeX',
  'blockSizeY',
  'blockSizeZ',
  'block_size_x',
  'block_size_y',
  'block_size_z',
  'dx',
  'dy',
  'dz',
  'size',
  'attributeName',
  'attributeValue',
  'attribute_name',
  'attribute_value',
  'name',
  'value',
  'valueType',
  'value_type',
  'unit',
  'layerOrder',
  'layer_order'
]);

function isNumericAttributeColumn(key, value) {
  if (!key || NON_ATTRIBUTE_KEYS.has(key)) return false;
  if (value == null || value === '') return false;
  if (typeof value === 'object') return false;
  return Number.isFinite(Number(value));
}

export class GeologicalAttributeModelDataset extends BaseSemanticDataset {
  constructor({
    representationProfile = 'generic',
    modelId = 'geological_attribute_model',
    elements = [],
    blocks = [],
    attributes = [],
    relations = [],
    grid = null,
    binaryAttributes = {},
    source = null,
    metadata = {},
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null,
    normalizedElements = false,
    attributeNames = null
  } = {}) {
    super({
      type: 'GeologicalAttributeModelDataset',
      semanticClass: contract?.class ?? 'GeologicalAttributeModel',
      taxonomyId: 'geology-resources',
      contract,
      templates,
      roleMapping,
      validation,
      adaptorResults,
      source,
      metadata
    });
    this.taxonomyClass = contract?.taxonomyClass ?? 'Geology & Resource Datasets';
    this.representationProfile = representationProfile;
    this.modelId = modelId;
    const sourceElements = asArray(elements);
    const sourceBlocks = asArray(asArray(blocks).length ? blocks : elements);
    const normalizedBySource = new WeakMap();
    this.elements = normalizedElements
      ? sourceElements
      : sourceElements.map((element, index) => {
        const normalized = normalizeElement(element, index);
        if (element && typeof element === 'object') normalizedBySource.set(element, normalized);
        return normalized;
      });
    if (sourceBlocks === sourceElements) {
      this.blocks = this.elements;
    } else if (normalizedElements) {
      this.blocks = sourceBlocks;
    } else {
      this.blocks = sourceBlocks.map((block, index) =>
        (block && typeof block === 'object' && normalizedBySource.get(block)) || normalizeElement(block, index)
      );
    }
    this.attributes = asArray(attributes);
    this.relations = asArray(relations);
    this.grid = grid;
    this.binaryAttributes = binaryAttributes || {};
    this.elementMap = new Map();
    this.elements.forEach((element) => this.elementMap.set(element.elementId, element));
    this.blockMap = new Map();
    this.blocks.forEach((block) => this.blockMap.set(String(block.blockId ?? block.elementId), block));
    this.attributeNamesCache = Array.isArray(attributeNames)
      ? [...new Set(attributeNames.filter(Boolean))]
      : null;
    this.summaryCache = new Map();
    this.numericRangeCache = new Map();
  }

  listAttributes() {
    if (this.attributeNamesCache) return [...this.attributeNamesCache];
    const names = new Set(this.attributes.map((attribute) => attribute.attributeName ?? attribute.name).filter(Boolean));
    Object.keys(this.binaryAttributes || {}).forEach((name) => names.add(name));
    this.elements.forEach((element) => {
      KNOWN_ATTRIBUTES.forEach((key) => {
        const canonical = ATTRIBUTE_ALIAS_TO_SNAKE[key];
        if (canonical && element[canonical] != null) return;
        if (element[key] != null) names.add(key);
      });
      Object.entries(element).forEach(([key, value]) => {
        if (isNumericAttributeColumn(key, value)) names.add(key);
      });
    });
    this.attributeNamesCache = [...names];
    return [...this.attributeNamesCache];
  }

  getPrimaryAttribute() {
    return this.listAttributes()[0] ?? null;
  }

  getValue(elementId, attributeName) {
    const element = this.elementMap.get(String(elementId)) ?? this.blockMap.get(String(elementId));
    if (element && attributeName in element) return element[attributeName];
    const row = this.attributes.find((attribute) => {
      const target = attribute.elementId ?? attribute.supportElementId ?? attribute.blockId;
      return String(target) === String(elementId) && String(attribute.attributeName ?? attribute.name) === String(attributeName);
    });
    return row?.attributeValue ?? row?.value ?? null;
  }

  getElementsByRange(attributeName, min = -Infinity, max = Infinity) {
    return this.elements.filter((element) => {
      const value = Number(this.getValue(element.elementId, attributeName));
      return Number.isFinite(value) && value >= min && value <= max;
    });
  }

  getGeometrySupport() {
    return {
      profile: this.representationProfile,
      elements: this.elements,
      blocks: this.blocks,
      grid: this.grid
    };
  }

  sampleAtPoint(position, attributeName = this.getPrimaryAttribute()) {
    if (this.grid && this.binaryAttributes?.[attributeName] && position) {
      const bounds = this.grid.bounds || {};
      const min = bounds.min || this.grid.origin || [0, 0, 0];
      const max = bounds.max;
      const nx = Number(this.grid.nx ?? this.grid.width ?? 0);
      const ny = Number(this.grid.ny ?? this.grid.height ?? 0);
      const nz = Number(this.grid.nz ?? this.grid.depth ?? 0);
      if (nx > 0 && ny > 0 && nz > 0) {
        const size = this.grid.cellSize || (max ? [(max[0] - min[0]) / nx, (max[1] - min[1]) / ny, (max[2] - min[2]) / nz] : [1, 1, 1]);
        const ix = Math.max(0, Math.min(nx - 1, Math.floor((Number(position.x ?? 0) - Number(min[0] ?? 0)) / Number(size[0] ?? size ?? 1))));
        const iy = Math.max(0, Math.min(ny - 1, Math.floor((Number(position.y ?? 0) - Number(min[1] ?? 0)) / Number(size[1] ?? size ?? 1))));
        const iz = Math.max(0, Math.min(nz - 1, Math.floor((Number(position.z ?? 0) - Number(min[2] ?? 0)) / Number(size[2] ?? size ?? 1))));
        const index = ix + iy * nx + iz * nx * ny;
        const value = this.binaryAttributes[attributeName]?.[index];
        return {
          element: { elementId: `VOX_${ix}_${iy}_${iz}`, blockId: `VOX_${ix}_${iy}_${iz}`, gridIndex: [ix, iy, iz] },
          value,
          attributeName
        };
      }
    }
    if (!this.elements.length || !position) return null;
    let best = null;
    let bestDistance = Infinity;
    this.elements.forEach((element) => {
      const center = element.centroid || {};
      const dx = Number(center.x) - Number(position.x ?? 0);
      const dy = Number(center.y) - Number(position.y ?? 0);
      const dz = Number(center.z) - Number(position.z ?? 0);
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < bestDistance) {
        best = element;
        bestDistance = distance;
      }
    });
    return best ? { element: best, value: this.getValue(best.elementId, attributeName), attributeName } : null;
  }

  sampleAlongPolyline(polyline = [], attributeName = this.getPrimaryAttribute()) {
    return asArray(polyline).map((point) => this.sampleAtPoint(point, attributeName)).filter(Boolean);
  }

  sampleOnSection(sectionPlane, attributeName = this.getPrimaryAttribute()) {
    return {
      sectionPlane,
      attributeName,
      samples: this.elements.slice(0, 200).map((element) => ({
        elementId: element.elementId,
        value: this.getValue(element.elementId, attributeName),
        centroid: element.centroid
      }))
    };
  }

  getSummary(attributeName = this.getPrimaryAttribute()) {
    const cacheKey = String(attributeName ?? '');
    const cached = this.summaryCache.get(cacheKey);
    if (cached) return cached;
    let min = Infinity;
    let max = -Infinity;
    let count = 0;
    this.elements.forEach((element) => {
      const value = Number(this.getValue(element.elementId, attributeName));
      if (!Number.isFinite(value)) return;
      if (value < min) min = value;
      if (value > max) max = value;
      count += 1;
    });
    const summary = {
      representationProfile: this.representationProfile,
      elementCount: this.elements.length,
      blockCount: this.blocks.length,
      gridSize: this.grid ? `${this.grid.nx ?? this.grid.width} x ${this.grid.ny ?? this.grid.height} x ${this.grid.nz ?? this.grid.depth}` : null,
      attributeCount: this.listAttributes().length,
      primaryAttribute: attributeName,
      valueRange: count ? { min, max } : null
    };
    this.summaryCache.set(cacheKey, summary);
    return summary;
  }

  getNumericRange(attributeName = this.getPrimaryAttribute(), values = null) {
    const cacheKey = String(attributeName ?? '');
    const cached = this.numericRangeCache.get(cacheKey);
    if (cached) return cached;
    const source = values ?? this.binaryAttributes?.[attributeName];
    if (!source?.length) return this.getSummary(attributeName)?.valueRange ?? null;
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < source.length; index += 1) {
      const numeric = Number(source[index]);
      if (!Number.isFinite(numeric)) continue;
      if (numeric < min) min = numeric;
      if (numeric > max) max = numeric;
    }
    const range = min === Infinity ? { min: 0, max: 1 } : { min, max };
    this.numericRangeCache.set(cacheKey, range);
    return range;
  }

  listBlocks() {
    return this.blocks;
  }

  getBlock(blockId) {
    return this.blockMap.get(String(blockId)) ?? null;
  }

  getBlocksInRange(attributeName, min = -Infinity, max = Infinity) {
    return this.blocks.filter((block) => {
      const value = Number(this.getValue(block.elementId, attributeName));
      return Number.isFinite(value) && value >= min && value <= max;
    });
  }
}
