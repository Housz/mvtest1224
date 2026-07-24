import { DatasetDefinitionRegistry } from '../datasets/definitions/index.js';

function clone(value) {
  if (value == null) return value;
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function defineDataNodePreset(preset) {
  if (!preset?.typeId) throw new Error('Data Node preset requires typeId.');
  if (!preset.datasetId) throw new Error(`Data Node preset ${preset.typeId} requires datasetId.`);
  const datasetDefinition = DatasetDefinitionRegistry.get(preset.datasetId);
  if (!datasetDefinition) {
    throw new Error(`Data Node preset ${preset.typeId} references unknown Dataset ${preset.datasetId}.`);
  }
  if (!preset.output?.type) {
    throw new Error(`Data Node preset ${preset.typeId} requires an output Dataset type.`);
  }
  if (preset.output.type !== datasetDefinition.datasetType) {
    throw new Error(
      `Data Node preset ${preset.typeId} outputs ${preset.output.type}; expected ${datasetDefinition.datasetType}.`
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    descriptorSupport: false,
    representationProfile: 'generic',
    sourceSlots: {},
    defaultRoleMapping: {},
    ...preset,
    sourceSlots: Object.freeze(clone(preset.sourceSlots || {})),
    defaultRoleMapping: Object.freeze(clone(preset.defaultRoleMapping || {})),
    output: Object.freeze({ ...preset.output })
  });
}

export class DataNodePresetRegistryClass {
  constructor() {
    this.presets = new Map();
  }

  register(rawPreset) {
    const preset = rawPreset?.schemaVersion ? rawPreset : defineDataNodePreset(rawPreset);
    if (this.presets.has(preset.typeId)) {
      throw new Error(`Duplicate Data Node preset: ${preset.typeId}.`);
    }
    this.presets.set(preset.typeId, preset);
    return preset;
  }

  get(typeId) {
    return this.presets.get(typeId) || null;
  }

  list() {
    return [...this.presets.values()];
  }

  registerDefinition(definition) {
    const output = (definition.ports || []).find((port) => (
      port.direction === 'out' && port.type?.endsWith('Dataset')
    ));
    const materializerId = definition.defaultParams?.datasetType;
    const datasetDefinition = DatasetDefinitionRegistry.getByMaterializer(materializerId);
    if (!datasetDefinition) {
      throw new Error(
        `Data Node ${definition.typeId} uses an unknown Dataset materializer ${materializerId || '<missing>'}.`
      );
    }
    const preset = this.register(defineDataNodePreset({
      typeId: definition.typeId,
      label: definition.label,
      datasetId: datasetDefinition.id,
      representationProfile: definition.defaultParams?.representationProfile || 'generic',
      sourceSlots: definition.defaultParams?.sources || {},
      defaultRoleMapping: definition.defaultParams?.roleMapping || {},
      descriptorSupport: Boolean(definition.defaultParams?.sources?.descriptor),
      output: {
        portId: output?.id || 'dataset',
        type: output?.type || datasetDefinition.datasetType
      },
      definition
    }));
    return Object.freeze({
      ...definition,
      datasetId: preset.datasetId,
      datasetDefinition,
      representationProfile: preset.representationProfile,
      sourceSlots: preset.sourceSlots,
      descriptorSupport: preset.descriptorSupport,
      preset
    });
  }
}

export const DataNodePresetRegistry = new DataNodePresetRegistryClass();

export function registerDataNodeDefinitions(definitions) {
  return definitions.map((definition) => (
    DataNodePresetRegistry.get(definition.typeId)
      ? definition
      : DataNodePresetRegistry.registerDefinition(definition)
  ));
}
