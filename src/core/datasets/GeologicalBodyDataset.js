const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

function normalizeId(value, fallback) {
  return value == null || value === '' ? fallback : String(value);
}

function normalizeBody(row = {}, index = 0) {
  const id = normalizeId(row.bodyId ?? row.body_id ?? row.id ?? row.unitId ?? row.geologicalUnitId, `GB_${index + 1}`);
  return {
    ...row,
    id,
    bodyId: id,
    bodyName: row.bodyName ?? row.name ?? row.geologicalUnitName ?? id,
    geologicalUnitId: row.geologicalUnitId ?? row.unitId ?? id,
    geologicalUnitType: row.geologicalUnitType ?? row.unitType ?? row.type ?? 'unknown'
  };
}

function normalizeUnit(row = {}, index = 0) {
  const id = normalizeId(row.geologicalUnitId ?? row.unitId ?? row.bodyId ?? row.id, `GU_${index + 1}`);
  return {
    ...row,
    id,
    geologicalUnitId: id,
    geologicalUnitName: row.geologicalUnitName ?? row.unitName ?? row.name ?? id,
    geologicalUnitType: row.geologicalUnitType ?? row.unitType ?? row.type ?? 'unknown'
  };
}

function normalizeSurface(row = {}, index = 0) {
  const id = normalizeId(row.surfaceId ?? row.surface_id ?? row.id ?? row.meshPartId, `SURF_${index + 1}`);
  return {
    ...row,
    id,
    surfaceId: id,
    surfaceType: row.surfaceType ?? row.type ?? 'surface',
    geologicalUnitId: row.geologicalUnitId ?? row.unitId ?? null
  };
}

function normalizeBlock(row = {}, index = 0) {
  const id = normalizeId(row.blockId ?? row.block_id ?? row.id, `BLOCK_${index + 1}`);
  return {
    ...row,
    id,
    blockId: id,
    bodyId: row.bodyId ?? row.orebodyId ?? row.orebody_id ?? null,
    centroid: row.centroid ?? {
      x: Number(row.centroidX ?? row.centroid_x ?? row.x ?? row.X ?? 0),
      y: Number(row.centroidY ?? row.centroid_y ?? row.y ?? row.Y ?? 0),
      z: Number(row.centroidZ ?? row.centroid_z ?? row.z ?? row.Z ?? 0)
    },
    size: row.size ?? {
      x: Number(row.blockSizeX ?? row.block_size_x ?? row.dx ?? row.size_x ?? 0),
      y: Number(row.blockSizeY ?? row.block_size_y ?? row.dy ?? row.size_y ?? 0),
      z: Number(row.blockSizeZ ?? row.block_size_z ?? row.dz ?? row.size_z ?? 0)
    }
  };
}

export class GeologicalBodyDataset {
  constructor({
    representationProfile = 'generic',
    units = [],
    bodies = [],
    surfaces = [],
    blocks = [],
    attributes = [],
    relations = [],
    geometrySupport = null,
    source = null,
    metadata = {},
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null
  } = {}) {
    this.type = 'GeologicalBodyDataset';
    this.contract = contract;
    this.semanticClass = contract?.class ?? 'GeologicalBody';
    this.taxonomyClass = contract?.taxonomyClass ?? 'Geology & Resource Datasets';
    this.representationProfile = representationProfile;
    this.templates = templates ?? {};
    this.roleMapping = roleMapping;
    this.validation = validation ?? { valid: true, warnings: [], errors: [], summary: {} };
    this.adaptorResults = adaptorResults;
    this.source = source;
    this.metadata = metadata;
    this.units = asArray(units).map(normalizeUnit);
    this.bodies = asArray(bodies).map(normalizeBody);
    this.surfaces = asArray(surfaces).map(normalizeSurface);
    this.blocks = asArray(blocks).map(normalizeBlock);
    this.attributes = asArray(attributes);
    this.relations = asArray(relations);
    this.geometrySupport = geometrySupport ?? {
      profile: representationProfile,
      surfaces: this.surfaces,
      blocks: this.blocks
    };
    this.unitMap = new Map(this.units.map((unit) => [unit.geologicalUnitId, unit]));
    this.bodyMap = new Map(this.bodies.map((body) => [body.bodyId, body]));
    this.surfaceMap = new Map(this.surfaces.map((surface) => [surface.surfaceId, surface]));
    this.blockMap = new Map(this.blocks.map((block) => [block.blockId, block]));
  }

  getRepresentationProfile() {
    return this.representationProfile;
  }

  listUnits() {
    return this.units;
  }

  listBodies() {
    return this.bodies;
  }

  listSurfaces() {
    return this.surfaces;
  }

  listBlocks() {
    return this.blocks;
  }

  listAttributes() {
    const fromRows = new Set(this.attributes.map((attribute) => attribute.attributeName ?? attribute.name).filter(Boolean));
    this.blocks.forEach((block) => {
      ['grade', 'density', 'lithology', 'thickness', 'resource', 'uncertainty', 'risk'].forEach((key) => {
        if (block[key] != null) fromRows.add(key);
      });
    });
    return [...fromRows];
  }

  getGeometrySupport() {
    return this.geometrySupport;
  }

  getRenderableGeometries() {
    return {
      surfaces: this.surfaces,
      blocks: this.blocks,
      profile: this.representationProfile
    };
  }

  getUnit(id) {
    return this.unitMap.get(String(id)) ?? null;
  }

  getBody(id) {
    return this.bodyMap.get(String(id)) ?? null;
  }

  getAttributeValue(elementId, attributeName) {
    const id = String(elementId);
    const block = this.blockMap.get(id);
    if (block && attributeName in block) return block[attributeName];
    const surface = this.surfaceMap.get(id);
    if (surface && attributeName in surface) return surface[attributeName];
    const row = this.attributes.find((attribute) => {
      const target = attribute.elementId ?? attribute.supportElementId ?? attribute.blockId ?? attribute.surfaceId;
      return String(target) === id && String(attribute.attributeName ?? attribute.name) === String(attributeName);
    });
    return row?.attributeValue ?? row?.value ?? null;
  }

  getSummary() {
    return {
      representationProfile: this.representationProfile,
      unitCount: this.units.length,
      bodyCount: this.bodies.length,
      surfaceCount: this.surfaces.length,
      blockCount: this.blocks.length,
      attributeCount: this.listAttributes().length
    };
  }
}
