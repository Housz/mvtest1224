import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { extensionOf, fetchText, pickSuggestedRoleMapping } from './adaptorUtils.js';

export class OBJGeometryAdaptor {
  constructor() {
    this.id = 'OBJGeometryAdaptor';
    this.label = 'OBJ Geometry Adaptor';
    this.kind = 'OBJ geometry';
  }

  supports(source) {
    return extensionOf(source?.path || source?.name) === 'obj';
  }

  async load(source, contract) {
    const objText = source.text ?? (await fetchText(source.path));
    const loader = new OBJLoader();
    const group = loader.parse(objText);
    const meshParts = [];
    group.traverse((child) => {
      if (!child.isMesh) return;
      meshParts.push({
        name: child.name || `MeshPart_${meshParts.length + 1}`,
        vertexCount: child.geometry?.attributes?.position?.count || 0
      });
    });
    const paths = ['meshParts.name', 'meshParts.vertexCount'];
    return {
      source,
      kind: this.kind,
      raw: { objText, meshParts },
      objText,
      meshParts,
      fields: paths,
      paths,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, paths),
      summary: {
        meshPartCount: meshParts.length,
        modelPath: source.path
      }
    };
  }
}
