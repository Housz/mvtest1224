export class DatasetMaterializerRegistryClass {
  constructor() {
    this.materializers = new Map();
  }

  register(id, materializer) {
    if (!id || typeof materializer !== 'function') {
      throw new Error('Dataset materializer registration requires an id and function.');
    }
    if (this.materializers.has(id)) {
      throw new Error(`Duplicate Dataset materializer: ${id}.`);
    }
    this.materializers.set(id, materializer);
    return materializer;
  }

  has(id) {
    return this.materializers.has(id);
  }

  get(id) {
    return this.materializers.get(id) || null;
  }

  list() {
    return [...this.materializers.entries()].map(([id, materialize]) => ({ id, materialize }));
  }

  materialize(id, options) {
    const materializer = this.get(id);
    if (!materializer) throw new Error(`No Dataset materializer registered for ${id}.`);
    return materializer(options);
  }
}

export const DatasetMaterializerRegistry = new DatasetMaterializerRegistryClass();

export function registerDatasetMaterializers(materializers) {
  Object.entries(materializers).forEach(([id, materializer]) => {
    if (!DatasetMaterializerRegistry.has(id)) {
      DatasetMaterializerRegistry.register(id, materializer);
    }
  });
  return DatasetMaterializerRegistry;
}
