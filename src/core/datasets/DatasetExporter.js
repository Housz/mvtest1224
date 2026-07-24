export function datasetToJSON(dataset) {
  if (!dataset) return null;
  return typeof dataset.toJSON === 'function'
    ? dataset.toJSON()
    : {
        datasetType: dataset.type || dataset.datasetType,
        semanticClass: dataset.semanticClass,
        metadata: dataset.metadata || {},
        data: dataset
      };
}

export function datasetToCSV(dataset) {
  if (!dataset) return '';
  if (typeof dataset.toCSV !== 'function') {
    throw new Error(`Dataset ${dataset.type || '<unknown>'} does not support CSV serialization.`);
  }
  return dataset.toCSV();
}

export function downloadBlob(blob, filename) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Dataset download requires a browser environment.');
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadDataset(dataset, format = 'json', filename = null) {
  if (!dataset) return;
  if (format === 'json') {
    const name = filename || 'dataset.json';
    downloadBlob(
      new Blob([JSON.stringify(datasetToJSON(dataset), null, 2)], { type: 'application/json' }),
      name
    );
    return;
  }
  if (format === 'csv') {
    const name = filename || 'dataset.csv';
    downloadBlob(new Blob([datasetToCSV(dataset)], { type: 'text/csv;charset=utf-8' }), name);
    return;
  }
  throw new Error(`Unsupported Dataset export format: ${format}.`);
}
