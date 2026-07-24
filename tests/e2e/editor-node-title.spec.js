import { expect, test } from '@playwright/test';

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function pinnedNode(page, candidate) {
  const id = await candidate.getAttribute('data-id');
  return { id, node: page.locator(`#editor .node[data-id="${id}"]`) };
}

async function beginRename(node, { native = false } = {}) {
  const title = node.locator('.node-title');
  if (native) await title.dblclick();
  else await title.dispatchEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 });
  const input = node.locator('.node-title-input');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  return input;
}

async function nodePosition(page, nodeId) {
  return page.evaluate((id) => {
    const position = window.minevisEditor.graph.getNode(id).position;
    return { x: position.x, y: position.y };
  }, nodeId);
}

test('node title rename is title-only and coexists with thresholded dragging', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  const dataNodes = page.locator('#editor .node.kind-data');
  await expect.poll(() => dataNodes.count()).toBeGreaterThanOrEqual(3);
  const primary = await pinnedNode(page, dataNodes.nth(0));
  const cancelTarget = await pinnedNode(page, dataNodes.nth(1));
  const blurTarget = await pinnedNode(page, dataNodes.nth(2));
  await expect(primary.node.locator('.node-rename-toggle')).toHaveCount(0);
  await expect(primary.node.locator('.node-title')).toHaveCSS('cursor', 'default');

  const primaryInput = await beginRename(primary.node, { native: true });
  await primaryInput.fill('Renamed Data Node');
  await primaryInput.press('Enter');
  await expect(primary.node.locator('.node-title')).toHaveText('Renamed Data Node');

  const cancelOriginal = (await cancelTarget.node.locator('.node-title').textContent()).trim();
  const cancelInput = await beginRename(cancelTarget.node);
  await cancelInput.fill('Cancelled Name');
  await cancelInput.press('Escape');
  await expect(cancelTarget.node.locator('.node-title')).toHaveText(cancelOriginal);

  const blurInput = await beginRename(blurTarget.node);
  await blurInput.fill('Blur Commit');
  await blurInput.evaluate((element) => element.blur());
  await expect(blurTarget.node.locator('.node-title')).toHaveText('Blur Commit');

  const operatorTarget = await pinnedNode(page, page.locator('#editor .node.kind-operator').first());
  const operatorOriginal = (await operatorTarget.node.locator('.node-title').textContent()).trim();
  const emptyInput = await beginRename(operatorTarget.node);
  await emptyInput.fill('   ');
  await emptyInput.press('Enter');
  await expect(operatorTarget.node.locator('.node-title')).toHaveText(operatorOriginal);

  const titleBox = await primary.node.locator('.node-title').boundingBox();
  const startX = titleBox.x + titleBox.width / 2;
  const startY = titleBox.y + titleBox.height / 2;
  const beforeJitter = await nodePosition(page, primary.id);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 3, startY);
  await page.mouse.up();
  expect(await nodePosition(page, primary.id)).toEqual(beforeJitter);
  await page.waitForTimeout(550);

  const dragTitleBox = await primary.node.locator('.node-title').boundingBox();
  const dragX = dragTitleBox.x + dragTitleBox.width / 2;
  const dragY = dragTitleBox.y + dragTitleBox.height / 2;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  expect(await page.evaluate(() => window.minevisEditor.nodeDragCandidate?.node.id)).toBe(primary.id);
  await page.mouse.move(dragX + 24, dragY + 16);
  expect(await page.evaluate(() => window.minevisEditor.draggingNode?.id)).toBe(primary.id);
  await page.mouse.up();
  await expect.poll(() => nodePosition(page, primary.id)).not.toEqual(beforeJitter);
  await expect(primary.node.locator('.node-title-input')).toHaveCount(0);

  await primary.node.locator('.node-collapse-toggle').dispatchEvent('dblclick');
  await expect(primary.node.locator('.node-title-input')).toHaveCount(0);

  const moduleTarget = await pinnedNode(page, page.locator('#editor .node.kind-module').first());
  await page.evaluate((id) => {
    window.minevisEditor.setSelectedNode(id);
    window.minevisEditor.flushScheduledFrameNow();
  }, moduleTarget.id);
  await expect(moduleTarget.node).toBeVisible();
  const moduleInput = await beginRename(moduleTarget.node);
  await moduleInput.fill('Renamed Workspace');
  await moduleInput.press('Enter');
  await expect(moduleTarget.node.locator('.node-title')).toHaveText('Renamed Workspace');
  await expect.poll(() => page.evaluate((id) => (
    window.minevisEditor.graph.getNode(id).params.workspaceName
  ), moduleTarget.id)).toBe('Renamed Workspace');

  const edge = await page.evaluate(() => {
    const first = window.minevisEditor.graph.edges[0];
    return {
      count: window.minevisEditor.graph.edges.length,
      nodeId: first.from.nodeId,
      portId: first.from.portId
    };
  });
  const connectedPort = page.locator(
    `.port[data-node-id="${edge.nodeId}"][data-port-id="${edge.portId}"]`
  );
  await page.evaluate((nodeId) => {
    window.minevisEditor.setSelectedNode(nodeId);
    window.minevisEditor.flushScheduledFrameNow();
  }, edge.nodeId);
  await connectedPort.dblclick();
  await expect.poll(() => page.evaluate(() => window.minevisEditor.graph.edges.length))
    .toBeLessThan(edge.count);

  expect(errors).toEqual([]);
});
test('clicked node and its incident edges move through one coherent front stack', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  const endpoints = await page.evaluate(() => {
    const edge = window.minevisEditor.graph.edges[0];
    return { from: edge.from.nodeId, to: edge.to.nodeId };
  });
  const fromNode = page.locator(`#editor .node[data-id="${endpoints.from}"]`);
  const toNode = page.locator(`#editor .node[data-id="${endpoints.to}"]`);

  await fromNode.locator('.node-header').click();
  await expect.poll(() => page.evaluate(() => window.minevisEditor.selectedNodeId)).toBe(endpoints.from);
  const firstState = await page.evaluate(() => {
    const editor = window.minevisEditor;
    editor.flushScheduledFrameNow();
    const selected = editor.nodeElements.get(editor.selectedNodeId);
    const ordinary = [...editor.nodeElements.entries()].find(([id]) => id !== editor.selectedNodeId)?.[1];
    const expected = (editor.graph.getIncidentEdges?.(editor.selectedNodeId) || []).map((edge) => edge.id).sort();
    const active = [...editor.activeEdgeElements.keys()].sort();
    const activeEdgeId = active[0];
    return {
      selectedZ: Number(getComputedStyle(selected).zIndex),
      ordinaryZ: Number(getComputedStyle(ordinary).zIndex),
      activeLayerZ: Number(getComputedStyle(editor.activeEdgeSvg).zIndex),
      lastNodeId: [...editor.nodeLayer.children].filter((element) => element.classList.contains('node')).at(-1)?.dataset.id,
      expected,
      active,
      sourceD: editor.edgeElements.get(activeEdgeId)?.getAttribute('d'),
      cloneD: editor.activeEdgeElements.get(activeEdgeId)?.getAttribute('d')
    };
  });
  expect(firstState.lastNodeId).toBe(endpoints.from);
  expect(firstState.selectedZ).toBeGreaterThan(firstState.activeLayerZ);
  expect(firstState.activeLayerZ).toBeGreaterThan(firstState.ordinaryZ);
  expect(firstState.active).toEqual(firstState.expected);
  expect(firstState.cloneD).toBe(firstState.sourceD);

  await toNode.locator('.node-header').click();
  await expect.poll(() => page.evaluate(() => window.minevisEditor.selectedNodeId)).toBe(endpoints.to);
  const secondState = await page.evaluate(() => {
    const editor = window.minevisEditor;
    const expected = (editor.graph.getIncidentEdges?.(editor.selectedNodeId) || []).map((edge) => edge.id).sort();
    return {
      lastNodeId: [...editor.nodeLayer.children].filter((element) => element.classList.contains('node')).at(-1)?.dataset.id,
      active: [...editor.activeEdgeElements.keys()].sort(),
      expected
    };
  });
  expect(secondState.lastNodeId).toBe(endpoints.to);
  expect(secondState.active).toEqual(secondState.expected);
  expect(errors).toEqual([]);
});
