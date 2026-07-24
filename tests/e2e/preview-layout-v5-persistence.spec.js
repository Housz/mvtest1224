import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const graph = JSON.parse(
  fs.readFileSync(path.resolve('src/presets/graphs/Ventilation_Analysis.json'), 'utf8')
);

test('v6 persists closed panels separately and reopens their last root-grid placement', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    const value = message.text();
    if (
      message.type() === 'error' ||
      (message.type() === 'warning' && /Shared context key|Maximum call stack|zero-size|aria-hidden|ECharts/i.test(value))
    ) errors.push(value);
  });
  await page.addInitScript((documentGraph) => {
    localStorage.setItem('minevis.graph', JSON.stringify(documentGraph));
    if (!sessionStorage.getItem('minevis-v6-persistence-initialized')) {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('minevis.preview.layout.'))
        .forEach((key) => localStorage.removeItem(key));
      sessionStorage.setItem('minevis-v6-persistence-initialized', 'true');
    }
  }, graph);
  await page.goto('/preview.html');
  await expect(page.locator('.minevis-dock-tab').filter({ hasText: 'Main Scene' }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.minevisPreviewDebug?.loadingMetrics?.ready)),
    { timeout: 60_000 }).toBe(true);

  const legendId = await page.evaluate(() => [...window.minevisPreviewDebug.layoutService.records.values()].find((record) => record.title === 'Facility Legend')?.id);
  await page.evaluate((id) => {
    const layout = window.minevisPreviewDebug.layoutService;
    layout.dockRecord(id, 'left');
    layout.closeRecord(id);
    layout.saveLayout();
  }, legendId);
  await expect(page.locator('.minevis-dock-tab').filter({ hasText: 'Facility Legend' })).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.minevis-dock-tab').filter({ hasText: 'Main Scene' }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.minevisPreviewDebug?.loadingMetrics?.ready)),
    { timeout: 60_000 }).toBe(true);
  await expect(page.locator('.minevis-dock-tab').filter({ hasText: 'Facility Legend' })).toHaveCount(0);
  const manager = page.locator('.vc-manager');
  if (await manager.isHidden()) await page.locator('[data-system-panel-toggle="contributions"]').click();
  const item = manager.locator('.vc-item').filter({ hasText: 'Facility Legend' }).first();
  await expect(item.locator('.vc-open-panel')).toBeVisible();
  await item.locator('.vc-open-panel').click();
  await expect(page.locator('.minevis-dock-tab').filter({ hasText: 'Facility Legend' })).toBeVisible();
  await expect.poll(() => page.evaluate((id) => {
    const layout = window.minevisPreviewDebug.layoutService;
    const panel = layout.api.getPanel(id);
    return layout.placementRegion(layout.getGroupBounds(panel?.group));
  }, legendId)).toBe('left');
  const validation = await page.evaluate(() => window.minevisPreviewDebug.layoutService.validateLayout({ geometry: false }));
  expect(validation.valid).toBe(true);
  await expect(page.locator('.dv-groupview-edge')).toHaveCount(0);
  expect(errors).toEqual([]);
});
