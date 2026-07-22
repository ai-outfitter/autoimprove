#!/usr/bin/env node

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RESULT_PREFIX = 'AUTOIMPROVE_CAD_RESULT=';
const MESH_OPTIONS = Object.freeze({ tolerance: 0.05, angularTolerance: 0.1 });
const VOLUME_EPSILON = 1e-9;
const TOPOLOGY_KINDS = Object.freeze([
  'vertex',
  'edge',
  'wire',
  'face',
  'shell',
  'solid',
  'solidCompound',
  'compound',
]);

const errorMessage = (error) => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
};

const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const finiteVector = (value) =>
  Array.isArray(value) && value.length === 3 && value.every(finiteNumber);

const jsonVector = (value) => finiteVector(value) ? [...value] : null;

const safeDelete = (value) => {
  try {
    value?.delete?.();
  } catch {
    // Cleanup must never hide the measurement that was already produced.
  }
};

const shapePart = (part) => part && typeof part === 'object' ? part.shape : null;

const expectedParts = (spec) => spec?.parts;

const dimensionsFor = (part) => {
  if (part.primitive === 'cube' && finiteNumber(part.size)) {
    return [part.size, part.size, part.size];
  }
  if (part.primitive === 'box' && finiteVector(part.dimensions)) {
    return [...part.dimensions];
  }
  return null;
};

const analyticPart = (part) => {
  const center = [...part.center];
  if (part.primitive === 'cube' || part.primitive === 'box') {
    const dimensions = dimensionsFor(part);
    const half = dimensions.map((value) => value / 2);
    return {
      name: part.name,
      primitive: part.primitive,
      center,
      dimensions,
      bounds: {
        min: center.map((value, axis) => value - half[axis]),
        max: center.map((value, axis) => value + half[axis]),
      },
      volume: dimensions.reduce((product, value) => product * value, 1),
      area: 2 * (
        dimensions[0] * dimensions[1] +
        dimensions[0] * dimensions[2] +
        dimensions[1] * dimensions[2]
      ),
      centerOfMass: center,
    };
  }

  const { radius } = part;
  return {
    name: part.name,
    primitive: part.primitive,
    center,
    radius,
    bounds: {
      min: center.map((value) => value - radius),
      max: center.map((value) => value + radius),
    },
    volume: (4 / 3) * Math.PI * radius ** 3,
    area: 4 * Math.PI * radius ** 2,
    centerOfMass: center,
  };
};

const validateCadtests = (cadtests) => {
  if (!cadtests || typeof cadtests !== 'object' || Array.isArray(cadtests)) {
    throw new TypeError('cadtests.json must contain an object');
  }
  if (typeof cadtests.taskId !== 'string' || cadtests.taskId.length === 0) {
    throw new TypeError('cadtests.taskId must be a nonempty string');
  }
  if (!Array.isArray(cadtests.evaluationSpecs) || cadtests.evaluationSpecs.length === 0) {
    throw new TypeError('cadtests.evaluationSpecs must be a nonempty array');
  }

  cadtests.evaluationSpecs.forEach((spec, specIndex) => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new TypeError(`evaluationSpecs[${specIndex}] must be an object`);
    }
    if (!Array.isArray(expectedParts(spec)) || expectedParts(spec).length === 0) {
      throw new TypeError(`evaluationSpecs[${specIndex}].parts must be nonempty`);
    }
    const seenNames = new Set();
    expectedParts(spec).forEach((part, partIndex) => {
      const label = `evaluationSpecs[${specIndex}].parts[${partIndex}]`;
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        throw new TypeError(`${label} must be an object`);
      }
      if (typeof part.name !== 'string' || part.name.length === 0) {
        throw new TypeError(`${label}.name must be a nonempty string`);
      }
      if (seenNames.has(part.name)) throw new TypeError(`${label}.name must be unique`);
      seenNames.add(part.name);
      if (!finiteVector(part.center)) throw new TypeError(`${label}.center must be a finite vec3`);
      if (part.primitive === 'cube') {
        const dimensions = dimensionsFor(part);
        if (!dimensions || dimensions.some((value) => value <= 0)) {
          throw new TypeError(`${label}.size must be a positive number`);
        }
      } else if (part.primitive === 'box') {
        const dimensions = dimensionsFor(part);
        if (!dimensions || dimensions.some((value) => value <= 0)) {
          throw new TypeError(`${label}.dimensions must be a positive vec3`);
        }
      } else if (part.primitive === 'sphere') {
        if (!finiteNumber(part.radius) || part.radius <= 0) {
          throw new TypeError(`${label}.radius must be positive`);
        }
      } else {
        throw new TypeError(`${label}.primitive must be cube, box, or sphere`);
      }
    });
  });
};

const specIdFor = (taskId, spec, index, seen) => {
  const requested = spec.specId ?? spec.id ?? spec.caseId ?? `${taskId}:probe-${index + 1}`;
  const base = String(requested);
  let unique = base;
  let suffix = 2;
  while (seen.has(unique)) unique = `${base}#${suffix++}`;
  seen.add(unique);
  return unique;
};

const loadReplicad = async () => {
  const require = createRequire(import.meta.url);
  const ocModulePath = require.resolve('replicad-opencascadejs/src/replicad_single.js');
  const wasmPath = require.resolve('replicad-opencascadejs/src/replicad_single.wasm');

  // The published Emscripten bundle is ESM, but its Node path reads these
  // CommonJS globals while locating the wasm binary.
  globalThis.require = require;
  globalThis.__dirname = dirname(ocModulePath);

  const [{ default: opencascade }, replicad] = await Promise.all([
    import('replicad-opencascadejs/src/replicad_single.js'),
    import('replicad'),
  ]);
  const oc = await opencascade({ locateFile: () => wasmPath });
  replicad.setOC(oc);
  return { oc, replicad };
};

const typeName = (oc, shape) => {
  const value = shape.wrapped.ShapeType();
  const entry = Object.entries(oc.TopAbs_ShapeEnum).find(([, candidate]) => candidate === value);
  return entry ? entry[0].replace('TopAbs_', '') : 'UNKNOWN';
};

const brepIsValid = (oc, shape) => {
  if (shape.isNull || shape.wrapped.IsNull()) return false;
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);
  try {
    return Boolean(analyzer.IsValid_2());
  } finally {
    analyzer.delete();
  }
};

const topologyCounts = (replicad, shape) => Object.fromEntries(
  TOPOLOGY_KINDS.map((kind) => [kind, Array.from(replicad.iterTopo(shape.wrapped, kind)).length]),
);

const boundsFor = (oc, shape) => {
  const box = new oc.Bnd_Box_1();
  let min;
  let max;
  try {
    // Do not let an earlier tessellation inflate the evaluation bounds.
    oc.BRepBndLib.AddOptimal(shape.wrapped, box, false, false);
    if (box.IsVoid() || box.IsWhole() || box.IsOpen()) return null;
    min = box.CornerMin();
    max = box.CornerMax();
    const minTuple = [min.X(), min.Y(), min.Z()];
    const maxTuple = [max.X(), max.Y(), max.Z()];
    if (!finiteVector(minTuple) || !finiteVector(maxTuple)) return null;
    return { min: minTuple, max: maxTuple };
  } finally {
    safeDelete(min);
    safeDelete(max);
    safeDelete(box);
  }
};

const volumeProperties = (replicad, shape) => {
  const properties = replicad.measureShapeVolumeProperties(shape);
  try {
    return {
      volume: finiteNumber(properties.volume) ? properties.volume : null,
      centerOfMass: jsonVector(properties.centerOfMass),
    };
  } finally {
    properties.delete();
  }
};

const surfaceProperties = (replicad, shape) => {
  const properties = replicad.measureShapeSurfaceProperties(shape);
  try {
    return {
      area: finiteNumber(properties.area) ? properties.area : null,
      surfaceCenterOfMass: jsonVector(properties.centerOfMass),
    };
  } finally {
    properties.delete();
  }
};

const increment = (histogram, key) => {
  histogram[key] = (histogram[key] ?? 0) + 1;
};

const faceGeometry = (replicad, shape) => {
  const histogram = {};
  const geometry = [];
  const faces = shape.faces;
  try {
    faces.forEach((face, index) => {
      let properties;
      let box;
      let normal;
      try {
        const surfaceType = face.geomType;
        increment(histogram, surfaceType);
        properties = replicad.measureShapeSurfaceProperties(face);
        box = face.boundingBox;
        const [min, max] = box.bounds;
        try {
          normal = face.normalAt();
          if (finiteNumber(normal.Length) && normal.Length > 0) normal.normalize();
        } catch {
          normal = null;
        }
        geometry.push({
          index,
          surfaceType,
          orientation: face.orientation,
          area: finiteNumber(properties.area) ? properties.area : null,
          centerOfMass: jsonVector(properties.centerOfMass),
          bounds: finiteVector(min) && finiteVector(max) ? { min: [...min], max: [...max] } : null,
          normal: normal ? jsonVector(normal.toTuple()) : null,
        });
      } finally {
        safeDelete(normal);
        safeDelete(box);
        safeDelete(properties);
      }
    });
  } finally {
    faces.forEach(safeDelete);
  }
  return { faceTypes: histogram, faceGeometry: geometry };
};

const edgeGeometry = (shape) => {
  const histogram = {};
  const geometry = [];
  const edges = shape.edges;
  try {
    edges.forEach((edge, index) => {
      let curveType = 'UNKNOWN';
      let length = null;
      try {
        curveType = edge.geomType;
        length = finiteNumber(edge.length) ? edge.length : null;
      } catch {
        // A malformed edge remains visible as UNKNOWN instead of aborting all
        // other topology observations for the shape.
      }
      increment(histogram, curveType);
      geometry.push({ index, curveType, length });
    });
  } finally {
    edges.forEach(safeDelete);
  }
  return { edgeTypes: histogram, edgeGeometry: geometry };
};

const meshShape = (shape) => {
  const raw = shape.mesh(MESH_OPTIONS);
  const vertices = Array.from(raw.vertices ?? []);
  const triangles = Array.from(raw.triangles ?? []);
  const normals = Array.from(raw.normals ?? []);
  const faceGroups = Array.isArray(raw.faceGroups) ? raw.faceGroups : [];
  const numericFinite = [...vertices, ...triangles, ...normals].every(finiteNumber);
  const vertexCount = vertices.length / 3;
  const triangleCount = triangles.length / 3;
  const arraysAligned =
    Number.isInteger(vertexCount) &&
    Number.isInteger(triangleCount) &&
    normals.length === vertices.length;
  const indicesValid = triangles.every((value) =>
    Number.isInteger(value) && value >= 0 && value < vertexCount,
  );
  const groupsValid = faceGroups.every((group) =>
    Number.isInteger(group?.start) && group.start >= 0 &&
    Number.isInteger(group?.count) && group.count >= 0 &&
    Number.isInteger(group?.faceId),
  );
  const meshValid =
    numericFinite &&
    arraysAligned &&
    indicesValid &&
    groupsValid &&
    vertexCount > 0 &&
    triangleCount > 0;

  return {
    mesh: { vertices, triangles, normals, faceGroups },
    summary: {
      meshValid,
      finite: numericFinite,
      indicesValid,
      groupsValid,
      vertexCount,
      triangleCount,
      normalCount: normals.length / 3,
      faceGroupCount: faceGroups.length,
      tolerance: MESH_OPTIONS.tolerance,
      angularTolerance: MESH_OPTIONS.angularTolerance,
    },
  };
};

const emptyObservation = (part, index, error) => ({
  index,
  name: typeof part?.name === 'string' ? part.name : null,
  ...(typeof part?.primitive === 'string' ? { primitive: part.primitive } : {}),
  ...(finiteVector(part?.center) ? { center: [...part.center] } : {}),
  brepValid: false,
  solidCount: 0,
  bounds: null,
  volume: null,
  area: null,
  centerOfMass: null,
  faceTypes: {},
  edgeTypes: {},
  faceCount: 0,
  edgeCount: 0,
  vertexCount: 0,
  brepIou: null,
  meshValid: false,
  error: errorMessage(error),
});

const measureShape = (oc, replicad, shape) => {
  if (!shape || typeof shape !== 'object' || !shape.wrapped) {
    throw new TypeError('expected a native RepliCAD shape');
  }
  if (shape.isNull || shape.wrapped.IsNull()) {
    return {
      metrics: {
        brepValid: false,
        shapeType: 'NULL',
        topology: Object.fromEntries(TOPOLOGY_KINDS.map((kind) => [kind, 0])),
        solidCount: 0,
        bounds: null,
        volume: null,
        area: null,
        centerOfMass: null,
        surfaceCenterOfMass: null,
        faceTypes: {},
        edgeTypes: {},
        faceCount: 0,
        edgeCount: 0,
        vertexCount: 0,
        faceGeometry: [],
        edgeGeometry: [],
        meshValid: false,
        mesh: {
          meshValid: false,
          finite: false,
          indicesValid: false,
          groupsValid: false,
          vertexCount: 0,
          triangleCount: 0,
          normalCount: 0,
          faceGroupCount: 0,
          tolerance: MESH_OPTIONS.tolerance,
          angularTolerance: MESH_OPTIONS.angularTolerance,
        },
      },
      mesh: null,
    };
  }

  const topology = topologyCounts(replicad, shape);
  const volume = volumeProperties(replicad, shape);
  const surface = surfaceProperties(replicad, shape);
  const faces = faceGeometry(replicad, shape);
  const edges = edgeGeometry(shape);
  const meshed = meshShape(shape);
  return {
    metrics: {
      brepValid: brepIsValid(oc, shape),
      shapeType: typeName(oc, shape),
      topology,
      solidCount: topology.solid,
      bounds: boundsFor(oc, shape),
      volume: volume.volume,
      area: surface.area,
      centerOfMass: volume.centerOfMass,
      surfaceCenterOfMass: surface.surfaceCenterOfMass,
      faceTypes: faces.faceTypes,
      edgeTypes: edges.edgeTypes,
      faceCount: topology.face,
      edgeCount: topology.edge,
      vertexCount: topology.vertex,
      faceGeometry: faces.faceGeometry,
      edgeGeometry: edges.edgeGeometry,
      meshValid: meshed.summary.meshValid,
      mesh: meshed.summary,
    },
    mesh: meshed.mesh,
  };
};

const makeReferenceShape = (replicad, part) => {
  if (part.primitive === 'cube' || part.primitive === 'box') {
    const analytic = analyticPart(part);
    return replicad.makeBox(analytic.bounds.min, analytic.bounds.max);
  }
  return replicad.makeSphere(part.radius).translate(part.center);
};

const shapeVolume = (replicad, shape) => {
  const properties = volumeProperties(replicad, shape);
  return properties.volume;
};

const booleanIntersection = (oc, replicad, left, right) => {
  let result;
  try {
    result = left.intersect(right);
    const brepValid = brepIsValid(oc, result);
    const rawVolume = shapeVolume(replicad, result);
    const volume = finiteNumber(rawVolume) && rawVolume > -VOLUME_EPSILON
      ? Math.max(0, rawVolume)
      : null;
    return { brepValid, volume };
  } finally {
    safeDelete(result);
  }
};

const booleanIou = (oc, replicad, candidate, reference) => {
  let intersection;
  let union;
  try {
    intersection = candidate.intersect(reference);
    union = candidate.fuse(reference);
    const intersectionValid = brepIsValid(oc, intersection);
    const unionValid = brepIsValid(oc, union);
    const rawIntersectionVolume = shapeVolume(replicad, intersection);
    const rawUnionVolume = shapeVolume(replicad, union);
    const intersectionVolume = finiteNumber(rawIntersectionVolume) && rawIntersectionVolume > -VOLUME_EPSILON
      ? Math.max(0, rawIntersectionVolume)
      : null;
    const unionVolume = finiteNumber(rawUnionVolume) && rawUnionVolume > VOLUME_EPSILON
      ? rawUnionVolume
      : null;
    const rawIou =
      intersectionValid && unionValid && intersectionVolume !== null && unionVolume !== null
        ? intersectionVolume / unionVolume
        : null;
    return {
      brepIou: finiteNumber(rawIou) ? Math.min(1, Math.max(0, rawIou)) : null,
      intersectionVolume,
      unionVolume,
      intersectionBrepValid: intersectionValid,
      unionBrepValid: unionValid,
    };
  } finally {
    safeDelete(intersection);
    safeDelete(union);
  }
};

const matchParts = (builtParts, specParts) => {
  const used = new Set();
  return specParts.map((expected, expectedIndex) => {
    let candidateIndex = builtParts.findIndex((part, index) =>
      !used.has(index) && part?.name === expected.name,
    );
    let matchedBy = 'name';
    if (candidateIndex === -1 && expectedIndex < builtParts.length && !used.has(expectedIndex)) {
      candidateIndex = expectedIndex;
      matchedBy = 'index';
    }
    if (candidateIndex === -1) return { expectedIndex, candidateIndex: null, matchedBy: 'missing' };
    used.add(candidateIndex);
    return { expectedIndex, candidateIndex, matchedBy };
  });
};

const buildReferences = (replicad, specParts) => specParts.map((part) => ({
  descriptor: analyticPart(part),
  shape: makeReferenceShape(replicad, part),
}));

const referencePreview = (replicad, references) => references.length === 1
  ? references[0].shape.clone()
  : replicad.makeCompound(references.map(({ shape }) => shape.clone()));

const candidatePartsPreview = (replicad, parts) => {
  const shapes = [];
  try {
    parts.forEach((part, index) => {
      const shape = shapePart(part);
      if (!shape || typeof shape.clone !== 'function') {
        throw new TypeError(`build(spec).parts[${index}].shape must be a RepliCAD shape`);
      }
      shapes.push(shape.clone());
    });
    if (shapes.length === 1) return shapes.pop();
    return replicad.makeCompound(shapes);
  } catch (error) {
    for (const shape of shapes) {
      safeDelete(shape);
    }
    throw error;
  }
};

const failedBooleanComparison = (error) => ({
  brepIou: null,
  intersectionVolume: null,
  unionVolume: null,
  intersectionBrepValid: false,
  unionBrepValid: false,
  comparisonError: errorMessage(error),
});

const compareShapes = (oc, replicad, candidate, reference) => {
  try {
    return booleanIou(oc, replicad, candidate, reference);
  } catch (error) {
    // Boolean similarity is a CADTest diagnostic. A valid but semantically
    // wrong shape still executed successfully and should fail its CADTests,
    // rather than being mislabeled as an infrastructure failure.
    return failedBooleanComparison(error);
  }
};

const pairObservation = (oc, replicad, names, left, right, volumes) => {
  const distance = replicad.measureDistanceBetween(left, right);
  const intersection = booleanIntersection(oc, replicad, left, right);
  const denominator = Math.min(Math.abs(volumes[0] ?? 0), Math.abs(volumes[1] ?? 0));
  const rawOverlap = intersection.volume !== null && denominator > VOLUME_EPSILON
    ? intersection.volume / denominator
    : null;
  return {
    names,
    distance: finiteNumber(distance) ? distance : null,
    intersectionVolume: intersection.volume,
    overlapRatio: finiteNumber(rawOverlap) ? Math.min(1, Math.max(0, rawOverlap)) : null,
    intersectionBrepValid: intersection.brepValid,
  };
};

const measureProbe = async ({ oc, replicad, model, spec, specId }) => {
  const probe = {
    specId,
    executed: false,
    artifact: null,
    parts: [],
    preview: null,
    pairs: [],
  };
  let built;
  let references = [];
  let referencePreviewShape;
  const failures = [];

  try {
    // Keep the hidden evaluator spec authoritative even if candidate code
    // mutates the object it receives.
    built = await model.build(structuredClone(spec));
    if (!built || typeof built !== 'object' || Array.isArray(built)) {
      throw new TypeError('build(spec) must return { parts, preview }');
    }
    if (!Array.isArray(built.parts)) throw new TypeError('build(spec).parts must be an array');
    if (built.parts.length === 0) throw new TypeError('build(spec).parts must be nonempty');
    if (!built.preview) throw new TypeError('build(spec).preview must be a RepliCAD shape');
  } catch (error) {
    probe.error = errorMessage(error);
    return { probe, previewMesh: null };
  }

  try {
    references = buildReferences(replicad, expectedParts(spec));
    referencePreviewShape = referencePreview(replicad, references);
  } catch (error) {
    probe.error = `reference construction failed: ${errorMessage(error)}`;
    return { probe, previewMesh: null };
  }

  const matches = matchParts(built.parts, expectedParts(spec));
  const expectedForCandidate = new Map(
    matches
      .filter(({ candidateIndex }) => candidateIndex !== null)
      .map((match) => [match.candidateIndex, match]),
  );
  const measuredParts = [];

  for (let index = 0; index < built.parts.length; index += 1) {
    const part = built.parts[index];
    try {
      const measured = measureShape(oc, replicad, shapePart(part));
      const match = expectedForCandidate.get(index);
      const observation = {
        index,
        name: typeof part?.name === 'string' ? part.name : null,
        ...(typeof part?.primitive === 'string' ? { primitive: part.primitive } : {}),
        ...(finiteVector(part?.center) ? { center: [...part.center] } : {}),
        ...measured.metrics,
        brepIou: null,
      };
      if (match) {
        const comparison = compareShapes(
          oc,
          replicad,
          shapePart(part),
          references[match.expectedIndex].shape,
        );
        Object.assign(observation, comparison, {
          referenceName: references[match.expectedIndex].descriptor.name,
          referenceMatchedBy: match.matchedBy,
        });
      }
      probe.parts.push(observation);
      measuredParts.push({ shape: shapePart(part), observation });
    } catch (error) {
      failures.push(`part ${index}: ${errorMessage(error)}`);
      const observation = emptyObservation(part, index, error);
      probe.parts.push(observation);
      measuredParts.push({ shape: shapePart(part), observation });
    }
  }

  let previewMesh = null;
  let candidatePreviewShape;
  try {
    const measured = measureShape(oc, replicad, built.preview);
    const comparison = compareShapes(oc, replicad, built.preview, referencePreviewShape);
    let partAgreement;
    try {
      candidatePreviewShape = candidatePartsPreview(replicad, built.parts);
      partAgreement = compareShapes(oc, replicad, built.preview, candidatePreviewShape);
    } catch (error) {
      partAgreement = failedBooleanComparison(error);
    }
    probe.preview = {
      brepValid: measured.metrics.brepValid,
      solidCount: measured.metrics.solidCount,
      bounds: measured.metrics.bounds,
      volume: measured.metrics.volume,
      meshValid: measured.metrics.meshValid,
      brepIou: comparison.brepIou,
      intersectionVolume: comparison.intersectionVolume,
      unionVolume: comparison.unionVolume,
      intersectionBrepValid: comparison.intersectionBrepValid,
      unionBrepValid: comparison.unionBrepValid,
      ...(comparison.comparisonError ? { comparisonError: comparison.comparisonError } : {}),
      partAgreementIou: partAgreement.brepIou,
      partAgreementIntersectionVolume: partAgreement.intersectionVolume,
      partAgreementUnionVolume: partAgreement.unionVolume,
      partAgreementIntersectionBrepValid: partAgreement.intersectionBrepValid,
      partAgreementUnionBrepValid: partAgreement.unionBrepValid,
      ...(partAgreement.comparisonError
        ? { partAgreementError: partAgreement.comparisonError }
        : {}),
      mesh: measured.metrics.mesh,
    };
    previewMesh = measured.mesh;
  } catch (error) {
    failures.push(`preview: ${errorMessage(error)}`);
    probe.preview = {
      brepValid: false,
      solidCount: 0,
      bounds: null,
      volume: null,
      meshValid: false,
      partAgreementIou: null,
      error: errorMessage(error),
    };
  } finally {
    safeDelete(candidatePreviewShape);
  }

  for (let leftIndex = 0; leftIndex < expectedParts(spec).length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < expectedParts(spec).length; rightIndex += 1) {
      const names = [expectedParts(spec)[leftIndex].name, expectedParts(spec)[rightIndex].name];
      const leftMatch = matches[leftIndex];
      const rightMatch = matches[rightIndex];
      const left = leftMatch.candidateIndex === null ? null : measuredParts[leftMatch.candidateIndex];
      const right = rightMatch.candidateIndex === null ? null : measuredParts[rightMatch.candidateIndex];
      if (!left?.shape || !right?.shape) {
        failures.push(`pair ${names.join('/')}: one or both candidate parts are missing`);
        probe.pairs.push({
          names,
          distance: null,
          intersectionVolume: null,
          overlapRatio: null,
          error: 'one or both candidate parts are missing native shapes',
        });
        continue;
      }
      try {
        const observed = pairObservation(
          oc,
          replicad,
          names,
          left.shape,
          right.shape,
          [left.observation.volume, right.observation.volume],
        );
        const expected = pairObservation(
          oc,
          replicad,
          names,
          references[leftIndex].shape,
          references[rightIndex].shape,
          [references[leftIndex].descriptor.volume, references[rightIndex].descriptor.volume],
        );
        probe.pairs.push({ ...observed, reference: expected });
      } catch (error) {
        probe.pairs.push({
          names,
          distance: null,
          intersectionVolume: null,
          overlapRatio: null,
          error: errorMessage(error),
        });
      }
    }
  }

  probe.reference = {
    parts: references.map(({ descriptor }) => descriptor),
    preview: {
      bounds: references.length === 1
        ? references[0].descriptor.bounds
        : {
            min: [0, 1, 2].map((axis) => Math.min(
              ...references.map(({ descriptor }) => descriptor.bounds.min[axis]),
            )),
            max: [0, 1, 2].map((axis) => Math.max(
              ...references.map(({ descriptor }) => descriptor.bounds.max[axis]),
            )),
          },
      volume: references.reduce((sum, { descriptor }) => sum + descriptor.volume, 0),
      solidCount: references.length,
    },
  };
  probe.executed = failures.length === 0;
  if (failures.length > 0) probe.error = failures.join('; ');

  safeDelete(referencePreviewShape);
  references.forEach(({ shape }) => safeDelete(shape));
  return { probe, previewMesh };
};

const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text);
  return Buffer.byteLength(text);
};

const candidateFailure = (cadtests, specIds, error) => ({
  taskId: cadtests.taskId,
  executed: false,
  probes: specIds.map((specId) => ({
    specId,
    executed: false,
    artifact: null,
    parts: [],
    preview: null,
    pairs: [],
    error: errorMessage(error),
  })),
  error: errorMessage(error),
});

const run = async () => {
  const [modelArg, cadtestsArg, resultArg, artifactArg, ...extra] = process.argv.slice(2);
  if (!modelArg || !cadtestsArg || !resultArg || !artifactArg || extra.length > 0) {
    throw new TypeError(
      'usage: verify-replicad-model.mjs <model.mjs> <cadtests.json> <result.json> <artifact.mesh.json>',
    );
  }

  const modelPath = resolve(modelArg);
  const cadtestsPath = resolve(cadtestsArg);
  const resultPath = resolve(resultArg);
  const artifactPath = resolve(artifactArg);
  const cadtests = JSON.parse(await readFile(cadtestsPath, 'utf8'));
  validateCadtests(cadtests);
  const seenSpecIds = new Set();
  const specIds = cadtests.evaluationSpecs.map((spec, index) =>
    specIdFor(cadtests.taskId, spec, index, seenSpecIds),
  );
  // Candidate modules run in this process and can inspect process.argv. Remove
  // evaluator-only probes before importing candidate code so the temporary
  // file cannot become an answer key at model initialization or build time.
  await unlink(cadtestsPath);
  const { oc, replicad } = await loadReplicad();

  let model;
  try {
    model = await import(`${pathToFileURL(modelPath).href}?verify=${process.pid}-${Date.now()}`);
    if (typeof model.build !== 'function') throw new TypeError('model.mjs must export build(spec)');
  } catch (error) {
    const result = candidateFailure(cadtests, specIds, error);
    await writeJson(artifactPath, {
      taskId: cadtests.taskId,
      format: 'replicad-shape-mesh-v1',
      probes: [],
    });
    await writeJson(resultPath, result);
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`);
    return;
  }

  const probes = [];
  const artifactProbes = [];
  for (let index = 0; index < cadtests.evaluationSpecs.length; index += 1) {
    const { probe, previewMesh } = await measureProbe({
      oc,
      replicad,
      model,
      spec: cadtests.evaluationSpecs[index],
      specId: specIds[index],
    });
    if (previewMesh) {
      artifactProbes.push({ specId: probe.specId, preview: previewMesh });
      probe.artifact = {
        path: artifactPath,
        format: 'replicad-shape-mesh-v1',
        meshKey: probe.specId,
        vertexCount: probe.preview?.mesh?.vertexCount ?? 0,
        triangleCount: probe.preview?.mesh?.triangleCount ?? 0,
      };
    }
    probes.push(probe);
  }

  const artifactBytes = await writeJson(artifactPath, {
    taskId: cadtests.taskId,
    format: 'replicad-shape-mesh-v1',
    probes: artifactProbes,
  });
  probes.forEach((probe) => {
    if (probe.artifact) probe.artifact.fileSize = artifactBytes;
  });

  const result = {
    taskId: cadtests.taskId,
    executed: probes.every((probe) => probe.executed),
    probes,
  };
  if (!result.executed) result.error = 'one or more evaluation probes failed to execute completely';
  await writeJson(resultPath, result);
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`);
};

const resultArg = process.argv[4];
try {
  await run();
} catch (error) {
  const failure = { executed: false, probes: [], error: errorMessage(error) };
  if (resultArg) {
    try {
      await writeJson(resolve(resultArg), failure);
    } catch {
      // The original verifier/configuration failure remains the useful error.
    }
  }
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
