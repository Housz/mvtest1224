import { collectObjectPaths, extensionOf, fetchText, pickSuggestedRoleMapping } from './adaptorUtils.js';

export class PeopleJsonAdaptor {
  constructor() {
    this.id = 'PeopleJsonAdaptor';
    this.label = 'People JSON Adaptor';
    this.kind = 'People JSON';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return extensionOf(path) === 'json' && /people|personnel/i.test(path);
  }

  async load(source, contract) {
    const raw = source.data ?? JSON.parse(source.text ?? (await fetchText(source.path)));
    const people = raw.people ?? raw.persons ?? raw.data ?? [];
    const paths = new Set();
    collectObjectPaths({ people: people[0] || {} }, '', paths);
    [
      'people.personId',
      'people.person_id',
      'people.id',
      'people.label',
      'people.name',
      'people.personType',
      'people.type',
      'people.team',
      'people.group',
      'people.status',
      'people.timestamp',
      'people.time',
      'people.position',
      'people.position.x',
      'people.position.y',
      'people.position.z',
      'people.x',
      'people.y',
      'people.z',
      'people.roadwayAnchor.edgeId',
      'people.roadwayAnchor.nodeId',
      'people.roadwayAnchor.ratio',
      'people.edgeId',
      'people.nodeId',
      'people.roadwayEdgeId',
      'people.roadwayNodeId',
      'people.ratio'
    ].forEach((path) => paths.add(path));
    const pathList = [...paths].sort();
    return {
      source,
      kind: this.kind,
      raw,
      people,
      fields: pathList,
      paths: pathList,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, pathList),
      summary: {
        peopleCount: people.length,
        fieldCount: pathList.length
      }
    };
  }
}
