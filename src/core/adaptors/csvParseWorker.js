import Papa from 'papaparse';

const RESULT_CHUNK_SIZE = 2048;

self.onmessage = (event) => {
  const { id, text, config } = event.data || {};
  try {
    const parsed = Papa.parse(text || '', config || {});
    if ((parsed.data?.length || 0) <= RESULT_CHUNK_SIZE) {
      self.postMessage({ id, parsed });
      return;
    }
    for (let start = 0; start < parsed.data.length; start += RESULT_CHUNK_SIZE) {
      self.postMessage({
        id,
        type: 'rows',
        rows: parsed.data.slice(start, start + RESULT_CHUNK_SIZE)
      });
    }
    self.postMessage({
      id,
      type: 'complete',
      meta: parsed.meta || {},
      errors: parsed.errors || []
    });
  } catch (error) {
    self.postMessage({
      id,
      error: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack || ''
      }
    });
  }
};
