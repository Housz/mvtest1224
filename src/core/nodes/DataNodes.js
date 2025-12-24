import { ContractRegistry } from '../contracts/ContractRegistry.js';
import { DataResource } from '../datasets/DataResource.js';

const defaultFacetsByContract = {
  RoadwayTopology: [
    { id: 'graph', label: 'Graph', facetType: 'Graph', outputType: 'RoadwayGraph', preset: { mode: 'full' } }
  ],
  RoadwayGeometry: [
    { id: 'meshParts', label: 'Mesh Parts', facetType: 'MeshParts', outputType: 'RoadwayMeshParts' }
  ],
  SensorStationRegistry: [
    { id: 'registry', label: 'Registry', facetType: 'Registry', outputType: 'SensorRegistry' },
    { id: 'points', label: 'Points3D', facetType: 'Points', outputType: 'SensorPoints3D' }
  ],
  SensorReadingTimeSeries: [
    { id: 'series', label: 'Series', facetType: 'Series', outputType: 'SensorDataset' },
    { id: 'snapshot', label: 'Snapshot', facetType: 'Snapshot', outputType: 'SensorDataset' },
    { id: 'value', label: 'Value(latest)', facetType: 'Value', outputType: 'SensorDataset' }
  ],
  ModelLibrary: [{ id: 'models', label: 'Models', facetType: 'ModelSet', outputType: 'ModelLibrary' }]
};

function buildFacetPorts(node) {
  const facets = node.params.facets || [];
  return facets.map((f) => ({
    id: `facet-${f.id}`,
    name: `${f.label || f.id}`,
    direction: 'out',
    type: f.outputType || `facet:${f.facetType}`,
    facetType: f.facetType,
    outputType: f.outputType || 'raw'
  }));
}

export const DataNodeDefinitions = [
  {
    typeId: 'DataNode',
    label: 'Data Resource',
    kind: 'data',
    buildPorts(node) {
      return buildFacetPorts(node);
    },
    defaultParams: {
      source: { type: 'file', path: '/data/roadwayTopo.json' },
      contractId: 'RoadwayTopology',
      roleMapping: {},
      bindings: {},
      facets: defaultFacetsByContract.RoadwayTopology
    },
    createRuntime() {
      return {
        async execute(registry, nodeModel, context, resolveBinding) {
          const resource = new DataResource(nodeModel.params);
          resource.bindings = nodeModel.bindings || nodeModel.params.bindings || {};
          resource.bindingResolver = resolveBinding;
          await resource.load(registry);
          return resource;
        },
        updateFacets(nodeModel) {
          const contract = ContractRegistry.get(nodeModel.params.contractId);
          if (!contract) return;
          nodeModel.label = contract.name || nodeModel.label;
          nodeModel.params.facets = nodeModel.params.facets?.length
            ? nodeModel.params.facets
            : defaultFacetsByContract[nodeModel.params.contractId] || [];
          nodeModel.ports = buildFacetPorts(nodeModel);
        }
      };
    }
  }
];

export function seedDataNode(contractId, overrides = {}) {
  const contract = ContractRegistry.get(contractId);
  return {
    source: { type: 'file', path: overrides.path || '' },
    contractId,
    roleMapping: contract?.required_roles?.reduce((acc, r) => ({ ...acc, [r.roleKey]: r.defaultField || '' }), {}) || {},
    bindings: {},
    facets: defaultFacetsByContract[contractId] || []
  };
}
