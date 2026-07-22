/**
 * Autoimprove-specific CADTest-style cases.
 *
 * These are deliberately labeled extensions. They are not rows from the
 * official CADTestBench dataset and must not be reported as such.
 */

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

const vector3 = (value, label) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) {
    throw new TypeError(`${label} must be an array of three finite numbers`);
  }
  return [...value];
};

const dimensionsFor = (part) => {
  if (part.primitive === 'sphere') {
    if (!finite(part.radius) || part.radius <= 0) {
      throw new TypeError('sphere radius must be a positive finite number');
    }
    return [part.radius * 2, part.radius * 2, part.radius * 2];
  }
  if (Array.isArray(part.dimensions)) return vector3(part.dimensions, 'box dimensions');
  if (Array.isArray(part.size)) return vector3(part.size, 'box size');
  if (finite(part.size) && part.size > 0) return [part.size, part.size, part.size];
  throw new TypeError('box/cube part requires positive size or dimensions');
};

const normalizePart = (part, index = 0) => {
  const primitive = part?.primitive === 'box' ? 'box' : part?.primitive;
  if (!['box', 'cube', 'sphere'].includes(primitive)) {
    throw new TypeError(`unsupported primitive: ${String(part?.primitive)}`);
  }
  const center = vector3(part.center ?? [0, 0, 0], 'part center');
  const dimensions = dimensionsFor({ ...part, primitive });
  const normalized = {
    name: part.name ?? `part-${index + 1}`,
    primitive,
    center,
    dimensions,
  };
  if (primitive === 'sphere') normalized.radius = part.radius;
  return normalized;
};

const extensionTest = ({ id, description, category, requirement, requirementType, requirementDescription }) => ({
  cadtest_id: id,
  cadtest_description: `[Autoimprove extension] ${description}`,
  cadtest_type: category,
  requirement_id: requirement,
  requirement_type: requirementType,
  requirement_description: requirementDescription,
  extension: true,
});

const buildRequirementGroups = (cadtests) => {
  const groups = [];
  const byId = new Map();
  for (const cadtest of cadtests) {
    let group = byId.get(cadtest.requirement_id);
    if (!group) {
      group = {
        requirement_id: cadtest.requirement_id,
        requirement_type: cadtest.requirement_type,
        requirement_description: cadtest.requirement_description,
        cadtest_ids: [],
      };
      byId.set(cadtest.requirement_id, group);
      groups.push(group);
    }
    group.cadtest_ids.push(cadtest.cadtest_id);
  }
  return groups;
};

const primitiveTests = (part, prefix = '') => {
  const id = (name) => `${prefix}${name}`;
  const requirement = (name) => `${prefix}${name}`;
  const tests = [
    extensionTest({
      id: id('brep-valid'),
      description: `${part.name} is a valid OpenCascade B-rep`,
      category: 'solid_shell_validity',
      requirement: requirement('valid-solid'),
      requirementType: 'solid_validity',
      requirementDescription: `${part.name} is a valid, non-degenerate solid B-rep.`,
    }),
    extensionTest({
      id: id('single-solid'),
      description: `${part.name} contains exactly one solid`,
      category: 'solid_shell_validity',
      requirement: requirement('valid-solid'),
      requirementType: 'solid_validity',
      requirementDescription: `${part.name} is a valid, non-degenerate solid B-rep.`,
    }),
    extensionTest({
      id: id('mesh-valid'),
      description: `${part.name} produces a finite, index-valid tessellation`,
      category: 'solid_shell_validity',
      requirement: requirement('exportable-mesh'),
      requirementType: 'artifact_validity',
      requirementDescription: `${part.name} can be tessellated into a valid preview/export mesh.`,
    }),
    extensionTest({
      id: id('geometry-type'),
      description: `${part.name} has the expected analytic surface types`,
      category: 'geometry_types',
      requirement: requirement('primitive-geometry'),
      requirementType: 'shape_geometry',
      requirementDescription: `${part.name} has the requested ${part.primitive} geometry.`,
    }),
    extensionTest({
      id: id('bounds'),
      description: `${part.name} has the requested dimensions and placement`,
      category: 'dimensions_ratios',
      requirement: requirement('dimensions'),
      requirementType: 'dimensions',
      requirementDescription: `${part.name} has the requested axis-aligned bounds.`,
    }),
    extensionTest({
      id: id('volume'),
      description: `${part.name} has the analytic volume`,
      category: 'volumetric_checks',
      requirement: requirement('mass-properties'),
      requirementType: 'derived_property',
      requirementDescription: `${part.name} has the expected analytic mass properties.`,
    }),
    extensionTest({
      id: id('area'),
      description: `${part.name} has the analytic surface area`,
      category: 'volumetric_checks',
      requirement: requirement('mass-properties'),
      requirementType: 'derived_property',
      requirementDescription: `${part.name} has the expected analytic mass properties.`,
    }),
    extensionTest({
      id: id('center-of-mass'),
      description: `${part.name} center of mass matches its requested center`,
      category: 'spatial_arrangement',
      requirement: requirement('placement'),
      requirementType: 'placement',
      requirementDescription: `${part.name} is placed at the requested center.`,
    }),
    extensionTest({
      id: id('brep-iou'),
      description: `${part.name} B-rep IoU agrees with the deterministic reference`,
      category: 'volumetric_checks',
      requirement: requirement('reference-agreement'),
      requirementType: 'geometric_similarity',
      requirementDescription: `${part.name} agrees with the exact OpenCascade reference solid.`,
    }),
  ];

  if (part.primitive !== 'sphere') {
    tests.splice(3, 0, extensionTest({
      id: id('box-topology'),
      description: `${part.name} has 6 faces, 12 edges, and 8 vertices`,
      category: 'topology_checks',
      requirement: requirement('primitive-geometry'),
      requirementType: 'shape_geometry',
      requirementDescription: `${part.name} has the requested ${part.primitive} geometry.`,
    }));
  }
  return tests;
};

const extensionProvenance = (kind) => ({
  source: 'autoimprove-extension',
  official: false,
  kind,
  notice: 'This case is an Autoimprove Replicad extension, not an official CADTestBench sample.',
});

export function createPrimitiveExtensionCase(spec) {
  if (!spec || !Array.isArray(spec.parts) || spec.parts.length !== 1) {
    throw new TypeError('primitive extension case requires exactly one expected part');
  }
  const part = normalizePart(spec.parts[0]);
  const kind = part.primitive === 'sphere'
    ? 'sphere'
    : part.dimensions.every((dimension) => dimension === part.dimensions[0]) ? 'cube' : 'box';
  const cadtests = primitiveTests(part);
  return deepFreeze({
    id: spec.id ?? `autoimprove-extension:${kind}:${part.name}`,
    source: 'autoimprove-extension',
    official: false,
    kind,
    predicateSet: 'autoimprove-primitive-extension',
    expected: { parts: [part] },
    requirement_groups: buildRequirementGroups(cadtests),
    cadtests,
    provenance: extensionProvenance(kind),
    slices: {
      source: 'autoimprove-extension',
      kind,
      ...(spec.slices ?? {}),
    },
  });
}

export function createNamedAssemblyExtensionCase(spec) {
  if (!spec || !Array.isArray(spec.parts) || spec.parts.length < 2) {
    throw new TypeError('named assembly extension case requires at least two expected parts');
  }
  const parts = spec.parts.map(normalizePart);
  const names = parts.map((part) => part.name);
  if (new Set(names).size !== names.length) {
    throw new TypeError('named assembly extension part names must be unique');
  }

  const structureDescription = 'The assembly preserves all requested components as separately named parts.';
  const cadtests = [
    extensionTest({
      id: 'assembly:part-count',
      description: 'assembly has exactly the requested number of components',
      category: 'topology_checks',
      requirement: 'assembly:structure',
      requirementType: 'assembly_structure',
      requirementDescription: structureDescription,
    }),
    extensionTest({
      id: 'assembly:part-names',
      description: 'assembly preserves every requested component name',
      category: 'topology_checks',
      requirement: 'assembly:structure',
      requirementType: 'assembly_structure',
      requirementDescription: structureDescription,
    }),
    extensionTest({
      id: 'assembly:preview-brep',
      description: 'assembly preview is a valid OpenCascade compound B-rep',
      category: 'solid_shell_validity',
      requirement: 'assembly:preview',
      requirementType: 'assembly_structure',
      requirementDescription: 'The separately named parts compose into a valid assembly preview.',
    }),
    extensionTest({
      id: 'assembly:preview-solid-count',
      description: 'assembly preview preserves one solid per requested component',
      category: 'topology_checks',
      requirement: 'assembly:preview',
      requirementType: 'assembly_structure',
      requirementDescription: 'The separately named parts compose into a valid assembly preview.',
    }),
    extensionTest({
      id: 'assembly:preview-iou',
      description: 'assembly preview B-rep IoU agrees with the compound reference',
      category: 'volumetric_checks',
      requirement: 'assembly:preview',
      requirementType: 'geometric_similarity',
      requirementDescription: 'The separately named parts compose into a valid assembly preview.',
    }),
    extensionTest({
      id: 'assembly:preview-mesh',
      description: 'assembly preview produces a finite, index-valid tessellation',
      category: 'solid_shell_validity',
      requirement: 'assembly:preview',
      requirementType: 'artifact_validity',
      requirementDescription: 'The separately named parts compose into a valid assembly preview.',
    }),
    ...parts.flatMap((part) => primitiveTests(part, `part:${part.name}:`)),
    extensionTest({
      id: 'assembly:pair-relations',
      description: 'all component pairs have the expected clearance and no interference',
      category: 'spatial_arrangement',
      requirement: 'assembly:pair-relations',
      requirementType: 'assembly_relationships',
      requirementDescription: 'Component clearances match the requested placement and no components overlap.',
    }),
  ];

  return deepFreeze({
    id: spec.id ?? `autoimprove-extension:named-assembly:${names.join('+')}`,
    source: 'autoimprove-extension',
    official: false,
    kind: 'named-assembly',
    predicateSet: 'autoimprove-named-assembly-extension',
    expected: { parts },
    requirement_groups: buildRequirementGroups(cadtests),
    cadtests,
    provenance: extensionProvenance('named-assembly'),
    slices: {
      source: 'autoimprove-extension',
      kind: 'named-assembly',
      ...(spec.slices ?? {}),
    },
  });
}

export const CUBE_EXTENSION_CASE = createPrimitiveExtensionCase({
  id: 'autoimprove-extension:cube-10',
  parts: [{ name: 'cube', primitive: 'cube', size: 10, center: [0, 0, 0] }],
});

export const SPHERE_EXTENSION_CASE = createPrimitiveExtensionCase({
  id: 'autoimprove-extension:sphere-5',
  parts: [{ name: 'sphere', primitive: 'sphere', radius: 5, center: [0, 0, 0] }],
});

export const NAMED_ASSEMBLY_EXTENSION_CASE = createNamedAssemblyExtensionCase({
  id: 'autoimprove-extension:named-assembly-10-5',
  parts: [
    { name: 'base', primitive: 'cube', size: 10, center: [0, 0, 0] },
    { name: 'orb', primitive: 'sphere', radius: 5, center: [18, 0, 0] },
  ],
});

export const AUTOIMPROVE_EXTENSION_CASES = deepFreeze([
  CUBE_EXTENSION_CASE,
  SPHERE_EXTENSION_CASE,
  NAMED_ASSEMBLY_EXTENSION_CASE,
]);
