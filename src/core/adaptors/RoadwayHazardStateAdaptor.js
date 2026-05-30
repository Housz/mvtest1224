import Papa from 'papaparse';
import { collectObjectPaths, extensionOf, fetchText, pickSuggestedRoleMapping } from './adaptorUtils.js';

export class RoadwayHazardStateAdaptor {
  constructor() {
    this.id = 'RoadwayHazardStateAdaptor';
    this.label = 'Roadway Hazard State Adaptor';
    this.kind = 'Roadway hazard state';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    const ext = extensionOf(path);
    return ['csv', 'json'].includes(ext) && /hazard|roadway[_-]?hazard|inrush/i.test(path);
  }

  async load(source, contract) {
    const ext = extensionOf(source?.path || source?.name || '');
    if (ext === 'json') return this.loadJson(source, contract);
    return this.loadCsv(source, contract);
  }

  async loadCsv(source, contract) {
    const text = source.text ?? (await fetchText(source.path));
    const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
    const rows = parsed.data.filter((row) => Object.keys(row).length > 0);
    const fields = parsed.meta.fields || Object.keys(rows[0] || {});
    return {
      source,
      kind: this.kind,
      raw: { rows },
      rows,
      fields,
      paths: fields,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, fields),
      summary: {
        rowCount: rows.length,
        fieldCount: fields.length,
        fields
      }
    };
  }

  async loadJson(source, contract) {
    const raw = source.data ?? JSON.parse(source.text ?? (await fetchText(source.path)));
    const rows = raw.rows ?? raw.states ?? raw.data ?? [];
    const paths = new Set();
    collectObjectPaths({ rows: rows[0] || {} }, '', paths);
    [
      'rows.time',
      'rows.roadwayEdgeId',
      'rows.roadway_edge_id',
      'rows.roadwayNodeId',
      'rows.roadway_node_id',
      'rows.hazardType',
      'rows.hazard_type',
      'rows.hazardValue',
      'rows.hazard_value',
      'rows.severity',
      'rows.passability',
      'rows.arrivalTime',
      'rows.arrival_time',
      'rows.scenarioId',
      'rows.scenario_id'
    ].forEach((path) => paths.add(path));
    const pathList = [...paths].sort();
    return {
      source,
      kind: this.kind,
      raw,
      rows,
      fields: pathList,
      paths: pathList,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, pathList),
      summary: {
        rowCount: rows.length,
        fieldCount: pathList.length
      }
    };
  }
}
