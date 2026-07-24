import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const monitoringGraph = JSON.parse(
  fs.readFileSync(path.resolve('src/presets/graphs/Environmental_Monitoring.json'), 'utf8')
);
const ventilationGraph = JSON.parse(
  fs.readFileSync(path.resolve('src/presets/graphs/Ventilation_Analysis.json'), 'utf8')
);

function geologyOverviewGraph() {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'body',
        typeId: 'LayeredGeologicalBodyDataNode',
        kind: 'data',
        label: 'Layered Geological Body',
        position: { x: 0, y: 0 },
        params: {}
      },
      {
        id: 'overview',
        typeId: 'GeologicalModelOverviewOperator',
        kind: 'operator',
        label: 'Geological Model Overview',
        position: { x: 420, y: 0 },
        params: {}
      },
      {
        id: 'module',
        typeId: 'ModuleNode',
        kind: 'module',
        label: 'Geological Workspace',
        position: { x: 820, y: 0 },
        params: {
          workspaceName: 'Geological Workspace',
          functions: [
            { id: 'function-1', label: 'Overview', placeholder: false, operatorNodeId: 'overview' },
            { id: 'function-2', label: '(Add Function)', placeholder: true }
          ]
        }
      }
    ],
    edges: [
      {
        id: 'body-overview',
        from: { nodeId: 'body', portId: 'dataset' },
        to: { nodeId: 'overview', portId: 'geologicalBody' }
      },
      {
        id: 'overview-module',
        from: { nodeId: 'overview', portId: 'operator' },
        to: { nodeId: 'module', portId: 'function-1' }
      }
    ],
    view: { panX: 0, panY: 0, zoom: 1 }
  };
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'error' ||
      (message.type() === 'warning' && /ECharts|Can't get DOM width or height|Maximum call stack|Blocked aria-hidden/i.test(text))
    ) errors.push(text);
  });
  return errors;
}

async function openGraph(page, graph) {
  await page.addInitScript((document) => {
    localStorage.setItem('minevis.graph', JSON.stringify(document));
    Object.keys(localStorage)
      .filter((key) => key.startsWith('minevis.preview.layout.'))
      .forEach((key) => localStorage.removeItem(key));
  }, graph);
  await page.goto('/preview.html');
  await expect.poll(
    () => page.evaluate(() => Boolean(window.minevisPreviewDebug?.layoutService)),
    { timeout: 30_000 }
  ).toBe(true);
}

test('Sensor Trend tooltip escapes the panel and the Sensor List shares 3D selection', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGraph(page, monitoringGraph);
  const chartTab = page.locator('.minevis-dock-tab').filter({ hasText: 'Sensor Trend Chart' }).first();
  await chartTab.click();
  const host = page.locator('.sensor-trend-chart-host');
  await expect(host).toBeVisible();
  const box = await host.boundingBox();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.55);
  const tooltip = page.locator('body > .minevis-chart-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(/Sensor_.+degC/);
  const tooltipBox = await tooltip.boundingBox();
  expect(tooltipBox.width).toBeLessThan(320);
  expect(tooltipBox.height).toBeLessThan(180);
  expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
  expect(tooltipBox.y).toBeGreaterThanOrEqual(0);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(1440);
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(900);
  expect(await tooltip.evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThanOrEqual(700);
  await page.screenshot({ path: testInfo.outputPath('04-sensor-tooltip.png') });

  const listTab = page.locator('.minevis-dock-tab').filter({ hasText: 'Sensor List' }).first();
  await expect(listTab).toBeVisible();
  await listTab.click();
  const listPanel = page.locator('.sensor-list-panel');
  await expect(listPanel).toBeVisible();
  const sensorCount = await page.evaluate(() => window.minevisPreviewDebug.sceneManager.sensors.size);
  const rows = listPanel.locator('.sensor-list-item');
  await expect(rows).toHaveCount(sensorCount);
  expect(sensorCount).toBeGreaterThan(1);
  await rows.nth(1).locator('.sensor-list-select').click();
  await expect(listPanel.locator('.sensor-list-item.selected')).toHaveCount(1);
  const selectedState = await page.evaluate(() => ({
    sensorID: window.minevisPreviewDebug.sceneManager.selected?.userData?.sensorID,
    radii: [...window.minevisPreviewDebug.sceneManager.sensors.values()]
      .map((mesh) => mesh.geometry?.parameters?.radius),
    pickRadii: [...window.minevisPreviewDebug.sceneManager.sensorPickTargets.values()]
      .map((mesh) => mesh.geometry?.parameters?.radius)
  }));
  expect(selectedState.sensorID).toBeTruthy();
  selectedState.radii.forEach((radius) => expect(radius).toBeGreaterThanOrEqual(2));
  selectedState.pickRadii.forEach((radius) => expect(radius).toBeGreaterThanOrEqual(3.6));

  const scenePick = await page.evaluate(() => {
    const sceneManager = window.minevisPreviewDebug.sceneManager;
    const currentSensorID = sceneManager.selected?.userData?.sensorID;
    const target = [...sceneManager.sensors.values()]
      .find((mesh) => mesh.userData.sensorID !== currentSensorID);
    const point = target.getWorldPosition(target.position.clone()).project(sceneManager.camera);
    const rect = sceneManager.renderer.domElement.getBoundingClientRect();
    return {
      sensorID: target.userData.sensorID,
      x: rect.left + ((point.x + 1) * 0.5 * rect.width),
      y: rect.top + ((1 - point.y) * 0.5 * rect.height)
    };
  });
  await page.mouse.click(scenePick.x, scenePick.y);
  await expect.poll(() => page.evaluate(() => (
    window.minevisPreviewDebug.sceneManager.selected?.userData?.sensorID
  ))).toBe(scenePick.sensorID);
  await page.screenshot({ path: testInfo.outputPath('05-sensor-list.png') });
  expect(errors).toEqual([]);
});

test('Sensor Trend Chart fills and follows its panel while toggles keep one switch geometry', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGraph(page, monitoringGraph);

  const chartTab = page.locator('.minevis-dock-tab').filter({ hasText: 'Sensor Trend Chart' }).first();
  await expect(chartTab).toBeVisible({ timeout: 30_000 });
  await chartTab.click();
  const chartPanel = page.locator('.sensor-trend-workspace-panel');
  await expect(chartPanel).toBeVisible();
  await expect(chartPanel).toHaveAttribute('data-content-profile', 'chart');

  const initial = await page.evaluate(() => {
    const panel = document.querySelector('.sensor-trend-workspace-panel');
    const chart = panel.querySelector('.sensor-trend-chart-host');
    const canvas = chart.querySelector('canvas');
    const panelRect = panel.getBoundingClientRect();
    const chartRect = chart.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return { panelRect, chartRect, canvasRect };
  });
  expect(Math.abs(initial.chartRect.width - initial.panelRect.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(initial.chartRect.height - initial.panelRect.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(initial.canvasRect.width - initial.chartRect.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(initial.canvasRect.height - initial.chartRect.height)).toBeLessThanOrEqual(2);

  await page.evaluate(() => {
    const layout = window.minevisPreviewDebug.layoutService;
    const record = [...layout.records.values()].find((item) => item.title === 'Sensor Trend Chart');
    const group = layout.api.getPanel(record.id).group;
    const rect = group.element.getBoundingClientRect();
    group.api.setSize({ height: rect.height + 90 });
  });
  await expect.poll(() => page.evaluate(() => {
    const chart = document.querySelector('.sensor-trend-chart-host');
    return Math.round(chart.getBoundingClientRect().height);
  })).toBeGreaterThan(Math.round(initial.chartRect.height + 40));
  const resizedCanvas = await chartPanel.locator('canvas').boundingBox();
  const resizedHost = await chartPanel.locator('.sensor-trend-chart-host').boundingBox();
  expect(Math.abs(resizedCanvas.width - resizedHost.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(resizedCanvas.height - resizedHost.height)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath('01-sensor-trend-responsive.png') });

  const controlsTab = page.locator('.minevis-dock-tab')
    .filter({ hasText: /Legend \/ Controls|Controls/ })
    .first();
  await controlsTab.click();
  const toggle = page.locator('.operator-show-sensors');
  await expect(toggle).toBeVisible();
  const unchecked = await toggle.evaluate((input) => {
    const style = getComputedStyle(input);
    const thumb = getComputedStyle(input, '::after');
    return {
      width: style.width,
      height: style.height,
      radius: style.borderRadius,
      thumbWidth: thumb.width,
      thumbHeight: thumb.height,
      transform: thumb.transform
    };
  });
  expect(unchecked).toEqual(expect.objectContaining({
    width: '30px',
    height: '16px',
    thumbWidth: '10px',
    thumbHeight: '10px'
  }));
  await toggle.check();
  const checked = await toggle.evaluate((input) => {
    const style = getComputedStyle(input);
    const thumb = getComputedStyle(input, '::after');
    return { background: style.backgroundColor, transform: thumb.transform };
  });
  expect(checked.background).toBe('rgb(217, 119, 6)');
  expect(checked.transform).toContain('14');
  await page.screenshot({ path: testInfo.outputPath('02-toggle-control.png') });
  expect(errors).toEqual([]);
});

test('Geological Legend uses responsive shared rows with readable marker spacing', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await openGraph(page, geologyOverviewGraph());

  const legendTab = page.locator('.minevis-dock-tab').filter({ hasText: 'Geological Legend' }).first();
  await expect(legendTab).toBeVisible({ timeout: 30_000 });
  await legendTab.click();
  const panel = page.locator('.geological-legend-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-content-profile', 'table');
  const rows = panel.locator('.runtime-legend-list .legend-row');
  await expect(rows).not.toHaveCount(0);

  const geometry = await rows.evaluateAll((elements) => elements.map((row) => {
    const marker = row.querySelector('.legend-swatch, .legend-dot, .legend-line');
    const label = row.querySelector('.legend-label');
    const rowRect = row.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    return {
      gap: labelRect.left - markerRect.right,
      overflow: row.scrollWidth - row.clientWidth,
      rowWidth: rowRect.width,
      markerWidth: markerRect.width
    };
  }));
  geometry.forEach((item) => {
    expect(item.gap).toBeGreaterThanOrEqual(7);
    expect(item.overflow).toBeLessThanOrEqual(1);
    expect(item.markerWidth).toBeGreaterThanOrEqual(10);
  });

  await page.evaluate(() => {
    const layout = window.minevisPreviewDebug.layoutService;
    const record = [...layout.records.values()].find((item) => item.title === 'Geological Legend');
    layout.api.getPanel(record.id).group.api.setSize({ width: 220 });
  });
  await expect.poll(() => panel.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('03-geological-legend.png') });
  expect(errors).toEqual([]);
});

test('Ventilation panels share one responsive shell without horizontal clipping', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await openGraph(page, ventilationGraph);

  const functionRows = page.locator('.function-button');
  for (let index = 0; index < await functionRows.count(); index += 1) {
    const row = functionRows.nth(index);
    if (!(await row.evaluate((element) => element.classList.contains('enabled')))) {
      await row.locator('.function-main').click();
      await expect(row).toHaveClass(/enabled/);
    }
  }

  const panelIds = await page.evaluate(() => [...window.minevisPreviewDebug.layoutService.records.values()]
    .filter((record) => record.element)
    .map((record) => record.id));
  const issues = [];
  for (const panelId of panelIds) {
    await page.evaluate((id) => window.minevisPreviewDebug.layoutService.activatePanel(id), panelId);
    await page.waitForTimeout(30);
    const issue = await page.evaluate((id) => {
      const record = window.minevisPreviewDebug.layoutService.records.get(id);
      const element = record?.element;
      if (!element?.isConnected || !element.getClientRects().length) return null;
      const horizontalOverflow = element.scrollWidth - element.clientWidth;
      const legacyTitles = [...element.querySelectorAll('.panel-title, .panel-heading, .panel-header')]
        .filter((title) => getComputedStyle(title).display !== 'none').length;
      return horizontalOverflow > 2 || legacyTitles
        ? { title: record.title, horizontalOverflow, legacyTitles, profile: element.dataset.contentProfile }
        : null;
    }, panelId);
    if (issue) issues.push(issue);
  }

  expect(issues).toEqual([]);
  const facilityLegend = await page.evaluate(() => {
    const layout = window.minevisPreviewDebug.layoutService;
    const record = [...layout.records.values()].find((item) => item.title === 'Facility Legend');
    if (!record) return { found: false, rowCount: 0 };
    layout.activatePanel(record.id);
    return {
      found: true,
      rowCount: record.element?.querySelectorAll('.runtime-legend-list .legend-row').length || 0
    };
  });
  expect(facilityLegend).toEqual({ found: true, rowCount: 6 });
  expect(errors).toEqual([]);
});

test('Roadway scalar supports multi-selection and four linked chart presentations', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGraph(page, monitoringGraph);

  const listTab = page.locator('.minevis-dock-tab').filter({ hasText: 'Sensor List' }).first();
  await expect(listTab).toBeVisible({ timeout: 30_000 });
  await listTab.click();
  const listPanel = page.locator('.sensor-list-panel');
  const rows = listPanel.locator('.sensor-list-item');
  await expect(rows).toHaveCount(await page.evaluate(() => window.minevisPreviewDebug.sceneManager.sensors.size));
  expect(await rows.count()).toBeGreaterThanOrEqual(5);

  for (let index = 1; index < 5; index += 1) {
    await rows.nth(index).locator('.sensor-list-compare').check();
  }
  await expect(listPanel.locator('.sensor-list-item.compared')).toHaveCount(5);
  await expect(listPanel.locator('.sensor-list-count')).toContainText('5/8 compared');

  const colors = await listPanel.locator('.sensor-list-item.compared .sensor-list-marker')
    .evaluateAll((elements) => elements.map((element) => element.style.getPropertyValue('--series-color')));
  expect(new Set(colors).size).toBe(5);
  const ringState = await page.evaluate(() => ({
    count: window.minevisPreviewDebug.sceneManager.sensorSelectionSprites.size,
    primaryCount: [...window.minevisPreviewDebug.sceneManager.sensorSelectionSprites.values()]
      .filter((sprite) => sprite.scale.x >= 9.5).length
  }));
  expect(ringState).toEqual({ count: 5, primaryCount: 1 });

  const chartTab = page.locator('.minevis-dock-tab').filter({ hasText: 'Sensor Trend Chart' }).first();
  await chartTab.click();
  const chartHost = page.locator('.sensor-trend-chart-host');
  await expect(chartHost).toBeVisible();
  await expect(chartHost).toHaveAttribute('data-series-count', '5');
  await expect(chartHost).toHaveAttribute('data-comparison-layout', 'small-multiples');

  const controlsId = await page.evaluate(() => {
    const layout = window.minevisPreviewDebug.layoutService;
    return [...layout.records.values()]
      .find((record) => record.element?.querySelector?.('.chart-presentation-select'))?.id || null;
  });
  expect(controlsId).toBeTruthy();
  await page.evaluate((id) => window.minevisPreviewDebug.layoutService.activatePanel(id), controlsId);
  const presentation = page.locator('.chart-presentation-select:visible').first();
  await expect(presentation).toBeVisible();

  await presentation.selectOption('scene-callout');
  const callout = page.locator('.scene-chart-callout');
  await expect(callout).toBeVisible();
  const calloutBounds = await page.evaluate(() => {
    const scene = window.minevisPreviewDebug.sceneManager.container.getBoundingClientRect();
    const panel = document.querySelector('.scene-chart-callout').getBoundingClientRect();
    return {
      left: panel.left - scene.left,
      top: panel.top - scene.top,
      right: scene.right - panel.right,
      bottom: scene.bottom - panel.bottom
    };
  });
  Object.values(calloutBounds).forEach((distance) => expect(distance).toBeGreaterThanOrEqual(6));
  await expect(chartHost).toHaveAttribute('data-series-count', '5');
  await page.screenshot({ path: testInfo.outputPath('06-scene-callout-comparison.png') });

  await presentation.selectOption('world-billboard');
  await expect(callout).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const scene = window.minevisPreviewDebug.sceneManager.scene;
    const billboards = scene.children.filter((object) => object.name.endsWith('-world-billboard'));
    const planes = scene.children.filter((object) => object.name.endsWith('-world-plane'));
    return {
      billboardCount: billboards.length,
      planeCount: planes.length,
      billboardVisible: billboards[0]?.visible || false,
      planeVisible: planes[0]?.visible || false
    };
  })).toEqual({
    billboardCount: 1,
    planeCount: 1,
    billboardVisible: true,
    planeVisible: false
  });
  const textureUuid = await page.evaluate(() => {
    const scene = window.minevisPreviewDebug.sceneManager.scene;
    return scene.children.find((object) => object.name.endsWith('-world-billboard'))?.material?.map?.uuid;
  });
  expect(textureUuid).toBeTruthy();
  await expect(chartHost).toHaveAttribute('data-series-count', '1');
  await expect(chartHost).toHaveAttribute('data-series-mode', 'primary-only');

  const billboardPoint = await page.evaluate(() => {
    const sceneManager = window.minevisPreviewDebug.sceneManager;
    const billboard = sceneManager.scene.children
      .find((object) => object.name.endsWith('-world-billboard'));
    sceneManager.scene.updateMatrixWorld(true);
    sceneManager.camera.updateMatrixWorld(true);
    const point = billboard.getWorldPosition(billboard.position.clone())
      .project(sceneManager.camera);
    const rect = sceneManager.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) * 0.5 * rect.width),
      y: rect.top + ((1 - point.y) * 0.5 * rect.height)
    };
  });
  await page.evaluate(({ x, y }) => {
    const canvas = window.minevisPreviewDebug.sceneManager.renderer.domElement;
    const init = {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0
    };
    canvas.dispatchEvent(new PointerEvent('pointerdown', init));
    canvas.dispatchEvent(new PointerEvent('pointerup', init));
  }, billboardPoint);
  await expect(presentation).toHaveValue('docked');
  await expect(chartHost).toHaveAttribute('data-series-count', '5');
  await expect(chartHost).toHaveAttribute('data-series-mode', 'full');
  await presentation.selectOption('world-billboard');

  for (let index = 0; index < 6; index += 1) {
    await presentation.selectOption(index % 2 ? 'world-billboard' : 'scene-callout');
  }
  await presentation.selectOption('world-plane');
  await expect(chartHost).toHaveAttribute('data-series-count', '1');
  const planeBefore = await page.evaluate(() => {
    const sceneManager = window.minevisPreviewDebug.sceneManager;
    const plane = sceneManager.scene.children.find((object) => object.name.endsWith('-world-plane'));
    const quaternion = plane.quaternion.toArray();
    sceneManager.camera.rotateY(0.35);
    sceneManager.camera.updateMatrixWorld(true);
    return quaternion;
  });
  await page.waitForTimeout(100);
  const worldState = await page.evaluate(() => {
    const scene = window.minevisPreviewDebug.sceneManager.scene;
    const billboard = scene.children.find((object) => object.name.endsWith('-world-billboard'));
    const plane = scene.children.find((object) => object.name.endsWith('-world-plane'));
    return {
      billboardCount: scene.children.filter((object) => object.name.endsWith('-world-billboard')).length,
      planeCount: scene.children.filter((object) => object.name.endsWith('-world-plane')).length,
      textureUuid: billboard.material.map.uuid,
      billboardVisible: billboard.visible,
      planeVisible: plane.visible,
      planeQuaternion: plane.quaternion.toArray()
    };
  });
  expect(worldState.billboardCount).toBe(1);
  expect(worldState.planeCount).toBe(1);
  expect(worldState.textureUuid).toBe(textureUuid);
  expect(worldState.billboardVisible).toBe(false);
  expect(worldState.planeVisible).toBe(true);
  planeBefore.forEach((value, index) => expect(worldState.planeQuaternion[index]).toBeCloseTo(value, 6));

  await presentation.selectOption('docked');
  const restoredChartTab = page.locator('.minevis-dock-tab')
    .filter({ hasText: 'Sensor Trend Chart' }).first();
  await expect(restoredChartTab).toBeVisible();
  await restoredChartTab.click();
  await expect(chartHost).toBeVisible();
  await expect(chartHost).toHaveAttribute('data-series-count', '5');
  expect(errors).toEqual([]);
});
test('Ventilation branch trend shares comparison selection and cleans world charts', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGraph(page, ventilationGraph);

  const functionRow = page.locator('.function-button')
    .filter({ hasText: 'Branch Airflow Trend Inspection' }).first();
  await expect(functionRow).toBeVisible();
  if (!(await functionRow.evaluate((element) => element.classList.contains('enabled')))) {
    await functionRow.locator('.function-main').click();
  }
  await expect(functionRow).toHaveClass(/enabled/);

  const selectorTab = page.locator('.minevis-dock-tab')
    .filter({ hasText: 'Branch Selector / Context' }).first();
  await expect(selectorTab).toBeVisible({ timeout: 30_000 });
  await selectorTab.click();
  const selectorPanel = page.locator('.branch-selector-panel');
  const branchRows = selectorPanel.locator('.branch-comparison-row');
  expect(await branchRows.count()).toBeGreaterThanOrEqual(5);
  for (let index = 1; index < 5; index += 1) {
    await branchRows.nth(index).locator('.branch-comparison-checkbox').check();
  }
  await expect(selectorPanel.locator('.branch-comparison-row.is-compared')).toHaveCount(5);
  await expect(selectorPanel.locator('.comparison-list-summary')).toContainText('5 / 8 compared');

  const trendTab = page.locator('.minevis-dock-tab')
    .filter({ hasText: 'Branch Airflow Trend Chart' }).first();
  await trendTab.click();
  const chartHost = page.locator('.branch-trend-chart');
  await expect(chartHost).toBeVisible();
  await expect(chartHost).toHaveAttribute('data-series-count', '5');
  await expect(chartHost).toHaveAttribute('data-comparison-layout', 'small-multiples');
  expect(await page.evaluate(() => (
    window.minevisPreviewDebug.sceneManager.ventilationSelectionSprites.size
  ))).toBe(5);

  await functionRow.locator('.function-focus').click();
  const presentation = page.locator('.chart-presentation-select:visible').first();
  await expect(presentation).toBeVisible();
  await presentation.selectOption('world-billboard');
  await expect(chartHost).toHaveAttribute('data-series-count', '1');
  await expect(chartHost).toHaveAttribute('data-series-mode', 'primary-only');
  await expect.poll(() => page.evaluate(() => {
    const scene = window.minevisPreviewDebug.sceneManager.scene;
    return scene.children.filter((object) => (
      object.name.includes('branch-trend-chart-world-billboard') && object.visible
    )).length;
  })).toBe(1);

  await functionRow.locator('.function-main').click();
  await expect(functionRow).not.toHaveClass(/enabled/);
  await expect.poll(() => page.evaluate(() => {
    const sceneManager = window.minevisPreviewDebug.sceneManager;
    return {
      worldObjects: sceneManager.scene.children.filter((object) => (
        object.name.includes('branch-trend-chart-world')
      )).length,
      pickTargets: [...sceneManager.chartPresentationPickTargets.keys()]
        .filter((key) => key.includes('branch-trend-chart')).length
    };
  })).toEqual({ worldObjects: 0, pickTargets: 0 });
  expect(errors).toEqual([]);
});

test('Roadway temperature chart reopens and scene presentations survive blank picks', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGraph(page, monitoringGraph);

  const chartId = await page.evaluate(() => {
    const layout = window.minevisPreviewDebug.layoutService;
    return [...layout.records.values()]
      .find((record) => record.title === 'Sensor Trend Chart')?.id || null;
  });
  expect(chartId).toBeTruthy();
  await page.evaluate((id) => window.minevisPreviewDebug.layoutService.closeRecord(id), chartId);
  await expect.poll(() => page.evaluate(
    (id) => window.minevisPreviewDebug.layoutService.isPanelOpen(id),
    chartId
  )).toBe(false);

  const projectSensor = async ({ excludeCurrent = false, avoidCallout = false } = {}) => (
    page.evaluate(({ excludeCurrent, avoidCallout }) => {
      const sceneManager = window.minevisPreviewDebug.sceneManager;
      sceneManager.scene.updateMatrixWorld(true);
      sceneManager.camera.updateMatrixWorld(true);
      const canvas = sceneManager.renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      const currentId = sceneManager.selected?.userData?.sensorID;
      const calloutRect = avoidCallout && !document.querySelector('.scene-chart-callout')?.hidden
        ? document.querySelector('.scene-chart-callout').getBoundingClientRect()
        : null;
      for (const sensor of sceneManager.sensors.values()) {
        if (excludeCurrent && sensor.userData.sensorID === currentId) continue;
        const projected = sensor.getWorldPosition(sensor.position.clone()).project(sceneManager.camera);
        const x = rect.left + ((projected.x + 1) * 0.5 * rect.width);
        const y = rect.top + ((1 - projected.y) * 0.5 * rect.height);
        if (projected.z < -1 || projected.z > 1 ||
            x < rect.left + 8 || x > rect.right - 8 ||
            y < rect.top + 8 || y > rect.bottom - 8) continue;
        if (calloutRect &&
            x >= calloutRect.left - 8 && x <= calloutRect.right + 8 &&
            y >= calloutRect.top - 8 && y <= calloutRect.bottom + 8) continue;
        if (document.elementFromPoint(x, y) !== canvas) continue;
        return { sensorID: sensor.userData.sensorID, x, y };
      }
      return null;
    }, { excludeCurrent, avoidCallout })
  );

  const firstPick = await projectSensor({ excludeCurrent: true });
  expect(firstPick).toBeTruthy();
  await page.mouse.click(firstPick.x, firstPick.y);
  await expect.poll(() => page.evaluate(() => (
    window.minevisPreviewDebug.sceneManager.selected?.userData?.sensorID
  ))).toBe(firstPick.sensorID);
  await expect.poll(() => page.evaluate(
    (id) => window.minevisPreviewDebug.layoutService.isPanelOpen(id),
    chartId
  )).toBe(true);
  expect(await page.evaluate(
    (id) => window.minevisPreviewDebug.layoutService.api.getPanel(id)?.group?.activePanel?.id,
    chartId
  )).toBe(chartId);

  const controlsId = await page.evaluate(() => {
    const layout = window.minevisPreviewDebug.layoutService;
    return [...layout.records.values()]
      .find((record) => record.element?.querySelector?.('.chart-presentation-select'))?.id || null;
  });
  expect(controlsId).toBeTruthy();
  await page.evaluate((id) => window.minevisPreviewDebug.layoutService.activatePanel(id), controlsId);
  const presentation = page.locator('.chart-presentation-select:visible').first();
  await presentation.selectOption('scene-callout');

  const callout = page.locator('.scene-chart-callout');
  await expect(callout).toBeVisible();
  expect(await page.locator('.scene-chart-overlay').evaluate(
    (element) => getComputedStyle(element).pointerEvents
  )).toBe('none');

  const calloutPick = await projectSensor({ excludeCurrent: true, avoidCallout: true });
  expect(calloutPick).toBeTruthy();
  await page.mouse.click(calloutPick.x, calloutPick.y);
  await expect.poll(() => page.evaluate(() => (
    window.minevisPreviewDebug.sceneManager.selected?.userData?.sensorID
  ))).toBe(calloutPick.sensorID);

  const orbitStart = await page.evaluate(() => {
    const sceneManager = window.minevisPreviewDebug.sceneManager;
    const canvas = sceneManager.renderer.domElement;
    const scene = canvas.getBoundingClientRect();
    const callout = document.querySelector('.scene-chart-callout')?.getBoundingClientRect();
    const candidates = [
      [0.18, 0.22], [0.82, 0.22], [0.18, 0.78], [0.82, 0.78], [0.5, 0.82]
    ];
    for (const [rx, ry] of candidates) {
      const x = scene.left + scene.width * rx;
      const y = scene.top + scene.height * ry;
      const blocked = callout &&
        x >= callout.left - 8 && x <= callout.right + 8 &&
        y >= callout.top - 8 && y <= callout.bottom + 8;
      if (!blocked && document.elementFromPoint(x, y) === canvas) return { x, y };
    }
    return null;
  });
  expect(orbitStart).toBeTruthy();
  const cameraBefore = await page.evaluate(() => (
    window.minevisPreviewDebug.sceneManager.camera.position.toArray()
  ));
  await page.mouse.move(orbitStart.x, orbitStart.y);
  await page.mouse.down();
  await page.mouse.move(orbitStart.x + 36, orbitStart.y + 12, { steps: 6 });
  await page.mouse.up();
  const cameraAfter = await page.evaluate(() => (
    window.minevisPreviewDebug.sceneManager.camera.position.toArray()
  ));
  expect(cameraAfter.some((value, index) => Math.abs(value - cameraBefore[index]) > 1e-4)).toBe(true);
  expect(await page.evaluate(() => (
    window.minevisPreviewDebug.sceneManager.selected?.userData?.sensorID
  ))).toBe(calloutPick.sensorID);
  await expect(callout).toBeVisible();

  const blankScenePoint = async () => page.evaluate(() => {
    const sceneManager = window.minevisPreviewDebug.sceneManager;
    sceneManager.scene.updateMatrixWorld(true);
    sceneManager.camera.updateMatrixWorld(true);
    const canvas = sceneManager.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const projectedSensors = [...sceneManager.sensors.values()].map((sensor) => {
      const point = sensor.getWorldPosition(sensor.position.clone()).project(sceneManager.camera);
      return {
        x: rect.left + ((point.x + 1) * 0.5 * rect.width),
        y: rect.top + ((1 - point.y) * 0.5 * rect.height)
      };
    });
    const candidates = [
      [0.08, 0.92], [0.92, 0.92], [0.08, 0.12], [0.92, 0.12]
    ];
    for (const [rx, ry] of candidates) {
      const x = rect.left + rect.width * rx;
      const y = rect.top + rect.height * ry;
      if (document.elementFromPoint(x, y) !== canvas) continue;
      if (projectedSensors.every((point) => Math.hypot(point.x - x, point.y - y) > 48)) {
        return { x, y };
      }
    }
    return null;
  });

  for (const mode of ['world-billboard', 'world-plane']) {
    await presentation.selectOption(mode);
    const suffix = mode === 'world-billboard' ? '-world-billboard' : '-world-plane';
    await expect.poll(() => page.evaluate((suffix) => {
      const scene = window.minevisPreviewDebug.sceneManager.scene;
      return scene.children.some((object) => object.name.endsWith(suffix) && object.visible);
    }, suffix)).toBe(true);

    const blank = await blankScenePoint();
    expect(blank).toBeTruthy();
    await page.mouse.click(blank.x, blank.y);
    await expect.poll(() => page.evaluate(() => (
      window.minevisPreviewDebug.sceneManager.selected?.userData?.sensorID || null
    ))).toBe(null);
    await expect.poll(() => page.evaluate((suffix) => {
      const scene = window.minevisPreviewDebug.sceneManager.scene;
      return scene.children.some((object) => object.name.endsWith(suffix) && object.visible);
    }, suffix)).toBe(false);

    const sensorPick = await projectSensor();
    expect(sensorPick).toBeTruthy();
    await page.mouse.click(sensorPick.x, sensorPick.y);
    await expect.poll(() => page.evaluate(() => (
      window.minevisPreviewDebug.sceneManager.selected?.userData?.sensorID
    ))).toBe(sensorPick.sensorID);
    await expect.poll(() => page.evaluate((suffix) => {
      const scene = window.minevisPreviewDebug.sceneManager.scene;
      return scene.children.some((object) => object.name.endsWith(suffix) && object.visible);
    }, suffix)).toBe(true);
  }

  expect(errors).toEqual([]);
});
