export function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export async function yieldToMainThread() {
  if (typeof globalThis.scheduler?.yield === 'function') {
    await globalThis.scheduler.yield();
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function mapWithConcurrency(items, worker, {
  concurrency = 3,
  onProgress = null,
  yieldBetweenItems = true
} = {}) {
  const source = Array.from(items || []);
  const results = new Array(source.length);
  let nextIndex = 0;
  let completed = 0;
  const count = Math.max(1, Math.min(source.length || 1, Math.floor(concurrency) || 1));

  const runWorker = async () => {
    while (nextIndex < source.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = source[index];
      const startedAt = nowMs();
      onProgress?.({ phase: 'start', index, completed, total: source.length, item });
      try {
        results[index] = await worker(item, index);
        completed += 1;
        onProgress?.({
          phase: 'complete',
          index,
          completed,
          total: source.length,
          item,
          durationMs: nowMs() - startedAt
        });
      } catch (error) {
        onProgress?.({
          phase: 'error',
          index,
          completed,
          total: source.length,
          item,
          error,
          durationMs: nowMs() - startedAt
        });
        throw error;
      }
      if (yieldBetweenItems) await yieldToMainThread();
    }
  };

  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return results;
}
