import { EnvironmentalOperatorManifests } from './environmental.js';
import { VentilationOperatorManifests } from './ventilation.js';
import { EmergencyOperatorManifests } from './emergency.js';
import { GeologyOperatorManifests } from './geology.js';

export class OperatorManifestRegistryClass {
  constructor(manifestMaps = []) {
    this.manifests = new Map();
    manifestMaps.forEach((manifestMap) => {
      manifestMap.forEach((manifest, typeId) => this.register(typeId, manifest));
    });
  }

  register(typeId, manifest) {
    if (!typeId || !manifest?.explicit) {
      throw new Error('Operator manifest registration requires a typeId and explicit manifest.');
    }
    if (this.manifests.has(typeId)) throw new Error(`Duplicate Operator manifest: ${typeId}.`);
    this.manifests.set(typeId, Object.freeze({ ...manifest, typeId }));
    return this.manifests.get(typeId);
  }

  get(typeId) {
    return this.manifests.get(typeId) || null;
  }

  list() {
    return [...this.manifests.values()];
  }
}

export const OperatorManifestRegistry = new OperatorManifestRegistryClass([
  EnvironmentalOperatorManifests,
  VentilationOperatorManifests,
  GeologyOperatorManifests,
  EmergencyOperatorManifests
]);

export {
  EnvironmentalOperatorManifests,
  VentilationOperatorManifests,
  GeologyOperatorManifests,
  EmergencyOperatorManifests
};
