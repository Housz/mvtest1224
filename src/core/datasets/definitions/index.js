import { RoadwayDatasetDefinition } from '../Roadway/definition.js';
import { SensorRegistryDatasetDefinition } from '../SensorRegistry/definition.js';
import { SensorReadingsDatasetDefinition } from '../SensorReadings/definition.js';
import { VentilationNetworkDatasetDefinition } from '../VentilationNetwork/definition.js';
import { AirflowStateDatasetDefinition } from '../AirflowState/definition.js';
import { PeopleDatasetDefinition } from '../People/definition.js';
import { EmergencyResourcesDatasetDefinition } from '../EmergencyResources/definition.js';
import { RoadwayHazardStateDatasetDefinition } from '../RoadwayHazardState/definition.js';
import { GeologicalBodyDatasetDefinition } from '../GeologicalBody/definition.js';
import { BoreholeDatasetDefinition } from '../Borehole/definition.js';
import { GeologicalStructureDatasetDefinition } from '../GeologicalStructure/definition.js';
import { GeologicalAttributeModelDatasetDefinition } from '../GeologicalAttributeModel/definition.js';
import { DatasetDefinitionRegistry } from '../../semantics/DatasetDefinitionRegistry.js';

export const BuiltInDatasetDefinitions = Object.freeze([
  RoadwayDatasetDefinition,
  SensorRegistryDatasetDefinition,
  SensorReadingsDatasetDefinition,
  VentilationNetworkDatasetDefinition,
  AirflowStateDatasetDefinition,
  PeopleDatasetDefinition,
  EmergencyResourcesDatasetDefinition,
  RoadwayHazardStateDatasetDefinition,
  GeologicalBodyDatasetDefinition,
  BoreholeDatasetDefinition,
  GeologicalStructureDatasetDefinition,
  GeologicalAttributeModelDatasetDefinition
]);

BuiltInDatasetDefinitions.forEach((definition) => {
  if (!DatasetDefinitionRegistry.get(definition.id)) DatasetDefinitionRegistry.register(definition);
});

export { DatasetDefinitionRegistry };
