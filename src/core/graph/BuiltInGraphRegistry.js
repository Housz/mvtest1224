const graphModules = import.meta.glob('../../presets/graphs/*.json', {
  eager: true,
  import: 'default'
});

const graphEntries = Object.entries(graphModules)
  .map(([path, document]) => ({
    name: path.split('/').pop(),
    document
  }))
  .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));

const clone = (value) =>
  typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

export function listBuiltInGraphs() {
  return graphEntries.map(({ name, document }) => ({ name, document: clone(document) }));
}