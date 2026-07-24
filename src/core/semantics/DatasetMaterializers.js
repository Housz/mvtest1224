import { materializeRoadway } from '../datasets/Roadway/materializer.js';
import { materializeSensorRegistry } from '../datasets/SensorRegistry/materializer.js';
import { materializeSensorReadings } from '../datasets/SensorReadings/materializer.js';
import { materializeVentilationNetwork } from '../datasets/VentilationNetwork/materializer.js';
import { materializeAirflowState } from '../datasets/AirflowState/materializer.js';
import { materializePeople } from '../datasets/People/materializer.js';
import { materializeEmergencyResources } from '../datasets/EmergencyResources/materializer.js';
import { materializeRoadwayHazardState } from '../datasets/RoadwayHazardState/materializer.js';
import { materializeGeologicalBody } from '../datasets/GeologicalBody/materializer.js';
import { materializeBorehole } from '../datasets/Borehole/materializer.js';
import { materializeGeologicalStructure } from '../datasets/GeologicalStructure/materializer.js';
import { materializeGeologicalAttributeModel } from '../datasets/GeologicalAttributeModel/materializer.js';
import { DatasetDefinitionRegistry } from '../datasets/definitions/index.js';
import { completeRoleMapping } from '../datasets/shared/MaterializerUtils.js';
import { DatasetMaterializerRegistry, registerDatasetMaterializers } from './DatasetMaterializerRegistry.js';

export {
  materializeRoadway,
  materializeSensorRegistry,
  materializeSensorReadings,
  materializeVentilationNetwork,
  materializeAirflowState,
  materializePeople,
  materializeEmergencyResources,
  materializeRoadwayHazardState,
  materializeGeologicalBody,
  materializeBorehole,
  materializeGeologicalStructure,
  materializeGeologicalAttributeModel
};

export const BuiltInDatasetMaterializers = Object.freeze({
  Roadway: materializeRoadway,
  SensorRegistry: materializeSensorRegistry,
  SensorReadings: materializeSensorReadings,
  VentilationNetwork: materializeVentilationNetwork,
  AirflowState: materializeAirflowState,
  People: materializePeople,
  EmergencyResources: materializeEmergencyResources,
  RoadwayHazardState: materializeRoadwayHazardState,
  GeologicalBody: materializeGeologicalBody,
  Borehole: materializeBorehole,
  GeologicalStructure: materializeGeologicalStructure,
  GeologicalAttributeModel: materializeGeologicalAttributeModel
});

registerDatasetMaterializers(BuiltInDatasetMaterializers);

export function materializeDataset(options) {
  const definition = DatasetDefinitionRegistry.getByMaterializer(options.datasetType);
  if (!definition) {
    throw new Error(`No Dataset definition registered for materializer ${options.datasetType}.`);
  }
  const dataset = DatasetMaterializerRegistry.materialize(definition.materializerId, options);
  dataset.datasetDefinitionId = definition.id;
  dataset.taxonomyId = definition.taxonomyId;
  return dataset;
}

export function mergeRoleMapping(contract, adaptorResults, roleMapping) {
  return completeRoleMapping(contract, adaptorResults, roleMapping);
}
