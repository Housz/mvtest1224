import { collectObjectPaths, extensionOf, fetchText, pickSuggestedRoleMapping } from './adaptorUtils.js';

export class JSONGraphAdaptor {
  constructor() {
    this.id = 'JSONGraphAdaptor';
    this.label = 'JSON Graph Adaptor';
    this.kind = 'JSON graph';
  }

  supports(source) {
    return extensionOf(source?.path || source?.name) === 'json';
  }

  async load(source, contract) {
    const json = source.data ?? JSON.parse(source.text ?? (await fetchText(source.path)));
    const nodes = json.nodes ?? json.Nodes ?? [];
    const edges = json.edges ?? json.connections ?? json.Edges ?? json.Connections ?? [];
    const paths = new Set();
    collectObjectPaths({ nodes: nodes[0] || {}, edges: edges[0] || {} }, '', paths);
    ['nodes.id', 'nodes.position', 'edges.id', 'edges.source', 'edges.target', 'edges.path'].forEach((path) =>
      paths.add(path)
    );
    const pathList = [...paths].sort();
    return {
      source,
      kind: this.kind,
      raw: json,
      nodes,
      edges,
      fields: pathList,
      paths: pathList,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, pathList),
      summary: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        pathCount: pathList.length
      }
    };
  }
}
