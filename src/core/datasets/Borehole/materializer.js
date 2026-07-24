import { BoreholeDataset } from '../BoreholeDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';

export function materializeBorehole({ contract, adaptorResults, roleMapping, sources }) {
  const source = adaptorResults.legacy || adaptorResults.boreholes || adaptorResults.logs || firstAdaptorResult(adaptorResults);
  const boreholeSource = adaptorResults.boreholes || {};
  const trajectorySource = adaptorResults.trajectories || {};
  const intervalSource = adaptorResults.intervals || adaptorResults.logs || {};
  const assaySource = adaptorResults.assays || {};
  const relationsSource = adaptorResults.relations || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const sourceIsBoreholeRegistry = source === boreholeSource && !source.raw?.boreholes;
  const intervalRows = mergeRows(
    intervalSource.intervals || rowsOf(intervalSource),
    assaySource.intervals || assaySource.samples || rowsOf(assaySource)
  );
  const rawIntervals = mergeRows(sourceIsBoreholeRegistry ? [] : source.intervals, sourceIsBoreholeRegistry ? [] : source.raw?.intervals, intervalRows);
  const rawBoreholes = mergeRows(source.boreholes, source.raw?.boreholes, rowsOf(boreholeSource), trajectorySource.boreholes);
  const boreholeMap = new Map();
  rawBoreholes.forEach((row, index) => {
    const id =
      getPathValue(row, relativePath(rolePath(mapping, 'boreholeId', 'boreholeId'), 'boreholes')) ??
      row.boreholeId ??
      row.borehole_id ??
      row.hole_id ??
      row.id ??
      `BH_${index + 1}`;
    boreholeMap.set(String(id), {
      ...row,
      boreholeId: String(id),
      boreholeName:
        getPathValue(row, relativePath(rolePath(mapping, 'boreholeName', 'name'), 'boreholes')) ??
        row.borehole_name ??
        row.boreholeName ??
        row.name ??
        String(id),
      collar: {
        x: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarX', 'collar.x'), 'boreholes'), 'collar_x', 'x']) ?? 0),
        y: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarY', 'collar.y'), 'boreholes'), 'collar_y', 'y']) ?? 0),
        z: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarZ', 'collar.z'), 'boreholes'), 'collar_z', 'z']) ?? 0)
      },
      trajectory: getPathValue(row, relativePath(rolePath(mapping, 'trajectory', 'trajectory'), 'boreholes')) ?? row.trajectory ?? row.points ?? []
    });
  });
  rawIntervals.forEach((row, index) => {
    const id =
      getPathValue(row, relativePath(rolePath(mapping, 'boreholeId', 'boreholeId'), 'intervals')) ??
      row.boreholeId ??
      row.borehole_id ??
      row.hole_id ??
      row.id ??
      `BH_${index + 1}`;
    if (!boreholeMap.has(String(id))) {
      boreholeMap.set(String(id), {
        boreholeId: String(id),
        boreholeName: String(id),
        collar: {
          x: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarX', 'x'), 'intervals'), 'x', 'collar_x']) ?? 0),
          y: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarY', 'y'), 'intervals'), 'y', 'collar_y']) ?? 0),
          z: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'collarZ', 'z'), 'intervals'), 'z', 'collar_z']) ?? 0)
        },
        trajectory: []
      });
    }
  });
  const boreholes = [...boreholeMap.values()];
  const intervals = rawIntervals.map((row, index) => ({
    ...row,
    sampleId:
      getPathValue(row, relativePath(rolePath(mapping, 'sampleId', 'sampleId'), 'intervals')) ??
      row.sample_id ??
      `SAMPLE_${index + 1}`,
    boreholeId:
      getPathValue(row, relativePath(rolePath(mapping, 'boreholeId', 'boreholeId'), 'intervals')) ??
      row.boreholeId ??
      row.borehole_id ??
      row.hole_id ??
      row.id,
    depthFrom: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'depthFrom', 'depthFrom'), 'intervals'), 'depth_from', 'from_depth', 'from']) ?? 0),
    depthTo: Number(valueFromAnyPath(row, [relativePath(rolePath(mapping, 'depthTo', 'depthTo'), 'intervals'), 'depth_to', 'to_depth', 'to']) ?? 0),
    lithology: getPathValue(row, relativePath(rolePath(mapping, 'lithology', 'lithology'), 'intervals')) ?? row.rock_type ?? null,
    grade: getPathValue(row, relativePath(rolePath(mapping, 'grade', 'grade'), 'intervals')) ?? row.assay ?? row.value ?? null,
    attributeValue: getPathValue(row, relativePath(rolePath(mapping, 'attributeValue', 'value'), 'intervals')) ?? row.value ?? null
  }));

  const templates = {
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Borehole registry',
      role: 'boreholeIdentity',
      data: { boreholes, samples: intervals.map((interval) => ({ sampleId: interval.sampleId, boreholeId: interval.boreholeId })) },
      roleMapping: fieldRoleMapping(mapping, ['boreholeId', 'boreholeName', 'sampleId']),
      metadata: { keyRole: 'boreholeId' }
    }),
    trajectoryGeometry: new GeometryTemplate({
      id: 'trajectoryGeometry',
      label: 'Borehole trajectory geometry',
      role: 'boreholeSpatialSupport',
      data: { form: 'Point / Polyline / LinearInterval', boreholes, intervals },
      roleMapping: fieldRoleMapping(mapping, ['collarX', 'collarY', 'collarZ', 'trajectory', 'depthFrom', 'depthTo']),
      metadata: { form: 'BoreholeTrajectory' }
    }),
    logField: createTemplate('Field', {
      id: 'logField',
      label: 'Borehole log field',
      role: 'depthIndexedLog',
      data: { rows: intervals },
      roleMapping: fieldRoleMapping(mapping, ['lithology', 'grade', 'attributeValue']),
      metadata: { support: 'borehole intervals' }
    }),
    relation: new RelationTemplate({
      id: 'relation',
      label: 'Borehole sample relation',
      role: 'sampleBoreholeRelation',
      data: { rows: mergeRows(intervals.map((interval) => ({ sampleId: interval.sampleId, boreholeId: interval.boreholeId })), rowsOf(relationsSource), relationsSource.relations) },
      roleMapping: fieldRoleMapping(mapping, ['boreholeId', 'sampleId', 'depthFrom', 'depthTo']),
      metadata: { relation: 'samples and intervals are located along boreholes' }
    })
  };

  const report = makeReport();
  if (!boreholes.length) report.errors.push('Borehole dataset has no boreholes.');
  validateUnique(boreholes.map((borehole) => borehole.boreholeId).filter(Boolean), 'Borehole ids', report);
  intervals.forEach((interval, index) => {
    if (!interval.boreholeId) report.errors.push(`Borehole interval ${index + 1} does not reference a borehole.`);
    if (Number.isFinite(interval.depthFrom) && Number.isFinite(interval.depthTo) && interval.depthFrom > interval.depthTo) {
      report.errors.push(`Borehole interval ${index + 1} has depthFrom greater than depthTo.`);
    }
  });
  report.summary = {
    boreholeCount: boreholes.length,
    intervalCount: intervals.length,
    sampleCount: intervals.filter((interval) => interval.sampleId).length
  };

  return new BoreholeDataset({
    boreholes,
    intervals,
    samples: source.samples || intervalSource.samples || intervals,
    logs: source.logs || intervalSource.logs || intervals,
    source: {
      boreholePath: sources.boreholes?.path || sources.logs?.path || sources.legacy?.path,
      trajectoryPath: sources.trajectories?.path,
      intervalPath: sources.intervals?.path,
      assayPath: sources.assays?.path,
      relationsPath: sources.relations?.path
    },
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}
