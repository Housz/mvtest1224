import { parseCsv } from './CsvParser.js';
import { extensionOf, fetchText, pickSuggestedRoleMapping } from './adaptorUtils.js';

export class CSVTableAdaptor {
  constructor() {
    this.id = 'CSVTableAdaptor';
    this.label = 'CSV Table Adaptor';
    this.kind = 'CSV table';
  }

  supports(source) {
    return extensionOf(source?.path || source?.name) === 'csv';
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
        fields
      }
    };
  }
}
