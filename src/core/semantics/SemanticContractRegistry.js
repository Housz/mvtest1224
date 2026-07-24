import { RoadwayContract } from '../datasets/Roadway/contract.js';
import { SensorRegistryContract } from '../datasets/SensorRegistry/contract.js';
import { SensorReadingsContract } from '../datasets/SensorReadings/contract.js';
import { VentilationNetworkContract } from '../datasets/VentilationNetwork/contract.js';
import { AirflowStateContract } from '../datasets/AirflowState/contract.js';
import { PeopleContract } from '../datasets/People/contract.js';
import { EmergencyResourcesContract } from '../datasets/EmergencyResources/contract.js';
import { RoadwayHazardStateContract } from '../datasets/RoadwayHazardState/contract.js';
import { GeologicalBodyContract } from '../datasets/GeologicalBody/contract.js';
import { BoreholeContract } from '../datasets/Borehole/contract.js';
import { GeologicalStructureContract } from '../datasets/GeologicalStructure/contract.js';
import { GeologicalAttributeModelContract } from '../datasets/GeologicalAttributeModel/contract.js';
import { resolveDatasetTaxonomy } from './Taxonomies.js';

export const BuiltInSemanticContracts = Object.freeze([
  RoadwayContract,
  SensorRegistryContract,
  SensorReadingsContract,
  VentilationNetworkContract,
  AirflowStateContract,
  PeopleContract,
  EmergencyResourcesContract,
  RoadwayHazardStateContract,
  GeologicalBodyContract,
  BoreholeContract,
  GeologicalStructureContract,
  GeologicalAttributeModelContract
]);

export class SemanticContractRegistryClass {
  constructor(contracts = BuiltInSemanticContracts) {
    this.contracts = new Map();
    contracts.forEach((contract) => this.register(contract));
  }

  register(contract) {
    if (!contract?.id) throw new Error('Semantic contract registration requires id.');
    if (this.contracts.has(contract.id)) throw new Error(`Duplicate semantic contract: ${contract.id}.`);
    this.contracts.set(contract.id, contract);
    return contract;
  }

  list() { return [...this.contracts.values()]; }

  get(id) { return this.contracts.get(id); }

  getByClass(className) {
    return this.list().find((contract) => contract.class === className) ?? null;
  }

  getDatasetTaxonomyRow(contract) {
    return resolveDatasetTaxonomy(contract?.taxonomyClass);
  }
}

export const SemanticContractRegistry = new SemanticContractRegistryClass();
