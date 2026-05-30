const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

function normalizeStructure(row = {}, index = 0) {
  const id = row.structureId ?? row.structure_id ?? row.faultId ?? row.id ?? `GS_${index + 1}`;
  return {
    ...row,
    id: String(id),
    structureId: String(id),
    structureName: row.structureName ?? row.name ?? String(id),
    structureType: row.structureType ?? row.type ?? row.kind ?? 'unknown',
    geometry: row.geometry ?? row.surface ?? row.trace ?? row.path ?? row.mesh ?? null,
    attributes: row.attributes ?? {}
  };
}

export class GeologicalStructureDataset {
  constructor({
    structures = [],
    relations = [],
    source = null,
    metadata = {},
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null
  } = {}) {
    this.type = 'GeologicalStructureDataset';
    this.contract = contract;
    this.semanticClass = contract?.class ?? 'GeologicalStructure';
    this.taxonomyClass = contract?.taxonomyClass ?? 'Geology & Resource Datasets';
    this.templates = templates ?? {};
    this.roleMapping = roleMapping;
    this.validation = validation ?? { valid: true, warnings: [], errors: [], summary: {} };
    this.adaptorResults = adaptorResults;
    this.source = source;
    this.metadata = metadata;
    this.structures = asArray(structures).map(normalizeStructure);
    this.relations = asArray(relations);
    this.structureMap = new Map(this.structures.map((structure) => [structure.structureId, structure]));
  }

  listStructures() {
    return this.structures;
  }

  getStructure(id) {
    return this.structureMap.get(String(id)) ?? null;
  }

  getStructuresByType(type) {
    const target = String(type).toLowerCase();
    return this.structures.filter((structure) => String(structure.structureType).toLowerCase() === target);
  }

  getGeometry(id) {
    return this.getStructure(id)?.geometry ?? null;
  }

  listAttributes() {
    const keys = new Set();
    this.structures.forEach((structure) => {
      Object.keys(structure.attributes || {}).forEach((key) => keys.add(key));
      ['strike', 'dip', 'throw', 'width', 'confidence', 'waterConductivity', 'activity', 'riskLevel'].forEach((key) => {
        if (structure[key] != null) keys.add(key);
      });
    });
    return [...keys];
  }

  getAttribute(id, attributeName) {
    const structure = this.getStructure(id);
    if (!structure) return null;
    if (structure.attributes && attributeName in structure.attributes) return structure.attributes[attributeName];
    return structure[attributeName] ?? null;
  }

  getSummary() {
    return {
      structureCount: this.structures.length,
      structureTypes: [...new Set(this.structures.map((structure) => structure.structureType).filter(Boolean))],
      attributeCount: this.listAttributes().length
    };
  }
}
