import { parseCsv } from './CsvParser.js';
import { extensionOf, fetchText, pickSuggestedRoleMapping } from './adaptorUtils.js';

export class AirflowStateCsvAdaptor {
  constructor() {
    this.id = 'AirflowStateCsvAdaptor';
    this.label = 'Airflow State CSV Adaptor';
    this.kind = 'Airflow state CSV';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return extensionOf(path) === 'csv' && /airflow[_-]?state/i.test(path);
  }

  async load(source, contract) {
    const text = source.text ?? (await fetchText(source.path));
    const parsed = await parseCsv(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
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
        branchCount: new Set(rows.map((row) => row.branch_id ?? row.branchId).filter(Boolean)).size,
        fields
      }
    };
  }
}
