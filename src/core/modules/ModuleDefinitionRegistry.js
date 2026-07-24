export function defineModule(definition) {
  if (!definition?.typeId) throw new Error('Module definition requires typeId.');
  const manifest = definition.moduleManifest;
  if (!manifest?.workspace || !manifest?.functions || !manifest?.sharedContext ||
      !manifest?.visualComposition || !manifest?.datasetClosure) {
    throw new Error(`Module ${definition.typeId} requires a complete D-O-M module manifest.`);
  }
  return {
    kind: 'module',
    category: 'Module',
    color: '#2faa64',
    ...definition,
    moduleManifest: Object.freeze({
      schemaVersion: 1,
      ...manifest,
      workspace: Object.freeze({ ...manifest.workspace }),
      functions: Object.freeze({ ...manifest.functions }),
      sharedContext: Object.freeze({ ...manifest.sharedContext }),
      visualComposition: Object.freeze({ ...manifest.visualComposition }),
      datasetClosure: Object.freeze({ ...manifest.datasetClosure })
    })
  };
}

export class ModuleDefinitionRegistryClass {
  constructor() {
    this.definitions = new Map();
  }

  register(rawDefinition) {
    const definition = rawDefinition?.moduleManifest?.schemaVersion
      ? rawDefinition
      : defineModule(rawDefinition);
    if (this.definitions.has(definition.typeId)) {
      throw new Error(`Duplicate Module definition: ${definition.typeId}.`);
    }
    this.definitions.set(definition.typeId, definition);
    return definition;
  }

  get(typeId) {
    return this.definitions.get(typeId) || null;
  }

  list() {
    return [...this.definitions.values()];
  }
}

export const ModuleDefinitionRegistry = new ModuleDefinitionRegistryClass();

export function registerModuleDefinitions(definitions) {
  return definitions.map((definition) => ModuleDefinitionRegistry.register(definition));
}

export const DefaultModuleManifest = Object.freeze({
  workspace: {
    isolatedRuntimeSession: true,
    immutableDatasetSharing: true
  },
  functions: {
    dynamicSlots: true,
    dependencyCompilation: 'topological'
  },
  sharedContext: {
    declarationDriven: true,
    sourceRevisionTracking: true,
    batching: true
  },
  visualComposition: {
    contributionDescriptors: true,
    focus: true,
    pin: true,
    visibility: true,
    opacity: true,
    order: true,
    interactionLock: true
  },
  datasetClosure: {
    contractValidation: true,
    subscription: true
  }
});
