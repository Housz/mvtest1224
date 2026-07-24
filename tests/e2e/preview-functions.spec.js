import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const preset = (name) => JSON.parse(fs.readFileSync(path.resolve('src/presets/graphs', name), 'utf8'));

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
  }, graph);
  await page.goto('/preview.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.minevisPreviewDebug?.loadingMetrics?.ready)),
    { timeout: 180_000 }
  ).toBe(true);
}

async function functionId(page, typeId) {
  const id = await page.evaluate((targetTypeId) => {
    const fn = window.minevisPreviewDebug.activeWorkspace.functions.find(
      (candidate) => candidate.operator?.nodeModel?.typeId === targetTypeId
    );
    return fn?.id || null;
  }, typeId);
  expect(id, `Missing Function ${typeId}`).toBeTruthy();
  return id;
}

async function restartFunction(page, typeId) {
  const id = await functionId(page, typeId);
  const enabled = await page.evaluate((targetId) => (
    window.minevisPreviewDebug.activeWorkspace.functions.find((fn) => fn.id === targetId)?.enabled
  ), id);
  if (enabled) {
    expect(await page.evaluate((targetId) => window.minevisPreviewDebug.toggleFunction(targetId), id)).toBe(false);
  }
  expect(await page.evaluate((targetId) => window.minevisPreviewDebug.toggleFunction(targetId), id)).toBe(true);
  await page.evaluate((targetId) => window.minevisPreviewDebug.focusFunction(targetId), id);
  await expect.poll(() => page.evaluate((targetId) => {
    const fn = window.minevisPreviewDebug.activeWorkspace.functions.find((candidate) => candidate.id === targetId);
    return { enabled: fn?.enabled, loading: fn?.loading, error: fn?.error || null };
  }, id)).toEqual({ enabled: true, loading: false, error: null });
  return id;
}

async function runtimeState(page, typeId) {
  return page.evaluate((targetTypeId) => {
    const fn = window.minevisPreviewDebug.activeWorkspace.functions.find(
      (candidate) => candidate.operator?.nodeModel?.typeId === targetTypeId
    );
    const runtime = fn?.operator;
    if (!runtime) return null;
    const canvasRect = (runtime.graphCanvas || runtime.topologyCanvas || runtime.sectionCanvas)
      ?.getBoundingClientRect?.();
    return {
      functionId: fn.id,
      contributionCount: window.minevisPreviewDebug.contributionRegistry.list()
        .filter((item) => item.ownerFunctionId === fn.id).length,
      sensorSnapshotCount: runtime.sensorSnapshot?.size || 0,
      sensorSeriesCount: runtime.chartView?.model?.series?.length || 0,
      sensorListCount: runtime.sensorListPanel?.querySelectorAll?.('[data-sensor-id]')?.length || 0,
      fieldLayerReady: Boolean(runtime.fieldLayer),
      metricVariable: runtime.metric?.variable || null,
      renderBranchCount: runtime.renderBranches?.length || 0,
      stateByBranchCount: runtime.stateByBranch?.size || 0,
      distributionSeriesCount: runtime.summaryChartView?.model?.series?.length || 0,
      trendSeriesCount: runtime.trendChartView?.model?.series?.length || 0,
      anomalyCount: runtime.anomalies?.length || 0,
      timelineCount: runtime.timelineCounts?.length || 0,
      hazardCount: runtime.outputs?.hazardState?.rows?.length
        || runtime.outputs?.hazardState?.states?.length
        || runtime.outputs?.hazardState?.records?.length
        || 0,
      routeCount: runtime.routes?.length || 0,
      pickableCount: runtime.pickables?.length || 0,
      rootChildren: runtime.rootGroup?.children?.length || 0,
      attributeCount: runtime.attributeElements?.length || 0,
      attributeFilteredCount: runtime.attributeStats?.filteredCount || 0,
      relationCount: runtime.relationResult?.edgeRelations?.size || 0,
      sectionSummary: runtime.sectionResult?.summary || null,
      canvasRect: canvasRect
        ? { width: canvasRect.width, height: canvasRect.height }
        : null
    };
  }, typeId);
}

test.describe.serial('all representative Preview Functions', () => {
  test.setTimeout(300_000);

  test('Environmental Functions restart, render data, chart, list and sensor interaction', async ({ page }) => {
    const errors = collectErrors(page);
    await openPreset(page, preset('Environmental_Monitoring.json'));
    const functions = [
      ['RoadwayTemperatureAnalysisOperator', 'temperature'],
      ['RoadwayHumidityAnalysisOperator', 'humidity'],
      ['RoadwayCH4ConcentrationAnalysisOperator', 'CH4']
    ];
    for (const [typeId, variable] of functions) {
      await restartFunction(page, typeId);
      const state = await runtimeState(page, typeId);
      expect(state.metricVariable).toBe(variable);
      expect(state.sensorSnapshotCount).toBeGreaterThan(0);
      expect(state.sensorSeriesCount).toBeGreaterThan(0);
      expect(state.sensorListCount).toBeGreaterThan(0);
      expect(state.fieldLayerReady).toBe(true);
      expect(state.contributionCount).toBeGreaterThanOrEqual(4);
      const sensorId = await page.evaluate(() => [...window.minevisPreviewDebug.sceneManager.sensors.keys()][0]);
      expect(await page.evaluate((id) => (
        window.minevisPreviewDebug.sceneManager.interactionRouter.dispatch('sensor', id, {})
      ), sensorId)).toBe(true);
      await expect.poll(() => page.evaluate(() => (
        window.minevisPreviewDebug.activeWorkspace.context.get('selectedSensor')
      ))).toBe(sensorId);
    }
    expect(errors).toEqual([]);
  });

  test('Environmental Function restart stress keeps one interaction owner and stable cached layers', async ({ page }) => {
    const errors = collectErrors(page);
    await openPreset(page, preset('Environmental_Monitoring.json'));
    const id = await restartFunction(page, 'RoadwayTemperatureAnalysisOperator');
    const before = await page.evaluate((functionId) => {
      const debug = window.minevisPreviewDebug;
      const fn = debug.activeWorkspace.functions.find((candidate) => candidate.id === functionId);
      const ownerId = fn.operator.id;
      const handlers = [...(debug.sceneManager.interactionRouter.handlers.get('sensor')?.values() || [])]
        .filter((entry) => entry.ownerId === ownerId);
      const contributions = debug.contributionRegistry.list()
        .filter((item) => item.ownerFunctionId === functionId);
      return {
        ownerId,
        handlerCount: handlers.length,
        fieldLayerCount: debug.sceneManager.roadwayFieldLayers.size,
        contributionCount: contributions.length,
        contributionIds: contributions.map((item) => item.id).sort(),
        uniqueContributionCount: new Set(contributions.map((item) => item.id)).size
      };
    }, id);
    expect(before.handlerCount).toBe(1);
    expect(before.contributionCount).toBeGreaterThanOrEqual(4);
    expect(before.uniqueContributionCount).toBe(before.contributionCount);

    for (let cycle = 0; cycle < 10; cycle += 1) {
      expect(await page.evaluate((functionId) => window.minevisPreviewDebug.toggleFunction(functionId), id)).toBe(false);
      expect(await page.evaluate((functionId) => window.minevisPreviewDebug.toggleFunction(functionId), id)).toBe(true);
    }

    const after = await page.evaluate((functionId) => {
      const debug = window.minevisPreviewDebug;
      const fn = debug.activeWorkspace.functions.find((candidate) => candidate.id === functionId);
      const ownerId = fn.operator.id;
      const handlers = [...(debug.sceneManager.interactionRouter.handlers.get('sensor')?.values() || [])]
        .filter((entry) => entry.ownerId === ownerId);
      const contributions = debug.contributionRegistry.list()
        .filter((item) => item.ownerFunctionId === functionId);
      return {
        handlerCount: handlers.length,
        fieldLayerCount: debug.sceneManager.roadwayFieldLayers.size,
        contributionCount: contributions.length,
        contributionIds: contributions.map((item) => item.id).sort(),
        uniqueContributionCount: new Set(contributions.map((item) => item.id)).size,
        error: fn.error || null
      };
    }, id);
    expect(after).toEqual({
      handlerCount: 1,
      fieldLayerCount: before.fieldLayerCount,
      contributionCount: before.contributionCount,
      contributionIds: before.contributionIds,
      uniqueContributionCount: before.contributionCount,
      error: null
    });

    const sensorId = await page.evaluate(() => [...window.minevisPreviewDebug.sceneManager.sensors.keys()][0]);
    expect(await page.evaluate((targetId) => (
      window.minevisPreviewDebug.sceneManager.interactionRouter.dispatch('sensor', targetId, {})
    ), sensorId)).toBe(true);
    await expect.poll(() => page.evaluate(() => (
      window.minevisPreviewDebug.activeWorkspace.context.get('selectedSensor')
    ))).toBe(sensorId);
    expect(errors).toEqual([]);
  });

  test('Ventilation Functions restart and expose their complete analysis state', async ({ page }) => {
    const errors = collectErrors(page);
    await openPreset(page, preset('Ventilation_Analysis.json'));
    const types = [
      'VentilationNetworkOverviewOperator',
      'AirflowDistributionAnalysisOperator',
      'BranchAirflowTrendInspectionOperator',
      'VentilationAnomalyInspectionOperator'
    ];
    for (const typeId of types) {
      await restartFunction(page, typeId);
      const branchId = await page.evaluate(() => (
        [...window.minevisPreviewDebug.sceneManager.ventilationPickBranches.keys()][0]
      ));
      expect(branchId).toBeTruthy();
      expect(await page.evaluate((id) => (
        window.minevisPreviewDebug.sceneManager.interactionRouter.dispatch('ventilation-branch', id, {})
      ), branchId)).toBe(true);
      await expect.poll(() => page.evaluate(() => (
        window.minevisPreviewDebug.activeWorkspace.context.get('selectedBranch')
      ))).toBe(branchId);
      const state = await runtimeState(page, typeId);
      expect(state.renderBranchCount).toBeGreaterThan(0);
      expect(state.contributionCount).toBeGreaterThanOrEqual(3);
      if (typeId === 'AirflowDistributionAnalysisOperator') {
        expect(state.stateByBranchCount).toBeGreaterThan(0);
        expect(state.distributionSeriesCount).toBeGreaterThan(0);
      }
      if (typeId === 'BranchAirflowTrendInspectionOperator') {
        expect(state.trendSeriesCount).toBeGreaterThan(0);
      }
      if (typeId === 'VentilationAnomalyInspectionOperator') {
        expect(state.anomalyCount).toBeGreaterThan(0);
        expect(state.timelineCount).toBeGreaterThan(0);
      }
    }
    expect(errors).toEqual([]);
  });

  test('Emergency dependency promotion, restart and generated outputs remain valid', async ({ page }) => {
    const errors = collectErrors(page);
    await openPreset(page, preset('Emergency_Response.json'));
    const initial = await page.evaluate(() => {
      const debug = window.minevisPreviewDebug;
      const personnel = debug.activeWorkspace.functions.find(
        (fn) => fn.operator?.nodeModel?.typeId === 'PersonnelEmergencyAnalysisOperator'
      );
      const fire = debug.activeWorkspace.functions.find(
        (fn) => fn.operator?.nodeModel?.typeId === 'FireAndSmokeSimulationOperator'
      );
      const dependency = debug.activeWorkspace.runtimeSession.dependencyRecords.get(fire.operator.id);
      return {
        personnelEnabled: personnel.enabled,
        fireEnabled: fire.enabled,
        dependencyReady: Boolean(dependency?.session),
        routeCount: personnel.operator.routes.length,
        fireHazardCount: fire.operator.outputs.hazardState?.rows?.length || 0
      };
    });
    expect(initial).toMatchObject({ personnelEnabled: true, fireEnabled: false, dependencyReady: true });
    expect(initial.routeCount).toBeGreaterThan(0);
    expect(initial.fireHazardCount).toBeGreaterThan(0);

    const fireId = await functionId(page, 'FireAndSmokeSimulationOperator');
    expect(await page.evaluate((id) => window.minevisPreviewDebug.toggleFunction(id), fireId)).toBe(true);
    const promoted = await page.evaluate(() => {
      const runtime = window.minevisPreviewDebug.activeWorkspace.runtimeSession;
      const fire = window.minevisPreviewDebug.activeWorkspace.functions.find(
        (fn) => fn.operator?.nodeModel?.typeId === 'FireAndSmokeSimulationOperator'
      );
      return runtime.rootRecords.get(fire.operator.id)?.session
        === runtime.dependencyRecords.get(fire.operator.id)?.session;
    });
    expect(promoted).toBe(true);
    expect(await page.evaluate((id) => window.minevisPreviewDebug.toggleFunction(id), fireId)).toBe(false);
    expect(await page.evaluate(() => {
      const debug = window.minevisPreviewDebug;
      const personnel = debug.activeWorkspace.functions.find(
        (fn) => fn.operator?.nodeModel?.typeId === 'PersonnelEmergencyAnalysisOperator'
      );
      const fire = debug.activeWorkspace.functions.find(
        (fn) => fn.operator?.nodeModel?.typeId === 'FireAndSmokeSimulationOperator'
      );
      return personnel.operator.routes.length > 0
        && debug.activeWorkspace.runtimeSession.dependencyRecords.has(fire.operator.id);
    })).toBe(true);

    await restartFunction(page, 'WaterInrushSimulationOperator');
    expect((await runtimeState(page, 'WaterInrushSimulationOperator')).hazardCount).toBeGreaterThan(0);
    await restartFunction(page, 'PersonnelEmergencyAnalysisOperator');
    expect((await runtimeState(page, 'PersonnelEmergencyAnalysisOperator')).routeCount).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('Geology Functions restart and produce model, attribute, relationship and section results', async ({ page }) => {
    const errors = collectErrors(page);
    await openPreset(page, preset('Geological Analysis.json'));

    await restartFunction(page, 'GeologicalModelOverviewOperator');
    const overview = await runtimeState(page, 'GeologicalModelOverviewOperator');
    expect(overview.rootChildren).toBeGreaterThan(0);
    expect(overview.pickableCount).toBeGreaterThan(0);
    await restartFunction(page, 'GeologicalModelOverviewOperator');
    const overviewRestarted = await runtimeState(page, 'GeologicalModelOverviewOperator');
    expect(overviewRestarted.pickableCount).toBe(overview.pickableCount);
    expect(await page.evaluate(() => {
      const roots = window.minevisPreviewDebug.sceneManager.scene.children
        .filter((item) => item.name?.includes(':geological-model-overview'));
      return roots.length;
    })).toBe(1);

    await restartFunction(page, 'GeologicalAttributeDistributionAnalysisOperator');
    const attribute = await runtimeState(page, 'GeologicalAttributeDistributionAnalysisOperator');
    expect(attribute.attributeCount).toBeGreaterThan(0);
    expect(attribute.attributeFilteredCount).toBeGreaterThan(0);

    await restartFunction(page, 'RoadwayGeologyRelationshipAnalysisOperator');
    const relationship = await runtimeState(page, 'RoadwayGeologyRelationshipAnalysisOperator');
    expect(relationship.relationCount).toBeGreaterThan(0);
    const relationshipId = await functionId(page, 'RoadwayGeologyRelationshipAnalysisOperator');
    await page.evaluate(() => {
      window.minevisPreviewDebug.sceneManager.setRoadwayVisibleForOwner('e2e-peer-owner', true);
    });
    expect(await page.evaluate((id) => window.minevisPreviewDebug.toggleFunction(id), relationshipId)).toBe(false);
    expect(await page.evaluate((id) => {
      const scene = window.minevisPreviewDebug.sceneManager;
      return {
        relationshipOwnerReleased: !scene.roadwayVisibilityOwners.has(id),
        peerOwnerVisible: scene.roadwayVisibilityOwners.get('e2e-peer-owner') === true,
        roadwayVisible: scene.roadwayObject?.visible === true
      };
    }, relationshipId)).toEqual({
      relationshipOwnerReleased: true,
      peerOwnerVisible: true,
      roadwayVisible: true
    });
    await page.evaluate(() => {
      window.minevisPreviewDebug.sceneManager.clearRoadwayOwnerState('e2e-peer-owner');
    });
    await restartFunction(page, 'RoadwayGeologyRelationshipAnalysisOperator');

    await restartFunction(page, 'GeologicalSectionAnalysisOperator');
    const section = await runtimeState(page, 'GeologicalSectionAnalysisOperator');
    expect(section.sectionSummary).toBeTruthy();
    expect(Object.values(section.sectionSummary).filter(Number.isFinite).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0);

    expect(await page.evaluate(() => (
      window.minevisPreviewDebug.activeWorkspace.functions.every((fn) => !fn.error)
    ))).toBe(true);
    expect(errors).toEqual([]);
  });
});
