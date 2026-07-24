import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const ventilationGraph = JSON.parse(
  fs.readFileSync(path.resolve('src/presets/graphs/Ventilation_Analysis.json'), 'utf8')
);

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

async function openVentilationPreview(page) {
  await page.addInitScript((graph) => {
    localStorage.setItem('minevis.graph', JSON.stringify(graph));
    Object.keys(localStorage)
      .filter((key) => key.startsWith('minevis.preview.layout.'))
      .forEach((key) => localStorage.removeItem(key));
  }, ventilationGraph);
  await page.goto('/preview.html');
  await expect.poll(() => page.evaluate(() => Boolean(window.minevisPreviewDebug?.layoutService)),
    { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.minevis-dock-tab').filter({ hasText: 'Main Scene' }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('canvas.ventilation-topology-canvas')).toBeVisible();
  await expect(page.locator('.dv-groupview-edge')).toHaveCount(0);
  await expect(page.locator('.workspace-auto-hide-rail')).toHaveCount(0);
}

async function beginTabDrag(page, title) {
  const tab = page.locator('.minevis-dock-tab').filter({ hasText: title }).first();
  await expect(tab).toBeVisible();
  const box = await tab.boundingBox();
  await page.mouse.move(box.x + Math.min(80, box.width / 2), box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 45, { steps: 8 });
  await expect(page.locator('.workspace-docking-overlay')).toBeVisible();
  return tab;
}

async function dropOnEdgeGuide(page, position) {
  const guide = page.locator('.workspace-edge-dock-guide[data-position="' + position + '"]');
  await expect(guide).not.toHaveClass(/disabled/);
  const box = await guide.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await expect(page.locator('.workspace-docking-hint')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.workspace-docking-overlay')).toBeHidden();
}

test('panel drag preview follows the pointer before drop', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await openVentilationPreview(page);
  await beginTabDrag(page, 'Ventilation 2D Drawing');
  const ghost = page.locator('.workspace-drag-ghost');
  const before = await ghost.boundingBox();
  expect(before.width).toBeGreaterThanOrEqual(220);
  expect(before.height).toBeGreaterThanOrEqual(130);
  await expect(ghost.locator('.workspace-drag-preview-content')).toHaveCount(1);
  await page.mouse.move(760, 240, { steps: 8 });
  await expect.poll(async () => (await ghost.boundingBox()).x).toBeGreaterThan(before.x + 120);
  const after = await ghost.boundingBox();
  expect(Math.abs(after.y - before.y)).toBeGreaterThan(80);
  await page.screenshot({ path: testInfo.outputPath('01-panel-drag-live-preview.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.workspace-docking-overlay')).toBeHidden();
  expect(errors).toEqual([]);
});

for (const position of ['left', 'top', 'bottom']) {
  test('Docking Compass docks a primary view to the ' + position + ' workspace edge', async ({ page }) => {
    const errors = collectErrors(page);
    await openVentilationPreview(page);
    const tab = await beginTabDrag(page, 'Ventilation 2D Drawing');

    const enabledGuides = await page.locator('.workspace-edge-dock-guide:not(.disabled)').evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.position)
    );
    expect(enabledGuides).toEqual(expect.arrayContaining(['left', 'right', 'top', 'bottom']));

    await dropOnEdgeGuide(page, position);
    await expect(page.locator('.dv-resize-container')).toHaveCount(0);

    const relation = await page.evaluate(({ tabText, position }) => {
      const tabs = [...document.querySelectorAll('.minevis-dock-tab')];
      const groupFor = (text) => tabs.find((element) => element.textContent.includes(text))
        ?.closest('.dv-groupview')?.getBoundingClientRect();
      const source = groupFor(tabText);
      const main = groupFor('Main Scene');
      if (!source || !main) return false;
      if (position === 'left') return source.right <= main.left + 2;
      if (position === 'top') return source.bottom <= main.top + 2;
      return source.top >= main.bottom - 2;
    }, { tabText: 'Ventilation 2D Drawing', position });
    expect(relation).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('Docking Compass adds a primary view to the Main Scene tab group', async ({ page }) => {
  const errors = collectErrors(page);
  await openVentilationPreview(page);
  const tab = await beginTabDrag(page, 'Ventilation 2D Drawing');
  const main = await page.locator('.minevis-dock-tab')
    .filter({ hasText: 'Main Scene' })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"dv-groupview")]')
    .boundingBox();
  await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2, { steps: 8 });
  const center = page.locator('.workspace-docking-compass .workspace-dock-guide-center');
  await expect(center).toBeVisible();
  await expect(center).not.toHaveClass(/disabled/);
  const centerBox = await center.boundingBox();
  await page.mouse.move(centerBox.x + centerBox.width / 2, centerBox.y + centerBox.height / 2, { steps: 6 });
  const compassBox = await page.locator('.workspace-docking-compass').boundingBox();
  expect(Math.abs(compassBox.x + compassBox.width / 2 - (main.x + main.width / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(compassBox.y + compassBox.height / 2 - (main.y + main.height / 2))).toBeLessThanOrEqual(1);

  await expect(page.locator('.workspace-docking-hint')).toBeVisible();
  await page.mouse.up();

  const sameGroup = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.dv-groupview')];
    return groups.some((group) => {
      const titles = [...group.querySelectorAll('.minevis-dock-tab-title')].map((item) => item.textContent.trim());
      return titles.includes('Main Scene') && titles.includes('Ventilation 2D Drawing');
    });
  });
  expect(sameGroup).toBe(true);
  expect(errors).toEqual([]);
});

test('a complete tab group can cancel, float, and redock through the Docking Compass', async ({ page }) => {
  const errors = collectErrors(page);
  await openVentilationPreview(page);

  const group = page.locator('.dv-groupview')
    .filter({ hasText: 'Ventilation 2D Drawing' })
    .filter({ hasText: 'Ventilation Topology Graph' })
    .first();
  const blankHeader = group.locator('.dv-void-container');
  let headerBox = await blankHeader.boundingBox();
  await page.mouse.move(headerBox.x + headerBox.width - 80, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(headerBox.x + headerBox.width - 180, headerBox.y - 80, { steps: 8 });
  await expect(page.locator('.workspace-docking-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.workspace-docking-overlay')).toBeHidden();
  await expect(page.locator('.dv-resize-container')).toHaveCount(0);
  await expect(group.locator('.minevis-dock-tab-title')).toHaveCount(2);

  headerBox = await blankHeader.boundingBox();
  await page.mouse.move(headerBox.x + headerBox.width - 80, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(700, 180, { steps: 10 });
  await page.mouse.up();

  const floating = page.locator('.dv-resize-container');
  await expect(floating).toBeVisible();
  await expect(floating.locator('.minevis-dock-tab-title')).toHaveCount(2);
  await expect(floating.locator('.dv-floating-titlebar')).toHaveCount(0);
  const titlebarBox = await floating.locator('.dv-void-container').boundingBox();
  await page.mouse.move(titlebarBox.x + 80, titlebarBox.y + titlebarBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(titlebarBox.x + 140, titlebarBox.y + 60, { steps: 8 });
  await expect(page.locator('.workspace-docking-overlay')).toBeVisible();
  await dropOnEdgeGuide(page, 'bottom');

  await expect(floating).toHaveCount(0);
  await expect(page.locator('.dv-groupview')
    .filter({ hasText: 'Ventilation 2D Drawing' })
    .filter({ hasText: 'Ventilation Topology Graph' }))
    .toHaveCount(1);
  expect(errors).toEqual([]);
});
test('floating 2D view remains interactive, resizes, and redocks without a modifier key', async ({ page }) => {
  const errors = collectErrors(page);
  await openVentilationPreview(page);
  await beginTabDrag(page, 'Ventilation 2D Drawing');
  await page.mouse.move(700, 180, { steps: 10 });
  await page.mouse.up();

  const floating = page.locator('.dv-resize-container');
  await expect(floating).toBeVisible();
  await expect(floating.locator('[data-action=float]')).toHaveCount(0);
  const canvas = floating.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const initialFloat = await floating.boundingBox();
  const initialCanvas = await canvas.boundingBox();

  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
    x: initialCanvas.x + initialCanvas.width / 2,
    y: initialCanvas.y + initialCanvas.height / 2
  });
  expect(hit).toBe('CANVAS');

  await page.mouse.move(initialCanvas.x + initialCanvas.width / 2, initialCanvas.y + initialCanvas.height / 2);
  await page.mouse.wheel(0, -160);
  await page.mouse.down();
  await page.mouse.move(initialCanvas.x + initialCanvas.width / 2 + 48, initialCanvas.y + initialCanvas.height / 2 + 24, { steps: 6 });
  await page.mouse.up();

  const handle = floating.locator('.dv-resize-handle-bottomright');
  const handleBox = await handle.boundingBox();
  await page.mouse.move(handleBox.x + Math.max(1, handleBox.width / 2), handleBox.y + Math.max(1, handleBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 80, handleBox.y + 50, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const resizedFloat = await floating.boundingBox();
    return Math.abs(resizedFloat.width - initialFloat.width) + Math.abs(resizedFloat.height - initialFloat.height);
  }).toBeGreaterThan(20);
  await expect.poll(async () => {
    const resizedCanvas = await canvas.boundingBox();
    return Math.abs(resizedCanvas.width - initialCanvas.width) + Math.abs(resizedCanvas.height - initialCanvas.height);
  }).toBeGreaterThan(20);

  await expect(floating.locator('.dv-floating-titlebar')).toHaveCount(0);
  const titlebar = floating.locator('.minevis-dock-tab').first();
  const titlebarBox = await titlebar.boundingBox();
  await page.mouse.move(titlebarBox.x + 80, titlebarBox.y + titlebarBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(titlebarBox.x + 120, titlebarBox.y + 40, { steps: 8 });
  await expect(page.locator('.workspace-docking-overlay')).toBeVisible();
  await dropOnEdgeGuide(page, 'right');

  await expect(floating).toHaveCount(0);
  const redockedCanvas = page.locator('.minevis-dock-tab')
    .filter({ hasText: 'Ventilation 2D Drawing' })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"dv-groupview")]')
    .locator('canvas');
  await expect(redockedCanvas).toBeVisible();
  expect(errors).toEqual([]);
});

test('Close removes a panel and Visual Contributions reopens it without an empty group', async ({ page }) => {
  const errors = collectErrors(page);
  await openVentilationPreview(page);
  const legendId = await page.evaluate(() => [...window.minevisPreviewDebug.layoutService.records.values()]
    .find((record) => record.title === 'Facility Legend')?.id);
  expect(legendId).toBeTruthy();
  await page.evaluate((id) => window.minevisPreviewDebug.layoutService.dockRecord(id, 'left'), legendId);
  const tab = page.locator('.minevis-dock-tab').filter({ hasText: 'Facility Legend' }).first();
  await expect(tab).toBeVisible();
  await tab.locator('[data-action="close"]').click();
  await expect(tab).toHaveCount(0);
  const manager = page.locator('.vc-manager');
  if (await manager.isHidden()) await page.locator('[data-system-panel-toggle="contributions"]').click();
  const item = manager.locator('.vc-item').filter({ hasText: 'Facility Legend' }).first();
  await expect(item.locator('.vc-open-panel')).toBeVisible();
  await item.locator('.vc-open-panel').click();
  await expect(page.locator('.minevis-dock-tab').filter({ hasText: 'Facility Legend' })).toBeVisible();
  const valid = await page.evaluate(() => ({
    validation: window.minevisPreviewDebug.layoutService.validateLayout({ geometry: false }),
    emptyGroups: [...window.minevisPreviewDebug.layoutService.api.groups]
      .filter((group) => !group.panels.length).length
  }));
  expect(valid.validation.valid).toBe(true);
  expect(valid.emptyGroups).toBe(0);
  expect(errors).toEqual([]);
});
test('single-grid root splits stay tiled and the bottom group remains flush during repeated sibling resizes', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openVentilationPreview(page);

  const result = await page.evaluate(async () => {
    const layout = window.minevisPreviewDebug.layoutService;
    const records = [...layout.records.values()];
    const right = records.find((record) => record.title === 'Ventilation Network Overview Controls');
    const bottom = records.find((record) => record.title === 'Ventilation 2D Drawing');
    layout.activatePanel(right.id);
    layout.activatePanel(bottom.id);
    layout.dockRecord(right.id, 'right');
    layout.dockRecord(bottom.id, 'bottom');
    await new Promise((resolve) => setTimeout(resolve, 120));

    for (let index = 0; index < 100; index += 1) {
      layout.api.getPanel(right.id)?.group?.api?.setSize?.({ width: 220 + (index % 7) * 18 });
      layout.api.getPanel(bottom.id)?.group?.api?.setSize?.({ height: 170 + (index % 6) * 16 });
      if (index % 10 === 9) await new Promise(requestAnimationFrame);
    }
    layout.handleLayoutChange();
    await new Promise((resolve) => setTimeout(resolve, 240));

    const workspace = document.querySelector('.runtime-dock-overlay').getBoundingClientRect();
    const bottomRect = layout.api.getPanel(bottom.id).group.element.getBoundingClientRect();
    const rects = (layout.api.groups || [])
      .filter((group) => group.api?.location?.type !== 'floating')
      .map((group) => group.element.getBoundingClientRect())
      .map((rect) => ({
        x: rect.left - workspace.left,
        y: rect.top - workspace.top,
        width: rect.width,
        height: rect.height
      }));
    const xs = [...new Set(rects.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
    let coveredArea = 0;
    for (let index = 0; index < xs.length - 1; index += 1) {
      const left = xs[index];
      const rightEdge = xs[index + 1];
      const intervals = rects
        .filter((rect) => rect.x < rightEdge && rect.x + rect.width > left)
        .map((rect) => [rect.y, rect.y + rect.height])
        .sort((a, b) => a[0] - b[0]);
      let covered = 0;
      let start = null;
      let end = null;
      intervals.forEach(([nextStart, nextEnd]) => {
        if (start == null) {
          start = nextStart;
          end = nextEnd;
        } else if (nextStart <= end + 0.5) {
          end = Math.max(end, nextEnd);
        } else {
          covered += end - start;
          start = nextStart;
          end = nextEnd;
        }
      });
      if (start != null) covered += end - start;
      coveredArea += Math.max(0, rightEdge - left) * covered;
    }
    return {
      validation: layout.validateLayout({ geometry: true }),
      bottomDelta: Math.abs(bottomRect.bottom - workspace.bottom),
      uncoveredArea: Math.max(0, workspace.width * workspace.height - coveredArea)
    };
  });

  expect(result.validation.valid, result.validation.errors.join('\n')).toBe(true);
  expect(result.bottomDelta).toBeLessThanOrEqual(1);
  expect(result.uncoveredArea).toBeLessThanOrEqual(1440 + 900);
  expect(errors).toEqual([]);
});


test('Preview lifecycle stress does not drift system chrome or recurse', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openVentilationPreview(page);
  const result = await page.evaluate(async () => {
    const debug = window.minevisPreviewDebug;
    const functionId = debug.activeWorkspace.functions[0].id;
    const sidebar = document.querySelector('.function-sidebar');
    const widthBefore = sidebar.getBoundingClientRect().width;

    for (let index = 0; index < 100; index += 1) {
      await debug.toggleFunction(functionId);
    }
    const contribution = debug.contributionRegistry.list().find((item) => item.element);
    for (let index = 0; index < 100; index += 1) {
      debug.contributionRegistry.setVisible(contribution.id, index % 2 === 1);
    }
    for (let index = 0; index < 50; index += 1) {
      debug.contributionRegistry.setFocusedFunction(functionId);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      widthBefore,
      widthAfter: sidebar.getBoundingClientRect().width,
      diagnostics: debug.diagnostics(),
      dragOverlayHidden: document.querySelector('.workspace-docking-overlay').hidden
    };
  });

  expect(result.widthAfter).toBe(result.widthBefore);
  expect(result.dragOverlayHidden).toBe(true);
  expect(result.diagnostics.contributions.pendingNotification).toBe(false);
  expect(result.diagnostics.layout.pendingContributionSync).toBe(false);
  expect(result.diagnostics.layout.transactionDepth).toBe(0);
  expect(result.diagnostics.layout.invariantFailures).toBe(0);
  expect(errors).toEqual([]);
});
