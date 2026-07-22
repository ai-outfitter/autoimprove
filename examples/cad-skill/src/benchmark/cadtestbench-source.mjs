/**
 * Pinned CADTestBench attribution and a direct metadata port of detailed
 * sample 00003247. CADTestBench is MIT licensed.
 *
 * The Python in cadtest_code is retained verbatim as provenance. Evaluation
 * is performed by the JavaScript predicate port in evaluator.mjs.
 */

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

export const CADTESTBENCH_PROVENANCE = deepFreeze({
  title: 'Text-to-CAD Evaluation with CADTests',
  authors: [
    'Dimitrios Mallis',
    'Marco Wang',
    'Ahmet Serdar Karadeniz',
    'Elisa Ricci',
    'Anis Kacem',
    'Djamila Aouada',
  ],
  paperUrl: 'https://arxiv.org/abs/2605.07807',
  repositoryUrl: 'https://github.com/dimitrismallis/CADTestBench',
  repositoryRevision: 'e29283cc61db7329039d95b429766a50bfd37f89',
  datasetUrl: 'https://huggingface.co/datasets/dimitrismallis/CADTestBench',
  datasetRevision: '2b9a4a972d142d2bc634d072e9d4485f171ced06',
  license: 'MIT',
  port: 'Replicad/OpenCascade.js observation predicates',
});

export const CADTESTBENCH_00003247_SAMPLE = deepFreeze({
  sample_id: '00003247',
  partition: 'detailed',
  prompt: 'Write Python code using CADQuery to create a long rectangular prism with a length of 0.3 units, a width of 0.7 units, and a height of 0.3 units.',
});

export const CADTESTBENCH_00003247_CADTESTS = deepFreeze([
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 1,
    cadtest_description: 'Verifies the model has exactly 6 planar faces',
    cadtest_code: "face_count = final_result.faces('%Plane').size()\ncheck(face_count == 6, f'Face count is {face_count}, matches expected 6 for a rectangular prism', f'Rectangular prism must have 6 planar faces, found {face_count}')",
    cadtest_type: 'topology_checks',
    classification_reasoning: 'It checks an exact count of planar faces, which is a topological element count.',
    prompt_justification: 'A rectangular prism has exactly 6 planar faces by geometric definition',
    requirement_id: 'rectangular_prism_shape',
    requirement_type: 'shape_topology',
    requirement_description: 'The model is a rectangular prism/box with only planar faces and no curved/circular geometry.',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 2,
    cadtest_description: 'Verifies the model has exactly 12 edges',
    cadtest_code: "edge_count = final_result.edges().size()\ncheck(edge_count == 12, f'Edge count is {edge_count}, matches expected 12 for a rectangular prism', f'Rectangular prism must have 12 edges, found {edge_count}')",
    cadtest_type: 'topology_checks',
    classification_reasoning: 'It verifies the exact number of edges, a pure topology count check.',
    prompt_justification: 'A rectangular prism has exactly 12 edges by geometric definition',
    requirement_id: 'rectangular_prism_shape',
    requirement_type: 'shape_topology',
    requirement_description: 'The model is a rectangular prism/box with only planar faces and no curved/circular geometry.',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 3,
    cadtest_description: 'Verifies the model has exactly 8 vertices',
    cadtest_code: "vertex_count = final_result.vertices().size()\ncheck(vertex_count == 8, f'Vertex count is {vertex_count}, matches expected 8 for a rectangular prism', f'Rectangular prism must have 8 vertices, found {vertex_count}')",
    cadtest_type: 'topology_checks',
    classification_reasoning: 'It verifies the exact vertex count, which is a topological property.',
    prompt_justification: 'A rectangular prism has exactly 8 vertices by geometric definition',
    requirement_id: 'rectangular_prism_shape',
    requirement_type: 'shape_topology',
    requirement_description: 'The model is a rectangular prism/box with only planar faces and no curved/circular geometry.',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 4,
    cadtest_description: 'Verifies the model consists of exactly 1 solid',
    cadtest_code: "solid_count = final_result.solids().size()\ncheck(solid_count == 1, f'Solid count is {solid_count}, matches expected 1 for a single prism', f'Model should have exactly 1 solid, found {solid_count}')",
    cadtest_type: 'solid_shell_validity',
    classification_reasoning: 'It checks the model has a single solid body, relating to solid/body validity and connectedness.',
    prompt_justification: 'The prompt describes a single rectangular prism, so there should be exactly 1 solid',
    requirement_id: 'single_solid',
    requirement_type: 'model_structure',
    requirement_description: 'The model consists of exactly one solid body.',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 5,
    cadtest_description: 'Verifies the largest bounding box dimension is 0.7 units (the width)',
    cadtest_code: "bbox = final_result.val().BoundingBox()\ndims = sorted([bbox.xlen, bbox.ylen, bbox.zlen])\nexpected_large = 0.7\ncheck(abs(dims[2] - expected_large) / expected_large < 0.01, f'Largest dimension is {dims[2]:.4f}, within 1% of expected 0.7 units', f'Largest dimension should be 0.7 units, found {dims[2]:.4f}')",
    cadtest_type: 'dimensions_ratios',
    classification_reasoning: 'It validates an absolute bounding box dimension value, which is a dimensional measurement.',
    prompt_justification: 'The prompt specifies a width of 0.7 units, which is the largest of the three dimensions',
    requirement_id: 'bounding_box_dimensions',
    requirement_type: 'dimensions',
    requirement_description: 'The prism’s overall dimensions match width=0.7 and the other two dimensions are 0.3 and 0.3 (order/orientation arbitrary).',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 6,
    cadtest_description: 'Verifies the smallest bounding box dimension is 0.3 units',
    cadtest_code: "bbox = final_result.val().BoundingBox()\ndims = sorted([bbox.xlen, bbox.ylen, bbox.zlen])\nexpected_small = 0.3\ncheck(abs(dims[0] - expected_small) / expected_small < 0.01, f'Smallest dimension is {dims[0]:.4f}, within 1% of expected 0.3 units', f'Smallest dimension should be 0.3 units, found {dims[0]:.4f}')",
    cadtest_type: 'dimensions_ratios',
    classification_reasoning: 'It validates the smallest bounding box dimension as a specific numeric value.',
    prompt_justification: 'The prompt specifies a length of 0.3 and height of 0.3, so the smallest dimension should be 0.3 units',
    requirement_id: 'bounding_box_dimensions',
    requirement_type: 'dimensions',
    requirement_description: 'The prism’s overall dimensions match width=0.7 and the other two dimensions are 0.3 and 0.3 (order/orientation arbitrary).',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 7,
    cadtest_description: 'Verifies the middle bounding box dimension is also 0.3 units',
    cadtest_code: "bbox = final_result.val().BoundingBox()\ndims = sorted([bbox.xlen, bbox.ylen, bbox.zlen])\nexpected_small = 0.3\ncheck(abs(dims[1] - expected_small) / expected_small < 0.01, f'Middle dimension is {dims[1]:.4f}, within 1% of expected 0.3 units', f'Middle dimension should be 0.3 units, found {dims[1]:.4f}')",
    cadtest_type: 'dimensions_ratios',
    classification_reasoning: 'It checks a specific numeric value for the middle bounding box dimension.',
    prompt_justification: 'The prompt specifies both length and height as 0.3 units, so both the two smaller dimensions must be 0.3',
    requirement_id: 'bounding_box_dimensions',
    requirement_type: 'dimensions',
    requirement_description: 'The prism’s overall dimensions match width=0.7 and the other two dimensions are 0.3 and 0.3 (order/orientation arbitrary).',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 8,
    cadtest_description: 'Verifies the two smaller dimensions are equal (both 0.3 units)',
    cadtest_code: "bbox = final_result.val().BoundingBox()\ndims = sorted([bbox.xlen, bbox.ylen, bbox.zlen])\nratio = abs(dims[0] - dims[1]) / max(dims[0], dims[1])\ncheck(ratio < 0.01, f'Two smaller dimensions are {dims[0]:.4f} and {dims[1]:.4f}, ratio difference {ratio:.6f} < 1%', f'The two 0.3-unit dimensions should be equal, found {dims[0]:.4f} and {dims[1]:.4f} with ratio difference {ratio:.6f}')",
    cadtest_type: 'dimensions_ratios',
    classification_reasoning: 'It checks equality between two measured dimensions, a ratio/equality dimensional constraint.',
    prompt_justification: 'The prompt specifies length = 0.3 and height = 0.3, so these two dimensions must be equal to each other',
    requirement_id: 'bounding_box_dimensions',
    requirement_type: 'dimensions',
    requirement_description: 'The prism’s overall dimensions match width=0.7 and the other two dimensions are 0.3 and 0.3 (order/orientation arbitrary).',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 9,
    cadtest_description: 'Verifies the volume matches 0.3 x 0.7 x 0.3 = 0.063 cubic units',
    cadtest_code: "volume = final_result.val().Volume()\nexpected_volume = 0.3 * 0.7 * 0.3\ncheck(abs(volume - expected_volume) / expected_volume < 0.01, f'Volume is {volume:.6f} cubic units, within 1% of expected {expected_volume:.6f}', f'Volume should be {expected_volume:.6f} cubic units, found {volume:.6f}')",
    cadtest_type: 'volumetric_checks',
    classification_reasoning: 'It compares model volume to an analytic computed volume, which is a volumetric validation.',
    prompt_justification: 'A rectangular prism with length=0.3, width=0.7, height=0.3 must have volume = 0.3 * 0.7 * 0.3 = 0.063',
    requirement_id: 'volume_matches_dimensions',
    requirement_type: 'derived_property',
    requirement_description: 'The solid’s volume equals 0.3 × 0.7 × 0.3 = 0.063 cubic units, consistent with the specified dimensions.',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 10,
    cadtest_description: 'Verifies the shape factor (volume / bounding box volume) equals 1.0 for a solid box',
    cadtest_code: "bbox = final_result.val().BoundingBox()\nbbox_volume = bbox.xlen * bbox.ylen * bbox.zlen\nvolume = final_result.val().Volume()\nshape_factor = volume / bbox_volume\ncheck(abs(shape_factor - 1.0) < 0.01, f'Shape factor is {shape_factor:.6f}, confirming solid box fills bounding box', f'Shape factor should be 1.0 for a solid box, found {shape_factor:.6f}')",
    cadtest_type: 'volumetric_checks',
    classification_reasoning: 'It checks volume-to-bounding-box-volume (fill/shape factor), which is a volumetric metric.',
    prompt_justification: 'A rectangular prism with no holes or cutouts should completely fill its bounding box, giving a shape factor of 1.0',
    requirement_id: 'no_voids_or_cutouts',
    requirement_type: 'solidity',
    requirement_description: 'The prism is a full solid box (fills its bounding box), with no holes, cutouts, or missing material.',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 11,
    cadtest_description: 'Verifies the ratio of largest to smallest dimension is approximately 0.7/0.3 ≈ 2.333',
    cadtest_code: "bbox = final_result.val().BoundingBox()\ndims = sorted([bbox.xlen, bbox.ylen, bbox.zlen])\nexpected_ratio = 0.7 / 0.3\nmeasured_ratio = dims[2] / dims[0]\ncheck(abs(measured_ratio - expected_ratio) / expected_ratio < 0.01, f'Largest-to-smallest dimension ratio is {measured_ratio:.4f}, within 1% of expected {expected_ratio:.4f}', f'Dimension ratio should be {expected_ratio:.4f}, found {measured_ratio:.4f}')",
    cadtest_type: 'dimensions_ratios',
    classification_reasoning: 'It verifies a ratio between largest and smallest dimensions, a dimension ratio check.',
    prompt_justification: 'With width=0.7 and length=height=0.3, the ratio of largest to smallest dimension should be 7/3 ≈ 2.333',
    requirement_id: 'bounding_box_dimensions',
    requirement_type: 'dimensions',
    requirement_description: 'The prism’s overall dimensions match width=0.7 and the other two dimensions are 0.3 and 0.3 (order/orientation arbitrary).',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 12,
    cadtest_description: 'Verifies all 6 faces are planar (no curved surfaces)',
    cadtest_code: "total_faces = final_result.faces().size()\nplanar_faces = final_result.faces('%Plane').size()\ncheck(total_faces == planar_faces, f'All {total_faces} faces are planar, confirming rectangular prism shape', f'All faces should be planar for a rectangular prism, but only {planar_faces} of {total_faces} are planar')",
    cadtest_type: 'geometry_types',
    classification_reasoning: 'It checks face geometry type (planar vs curved) without counting beyond presence/absence intent.',
    prompt_justification: 'A rectangular prism has only flat faces; all faces must be planar type',
    requirement_id: 'rectangular_prism_shape',
    requirement_type: 'shape_topology',
    requirement_description: 'The model is a rectangular prism/box with only planar faces and no curved/circular geometry.',
  },
  {
    sample_id: '00003247',
    partition: 'detailed',
    cadtest_id: 13,
    cadtest_description: 'Verifies no circular edges exist (confirming box shape, not cylinder)',
    cadtest_code: "circular_edge_count = final_result.edges('%Circle').size()\ncheck(circular_edge_count == 0, f'No circular edges found ({circular_edge_count}), confirming rectangular prism shape', f'Rectangular prism should have no circular edges, found {circular_edge_count}')",
    cadtest_type: 'geometry_types',
    classification_reasoning: 'It asserts absence of circular edges, which is a geometry-type presence/absence check.',
    prompt_justification: 'A rectangular prism has no curved edges; there should be zero circular edges',
    requirement_id: 'rectangular_prism_shape',
    requirement_type: 'shape_topology',
    requirement_description: 'The model is a rectangular prism/box with only planar faces and no curved/circular geometry.',
  },
]);

const requirementGroups = [];
const requirementById = new Map();
for (const cadtest of CADTESTBENCH_00003247_CADTESTS) {
  let requirement = requirementById.get(cadtest.requirement_id);
  if (!requirement) {
    requirement = {
      requirement_id: cadtest.requirement_id,
      requirement_type: cadtest.requirement_type,
      requirement_description: cadtest.requirement_description,
      cadtest_ids: [],
    };
    requirementById.set(cadtest.requirement_id, requirement);
    requirementGroups.push(requirement);
  }
  requirement.cadtest_ids.push(cadtest.cadtest_id);
}

export const CADTESTBENCH_00003247_CASE = deepFreeze({
  id: 'cadtestbench:detailed:00003247',
  source: 'cadtestbench',
  official: true,
  sample: CADTESTBENCH_00003247_SAMPLE,
  provenance: CADTESTBENCH_PROVENANCE,
  predicateSet: 'cadtestbench-detailed-00003247',
  expected: {
    sortedDimensions: [0.3, 0.3, 0.7],
    volume: 0.063,
    relativeTolerance: 0.01,
  },
  requirement_groups: requirementGroups,
  cadtests: CADTESTBENCH_00003247_CADTESTS,
  slices: {
    source: 'cadtestbench',
    partition: 'detailed',
    kind: 'rectangular-prism',
  },
});
