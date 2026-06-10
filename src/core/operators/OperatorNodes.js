import { EnvironmentalOperatorNodeDefinitions } from './environmental/index.js';
import { VentilationOperatorNodeDefinitions } from './ventilation/index.js';
import { EmergencyOperatorNodeDefinitions } from './emergency/index.js';
import { GeologyOperatorNodeDefinitions } from './geology/index.js';

export const OperatorNodeDefinitions = [
  ...EnvironmentalOperatorNodeDefinitions,
  ...VentilationOperatorNodeDefinitions,
  ...GeologyOperatorNodeDefinitions,
  ...EmergencyOperatorNodeDefinitions
];
