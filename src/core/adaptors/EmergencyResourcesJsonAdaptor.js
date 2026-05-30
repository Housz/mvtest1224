import { collectObjectPaths, extensionOf, fetchText, pickSuggestedRoleMapping } from './adaptorUtils.js';

export class EmergencyResourcesJsonAdaptor {
  constructor() {
    this.id = 'EmergencyResourcesJsonAdaptor';
    this.label = 'Emergency Resources JSON Adaptor';
    this.kind = 'Emergency resources JSON';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return extensionOf(path) === 'json' && /emergency[_-]?resources|resources/i.test(path);
  }

  async load(source, contract) {
    const raw = source.data ?? JSON.parse(source.text ?? (await fetchText(source.path)));
    const resources = raw.resources ?? raw.emergencyResources ?? raw.data ?? [];
    const paths = new Set();
    collectObjectPaths({ resources: resources[0] || {} }, '', paths);
    [
      'resources.resourceId',
      'resources.resource_id',
      'resources.id',
      'resources.label',
      'resources.name',
      'resources.resourceType',
      'resources.type',
      'resources.status',
      'resources.capacity',
      'resources.position',
      'resources.position.x',
      'resources.position.y',
      'resources.position.z',
      'resources.x',
      'resources.y',
      'resources.z',
      'resources.roadwayAnchor.edgeId',
      'resources.roadwayAnchor.nodeId',
      'resources.roadwayAnchor.ratio',
      'resources.edgeId',
      'resources.nodeId',
      'resources.roadwayEdgeId',
      'resources.roadwayNodeId',
      'resources.ratio'
    ].forEach((path) => paths.add(path));
    const pathList = [...paths].sort();
    return {
      source,
      kind: this.kind,
      raw,
      resources,
      fields: pathList,
      paths: pathList,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, pathList),
      summary: {
        resourceCount: resources.length,
        fieldCount: pathList.length
      }
    };
  }
}
