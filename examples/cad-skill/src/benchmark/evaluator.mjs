import {
  CADTESTBENCH_00003247_CASE,
  CADTESTBENCH_PROVENANCE,
} from './cadtestbench-source.mjs';
import {
  createNamedAssemblyExtensionCase,
  createPrimitiveExtensionCase,
} from './extensions.mjs';

export const CAD_RELATIVE_TOLERANCE = 0.01;
export const CAD_ABSOLUTE_TOLERANCE = 1e-7;
export const CAD_BREP_IOU_THRESHOLD = 0.99;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const vector3 = (value) => Array.isArray(value) && value.length === 3 && value.every(finite);

const closeNumber = (actual, expected, {
  relative = CAD_RELATIVE_TOLERANCE,
  absolute = CAD_ABSOLUTE_TOLERANCE,
} = {}) => finite(actual) && finite(expected) &&
  Math.abs(actual - expected) <= Math.max(absolute, Math.abs(expected) * relative);

const closeVector = (actual, expected, options) => vector3(actual) && vector3(expected) &&
  expected.every((value, index) => closeNumber(actual[index], value, options));

const dimensionsFromBounds = (bounds) => {
  if (!bounds || !vector3(bounds.min) || !vector3(bounds.max)) return undefined;
  const dimensions = bounds.max.map((maximum, axis) => maximum - bounds.min[axis]);
  return dimensions.every(finite) ? dimensions : undefined;
};

const centerFromBounds = (bounds) => {
  if (!bounds || !vector3(bounds.min) || !vector3(bounds.max)) return undefined;
  return bounds.max.map((maximum, axis) => (maximum + bounds.min[axis]) / 2);
};

const expectedBounds = (part) => ({
  min: part.center.map((coordinate, axis) => coordinate - part.dimensions[axis] / 2),
  max: part.center.map((coordinate, axis) => coordinate + part.dimensions[axis] / 2),
});

const normalizeType = (value) => String(value ?? '')
  .toLowerCase()
  .replaceAll('geomabs_', '')
  .replaceAll(/[^a-z]/gu, '');

const typeAliases = {
  plane: new Set(['plane', 'planar']),
  sphere: new Set(['sphere', 'spherical']),
  circle: new Set(['circle', 'circular']),
};

const typeCount = (collection, expectedType) => {
  if (collection === undefined || collection === null) return undefined;
  const aliases = typeAliases[expectedType] ?? new Set([normalizeType(expectedType)]);
  if (Array.isArray(collection)) {
    return collection.reduce((count, item) => {
      const type = typeof item === 'object' ? item?.type ?? item?.kind ?? item?.geometry : item;
      return count + (aliases.has(normalizeType(type)) ? 1 : 0);
    }, 0);
  }
  if (typeof collection === 'object') {
    let count = 0;
    let recognized = false;
    for (const [type, value] of Object.entries(collection)) {
      if (!aliases.has(normalizeType(type))) continue;
      recognized = true;
      if (finite(value)) count += value;
      else if (Array.isArray(value)) count += value.length;
      else if (value === true) count += 1;
    }
    return recognized ? count : 0;
  }
  return undefined;
};

const sortedDimensions = (part) => dimensionsFromBounds(part?.bounds)?.toSorted((a, b) => a - b);

const result = (passed, expected, actual) => ({ passed: Boolean(passed), expected, actual });

const relativeCheck = (actual, expected, tolerance = CAD_RELATIVE_TOLERANCE) =>
  finite(actual) && finite(expected) && expected !== 0 &&
  Math.abs(actual - expected) / Math.abs(expected) < tolerance;

const officialPredicate = (cadtestId, part) => {
  const dimensions = sortedDimensions(part);
  const planarFaceCount = typeCount(part?.faceTypes, 'plane');
  const circularEdgeCount = typeCount(part?.edgeTypes, 'circle');

  switch (cadtestId) {
    case 1:
      return result(planarFaceCount === 6, 6, planarFaceCount);
    case 2:
      return result(part?.edgeCount === 12, 12, part?.edgeCount);
    case 3:
      return result(part?.vertexCount === 8, 8, part?.vertexCount);
    case 4:
      return result(part?.solidCount === 1, 1, part?.solidCount);
    case 5:
      return result(relativeCheck(dimensions?.[2], 0.7), 0.7, dimensions?.[2]);
    case 6:
      return result(relativeCheck(dimensions?.[0], 0.3), 0.3, dimensions?.[0]);
    case 7:
      return result(relativeCheck(dimensions?.[1], 0.3), 0.3, dimensions?.[1]);
    case 8: {
      const ratio = dimensions && Math.abs(dimensions[0] - dimensions[1]) /
        Math.max(dimensions[0], dimensions[1]);
      return result(finite(ratio) && ratio < 0.01, '< 0.01', ratio);
    }
    case 9:
      return result(relativeCheck(part?.volume, 0.063), 0.063, part?.volume);
    case 10: {
      const boundingBoxVolume = dimensions?.reduce((product, value) => product * value, 1);
      const shapeFactor = finite(part?.volume) && finite(boundingBoxVolume)
        ? part.volume / boundingBoxVolume
        : undefined;
      return result(finite(shapeFactor) && Math.abs(shapeFactor - 1) < 0.01, '1 ± 0.01', shapeFactor);
    }
    case 11: {
      const measuredRatio = dimensions && dimensions[2] / dimensions[0];
      const expectedRatio = 0.7 / 0.3;
      return result(relativeCheck(measuredRatio, expectedRatio), expectedRatio, measuredRatio);
    }
    case 12:
      return result(
        finite(part?.faceCount) && finite(planarFaceCount) && part.faceCount === planarFaceCount,
        'faceCount === planarFaceCount',
        { faceCount: part?.faceCount, planarFaceCount },
      );
    case 13:
      return result(circularEdgeCount === 0, 0, circularEdgeCount);
    default:
      throw new RangeError(`Unknown official CADTest id: ${cadtestId}`);
  }
};

const analyticVolume = (part) => part.primitive === 'sphere'
  ? (4 / 3) * Math.PI * part.radius ** 3
  : part.dimensions.reduce((product, dimension) => product * dimension, 1);

const analyticArea = (part) => {
  if (part.primitive === 'sphere') return 4 * Math.PI * part.radius ** 2;
  const [x, y, z] = part.dimensions;
  return 2 * (x * y + x * z + y * z);
};

const primitiveGeometry = (expected, actual) => {
  if (!actual || !finite(actual.faceCount) || actual.faceCount <= 0) {
    return result(false, expected.primitive, undefined);
  }
  if (expected.primitive === 'sphere') {
    const sphericalFaces = typeCount(actual.faceTypes, 'sphere');
    return result(
      finite(sphericalFaces) && sphericalFaces === actual.faceCount,
      'all faces spherical',
      { faceCount: actual.faceCount, sphericalFaces },
    );
  }
  const planarFaces = typeCount(actual.faceTypes, 'plane');
  const circularEdges = typeCount(actual.edgeTypes, 'circle');
  return result(
    planarFaces === actual.faceCount && circularEdges === 0,
    'all faces planar and no circular edges',
    { faceCount: actual.faceCount, planarFaces, circularEdges },
  );
};

const primitiveCheck = (suffix, expected, actual) => {
  switch (suffix) {
    case 'brep-valid':
      return result(actual?.brepValid === true, true, actual?.brepValid);
    case 'single-solid':
      return result(actual?.solidCount === 1, 1, actual?.solidCount);
    case 'mesh-valid':
      return result(actual?.meshValid === true, true, actual?.meshValid);
    case 'geometry-type':
      return primitiveGeometry(expected, actual);
    case 'box-topology':
      return result(
        actual?.faceCount === 6 && actual?.edgeCount === 12 && actual?.vertexCount === 8,
        { faceCount: 6, edgeCount: 12, vertexCount: 8 },
        {
          faceCount: actual?.faceCount,
          edgeCount: actual?.edgeCount,
          vertexCount: actual?.vertexCount,
        },
      );
    case 'bounds': {
      const expectedValue = expectedBounds(expected);
      const scale = Math.max(...expected.dimensions);
      const options = { relative: 0, absolute: Math.max(CAD_ABSOLUTE_TOLERANCE, scale * CAD_RELATIVE_TOLERANCE) };
      const passed = closeVector(actual?.bounds?.min, expectedValue.min, options) &&
        closeVector(actual?.bounds?.max, expectedValue.max, options);
      return result(passed, expectedValue, actual?.bounds);
    }
    case 'volume': {
      const expectedValue = analyticVolume(expected);
      return result(relativeCheck(actual?.volume, expectedValue), expectedValue, actual?.volume);
    }
    case 'area': {
      const expectedValue = analyticArea(expected);
      return result(relativeCheck(actual?.area, expectedValue), expectedValue, actual?.area);
    }
    case 'center-of-mass': {
      const scale = Math.max(...expected.dimensions);
      const options = { relative: 0, absolute: Math.max(CAD_ABSOLUTE_TOLERANCE, scale * CAD_RELATIVE_TOLERANCE) };
      return result(
        closeVector(actual?.centerOfMass, expected.center, options),
        expected.center,
        actual?.centerOfMass,
      );
    }
    case 'brep-iou':
      return result(
        finite(actual?.brepIou) && actual.brepIou >= CAD_BREP_IOU_THRESHOLD,
        `>= ${CAD_BREP_IOU_THRESHOLD}`,
        actual?.brepIou,
      );
    default:
      throw new RangeError(`Unknown extension predicate: ${suffix}`);
  }
};

const actualPartsByName = (probe) => new Map(
  (Array.isArray(probe?.parts) ? probe.parts : []).map((part) => [part?.name, part]),
);

const sameNames = (actual, expected) => actual.length === expected.length &&
  [...actual].sort().every((name, index) => name === [...expected].sort()[index]);

const pointToBoxDistance = (point, box) => Math.hypot(...point.map((coordinate, axis) => {
  const minimum = box.center[axis] - box.dimensions[axis] / 2;
  const maximum = box.center[axis] + box.dimensions[axis] / 2;
  return Math.max(minimum - coordinate, 0, coordinate - maximum);
}));

const expectedPairDistance = (first, second) => {
  if (first.primitive === 'sphere' && second.primitive === 'sphere') {
    return Math.max(0, Math.hypot(...first.center.map((value, axis) => value - second.center[axis])) -
      first.radius - second.radius);
  }
  if (first.primitive === 'sphere' || second.primitive === 'sphere') {
    const sphere = first.primitive === 'sphere' ? first : second;
    const box = first.primitive === 'sphere' ? second : first;
    return Math.max(0, pointToBoxDistance(sphere.center, box) - sphere.radius);
  }
  return Math.hypot(...[0, 1, 2].map((axis) => {
    const firstMin = first.center[axis] - first.dimensions[axis] / 2;
    const firstMax = first.center[axis] + first.dimensions[axis] / 2;
    const secondMin = second.center[axis] - second.dimensions[axis] / 2;
    const secondMax = second.center[axis] + second.dimensions[axis] / 2;
    return Math.max(firstMin - secondMax, secondMin - firstMax, 0);
  }));
};

const pairKey = (names) => Array.isArray(names) ? [...names].sort().join('\u0000') : '';

const evaluatePairRelations = (expectedParts, actualPairs) => {
  const actualByNames = new Map(
    (Array.isArray(actualPairs) ? actualPairs : []).map((pair) => [pairKey(pair.names), pair]),
  );
  const comparisons = [];
  for (let firstIndex = 0; firstIndex < expectedParts.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < expectedParts.length; secondIndex += 1) {
      const first = expectedParts[firstIndex];
      const second = expectedParts[secondIndex];
      const actual = actualByNames.get(pairKey([first.name, second.name]));
      const expectedDistance = expectedPairDistance(first, second);
      const scale = Math.max(...first.dimensions, ...second.dimensions);
      const distancePass = closeNumber(actual?.distance, expectedDistance, {
        relative: CAD_RELATIVE_TOLERANCE,
        absolute: Math.max(CAD_ABSOLUTE_TOLERANCE, scale * CAD_RELATIVE_TOLERANCE),
      });
      const noIntersection = finite(actual?.intersectionVolume) &&
        actual.intersectionVolume <= CAD_ABSOLUTE_TOLERANCE;
      const noOverlap = finite(actual?.overlapRatio) &&
        actual.overlapRatio <= CAD_ABSOLUTE_TOLERANCE;
      comparisons.push({
        names: [first.name, second.name],
        expectedDistance,
        actualDistance: actual?.distance,
        intersectionVolume: actual?.intersectionVolume,
        overlapRatio: actual?.overlapRatio,
        passed: Boolean(actual && distancePass && noIntersection && noOverlap),
      });
    }
  }
  return result(
    comparisons.length > 0 && comparisons.every((comparison) => comparison.passed),
    'expected clearance; intersectionVolume=0; overlapRatio=0',
    comparisons,
  );
};

const extensionPredicate = (benchmarkCase, cadtest, probe) => {
  const expectedParts = benchmarkCase.expected.parts;
  const actualByName = actualPartsByName(probe);
  const id = String(cadtest.cadtest_id);

  if (id === 'assembly:part-count') {
    const actualCount = Array.isArray(probe?.parts) ? probe.parts.length : undefined;
    return result(actualCount === expectedParts.length, expectedParts.length, actualCount);
  }
  if (id === 'assembly:part-names') {
    const expectedNames = expectedParts.map((part) => part.name);
    const actualNames = Array.isArray(probe?.parts) ? probe.parts.map((part) => part?.name) : [];
    return result(sameNames(actualNames, expectedNames), expectedNames, actualNames);
  }
  if (id === 'assembly:preview-brep') {
    return result(probe?.preview?.brepValid === true, true, probe?.preview?.brepValid);
  }
  if (id === 'assembly:preview-solid-count') {
    return result(
      probe?.preview?.solidCount === expectedParts.length,
      expectedParts.length,
      probe?.preview?.solidCount,
    );
  }
  if (id === 'assembly:preview-iou') {
    return result(
      finite(probe?.preview?.brepIou) && probe.preview.brepIou >= CAD_BREP_IOU_THRESHOLD,
      `>= ${CAD_BREP_IOU_THRESHOLD}`,
      probe?.preview?.brepIou,
    );
  }
  if (id === 'assembly:preview-mesh') {
    return result(probe?.preview?.meshValid === true, true, probe?.preview?.meshValid);
  }
  if (id === 'assembly:pair-relations') {
    return evaluatePairRelations(expectedParts, probe?.pairs);
  }

  const expected = id.startsWith('part:')
    ? expectedParts.find((part) => id.startsWith(`part:${part.name}:`))
    : expectedParts[0];
  const suffix = expected && id.startsWith(`part:${expected.name}:`)
    ? id.slice(`part:${expected.name}:`.length)
    : id;
  const actual = expected ? actualByName.get(expected.name) : undefined;
  return primitiveCheck(suffix, expected, actual);
};

const requirementResults = (benchmarkCase, checks) => {
  const checkById = new Map(checks.map((check) => [check.cadtestId, check]));
  return benchmarkCase.requirement_groups.map((requirement) => {
    const requirementChecks = requirement.cadtest_ids.map((id) => checkById.get(id));
    return {
      requirementId: requirement.requirement_id,
      requirementType: requirement.requirement_type,
      description: requirement.requirement_description,
      cadtestIds: [...requirement.cadtest_ids],
      passed: requirementChecks.length > 0 && requirementChecks.every((check) => check?.passed === true),
    };
  });
};

const categorySummary = (checks) => {
  const counts = {};
  for (const check of checks) {
    const category = check.category ?? 'uncategorized';
    const entry = counts[category] ?? { passed: 0, total: 0, accuracy: 0 };
    entry.total += 1;
    if (check.passed) entry.passed += 1;
    entry.accuracy = entry.passed / entry.total;
    counts[category] = entry;
  }
  return counts;
};

const outputContractParts = (benchmarkCase, spec, probe) => {
  const candidates = [
    spec?.parts,
    benchmarkCase?.expected?.parts,
    probe?.reference?.parts,
  ];
  return candidates.find((parts) => Array.isArray(parts) && parts.length > 0) ?? [];
};

const invalidReasonFor = (benchmarkCase, spec, probe, globallyExecuted) => {
  if (probe?.executed !== true) {
    return probe?.error || (globallyExecuted === false
      ? 'verification did not execute'
      : 'probe did not execute');
  }
  if (probe?.error) return probe.error;
  if (!Array.isArray(probe?.parts) || probe.parts.length === 0) return 'probe produced no parts';
  const expectedParts = outputContractParts(benchmarkCase, spec, probe);
  if (expectedParts.length > 0 && probe.parts.length !== expectedParts.length) {
    return `output part count ${probe.parts.length} does not match expected count ${expectedParts.length}`;
  }
  if (expectedParts.length > 0) {
    const actualNames = probe.parts.map((part) => part?.name);
    const expectedNames = expectedParts.map((part) => part?.name);
    if (!sameNames(actualNames, expectedNames)) {
      return `output part names ${JSON.stringify(actualNames)} do not match expected names ${JSON.stringify(expectedNames)}`;
    }
  }
  const invalidPart = probe.parts.find((part) => part?.brepValid !== true);
  if (invalidPart) return `${invalidPart.name ?? 'unnamed part'} is not a validated B-rep`;
  if (!probe.preview || typeof probe.preview !== 'object') return 'probe produced no preview';
  if (probe.preview.brepValid !== true) return 'preview is not a validated B-rep';
  if (expectedParts.length > 0 && probe.preview.solidCount !== expectedParts.length) {
    return `preview solid count ${String(probe.preview.solidCount)} does not match expected count ${expectedParts.length}`;
  }
  if (probe.preview.meshValid !== true) return 'preview does not produce a valid mesh';
  if (!finite(probe.preview.partAgreementIou) ||
      probe.preview.partAgreementIou < CAD_BREP_IOU_THRESHOLD) {
    return `preview does not agree with output parts at B-rep IoU >= ${CAD_BREP_IOU_THRESHOLD}`;
  }
  return undefined;
};

const diagnosticExpectedParts = (benchmarkCase) => {
  if (Array.isArray(benchmarkCase.expected?.parts)) return benchmarkCase.expected.parts;
  return [{
    name: benchmarkCase.sample?.sample_id ?? 'shape',
    dimensions: benchmarkCase.expected.sortedDimensions,
    volume: benchmarkCase.expected.volume,
  }];
};

const maxCoordinateError = (actual, expected) => {
  if (!vector3(actual) || !vector3(expected)) return undefined;
  return Math.max(...actual.map((value, axis) => Math.abs(value - expected[axis])));
};

const diagnosticsFor = (benchmarkCase, probe) => {
  const expectedParts = diagnosticExpectedParts(benchmarkCase);
  const actualByName = actualPartsByName(probe);
  const diagnostics = {
    expectedPartCount: expectedParts.length,
    brepValid: [],
    brepIou: [],
    volumeRelativeError: [],
    areaRelativeError: [],
    bboxMaxError: [],
    overlapRatio: [],
  };

  expectedParts.forEach((expected, index) => {
    const actual = benchmarkCase.official
      ? probe?.parts?.[index]
      : actualByName.get(expected.name);
    diagnostics.brepValid.push(actual?.brepValid === true ? 1 : 0);
    diagnostics.brepIou.push(finite(actual?.brepIou) ? actual.brepIou : 0);

    const expectedVolume = finite(expected.volume) ? expected.volume : analyticVolume(expected);
    diagnostics.volumeRelativeError.push(
      finite(actual?.volume) && finite(expectedVolume) && expectedVolume !== 0
        ? Math.abs(actual.volume - expectedVolume) / Math.abs(expectedVolume)
        : 1,
    );

    if (!benchmarkCase.official) {
      const expectedArea = analyticArea(expected);
      diagnostics.areaRelativeError.push(
        finite(actual?.area) && finite(expectedArea) && expectedArea !== 0
          ? Math.abs(actual.area - expectedArea) / Math.abs(expectedArea)
          : 1,
      );
      const wantedBounds = expectedBounds(expected);
      const minError = maxCoordinateError(actual?.bounds?.min, wantedBounds.min);
      const maxError = maxCoordinateError(actual?.bounds?.max, wantedBounds.max);
      diagnostics.bboxMaxError.push(
        finite(minError) && finite(maxError)
          ? Math.max(minError, maxError)
          : Math.max(...expected.dimensions),
      );
    } else {
      const actualDimensions = sortedDimensions(actual);
      const wantedDimensions = [...expected.dimensions].toSorted((a, b) => a - b);
      diagnostics.bboxMaxError.push(
        vector3(actualDimensions)
          ? Math.max(...wantedDimensions.map((value, axis) => Math.abs(actualDimensions[axis] - value)))
          : Math.max(...wantedDimensions),
      );
    }
  });

  const expectedPairCount = expectedParts.length * (expectedParts.length - 1) / 2;
  if (expectedPairCount > 0) {
    const actualPairs = Array.isArray(probe?.pairs) ? probe.pairs : [];
    for (let index = 0; index < expectedPairCount; index += 1) {
      const overlap = actualPairs[index]?.overlapRatio;
      diagnostics.overlapRatio.push(finite(overlap) ? overlap : 1);
    }
  }
  return diagnostics;
};

const evaluateProbe = (
  benchmarkCase,
  probe,
  { globallyExecuted, slices = {}, spec } = {},
) => {
  const invalidReason = invalidReasonFor(benchmarkCase, spec, probe, globallyExecuted);
  const invalid = invalidReason !== undefined;
  const primaryPart = Array.isArray(probe?.parts) ? probe.parts[0] : undefined;
  const checks = benchmarkCase.cadtests.map((cadtest) => {
    let predicateResult;
    let error;
    try {
      predicateResult = benchmarkCase.predicateSet === 'cadtestbench-detailed-00003247'
        ? officialPredicate(cadtest.cadtest_id, primaryPart)
        : extensionPredicate(benchmarkCase, cadtest, probe);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      predicateResult = result(false, undefined, undefined);
    }
    return {
      cadtestId: cadtest.cadtest_id,
      description: cadtest.cadtest_description,
      category: cadtest.cadtest_type,
      requirementId: cadtest.requirement_id,
      passed: !invalid && predicateResult.passed,
      expected: predicateResult.expected,
      actual: predicateResult.actual,
      ...(error ? { error } : {}),
    };
  });
  const requirements = requirementResults(benchmarkCase, checks);
  const passedRequirements = requirements.filter((requirement) => requirement.passed).length;
  const passedChecks = checks.filter((check) => check.passed).length;
  const hard = !invalid && checks.length > 0 && passedChecks === checks.length ? 1 : 0;
  const soft = requirements.length === 0 ? 0 : passedRequirements / requirements.length;
  const categories = categorySummary(checks);
  const metrics = {
    passRate: hard,
    requirementScore: soft,
    invalidRatio: invalid ? 1 : 0,
    validShapeRate: invalid ? 0 : 1,
    cadtestAccuracy: checks.length === 0 ? 0 : passedChecks / checks.length,
    categoryAccuracy: Object.fromEntries(
      Object.entries(categories).map(([category, counts]) => [category, counts.accuracy]),
    ),
  };
  const failed = checks.filter((check) => !check.passed).map((check) => check.cadtestId);
  return {
    specId: probe?.specId ?? benchmarkCase.id,
    benchmarkCaseId: benchmarkCase.id,
    source: benchmarkCase.source,
    official: benchmarkCase.official,
    invalid,
    hard,
    soft,
    checks,
    requirements,
    diagnostics: diagnosticsFor(benchmarkCase, probe),
    metrics,
    slices: { ...benchmarkCase.slices, ...slices },
    failReason: hard === 1
      ? undefined
      : invalidReason ?? `Failed CADTests: ${failed.join(', ')}`,
  };
};

const sourceRefersTo00003247 = (source) => {
  if (typeof source === 'string') return source.includes('00003247');
  if (!source || typeof source !== 'object') return false;
  return [source.sampleId, source.sample_id, source.id].includes('00003247');
};

export function benchmarkCaseForSpec(spec) {
  if (spec?.benchmarkCase?.cadtests) return spec.benchmarkCase;
  if (spec?.cadtests && spec?.requirement_groups) return spec;
  const explicitCase = spec?.benchmarkCaseId ?? spec?.caseId;
  if (explicitCase === CADTESTBENCH_00003247_CASE.id || sourceRefersTo00003247(spec?.source)) {
    return CADTESTBENCH_00003247_CASE;
  }
  if (spec?.kind === 'assembly' || (Array.isArray(spec?.parts) && spec.parts.length > 1)) {
    return createNamedAssemblyExtensionCase(spec);
  }
  if (spec?.kind === 'model' || (Array.isArray(spec?.parts) && spec.parts.length === 1)) {
    return createPrimitiveExtensionCase(spec);
  }
  throw new TypeError(`Cannot resolve a CAD benchmark case for spec ${String(spec?.id ?? '<unknown>')}`);
}

const evaluationSpecsFor = (task) => {
  if (task?.cadtests && task?.requirement_groups) return [{ benchmarkCase: task, id: task.id }];
  const specs = task?.payload?.evaluationSpecs ?? task?.evaluationSpecs;
  if (Array.isArray(specs) && specs.length > 0) return specs;
  const fallback = task?.payload?.publicSpec ?? task?.payload ?? task;
  return [{ ...fallback, id: fallback?.id ?? task?.id ?? 'probe-1' }];
};

const taskSlices = (task, spec) => ({
  ...(task?.split ? { split: task.split } : {}),
  ...(task?.payload?.split ? { split: task.payload.split } : {}),
  ...(spec?.slices ?? {}),
});

const failedProbe = (specId, error, slices) => ({
  specId,
  benchmarkCaseId: undefined,
  source: undefined,
  official: false,
  invalid: true,
  hard: 0,
  soft: 0,
  checks: [{
    cadtestId: 'evaluator:case-resolution',
    description: 'Resolve benchmark case and observation',
    category: 'uncategorized',
    requirementId: 'evaluator:valid-input',
    passed: false,
    expected: 'resolvable benchmark case and matching probe',
    actual: error,
    error,
  }],
  requirements: [{
    requirementId: 'evaluator:valid-input',
    requirementType: 'evaluation_contract',
    description: 'The benchmark task and verifier observation are evaluable.',
    cadtestIds: ['evaluator:case-resolution'],
    passed: false,
  }],
  diagnostics: {
    expectedPartCount: 1,
    brepValid: [0],
    brepIou: [0],
    volumeRelativeError: [1],
    areaRelativeError: [1],
    bboxMaxError: [1],
    overlapRatio: [],
  },
  metrics: {
    passRate: 0,
    requirementScore: 0,
    invalidRatio: 1,
    validShapeRate: 0,
    cadtestAccuracy: 0,
    categoryAccuracy: { uncategorized: 0 },
  },
  slices,
  failReason: error,
});

const mean = (values, fallback = 0) => values.length === 0
  ? fallback
  : values.reduce((sum, value) => sum + value, 0) / values.length;

const summaryWithoutSlices = (probes) => {
  const count = probes.length;
  const checks = probes.flatMap((probe) => probe.checks ?? []);
  const requirements = probes.flatMap((probe) => probe.requirements ?? []);
  const invalidCount = probes.filter((probe) => probe.invalid).length;
  const passCount = probes.filter((probe) => probe.hard === 1).length;
  const passedChecks = checks.filter((check) => check.passed).length;
  const passedRequirements = requirements.filter((requirement) => requirement.passed).length;
  const categories = categorySummary(checks);
  const diagnosticValues = (name) => probes.flatMap((probe) =>
    Array.isArray(probe.diagnostics?.[name])
      ? probe.diagnostics[name].filter(finite)
      : [],
  );
  const brepValid = diagnosticValues('brepValid');
  const brepIou = diagnosticValues('brepIou');
  const volumeRelativeError = diagnosticValues('volumeRelativeError');
  const areaRelativeError = diagnosticValues('areaRelativeError');
  const bboxMaxError = diagnosticValues('bboxMaxError');
  const overlapRatio = diagnosticValues('overlapRatio');
  return {
    count,
    passCount,
    invalidCount,
    validCount: count - invalidCount,
    passRate: count === 0 ? 0 : passCount / count,
    requirementScore: count === 0
      ? 0
      : probes.reduce((sum, probe) => sum + (probe.soft ?? 0), 0) / count,
    invalidRatio: count === 0 ? 0 : invalidCount / count,
    validShapeRate: count === 0 ? 0 : (count - invalidCount) / count,
    cadtestAccuracy: checks.length === 0 ? 0 : passedChecks / checks.length,
    requirementGroupsPassed: passedRequirements,
    requirementGroupsTotal: requirements.length,
    cadtestsPassed: passedChecks,
    cadtestsTotal: checks.length,
    brepValidPercentage: mean(brepValid) * 100,
    meanBrepIou: mean(brepIou),
    meanVolumeRelativeError: mean(volumeRelativeError, 1),
    meanAreaRelativeError: mean(areaRelativeError, 1),
    meanBboxMaxError: mean(bboxMaxError, 1),
    meanOverlapRatio: mean(overlapRatio),
    categoryAccuracy: Object.fromEntries(
      Object.entries(categories).map(([category, value]) => [category, value.accuracy]),
    ),
    categoryCounts: categories,
  };
};

const aggregateProbes = (probes) => {
  const summary = summaryWithoutSlices(probes);
  const sliceNames = new Set(probes.flatMap((probe) => Object.keys(probe.slices ?? {})));
  const slices = {};
  for (const sliceName of sliceNames) {
    const byValue = new Map();
    for (const probe of probes) {
      const value = probe.slices?.[sliceName];
      if (value === undefined || value === null) continue;
      const key = String(value);
      const group = byValue.get(key) ?? [];
      group.push(probe);
      byValue.set(key, group);
    }
    slices[sliceName] = Object.fromEntries(
      [...byValue.entries()].map(([value, group]) => [value, summaryWithoutSlices(group)]),
    );
  }
  return { ...summary, slices };
};

/**
 * Evaluate all hidden probe observations for one Autoimprove CAD task.
 *
 * task.payload.evaluationSpecs contains CAD specs and verification.probes
 * contains measurements produced by the Replicad/OpenCascade.js verifier.
 */
export function evaluateCadTask(task, verification) {
  const specs = evaluationSpecsFor(task);
  const observedProbes = Array.isArray(verification?.probes)
    ? verification.probes
    : [verification ?? {}];
  const observedById = new Map(observedProbes.map((probe) => [probe?.specId, probe]));
  const probes = specs.map((spec, index) => {
    const specId = spec?.id ?? spec?.specId ?? `probe-${index + 1}`;
    const observed = observedById.get(specId) ?? observedProbes[index] ?? {
      specId,
      executed: false,
      error: 'missing verifier observation',
      parts: [],
    };
    const probe = { ...observed, specId };
    const slices = taskSlices(task, spec);
    try {
      const benchmarkCase = benchmarkCaseForSpec(spec);
      return evaluateProbe(benchmarkCase, probe, {
        globallyExecuted: verification?.executed,
        slices,
        spec,
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      return failedProbe(specId, error, slices);
    }
  });

  const hard = probes.length > 0 && probes.every((probe) => probe.hard === 1) ? 1 : 0;
  const metrics = aggregateProbes(probes);
  Object.assign(metrics, {
    pr: metrics.passRate * 100,
    rs: metrics.requirementScore * 100,
    invalidSamplePercentage: metrics.invalidRatio * 100,
    parametricTaskPassRate: hard === 1 ? 100 : 0,
  });
  const checks = probes.flatMap((probe) => probe.checks.map((check) => ({
    ...check,
    specId: probe.specId,
  })));
  const soft = metrics.requirementScore;
  const failed = probes.filter((probe) => probe.hard !== 1);
  return {
    hard,
    soft,
    probes,
    checks,
    metrics,
    failReason: hard === 1
      ? undefined
      : failed.map((probe) => `verification probe ${probe.specId}: ${probe.failReason}`).join('; '),
  };
}

/** Aggregate task-level outputs returned by evaluateCadTask. */
export function aggregateCadEvaluations(evaluations) {
  const taskEvaluations = Array.isArray(evaluations) ? evaluations : [];
  const probes = taskEvaluations.flatMap((evaluation, evaluationIndex) => {
    const evaluationProbes = Array.isArray(evaluation?.probes) ? evaluation.probes : [];
    const taskKind = evaluation?.slice;
    if (evaluationProbes.length === 0) {
      return [failedProbe(
        evaluation?.taskId ?? `evaluation-${evaluationIndex + 1}`,
        evaluation?.failReason ?? 'evaluation contains no probe results',
        taskKind ? { taskKind } : {},
      )];
    }
    return evaluationProbes.map((probe) => ({
      ...probe,
      slices: {
        ...probe.slices,
        ...(taskKind ? { taskKind } : {}),
      },
    }));
  });
  const aggregate = aggregateProbes(probes);
  const metricAliases = (summary) => ({
    ...summary,
    pr: summary.passRate * 100,
    rs: summary.requirementScore * 100,
    invalidSamplePercentage: summary.invalidRatio * 100,
  });
  const taskSlices = {};
  for (const slice of new Set(taskEvaluations.map((evaluation) => evaluation?.slice).filter(Boolean))) {
    const sliceProbes = probes.filter((probe) => probe.slices?.taskKind === slice);
    const sliceTasks = taskEvaluations.filter((evaluation) => evaluation?.slice === slice);
    taskSlices[slice] = {
      ...metricAliases(summaryWithoutSlices(sliceProbes)),
      parametricTaskPassRate: sliceTasks.length === 0
        ? 0
        : sliceTasks.filter((evaluation) => evaluation?.hard === 1).length / sliceTasks.length * 100,
    };
  }
  return {
    ...metricAliases(aggregate),
    parametricTaskPassRate: taskEvaluations.length === 0
      ? 0
      : taskEvaluations.filter((evaluation) => evaluation?.hard === 1).length /
        taskEvaluations.length * 100,
    slices: taskSlices,
    sliceBreakdown: aggregate.slices,
  };
}

export { CADTESTBENCH_PROVENANCE };
