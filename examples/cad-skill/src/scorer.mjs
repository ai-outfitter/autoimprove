export const GEOMETRY_TOLERANCE = 1e-6;
// TSCAD's default tessellated sphere is about 1.6% below analytic volume.
export const VOLUME_RELATIVE_TOLERANCE = 0.02;

const CHECK_WEIGHTS = Object.freeze({
  execution: 1.5,
  artifact: 1,
  'part-count': 1,
  'part-names': 1,
  'part-types': 1,
  'part-centers': 1,
  'part-bounds': 2,
  'combined-bounds': 1.5,
  'part-volumes': 1,
});

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const isVector3 = (value) =>
  Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);

const closeNumber = (actual, expected, tolerance = GEOMETRY_TOLERANCE) =>
  isFiniteNumber(actual) && Math.abs(actual - expected) <= tolerance;

const closeVector = (actual, expected, tolerance = GEOMETRY_TOLERANCE) =>
  isVector3(actual) && expected.every((value, index) => closeNumber(actual[index], value, tolerance));

const closeBounds = (actual, expected) =>
  actual !== null &&
  typeof actual === 'object' &&
  closeVector(actual.min, expected.min) &&
  closeVector(actual.max, expected.max);

const hasNonemptyArtifact = (artifact) => {
  if (typeof artifact === 'string') return artifact.trim().length > 0;
  if (artifact instanceof ArrayBuffer) return artifact.byteLength > 0;
  if (ArrayBuffer.isView(artifact)) return artifact.byteLength > 0;
  if (Array.isArray(artifact)) return artifact.length > 0;
  if (artifact === null || typeof artifact !== 'object') return false;

  if (isFiniteNumber(artifact.size)) return artifact.size > 0;
  if (isFiniteNumber(artifact.byteLength)) return artifact.byteLength > 0;
  if (typeof artifact.content === 'string') return artifact.content.trim().length > 0;
  if (typeof artifact.path === 'string') return artifact.path.trim().length > 0;
  return false;
};

const payloadFrom = (taskOrPayload) => taskOrPayload?.payload ?? taskOrPayload;

export const analyticBounds = (part) => {
  const halfExtent = part.primitive === 'cube' ? part.size / 2 : part.radius;
  return {
    min: part.center.map((coordinate) => coordinate - halfExtent),
    max: part.center.map((coordinate) => coordinate + halfExtent),
  };
};

export const analyticVolume = (part) => {
  if (part.primitive === 'cube') return part.size ** 3;
  if (part.primitive === 'sphere') return (4 / 3) * Math.PI * part.radius ** 3;
  throw new Error(`Unsupported primitive: ${String(part.primitive)}`);
};

export const combinedAnalyticBounds = (parts) => {
  const partBounds = parts.map(analyticBounds);
  return {
    min: [0, 1, 2].map((axis) => Math.min(...partBounds.map((bounds) => bounds.min[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...partBounds.map((bounds) => bounds.max[axis]))),
  };
};

const sameStrings = (actual, expected) =>
  actual.length === expected.length &&
  [...actual].sort().every((value, index) => value === [...expected].sort()[index]);

const addCheck = (checks, id, passed, expected, actual) => {
  checks.push({
    id,
    passed: Boolean(passed),
    weight: CHECK_WEIGHTS[id],
    expected,
    actual,
  });
};

/**
 * Score one normalized CAD adapter result against a task (or its payload).
 * Adapter part ordering is ignored; names are the stable identity.
 */
export function scoreCadResult(taskOrPayload, result) {
  const payload = payloadFrom(taskOrPayload);
  if (!payload || !Array.isArray(payload.parts) || payload.parts.length === 0) {
    throw new TypeError('A CAD task payload with at least one expected part is required.');
  }

  const normalized = result ?? {};
  const actualParts = Array.isArray(normalized.parts) ? normalized.parts : [];
  const expectedParts = payload.parts;
  const actualByName = new Map(actualParts.map((part) => [part?.name, part]));
  const expectedNames = expectedParts.map((part) => part.name);
  const actualNames = actualParts.map((part) => part?.name);
  const checks = [];

  addCheck(checks, 'execution', normalized.executed === true, true, normalized.executed);
  addCheck(checks, 'artifact', hasNonemptyArtifact(normalized.artifact), 'nonempty', normalized.artifact);
  addCheck(checks, 'part-count', actualParts.length === expectedParts.length, expectedParts.length, actualParts.length);
  addCheck(checks, 'part-names', sameStrings(actualNames, expectedNames), expectedNames, actualNames);

  const expectedTypes = Object.fromEntries(expectedParts.map((part) => [part.name, part.primitive]));
  const actualTypes = Object.fromEntries(actualParts.map((part) => [part?.name, part?.primitive]));
  const typesPass = expectedParts.every(
    (expected) => actualByName.get(expected.name)?.primitive === expected.primitive,
  );
  addCheck(checks, 'part-types', typesPass, expectedTypes, actualTypes);

  const expectedCenters = Object.fromEntries(expectedParts.map((part) => [part.name, part.center]));
  const actualCenters = Object.fromEntries(actualParts.map((part) => [part?.name, part?.center]));
  const centersPass = expectedParts.every((expected) =>
    closeVector(actualByName.get(expected.name)?.center, expected.center),
  );
  addCheck(checks, 'part-centers', centersPass, expectedCenters, actualCenters);

  const expectedBounds = Object.fromEntries(
    expectedParts.map((part) => [part.name, analyticBounds(part)]),
  );
  const actualBounds = Object.fromEntries(actualParts.map((part) => [part?.name, part?.bounds]));
  const boundsPass = expectedParts.every((expected) =>
    closeBounds(actualByName.get(expected.name)?.bounds, expectedBounds[expected.name]),
  );
  addCheck(checks, 'part-bounds', boundsPass, expectedBounds, actualBounds);

  const expectedCombinedBounds = combinedAnalyticBounds(expectedParts);
  addCheck(
    checks,
    'combined-bounds',
    closeBounds(normalized.combinedBounds, expectedCombinedBounds),
    expectedCombinedBounds,
    normalized.combinedBounds,
  );

  const partsWithVolume = expectedParts.filter((expected) => {
    const actual = actualByName.get(expected.name);
    return actual !== undefined && actual.volume !== undefined;
  });
  if (partsWithVolume.length > 0) {
    const expectedVolumes = Object.fromEntries(
      partsWithVolume.map((part) => [part.name, analyticVolume(part)]),
    );
    const actualVolumes = Object.fromEntries(
      partsWithVolume.map((part) => [part.name, actualByName.get(part.name)?.volume]),
    );
    const volumesPass = partsWithVolume.every((part) => {
      const expected = expectedVolumes[part.name];
      const actual = actualVolumes[part.name];
      const tolerance = Math.max(GEOMETRY_TOLERANCE, Math.abs(expected) * VOLUME_RELATIVE_TOLERANCE);
      return closeNumber(actual, expected, tolerance);
    });
    addCheck(checks, 'part-volumes', volumesPass, expectedVolumes, actualVolumes);
  }

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const passedWeight = checks.reduce(
    (sum, check) => sum + (check.passed ? check.weight : 0),
    0,
  );
  const failed = checks.filter((check) => !check.passed);
  const hard = failed.length === 0 ? 1 : 0;
  const soft = Number((passedWeight / totalWeight).toFixed(6));

  return {
    hard,
    soft,
    checks,
    failReason: hard === 1 ? undefined : `Failed checks: ${failed.map((check) => check.id).join(', ')}`,
  };
}

export const scoreResult = scoreCadResult;
