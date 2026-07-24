import { EnvironmentalOperatorNodeDefinitions } from './environmental/index.js';
import { VentilationOperatorNodeDefinitions } from './ventilation/index.js';
import { EmergencyOperatorNodeDefinitions } from './emergency/index.js';
import { GeologyOperatorNodeDefinitions } from './geology/index.js';
import {
  formalizeOperatorDefinitions,
  validateOperatorDefinition
} from './shared/OperatorDefinitionFactory.js';
import { OperatorManifestRegistry } from './manifests/index.js';

const legacyOperatorDefinitions = [
  ...EnvironmentalOperatorNodeDefinitions,
  ...VentilationOperatorNodeDefinitions,
  ...GeologyOperatorNodeDefinitions,
  ...EmergencyOperatorNodeDefinitions
];

export const OperatorNodeDefinitions = formalizeOperatorDefinitions(
  legacyOperatorDefinitions,
  OperatorManifestRegistry
);

export { OperatorManifestRegistry, validateOperatorDefinition };
