import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const PRESET_FILES = [
  'Emergency_Response.json',
  'Environmental_Monitoring.json',
  'Geological Analysis.json',
  'Ventilation_Analysis.json'
];

const presets = Object.fromEntries(PRESET_FILES.map((name) => [
  name,
  JSON.parse(fs.readFileSync(path.resolve('src/presets/graphs', name), 'utf8'))
]));

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'error' ||
      (message.type() === 'warning' && /Shared context key|Maximum call stack|Can't get DOM width or height|Blocked aria-hidden|ECharts/i.test(text))
    ) {
      if (!/WebSocket connection to .*\?token=.* failed/i.test(text)) errors.push(text);
    }
  });
  return errors;
}

async function openPreset(page, graph) {
  await page.addInitScript((document) => {
    localStorage.setItem('minevis.graph', JSON.stringify(document));
    Object.keys(localStorage)
      .filter((key) => key.startsWith('minevis.preview.layout.'))
      .forEach((key) => localStorage.removeItem(key));
    window.__minevisHeartbeat = 0;
    window.setInterval(() => { window.__minevisHeartbeat += 1; }, 50);
    window.__minevisLongTasks = [];
    try {
      new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => window.__minevisLongTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
          name: entry.name
        }));
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      // Long Task API is optional in browser test environments.
    }
  }, graph);
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.minevisPreviewDebug?.loadingMetrics?.ready)),
    { timeout: 180_000 }
  ).toBe(true);
  await expect(page.locator('.preview-loading-overlay')).toHaveCount(0);
}

async function expectWorkspaceHealthy(page, graph) {
  const expectedFunctions = graph.nodes.filter((node) => node.kind === 'operator').length;
  const expectedDataNodes = graph.nodes.filter((node) => node.kind === 'data').length;
  const state = await page.evaluate(() => {
    const debug = window.minevisPreviewDebug;
    const sceneRect = debug.sceneManager.renderer.domElement.getBoundingClientRect();
    const sceneInventory = debug.sceneManager.scene.children.map((root) => {
      let meshes = 0;
      let visibleMeshes = 0;
      let triangles = 0;
      root.traverse?.((item) => {
        if (!item.isMesh && !item.isLine && !item.isSprite) return;
        meshes += 1;
        if (!item.visible) return;
        visibleMeshes += 1;
        const geometry = item.geometry;
        triangles += Math.floor((geometry?.index?.count || geometry?.attributes?.position?.count || 0) / 3);
      });
      return { name: root.name || root.type, visible: root.visible, meshes, visibleMeshes, triangles };
    });
    return {
      functionCount: debug.activeWorkspace?.functions?.filter((fn) => !fn.placeholder).length || 0,
      enabledCount: debug.activeWorkspace?.functions?.filter((fn) => fn.enabled).length || 0,
      functionErrors: debug.activeWorkspace?.functions?.filter((fn) => fn.error).map((fn) => fn.error) || [],
      dataNodeCount: debug.loadingMetrics.dataNodes.length,
      invalidData: [...debug.dataOutputs.entries()]
        .filter(([, result]) => result?.dataset?.validation?.valid === false)
        .map(([nodeId, result]) => ({
          nodeId,
          type: result?.dataset?.type || null,
          errors: result?.dataset?.validation?.errors || []
        })),
      totalDurationMs: debug.loadingMetrics.totalDurationMs,
      loadingMetrics: {
        dataDurationMs: debug.loadingMetrics.dataDurationMs,
        compileDurationMs: debug.loadingMetrics.compileDurationMs,
        servicesDurationMs: debug.loadingMetrics.layoutServiceReadyAt - debug.loadingMetrics.servicesStartedAt,
        initialFunctionDurationMs: debug.loadingMetrics.initialFunctionDurationMs,
        dataNodes: debug.loadingMetrics.dataNodes,
        semanticStages: [...debug.dataOutputs.entries()].map(([nodeId, result]) => ({
          nodeId,
          stages: Object.fromEntries(Object.entries(result?.dataset?.semanticization?.stages || {}).map(([key, stage]) => [key, {
            status: stage.status,
            durationMs: stage.durationMs || 0
          }]))
        }))
      },
      heartbeat: window.__minevisHeartbeat,
      longTasks: window.__minevisLongTasks || [],
      maxLongTask: Math.max(0, ...(window.__minevisLongTasks || []).map((entry) => entry.duration)),
      contributionCount: debug.contributionRegistry.list().length,
      scenePerformance: debug.sceneManager.performanceStats,
      sceneInventory,
      functionPerformance: (debug.activeWorkspace?.functions || []).map((fn) => ({
        typeId: fn.operator?.typeId || fn.typeId || fn.label,
        label: fn.label,
        enabled: fn.enabled,
        attachMs: fn.lastAttachDurationMs || 0,
        phases: fn.operator?.performancePhases || []
      })),
      layout: debug.layoutService.validateLayout({ geometry: false }),
      sceneRect: { width: sceneRect.width, height: sceneRect.height }
    };
  });
  expect(state.functionCount).toBe(expectedFunctions);
  expect(state.enabledCount).toBeGreaterThanOrEqual(1);
  expect(state.functionErrors).toEqual([]);
  expect(state.dataNodeCount).toBe(expectedDataNodes);
  expect(state.invalidData).toEqual([]);
  expect(state.totalDurationMs).toBeGreaterThan(0);
  expect(state.heartbeat).toBeGreaterThan(0);
  expect(state.contributionCount).toBeGreaterThan(0);
  expect(state.layout.valid).toBe(true);
  expect(state.sceneRect.width).toBeGreaterThan(100);
  expect(state.sceneRect.height).toBeGreaterThan(100);
  return state;
}

async function cycleFunction(page, index = 0) {
  const id = await page.evaluate((targetIndex) => (
    window.minevisPreviewDebug.activeWorkspace.functions.filter((fn) => !fn.placeholder)[targetIndex]?.id
  ), index);
  expect(id).toBeTruthy();
  const initiallyEnabled = await page.evaluate((functionId) => (
    window.minevisPreviewDebug.activeWorkspace.functions.find((fn) => fn.id === functionId)?.enabled
  ), id);
  if (initiallyEnabled) {
    const disabled = await page.evaluate((functionId) => window.minevisPreviewDebug.toggleFunction(functionId), id);
    expect(disabled).toBe(false);
  }
  const enabled = await page.evaluate((functionId) => window.minevisPreviewDebug.toggleFunction(functionId), id);
  expect(enabled).toBe(true);
  const functionState = await page.evaluate((functionId) => {
    const fn = window.minevisPreviewDebug.activeWorkspace.functions.find((item) => item.id === functionId);
    return { enabled: fn?.enabled, loading: fn?.loading, error: fn?.error, attachMs: fn?.lastAttachDurationMs };
  }, id);
  expect(functionState).toMatchObject({ enabled: true, loading: false, error: null });
  expect(functionState.attachMs).toBeGreaterThan(0);
  return id;
}

async function projectPickableSensor(page) {
  return page.evaluate(() => {
    const sceneManager = window.minevisPreviewDebug.sceneManager;
    const canvas = sceneManager.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    for (const sensor of sceneManager.sensors.values()) {
      const world = sensor.getWorldPosition(sensor.position.clone());
      const point = world.project(sceneManager.camera);
      const x = rect.left + ((point.x + 1) * 0.5 * rect.width);
      const y = rect.top + ((1 - point.y) * 0.5 * rect.height);
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      if (document.elementFromPoint(x, y) !== canvas) continue;
      return { id: sensor.userData.sensorID, x, y };
    }
    return null;
  });
}

test.describe('representative Preview presets', () => {
  test.setTimeout(300_000);

  test('Environmental Monitoring survives Function restart and keeps real 3D sensor pick', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openPreset(page, presets['Environmental_Monitoring.json']);
    const metrics = await expectWorkspaceHealthy(page, presets['Environmental_Monitoring.json']);
    expect(metrics.contributionCount).toBeLessThan(24);
    await cycleFunction(page, 0);
    const pick = await projectPickableSensor(page);
    expect(pick).toBeTruthy();
    await page.mouse.click(pick.x, pick.y);
    await expect.poll(() => page.evaluate(() => window.minevisPreviewDebug.sceneManager.selected?.userData?.sensorID)).toBe(pick.id);
    await expect(page.locator('.minevis-dock-tab').filter({ hasText: 'Sensor Trend Chart' })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('environmental-ready.png') });
    console.log('Environmental metrics', JSON.stringify(metrics, null, 2));
    expect(errors).toEqual([]);
  });

  test('Ventilation Analysis survives Function restart and routes branch selection', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openPreset(page, presets['Ventilation_Analysis.json']);
    const metrics = await expectWorkspaceHealthy(page, presets['Ventilation_Analysis.json']);
    expect(Math.max(0, ...metrics.scenePerformance.renderSamples.map((sample) => sample.calls || 0))).toBeLessThan(64);
    expect(metrics.sceneInventory.find((root) => root.name === 'ventilation-overlay')?.visibleMeshes || 0).toBeLessThan(32);
    const functionId = await cycleFunction(page, 0);
    await page.evaluate((id) => window.minevisPreviewDebug.focusFunction(id), functionId);
    const branchId = await page.evaluate(() => [...window.minevisPreviewDebug.sceneManager.ventilationPickBranches.keys()][0]);
    expect(branchId).toBeTruthy();
    expect(await page.evaluate((id) => window.minevisPreviewDebug.sceneManager.interactionRouter.dispatch('ventilation-branch', id, {}), branchId)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.minevisPreviewDebug.activeWorkspace.context.get('selectedBranch'))).toBe(branchId);
    await page.screenshot({ path: testInfo.outputPath('ventilation-ready.png') });
    console.log('Ventilation metrics', JSON.stringify(metrics, null, 2));
    expect(errors).toEqual([]);
  });

  test('Emergency Response survives Function restart and keeps response objects interactive', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openPreset(page, presets['Emergency_Response.json']);
    const metrics = await expectWorkspaceHealthy(page, presets['Emergency_Response.json']);
    const functionId = await cycleFunction(page, 0);
    await page.evaluate((id) => window.minevisPreviewDebug.focusFunction(id), functionId);
    const emergencyState = await page.evaluate(() => ({
      routeObjects: window.minevisPreviewDebug.sceneManager.routeObjects.size,
      people: window.minevisPreviewDebug.activeWorkspace.context.get('selectedPerson'),
      functionErrors: window.minevisPreviewDebug.activeWorkspace.functions.filter((fn) => fn.error).length
    }));
    expect(emergencyState.routeObjects).toBeGreaterThan(0);
    expect(emergencyState.functionErrors).toBe(0);
    const personPick = await page.evaluate(() => {
      const sceneManager = window.minevisPreviewDebug.sceneManager;
      const mesh = sceneManager.routeGroup.getObjectByName('person-markers');
      const canvas = sceneManager.renderer.domElement;
      if (!mesh?.instanceMatrix?.array?.length) return null;
      const matrix = mesh.instanceMatrix.array;
      const world = mesh.position.clone()
        .set(matrix[12], matrix[13], matrix[14])
        .applyMatrix4(mesh.matrixWorld)
        .project(sceneManager.camera);
      const rect = canvas.getBoundingClientRect();
      return {
        id: mesh.userData.emergencyInstances?.[0]?.id,
        x: rect.left + ((world.x + 1) * 0.5 * rect.width),
        y: rect.top + ((1 - world.y) * 0.5 * rect.height)
      };
    });
    expect(personPick?.id).toBeTruthy();
    await page.mouse.click(personPick.x, personPick.y);
    await expect.poll(() => page.evaluate(() => (
      window.minevisPreviewDebug.activeWorkspace.context.get('selectedPerson')
    ))).toBe(personPick.id);
    await page.screenshot({ path: testInfo.outputPath('emergency-ready.png') });
    console.log('Emergency metrics', JSON.stringify(metrics, null, 2));
    expect(errors).toEqual([]);
  });

  test('Geological Analysis loads large data responsively and all Functions can attach', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openPreset(page, presets['Geological Analysis.json']);
    const metrics = await expectWorkspaceHealthy(page, presets['Geological Analysis.json']);
    expect(metrics.maxLongTask).toBeLessThan(1_000);
    await cycleFunction(page, 0);
    const functionIds = await page.evaluate(() => window.minevisPreviewDebug.activeWorkspace.functions
      .filter((fn) => !fn.placeholder)
      .map((fn) => fn.id));
    for (const id of functionIds.slice(1)) {
      const enabled = await page.evaluate((functionId) => window.minevisPreviewDebug.activeWorkspace.functions.find((fn) => fn.id === functionId)?.enabled, id);
      if (!enabled) {
        const attached = await page.evaluate((functionId) => window.minevisPreviewDebug.toggleFunction(functionId), id);
        expect(attached).toBe(true);
      }
    }
    const geologyState = await page.evaluate(() => ({
      functionErrors: window.minevisPreviewDebug.activeWorkspace.functions.filter((fn) => fn.error).map((fn) => fn.error),
      geologicalOwners: window.minevisPreviewDebug.sceneManager.geologyPickSources.size,
      contributionCount: window.minevisPreviewDebug.contributionRegistry.list().length
    }));
    expect(geologyState.functionErrors).toEqual([]);
    expect(geologyState.geologicalOwners).toBeGreaterThan(0);
    expect(geologyState.contributionCount).toBeGreaterThan(8);
    await page.screenshot({ path: testInfo.outputPath('geology-ready.png') });
    console.log('Geology metrics', JSON.stringify(metrics, null, 2));
    expect(errors).toEqual([]);
  });
});
