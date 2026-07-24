import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const preset = (name) => JSON.parse(fs.readFileSync(path.resolve('src/presets/graphs', name), 'utf8'));

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function openPreset(page, graph) {
  await page.addInitScript((document) => {
    localStorage.setItem('minevis.graph', JSON.stringify(document));
    Object.keys(localStorage)
      .filter((key) => key.startsWith('minevis.preview.layout.'))
      .forEach((key) => localStorage.removeItem(key));
  }, graph);
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.minevisPreviewDebug?.loadingMetrics?.ready)),
    { timeout: 180_000 }
  ).toBe(true);
}

async function restartAndFocus(page, typeId) {
  const id = await page.evaluate((targetTypeId) => {
    return window.minevisPreviewDebug.activeWorkspace.functions.find(
      (fn) => fn.operator?.nodeModel?.typeId === targetTypeId
    )?.id || null;
  }, typeId);
  expect(id).toBeTruthy();
  const enabled = await page.evaluate((functionId) => {
    return window.minevisPreviewDebug.activeWorkspace.functions.find((fn) => fn.id === functionId)?.enabled;
  }, id);
  if (enabled) await page.evaluate((functionId) => window.minevisPreviewDebug.toggleFunction(functionId), id);
  await page.evaluate((functionId) => window.minevisPreviewDebug.toggleFunction(functionId), id);
  await page.evaluate((functionId) => window.minevisPreviewDebug.focusFunction(functionId), id);
  await expect.poll(() => page.evaluate((functionId) => {
    const fn = window.minevisPreviewDebug.activeWorkspace.functions.find((item) => item.id === functionId);
    return { loading: fn?.loading, error: fn?.error || null };
  }, id)).toEqual({ loading: false, error: null });
  return id;
}

test.describe('roadway 3D visual integrity', () => {
  test.setTimeout(240_000);

  test('scalar interpolation is painted on the original roadway mesh geometry', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPreset(page, preset('Environmental_Monitoring.json'));
    await restartAndFocus(page, 'RoadwayTemperatureAnalysisOperator');

    const state = await page.evaluate(() => {
      const fn = window.minevisPreviewDebug.activeWorkspace.functions.find(
        (item) => item.operator?.nodeModel?.typeId === 'RoadwayTemperatureAnalysisOperator'
      );
      const layer = fn.operator.fieldLayer;
      const proxy = layer.userData.roadwayFieldProxy;
      const colors = proxy.geometry.attributes.color;
      const uniqueColors = new Set();
      for (let index = 0; index < colors.count; index += Math.max(1, Math.floor(colors.count / 4000))) {
        uniqueColors.add(`${colors.getX(index).toFixed(3)}:${colors.getY(index).toFixed(3)}:${colors.getZ(index).toFixed(3)}`);
      }
      const modelPartNames = [];
      window.minevisPreviewDebug.sceneManager.roadwayObject.traverse((mesh) => {
        if (mesh.isMesh && mesh.userData?.heatmap && !mesh.userData?.roadwayRenderProxy) modelPartNames.push(mesh.name);
      });
      return {
        sourceKind: layer.userData.sourceKind,
        sourceCount: layer.userData.roadwayFieldSources.length,
        modelPartCount: modelPartNames.length,
        copiedModelParts: layer.userData.roadwayFieldSources.filter((mesh) => modelPartNames.includes(mesh.name)).length,
        proxyType: proxy.geometry.type,
        vertexCount: proxy.geometry.attributes.position.count,
        uniqueColorCount: uniqueColors.size,
        visibleMeshCount: layer.children.filter((child) => child.isMesh && child.material?.visible !== false).length
      };
    });
    expect(state.sourceKind).toBe('roadway-model');
    expect(state.sourceCount).toBe(state.modelPartCount);
    expect(state.copiedModelParts).toBe(state.modelPartCount);
    expect(state.vertexCount).toBeGreaterThan(1000);
    expect(state.uniqueColorCount).toBeGreaterThan(8);
    expect(state.visibleMeshCount).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('roadway-original-mesh-scalar.png') });
    expect(errors).toEqual([]);
  });

  test('ventilation arrows keep branch colors and branch selection highlights the full roadway mesh', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPreset(page, preset('Ventilation_Analysis.json'));
    await restartAndFocus(page, 'VentilationNetworkOverviewOperator');

    const branchId = await page.evaluate(() => {
      const fn = window.minevisPreviewDebug.activeWorkspace.functions.find(
        (item) => item.operator?.nodeModel?.typeId === 'VentilationNetworkOverviewOperator'
      );
      const branch = fn.operator.renderBranches.find((item) => {
        const ids = item.roadwayEdgeIds || item.roadwayEdgeId || item.roadwayEdgeID;
        return Array.isArray(ids) ? ids.length > 0 : Boolean(ids);
      });
      return branch?.id || null;
    });
    expect(branchId).toBeTruthy();
    expect(await page.evaluate((id) => (
      window.minevisPreviewDebug.sceneManager.interactionRouter.dispatch('ventilation-branch', id, {})
    ), branchId)).toBe(true);
    await expect.poll(() => page.evaluate(() => Boolean(
      window.minevisPreviewDebug.sceneManager.roadwaySelectionOverlay
    ))).toBe(true);

    const state = await page.evaluate(() => {
      const sceneManager = window.minevisPreviewDebug.sceneManager;
      const heads = sceneManager.ventilationGroup.getObjectByName('direction-arrow-heads');
      const shafts = sceneManager.ventilationGroup.getObjectByName('direction-arrow-shafts');
      const instanceColors = heads?.instanceColor?.array || [];
      const shaftColors = shafts?.geometry?.attributes?.color?.array || [];
      const brightness = (array) => {
        const values = [];
        for (let index = 0; index < array.length; index += 3) {
          values.push(array[index] + array[index + 1] + array[index + 2]);
        }
        return values;
      };
      const headBrightness = brightness(instanceColors);
      const shaftBrightness = brightness(shaftColors);
      const overlay = sceneManager.roadwaySelectionOverlay;
      return {
        arrowCount: heads?.count || 0,
        materialColor: heads?.material?.color?.getHex?.() ?? null,
        toneMapped: heads?.material?.toneMapped,
        blackHeadCount: headBrightness.filter((value) => value < 0.05).length,
        blackShaftCount: shaftBrightness.filter((value) => value < 0.05).length,
        recordedColors: heads?.userData?.arrowColorHexes || [],
        selectionType: overlay?.type || null,
        selectionVertexCount: overlay?.geometry?.attributes?.position?.count || 0,
        selectionEdges: overlay?.userData?.edgeIds || [],
        selectionNodes: overlay?.userData?.nodeIds || []
      };
    });
    expect(state.arrowCount).toBeGreaterThan(0);
    expect(state.materialColor).toBe(0xffffff);
    expect(state.toneMapped).toBe(false);
    expect(state.blackHeadCount).toBe(0);
    expect(state.blackShaftCount).toBe(0);
    expect(state.recordedColors).toHaveLength(state.arrowCount);
    expect(state.recordedColors.every((color) => color !== 0x000000)).toBe(true);
    expect(state.selectionType).toBe('Mesh');
    expect(state.selectionEdges.length).toBeGreaterThan(0);
    expect(state.selectionNodes.length).toBeGreaterThan(0);
    expect(state.selectionVertexCount).toBeGreaterThan(100);
    await page.screenshot({ path: testInfo.outputPath('ventilation-colored-arrows-full-mesh-selection.png') });
    expect(errors).toEqual([]);
  });
});