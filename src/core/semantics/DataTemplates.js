import { assertTemplateType } from './Taxonomies.js';
import { DataTemplateRegistry } from './DataTemplateRegistry.js';

export class DataTemplate {
  constructor({ id, type, label, role, data = {}, roleMapping = {}, metadata = {} }) {
    assertTemplateType(type);
    const definition = DataTemplateRegistry.get(type);
    this.id = id;
    this.type = type;
    this.label = label || id;
    this.role = role || '';
    this.data = data;
    this.roleMapping = roleMapping;
    this.metadata = metadata;
    this.kind = definition?.kind || type;
    this.form = data.form || metadata.form || definition?.forms?.[0] || '';
    this.schemaVersion = metadata.schemaVersion || 1;
  }

  summary() {
    return {
      id: this.id,
      type: this.type,
      kind: this.kind,
      label: this.label,
      role: this.role || undefined,
      form: this.form || undefined,
      schemaVersion: this.schemaVersion
    };
  }

  validate() {
    return DataTemplateRegistry.validate(this);
  }
}

export class GeometryTemplate extends DataTemplate {
  constructor(options) {
    super({ ...options, type: 'Geometry' });
  }

  summary() {
    const meshParts = this.data.meshParts || [];
    const points = this.data.points || [];
    return {
      ...super.summary(),
      form: this.data.form || this.metadata.form || 'Geometry',
      meshPartCount: meshParts.length || undefined,
      pointCount: points.length || undefined,
      modelPath: this.data.modelPath || undefined
    };
  }
}

export class GraphTemplate extends DataTemplate {
  constructor(options) {
    super({ ...options, type: 'Graph' });
  }

  summary() {
    return {
      ...super.summary(),
      nodeCount: this.data.nodes?.length || 0,
      edgeCount: this.data.edges?.length || 0
    };
  }
}

export class RegistryTemplate extends DataTemplate {
  constructor(options) {
    super({ ...options, type: 'Registry' });
  }

  summary() {
    return {
      ...super.summary(),
      entityCount: this.data.entities?.length || 0,
      keyRole: this.metadata.keyRole
    };
  }
}

export class StateTemplate extends DataTemplate {
  constructor(options) {
    super({ ...options, type: 'State' });
  }

  summary() {
    return {
      ...super.summary(),
      rowCount: this.data.rows?.length || 0,
      subjectRole: this.metadata.subjectRole,
      timeRole: this.metadata.timeRole,
      valueRole: this.metadata.valueRole,
      variable: this.metadata.variable,
      timeRange: this.metadata.timeRange
    };
  }
}

export class FieldTemplate extends DataTemplate {
  constructor(options) {
    super({ ...options, type: 'Field' });
  }

  summary() {
    return {
      ...super.summary(),
      support: this.data.support || this.metadata.support,
      fieldType: this.data.fieldType || this.metadata.fieldType,
      valueRole: this.metadata.valueRole,
      rowCount: this.data.rows?.length || this.data.values?.length || 0
    };
  }
}

export class RelationTemplate extends DataTemplate {
  constructor(options) {
    super({ ...options, type: 'Relation' });
  }

  summary() {
    return {
      ...super.summary(),
      source: this.data.source,
      target: this.data.target,
      relation: this.metadata.relation,
      relationCount: this.data.rows?.length || this.data.anchors?.length || undefined
    };
  }
}

export function createTemplate(type, options) {
  switch (type) {
    case 'Geometry':
      return new GeometryTemplate(options);
    case 'Graph':
      return new GraphTemplate(options);
    case 'Registry':
      return new RegistryTemplate(options);
    case 'State':
      return new StateTemplate(options);
    case 'Field':
      return new FieldTemplate(options);
    case 'Relation':
      return new RelationTemplate(options);
    default:
      return new DataTemplate({ ...options, type });
  }
}
