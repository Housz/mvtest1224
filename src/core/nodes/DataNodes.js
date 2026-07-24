import { BuiltInDataNodeDefinitions } from './presets/BuiltInDataNodePresets.js';
import { cloneDataNodeValue } from './DataNodeRuntime.js';

export const DataNodeDefinitions = BuiltInDataNodeDefinitions;

export { DataNodePresetRegistry } from './DataNodePresetRegistry.js';
export {
  normalizeDataNodeParams,
  normalizeDataNodeSources,
  semanticizeDataNode
} from './DataNodeRuntime.js';

export function seedDataNode(typeId, position = { x: 80, y: 80 }, overrides = {}) {
  const definition = DataNodeDefinitions.find((item) => item.typeId === typeId);
  if (!definition) throw new Error(`Unknown dataset node type: ${typeId}`);
  return {
    typeId,
    label: overrides.label ?? definition.label,
    position,
    params: {
      ...cloneDataNodeValue(definition.defaultParams),
      ...(overrides.params ?? {})
    },
    ports: cloneDataNodeValue(definition.ports)
  };
}