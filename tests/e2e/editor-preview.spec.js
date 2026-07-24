import path from 'node:path';
import { expect, test } from '@playwright/test';

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'error' ||
      (message.type() === 'warning' && /Shared context key|Maximum call stack|Can't get DOM width or height|Blocked aria-hidden|ECharts/i.test(text))
    ) {
      errors.push(text);
    }
  });
  return errors;
}

async function expectGraphSize(page, nodes, edges) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        nodes: window.minevisGraph.nodes.length,
        edges: window.minevisGraph.edges.length
      }))
    )
    .toEqual({ nodes, edges });
}
test('Editor boots with the default graph and compact shell', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('.editor-toolbar')).toBeVisible();
  await expect(page.locator('#editor .node')).toHaveCount(9);
  await expectGraphSize(page, 9, 11);
  await expect(page.locator('#btn-open-preview')).toContainText('Open Preview');
  await expect(page.locator('#inspector')).toBeVisible();
  expect(errors).toEqual([]);
});

test('built-in graph menu loads presets immediately and protects dirty work', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  const select = page.locator('#built-in-graph-select');
  await expect(select.locator('option')).toHaveText([
    'Load built-in graph...',
    'Emergency_Response.json',
    'Environmental_Monitoring.json',
    'Geological Analysis.json',
    'Ventilation_Analysis.json'
  ]);
  await expectGraphSize(page, 9, 11);

  await select.selectOption('Ventilation_Analysis.json');
  await expectGraphSize(page, 8, 15);
  await expect(page.locator('#graph-replace-dialog')).not.toBeVisible();
  await expect(select).toHaveValue('');

  await page.evaluate(() => window.minevisGraph.createNode('RoadwayDataNode', { x: 20, y: 20 }));
  await expectGraphSize(page, 9, 15);
  await select.selectOption('Environmental_Monitoring.json');
  const replaceDialog = page.locator('#graph-replace-dialog');
  await expect(replaceDialog).toBeVisible();
  await expect(replaceDialog).toContainText('Environmental_Monitoring.json');
  await replaceDialog.locator('[value="cancel"]').click();
  await expectGraphSize(page, 9, 15);

  await select.selectOption('Environmental_Monitoring.json');
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.locator('[value="confirm"]').click();
  await expectGraphSize(page, 11, 12);

  await page.evaluate(() => window.minevisGraph.createNode('RoadwayDataNode', { x: 40, y: 40 }));
  await select.selectOption('Environmental_Monitoring.json');
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.locator('[value="confirm"]').click();
  await expectGraphSize(page, 11, 12);
  await expect(select).toHaveValue('');
  expect(errors).toEqual([]);
});

test('Load JSON imports a local graph and rejects invalid documents transactionally', async ({ page }) => {
  await page.goto('/');
  const select = page.locator('#built-in-graph-select');
  await select.selectOption('Ventilation_Analysis.json');
  await expectGraphSize(page, 8, 15);

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#btn-load-json').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(path.resolve('src/presets/graphs/Environmental_Monitoring.json'));
  await expectGraphSize(page, 11, 12);
  await expect(page.locator('#graph-file-input')).toHaveValue('');

  const storedSize = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('minevis.graph'));
    return { nodes: stored.nodes.length, edges: stored.edges.length };
  });
  expect(storedSize).toEqual({ nodes: 11, edges: 12 });

  const alertPromise = page.waitForEvent('dialog');
  await page.locator('#graph-file-input').setInputFiles({
    name: 'future-graph.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 999, nodes: [], edges: [] }))
  });
  const alert = await alertPromise;
  expect(alert.message()).toContain('Failed to load future-graph.json');
  expect(alert.message()).toContain('schema version 999');
  await alert.accept();
  await expectGraphSize(page, 11, 12);
});
test('default Monitoring workspace compiles and toggles its Function lifecycle', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/preview.html');
  const fn = page.locator('.function-button').first();
  const canvas = page.locator('#scene-container .scene-main-canvas');
  const scene = page.locator('#scene-container');
  const dock = page.locator('.runtime-dock-overlay');
  const mainGroup = page.locator('.minevis-dock-tab')
    .filter({ hasText: 'Main Scene' }).first()
    .locator('xpath=ancestor::div[contains(@class,\"dv-groupview\")]');
  const functionsPanel = page.locator('.function-sidebar.system-chrome-panel');
  const contributionsPanel = page.locator('.vc-manager.system-chrome-panel');

  await expect(fn).toHaveClass(/enabled/);
  await expect(canvas).toBeVisible();
  await expect(page.locator('.preview-error')).toHaveCount(0);
  await expect(page.locator('.scene-view-helper')).toHaveCount(0);
  await expect(page.locator('.runtime-dock-overlay .dv-groupview')).not.toHaveCount(0);

  const sceneBounds = await scene.boundingBox();
  const canvasBounds = await canvas.boundingBox();
  const dockBounds = await dock.boundingBox();
  const mainBounds = await mainGroup.boundingBox();
  expect(Math.abs(sceneBounds.x - canvasBounds.x)).toBeLessThan(1);
  expect(Math.abs(sceneBounds.y - canvasBounds.y)).toBeLessThan(1);
  expect(Math.abs(sceneBounds.width - canvasBounds.width)).toBeLessThan(1);
  expect(Math.abs(sceneBounds.height - canvasBounds.height)).toBeLessThan(1);
  expect((mainBounds.width * mainBounds.height) / (dockBounds.width * dockBounds.height)).toBeGreaterThanOrEqual(0.45);

  const scenePointerTarget = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return {
      insideScene: Boolean(element?.closest?.('#scene-container')),
      tag: element?.tagName || null,
      pointerEvents: element ? getComputedStyle(element).pointerEvents : null
    };
  }, {
    x: sceneBounds.x + sceneBounds.width * 0.5,
    y: sceneBounds.y + sceneBounds.height * 0.5
  });
  expect(scenePointerTarget.insideScene, JSON.stringify(scenePointerTarget)).toBe(true);
  expect(scenePointerTarget.pointerEvents).not.toBe('none');

  const topbar = page.locator('.runtime-topbar');
  const functionsToggle = page.locator('[data-system-panel-toggle="functions"]');
  const contributionsToggle = page.locator('[data-system-panel-toggle="contributions"]');

  await expect(functionsToggle).toBeVisible();
  await expect(contributionsToggle).toBeVisible();
  await expect(functionsToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.runtime-brand')).toHaveCount(0);
  const [topbarBounds, functionsToggleBounds, contributionsToggleBounds] = await Promise.all([
    topbar.boundingBox(),
    functionsToggle.boundingBox(),
    contributionsToggle.boundingBox()
  ]);
  expect(Math.abs(functionsToggleBounds.x - topbarBounds.x)).toBeLessThan(10);
  expect(Math.abs((contributionsToggleBounds.x + contributionsToggleBounds.width) - (topbarBounds.x + topbarBounds.width))).toBeLessThan(10);

  const functionsBounds = await functionsPanel.boundingBox();
  expect(Math.abs(functionsBounds.y - (topbarBounds.y + topbarBounds.height) - 4)).toBeLessThan(1.1);
  await expect(functionsPanel.locator('.system-panel-badge')).toHaveText('System');
  await expect(functionsPanel.locator('.system-panel-badge')).toBeVisible();
  expect(functionsBounds.width).toBe(216);
  await expect(contributionsPanel).toBeHidden();
  await expect(contributionsToggle).toBeVisible();
  await expect(contributionsToggle).toHaveAttribute('aria-expanded', 'false');
  await contributionsToggle.click();
  await expect(contributionsToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(contributionsPanel).toBeVisible();
  const contributionsBounds = await contributionsPanel.boundingBox();
  expect(contributionsBounds.width).toBe(260);
  expect(Math.abs(contributionsBounds.y - (topbarBounds.y + topbarBounds.height) - 4)).toBeLessThan(1.1);
  await expect(contributionsPanel.locator('.system-panel-badge')).toHaveText('System');
  const toggleColors = await page.evaluate(() => ({
    functions: getComputedStyle(document.querySelector('[data-system-panel-toggle="functions"]')).color,
    contributions: getComputedStyle(document.querySelector('[data-system-panel-toggle="contributions"]')).color
  }));
  expect(toggleColors.functions).not.toBe(toggleColors.contributions);

  const layerOrder = await page.evaluate(() => ({
    system: Number(getComputedStyle(document.querySelector('.function-sidebar')).zIndex),
    contribution: Number(getComputedStyle(document.querySelector('.runtime-dock-overlay')).zIndex)
  }));
  expect(layerOrder.system).toBeGreaterThan(layerOrder.contribution);
  await contributionsToggle.click();
  await expect(contributionsPanel).toBeHidden();


  await fn.locator('.function-main').click();
  await expect(fn).not.toHaveClass(/enabled/);
  expect((await functionsPanel.boundingBox()).width).toBe(functionsBounds.width);
  await fn.locator('.function-main').click();
  await expect(fn).toHaveClass(/enabled/);
  expect((await functionsPanel.boundingBox()).width).toBe(functionsBounds.width);
  expect(errors).toEqual([]);
});

function monitoringGraph() {
  const nodes = [
    { id: 'roadway', typeId: 'RoadwayDataNode', kind: 'data', label: 'Roadway', position: { x: 0, y: 0 }, params: {} },
    { id: 'registry', typeId: 'SensorRegistryDataNode', kind: 'data', label: 'Sensor Registry', position: { x: 0, y: 180 }, params: {} },
    { id: 'readings', typeId: 'SensorReadingsDataNode', kind: 'data', label: 'Sensor Readings', position: { x: 0, y: 360 }, params: {} },
    { id: 'operator', typeId: 'RoadwayTemperatureAnalysisOperator', kind: 'operator', label: 'Roadway Temperature Analysis', position: { x: 420, y: 180 }, params: {} },
    {
      id: 'module',
      typeId: 'ModuleNode',
      kind: 'module',
      label: 'Monitoring Workspace',
      position: { x: 820, y: 180 },
      params: {
        workspaceName: 'Monitoring Workspace',
        functions: [
          { id: 'function-1', label: 'Temperature Monitoring', placeholder: false, operatorNodeId: 'operator' },
          { id: 'function-2', label: '(Add Function)', placeholder: true }
        ]
      }
    }
  ];
  const edges = [
    { id: 'roadway-operator', from: { nodeId: 'roadway', portId: 'dataset' }, to: { nodeId: 'operator', portId: 'roadway' } },
    { id: 'registry-operator', from: { nodeId: 'registry', portId: 'dataset' }, to: { nodeId: 'operator', portId: 'sensorRegistry' } },
    { id: 'readings-operator', from: { nodeId: 'readings', portId: 'dataset' }, to: { nodeId: 'operator', portId: 'sensorReadings' } },
    { id: 'operator-module', from: { nodeId: 'operator', portId: 'operator' }, to: { nodeId: 'module', portId: 'function-1' } }
  ];
  return { schemaVersion: 1, nodes, edges, view: { panX: 0, panY: 0, zoom: 1 } };
}

test('compact Preview persists closed panels and keeps floating views interactive', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.addInitScript((graph) => {
    localStorage.setItem('minevis.graph', JSON.stringify(graph));
  }, monitoringGraph());
  await page.goto('/preview.html');

  const canvas = page.locator('#scene-container .scene-main-canvas');
  const scene = page.locator('#scene-container');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  let canvasBounds = await canvas.boundingBox();
  let sceneBounds = await scene.boundingBox();
  expect(Math.abs(canvasBounds.width - sceneBounds.width)).toBeLessThan(1);
  expect(Math.abs(canvasBounds.height - sceneBounds.height)).toBeLessThan(1);

  const functionsToggle = page.locator('#workspace-functions-toggle');
  await expect(functionsToggle).toBeVisible();
  await expect(functionsToggle).toHaveAttribute('aria-expanded', 'false');
  await functionsToggle.click();
  await expect(page.locator('.function-sidebar.system-chrome-panel')).toBeVisible();

  const controlTab = page.locator('.minevis-dock-tab').filter({ hasText: 'Temperature Legend / Controls' });
  await expect(controlTab).toBeVisible();
  const hiddenPanelId = await page.evaluate(() => [...window.minevisPreviewDebug.layoutService.records.values()]
    .find((record) => record.title === 'Temperature Legend / Controls')?.id);
  await controlTab.locator('[data-action=close]').click();
  await expect(controlTab).toHaveCount(0);
  await expect.poll(() => page.evaluate((panelId) => {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith('minevis.preview.layout.'))
      .some((key) => {
        const state = JSON.parse(localStorage.getItem(key) || '{}');
        return state.version === 6 && !state.openPanelIds?.includes(panelId);
      });
  }, hiddenPanelId)).toBe(true);

  await page.reload();
  await page.waitForFunction(() => window.minevisPreviewDebug?.contributionRegistry?.list?.()
    .some((item) => item.label === 'Temperature Legend / Controls'), null, { timeout: 30_000 });
  await expect(page.locator('.minevis-dock-tab').filter({ hasText: 'Temperature Legend / Controls' })).toHaveCount(0);
  const contributionManager = page.locator('.vc-manager');
  if (await contributionManager.isHidden()) {
    await page.locator('[data-system-panel-toggle="contributions"]').click();
  }
  const controlItem = contributionManager.locator('.vc-item')
    .filter({ hasText: 'Temperature Legend / Controls' }).first();
  await expect(controlItem.locator('.vc-open-panel')).toBeVisible();
  await controlItem.locator('.vc-open-panel').click();
  await expect(page.locator('.minevis-dock-tab').filter({ hasText: 'Temperature Legend / Controls' })).toBeVisible();

  const restoredTab = page.locator('.minevis-dock-tab').filter({ hasText: 'Sensor Trend Chart' });
  await expect(restoredTab).toBeVisible();
  await expect(restoredTab.locator('[data-action=float]')).toHaveCount(0);
  const tabBounds = await restoredTab.boundingBox();
  await page.mouse.move(tabBounds.x + 80, tabBounds.y + tabBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(tabBounds.x + 130, tabBounds.y + 50, { steps: 6 });
  await page.mouse.move(540, 150, { steps: 8 });
  await page.mouse.up();
  const floating = page.locator('.dv-resize-container');
  await expect(floating).toBeVisible();
  await expect(floating.locator('.sensor-trend-workspace-panel')).toBeVisible();

  canvasBounds = await canvas.boundingBox();
  sceneBounds = await scene.boundingBox();
  expect(Math.abs(canvasBounds.width - sceneBounds.width)).toBeLessThan(1);
  expect(Math.abs(canvasBounds.height - sceneBounds.height)).toBeLessThan(1);
  expect(errors).toEqual([]);
});

function geologyGraph() {
  const nodes = [
    { id: 'body', typeId: 'LayeredGeologicalBodyDataNode', label: 'Layered Geological Body', position: { x: 0, y: 0 }, params: {} },
    { id: 'borehole', typeId: 'BoreholeDataNode', label: 'Borehole', position: { x: 0, y: 200 }, params: {} },
    { id: 'attribute', typeId: 'ResourceBlockModelDataNode', label: 'Resource Block Model', position: { x: 0, y: 400 }, params: {} },
    { id: 'roadway', typeId: 'RoadwayDataNode', label: 'Roadway', position: { x: 0, y: 600 }, params: {} },
    { id: 'overview', typeId: 'GeologicalModelOverviewOperator', label: 'Geological Model Overview', position: { x: 500, y: 0 }, params: {} },
    { id: 'section', typeId: 'GeologicalSectionAnalysisOperator', label: 'Geological Section Analysis', position: { x: 500, y: 200 }, params: {} },
    { id: 'correlation', typeId: 'BoreholeStratigraphyCorrelationOperator', label: 'Borehole & Stratigraphy Correlation', position: { x: 500, y: 400 }, params: {} },
    { id: 'distribution', typeId: 'GeologicalAttributeDistributionAnalysisOperator', label: 'Geological Attribute Distribution Analysis', position: { x: 900, y: 200 }, params: { renderMode: 'points', blockRenderMode: 'points' } },
    { id: 'relationship', typeId: 'RoadwayGeologyRelationshipAnalysisOperator', label: 'Roadway-Geology Relationship Analysis', position: { x: 900, y: 500 }, params: {} },
    {
      id: 'module',
      typeId: 'ModuleNode',
      label: 'Geological Workspace',
      position: { x: 1400, y: 300 },
      params: {
        workspaceName: 'Geological Workspace',
        functions: [
          { id: 'function-1', label: 'Overview', placeholder: false, operatorNodeId: 'overview' },
          { id: 'function-2', label: 'Section', placeholder: false, operatorNodeId: 'section' },
          { id: 'function-3', label: 'Correlation', placeholder: false, operatorNodeId: 'correlation' },
          { id: 'function-4', label: 'Distribution', placeholder: false, operatorNodeId: 'distribution' },
          { id: 'function-5', label: 'Relationship', placeholder: false, operatorNodeId: 'relationship' },
          { id: 'function-6', label: '(Add Function)', placeholder: true }
        ]
      }
    }
  ];
  const edges = [];
  const connect = (fromNode, fromPort, toNode, toPort) => edges.push({
    id: `${fromNode}:${fromPort}->${toNode}:${toPort}`,
    from: { nodeId: fromNode, portId: fromPort },
    to: { nodeId: toNode, portId: toPort }
  });
  connect('body', 'dataset', 'overview', 'geologicalBody');
  connect('borehole', 'dataset', 'overview', 'borehole');
  connect('attribute', 'dataset', 'overview', 'attributeModel');
  connect('body', 'dataset', 'section', 'geologicalBody');
  connect('borehole', 'dataset', 'section', 'borehole');
  connect('attribute', 'dataset', 'section', 'attributeModel');
  connect('borehole', 'dataset', 'correlation', 'borehole');
  connect('body', 'dataset', 'correlation', 'geologicalBody');
  connect('attribute', 'dataset', 'distribution', 'attributeModel');
  connect('body', 'dataset', 'distribution', 'geologicalBody');
  connect('roadway', 'dataset', 'relationship', 'roadway');
  connect('body', 'dataset', 'relationship', 'geologicalBody');
  connect('attribute', 'dataset', 'relationship', 'attributeModel');
  connect('overview', 'operator', 'module', 'function-1');
  connect('section', 'operator', 'module', 'function-2');
  connect('correlation', 'operator', 'module', 'function-3');
  connect('distribution', 'operator', 'module', 'function-4');
  connect('relationship', 'operator', 'module', 'function-5');
  return { schemaVersion: 1, nodes, edges, view: { panX: 0, panY: 0, zoom: 1 } };
}

test('all Geological workspace Functions attach and clean up', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.addInitScript((graph) => {
    localStorage.setItem('minevis.graph', JSON.stringify(graph));
  }, geologyGraph());
  await page.goto('/preview.html');

  const functionRows = page.locator('.function-button');
  await expect(functionRows).toHaveCount(5);
  await expect(functionRows.nth(0)).toHaveClass(/enabled/);

  for (let index = 0; index < 5; index += 1) {
    const row = functionRows.nth(index);
    if (!(await row.evaluate((element) => element.classList.contains('enabled')))) {
      await row.locator('.function-main').click();
    }
    await expect(row).toHaveClass(/enabled/);
    await expect(page.locator('.preview-error')).toHaveCount(0);
    expect(await page.locator('.runtime-dock-overlay .workspace-panel-mounted:visible').count()).toBeGreaterThan(1);
    await row.locator('.function-main').click();
    await expect(row).not.toHaveClass(/enabled/);
  }

  expect(errors).toEqual([]);
});

function ventilationGraph() {
  const nodes = [
    { id: 'roadway', typeId: 'RoadwayDataNode', label: 'Roadway', position: { x: 0, y: 0 }, params: {} },
    { id: 'network', typeId: 'VentilationNetworkDataNode', label: 'Ventilation Network', position: { x: 0, y: 200 }, params: {} },
    { id: 'airflow', typeId: 'AirflowStateDataNode', label: 'Airflow State', position: { x: 0, y: 400 }, params: {} },
    { id: 'overview', typeId: 'VentilationNetworkOverviewOperator', label: 'Ventilation Network Overview', position: { x: 500, y: 100 }, params: {} },
    { id: 'distribution', typeId: 'AirflowDistributionAnalysisOperator', label: 'Airflow Distribution Analysis', position: { x: 500, y: 350 }, params: {} },
    {
      id: 'module',
      typeId: 'ModuleNode',
      label: 'Ventilation Workspace',
      position: { x: 1000, y: 200 },
      params: {
        workspaceName: 'Ventilation Workspace',
        functions: [
          { id: 'function-1', label: 'Overview', placeholder: false, operatorNodeId: 'overview' },
          { id: 'function-2', label: 'Distribution', placeholder: false, operatorNodeId: 'distribution' },
          { id: 'function-3', label: '(Add Function)', placeholder: true }
        ]
      }
    }
  ];
  const edges = [];
  const connect = (fromNode, fromPort, toNode, toPort) => edges.push({
    id: `${fromNode}:${fromPort}->${toNode}:${toPort}`,
    from: { nodeId: fromNode, portId: fromPort },
    to: { nodeId: toNode, portId: toPort }
  });
  connect('roadway', 'dataset', 'overview', 'roadway');
  connect('network', 'dataset', 'overview', 'ventilationNetwork');
  connect('roadway', 'dataset', 'distribution', 'roadway');
  connect('network', 'dataset', 'distribution', 'ventilationNetwork');
  connect('airflow', 'dataset', 'distribution', 'airflowState');
  connect('overview', 'operator', 'module', 'function-1');
  connect('distribution', 'operator', 'module', 'function-2');
  return { schemaVersion: 1, nodes, edges, view: { panX: 0, panY: 0, zoom: 1 } };
}

test('Ventilation workspace Functions attach independently', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.addInitScript((graph) => {
    localStorage.setItem('minevis.graph', JSON.stringify(graph));
  }, ventilationGraph());
  await page.goto('/preview.html');

  const rows = page.locator('.function-button');
  const functionsPanel = page.locator('.function-sidebar.system-chrome-panel');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveClass(/enabled/);
  const initialFunctionsBounds = await functionsPanel.boundingBox();

  const drawingTab = page.locator('.minevis-dock-tab').filter({ hasText: 'Ventilation 2D Drawing' });
  const topologyTab = page.locator('.minevis-dock-tab').filter({ hasText: 'Ventilation Topology Graph' });
  await expect(drawingTab).toBeVisible();
  await expect(topologyTab).toBeVisible();
  await topologyTab.locator('.minevis-dock-tab-title').click();
  await expect(topologyTab.locator('xpath=..')).toHaveClass(/dv-active-tab/);
  await drawingTab.locator('.minevis-dock-tab-title').click();
  await expect(drawingTab.locator('xpath=..')).toHaveClass(/dv-active-tab/);

  await rows.nth(1).locator('.function-main').click();
  await expect(rows.nth(1)).toHaveClass(/enabled/);
  await expect(page.locator('.preview-error')).toHaveCount(0);
  expect((await functionsPanel.boundingBox()).width).toBe(initialFunctionsBounds.width);
  expect(await page.locator('.runtime-dock-overlay .workspace-panel-mounted:visible').count()).toBeGreaterThan(0);

  await rows.nth(0).locator('.function-main').click();
  await rows.nth(1).locator('.function-main').click();
  await expect(rows.nth(0)).not.toHaveClass(/enabled/);
  await expect(rows.nth(1)).not.toHaveClass(/enabled/);
  expect(errors).toEqual([]);
});

function emergencyClosureGraph() {
  const nodes = [
    { id: 'roadway', typeId: 'RoadwayDataNode', label: 'Roadway', position: { x: 0, y: 0 }, params: {} },
    { id: 'people', typeId: 'PeopleDataNode', label: 'People', position: { x: 0, y: 200 }, params: {} },
    { id: 'resources', typeId: 'EmergencyResourcesDataNode', label: 'Emergency Resources', position: { x: 0, y: 400 }, params: {} },
    { id: 'water', typeId: 'WaterInrushSimulationOperator', label: 'Water Inrush Simulation', position: { x: 450, y: 100 }, params: { autoRun: true, timeSteps: 8 } },
    { id: 'personnel', typeId: 'PersonnelEmergencyAnalysisOperator', label: 'Personnel Emergency Analysis', position: { x: 800, y: 250 }, params: {} },
    {
      id: 'module',
      typeId: 'ModuleNode',
      label: 'Emergency Workspace',
      position: { x: 1200, y: 250 },
      params: {
        workspaceName: 'Emergency Workspace',
        functions: [
          { id: 'function-1', label: 'Personnel Emergency', placeholder: false, operatorNodeId: 'personnel' },
          { id: 'function-2', label: '(Add Function)', placeholder: true }
        ]
      }
    }
  ];
  const edges = [];
  const connect = (fromNode, fromPort, toNode, toPort) => edges.push({
    id: `${fromNode}:${fromPort}->${toNode}:${toPort}`,
    from: { nodeId: fromNode, portId: fromPort },
    to: { nodeId: toNode, portId: toPort }
  });
  connect('roadway', 'dataset', 'water', 'roadway');
  connect('roadway', 'dataset', 'personnel', 'roadway');
  connect('people', 'dataset', 'personnel', 'people');
  connect('resources', 'dataset', 'personnel', 'emergencyResources');
  connect('water', 'hazardState', 'personnel', 'hazardState');
  connect('personnel', 'operator', 'module', 'function-1');
  return { schemaVersion: 1, nodes, edges, view: { panX: 0, panY: 0, zoom: 1 } };
}

test('Emergency Dataset closure attaches and exposes its simulation dependency', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.addInitScript((graph) => {
    localStorage.setItem('minevis.graph', JSON.stringify(graph));
  }, emergencyClosureGraph());
  await page.goto('/preview.html');

  const row = page.locator('.function-button').first();
  await expect(row).toHaveClass(/enabled/);
  await expect(page.locator('.dependency-control-section')).toContainText('Water Inrush Simulation');
  await expect(page.locator('.root-control-section')).toContainText('Personnel Emergency Analysis');
  await expect(page.locator('.preview-error')).toHaveCount(0);

  await row.locator('.function-main').click();
  await expect(row).not.toHaveClass(/enabled/);
  await row.locator('.function-main').click();
  await expect(row).toHaveClass(/enabled/);
  await expect(page.locator('.dependency-control-section')).toContainText('Water Inrush Simulation');
  expect(errors).toEqual([]);
});
