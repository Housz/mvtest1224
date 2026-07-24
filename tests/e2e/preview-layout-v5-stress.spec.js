import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const graph = JSON.parse(
  fs.readFileSync(path.resolve('src/presets/graphs/Ventilation_Analysis.json'), 'utf8')
);

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    const value = message.text();
    if (
      message.type() === 'error' ||
      (message.type() === 'warning' && /Shared context key|Maximum call stack|zero-size|aria-hidden|ECharts/i.test(value))
    ) errors.push(value);
  });
  return errors;
}

async function openPreview(page) {
  await page.addInitScript((documentGraph) => {
    localStorage.setItem('minevis.graph', JSON.stringify(documentGraph));
    Object.keys(localStorage)
      .filter((key) => key.startsWith('minevis.preview.layout.'))
      .forEach((key) => localStorage.removeItem(key));
  }, graph);
  await page.goto('/preview.html');
  await expect(page.locator('.minevis-dock-tab').filter({ hasText: 'Main Scene' }).first())
    .toBeVisible({ timeout: 30_000 });
  await expect(page.locator('canvas.ventilation-topology-canvas'))
    .toBeVisible({ timeout: 30_000 });
}

test('v6 survives 500 deterministic mixed single-grid operations', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await openPreview(page);
  const result = await page.evaluate(async () => {
    const delay = (duration = 0) => new Promise((resolve) => setTimeout(resolve, duration));
    const debug = window.minevisPreviewDebug;
    const layout = debug.layoutService;
    const registry = debug.contributionRegistry;
    const records = [...layout.records.values()];
    const tool = records.find((record) => record.title === 'Facility Legend') ||
      records.find((record) => record.layout?.role !== 'primary-view' && !record.system);
    const primary = records.find((record) => record.title === 'Ventilation 2D Drawing');
    const functionId = debug.activeWorkspace.functions[0].id;
    const edges = ['left', 'right', 'top', 'bottom'];
    for (let index = 0; index < 500; index += 1) {
      switch (index % 10) {
        case 0:
          if (layout.isPanelOpen(tool.id)) layout.closeRecord(tool.id);
          else layout.activatePanel(tool.id);
          break;
        case 1:
          layout.activatePanel(tool.id);
          break;
        case 2:
          layout.dockRecord(tool.id, edges[Math.floor(index / 10) % edges.length]);
          break;
        case 3:
          layout.floatRecord(primary.id, {
            x: 300 + (index % 5) * 12,
            y: 100 + (index % 4) * 10,
            width: 460,
            height: 300
          });
          break;
        case 4:
          layout.dockRecord(primary.id, index % 20 ? 'bottom' : 'right');
          break;
        case 5:
          layout.api.getPanel(primary.id)?.api?.setActive?.();
          break;
        case 6:
          registry.setFocusedFunction(functionId);
          break;
        case 7:
          registry.setVisible(tool.id, true);
          break;
        case 8:
          layout.activatePanel(primary.id);
          break;
        default:
          layout.handleLayoutChange();
      }
      if (index % 25 === 24) await delay();
    }
    layout.activatePanel(tool.id);
    layout.dockRecord(tool.id, 'right');
    layout.dockRecord(primary.id, 'bottom');
    await delay(500);
    return {
      validation: layout.validateLayout(),
      emptyGroups: (layout.api.groups || []).filter((group) => !(group.panels || []).length).length,
      duplicatePanels: layout.api.panels.length - new Set(layout.api.panels.map((panel) => panel.id)).size,
      floatingTitlebars: document.querySelectorAll('.dv-floating-titlebar').length,
      scenePanels: layout.api.panels.filter((panel) => panel.id === 'minevis:main-scene').length,
      diagnostics: layout.getDiagnostics()
    };
  });

  expect(result.validation.valid).toBe(true);
  expect(result.emptyGroups).toBe(0);
  expect(result.duplicatePanels).toBe(0);
  expect(result.floatingTitlebars).toBe(0);
  expect(result.scenePanels).toBe(1);
  expect(result.diagnostics.transactionDepth).toBe(0);
  expect(result.diagnostics.invariantFailures).toBe(0);
  expect(errors).toEqual([]);
});

test('canonical layout remains bounded and keeps Main Scene visible across viewport classes', async ({ page }) => {
  const errors = collectErrors(page);
  await openPreview(page);
  const sizes = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 }
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const layout = window.minevisPreviewDebug.layoutService;
      const workspace = document.querySelector('.runtime-dock-overlay').getBoundingClientRect();
      const mainTab = [...document.querySelectorAll('.minevis-dock-tab')]
        .find((tab) => tab.textContent.includes('Main Scene'));
      const mainGroup = mainTab.closest('.dv-groupview');
      const scene = mainGroup.getBoundingClientRect();
      const content = mainGroup.querySelector('.minevis-dock-content').getBoundingClientRect();
      const systemZ = Number.parseInt(getComputedStyle(document.querySelector('.function-sidebar')).zIndex, 10);
      const canvas = mainGroup.querySelector('.runtime-scene canvas').getBoundingClientRect();
      const dockZ = Number.parseInt(getComputedStyle(document.querySelector('.runtime-dock-overlay')).zIndex, 10);
      return {
        valid: layout.validateLayout(),
        sceneShare: (scene.width * scene.height) / (workspace.width * workspace.height),
        sceneInside: scene.left >= workspace.left - 1 && scene.top >= workspace.top - 1 && scene.right <= workspace.right + 1 && scene.bottom <= workspace.bottom + 1,
        canvasDelta: Math.abs(content.width - canvas.width) + Math.abs(content.height - canvas.height),
        systemAboveDock: systemZ > dockZ,
        groups: (layout.api.groups || []).map((group) => ({
          id: group.id,
          location: group.api?.location?.type,
          panels: (group.panels || []).map((panel) => panel.title),
          bounds: layout.getGroupBounds(group)
        })),
        regionGroups: Object.fromEntries(layout.regionGroups),
        diagnostics: layout.getDiagnostics(),
        canonicalSizedGroups: [...layout.canonicalSizedGroups],
      };
    });
    expect(state.valid.valid).toBe(true);
    expect(state.sceneShare, JSON.stringify(state, null, 2)).toBeGreaterThanOrEqual(0.45);
    expect(state.sceneInside).toBe(true);
    expect(state.canvasDelta).toBeLessThanOrEqual(2);
    expect(state.systemAboveDock).toBe(true);
  }
  expect(errors).toEqual([]);
});
