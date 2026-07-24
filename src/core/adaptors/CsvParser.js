import Papa from 'papaparse';

const WORKER_THRESHOLD = 256 * 1024;
let parserWorker = null;
let nextTaskId = 0;
const pendingTasks = new Map();

function rejectPending(error) {
  pendingTasks.forEach(({ reject }) => reject(error));
  pendingTasks.clear();
}

function ensureWorker() {
  if (parserWorker) return parserWorker;
  parserWorker = new Worker(new URL('./csvParseWorker.js', import.meta.url), { type: 'module' });
  parserWorker.addEventListener('message', (event) => {
    const { id, type, rows, parsed, meta, errors, error } = event.data || {};
    const task = pendingTasks.get(id);
    if (!task) return;
    if (error) {
      pendingTasks.delete(id);
      const parseError = new Error(error.message || 'CSV worker failed.');
      parseError.name = error.name || 'Error';
      parseError.stack = error.stack || parseError.stack;
      task.reject(parseError);
    } else if (type === 'rows') {
      task.rows.push(...(rows || []));
    } else if (type === 'complete') {
      pendingTasks.delete(id);
      task.resolve({ data: task.rows, meta: meta || {}, errors: errors || [] });
    } else {
      pendingTasks.delete(id);
      task.resolve(parsed);
    }
  });
  parserWorker.addEventListener('error', (event) => {
    rejectPending(event.error || new Error(event.message || 'CSV worker failed.'));
    parserWorker?.terminate();
    parserWorker = null;
  });
  return parserWorker;
}

export function parseCsv(text, config = {}) {
  const source = String(text || '');
  if (typeof Worker !== 'function' || source.length < WORKER_THRESHOLD) {
    return Promise.resolve(Papa.parse(source, config));
  }
  const id = ++nextTaskId;
  return new Promise((resolve, reject) => {
    pendingTasks.set(id, { resolve, reject, rows: [] });
    ensureWorker().postMessage({ id, text: source, config });
  });
}

export function disposeCsvParserWorker() {
  parserWorker?.terminate();
  parserWorker = null;
  rejectPending(new Error('CSV parser worker was disposed.'));
}
