import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyHeatmapColoring } from '../../src/core/algorithms/FieldSolver.js';
import {
  createRoadwayFieldLayer,
  createRoadwaySelectionOverlay,
  disposeRoadwayFieldLayer,
  syncRoadwayFieldLayerColors
} from '../../src/scene/RoadwayFieldLayer.js';

function sourceRoadwayModel() {
  const root = new THREE.Group();
  const edge = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 4), new THREE.MeshBasicMaterial());
  edge.position.x = 6;
  edge.name = 'Edge_Model_E1';
  edge.userData.topoID = 'E1';
  edge.userData.heatmap = {
    type: 'Connection',
    data: {
      id: 'E1',
      topoId: 'E1',
      j1: 'N1',
      j2: 'N2',
      verts: [{ x: 0, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }]
    }
  };
  const node = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), new THREE.MeshBasicMaterial());
  node.name = 'Node_Model_N1';
  node.userData.topoID = 'N1';
  node.userData.heatmap = { type: 'Node', data: { id: 'N1', x: 0, y: 0, z: 0 } };
  root.add(edge, node);
  root.updateMatrixWorld(true);
  return root;
}

describe('RoadwayFieldLayer', () => {
  it('derives the scalar surface from original roadway mesh parts and keeps smooth vertex colors', () => {
    const source = sourceRoadwayModel();
    const layer = createRoadwayFieldLayer({ getEdges: () => [], getNodes: () => [] }, { sourceObject: source });
    expect(layer.userData.sourceKind).toBe('roadway-model');
    expect(layer.userData.roadwayFieldSources.map((mesh) => mesh.name)).toEqual([
      'Edge_Model_E1',
      'Node_Model_N1'
    ]);

    applyHeatmapColoring(
      layer,
      [{ id: 'E1', j1: 'N1', j2: 'N2', verts: [{ x: 0, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }] }],
      new Map([['N1', 0], ['N2', 100]]),
      [],
      { min: 0, max: 100, map: 'rainbow' }
    );
    syncRoadwayFieldLayerColors(layer);

    const colors = layer.userData.roadwayFieldProxy.geometry.attributes.color;
    const unique = new Set();
    for (let index = 0; index < colors.count; index += 1) {
      unique.add(`${colors.getX(index).toFixed(3)}:${colors.getY(index).toFixed(3)}:${colors.getZ(index).toFixed(3)}`);
    }
    expect(unique.size).toBeGreaterThan(2);
    expect(layer.userData.roadwayFieldProxy.geometry.attributes.position.count).toBe(
      layer.userData.roadwayFieldSources.reduce(
        (sum, mesh) => sum + mesh.geometry.attributes.position.count,
        0
      )
    );
    disposeRoadwayFieldLayer(layer);
  });

  it('builds whole-mesh edge and junction highlights from the original model', () => {
    const source = sourceRoadwayModel();
    const overlay = createRoadwaySelectionOverlay(source, {
      edgeIds: ['E1'],
      nodeIds: ['N1']
    });
    expect(overlay).toBeTruthy();
    expect(overlay.userData.edgeIds).toEqual(['E1']);
    expect(overlay.userData.nodeIds).toEqual(['N1']);
    expect(overlay.geometry.attributes.position.count).toBeGreaterThan(100);
    overlay.geometry.computeBoundingBox();
    expect(overlay.geometry.boundingBox.min.x).toBeLessThanOrEqual(-2.9);
    expect(overlay.geometry.boundingBox.max.x).toBeGreaterThanOrEqual(11.9);
    overlay.geometry.dispose();
    overlay.material.dispose();
  });
});