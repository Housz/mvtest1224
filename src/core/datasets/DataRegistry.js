import Papa from 'papaparse';

/**
 * DataRegistry holds all dataset instances after loading.
 * It also provides semanticized accessor helpers (facets) for sensors.
 */
export class DataRegistry {
  constructor() {
    this.datasets = {};
  }

  register(name, data) {
    this.datasets[name] = data;
  }

  get(name) {
    return this.datasets[name];
  }

  async loadCsv(url) {
    const res = await fetch(url);
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, dynamicTyping: true });
    return parsed.data.filter((row) => Object.keys(row).length > 0);
  }

  async loadJson(url) {
    const res = await fetch(url);
    return res.json();
  }
}
