---
name: generate-replicad-cad
description: Create parameterized Replicad/OpenCascade.js solid models and named multi-part assemblies. Use when a task asks for a cube, sphere, simple B-Rep model, Replicad source, or an assembly whose part names and placements must remain distinct.
---

# Generate Replicad CAD

Write `model.mjs` in the task workspace and export `build(spec)`. Use only the
installed `replicad` API; the evaluator initializes `replicad-opencascadejs`
before importing the module.

## Preserve the contract

- Read every dimension, name, primitive, and world-space center from `spec`.
  Do not hardcode the example values.
- Return `{ parts, preview }`.
- Return one named entry in `parts` for each requested part. Preserve the input
  name and keep its Replicad shape as `shape`.
- Keep single models as one valid solid.
- Keep assembly parts as separate solids. Build `preview` with cloned shapes in
  a Replicad compound; do not fuse the assembly or substitute a mesh.

## Build the supported primitives

- Build a centered cube or box with `makeBox(minCorner, maxCorner)`, deriving
  both corners from its requested dimensions and center.
- Build a sphere with `makeSphere(radius)` and translate it to its requested
  center.
- Reject unsupported primitives explicitly instead of returning approximate
  geometry.

## Check the result

Before finishing, confirm that every part is present once, names are unique,
dimensions come from the supplied spec, and the preview contains the same
separate solids. Leave B-Rep validity, topology, volume, placement, gap, and
interference decisions to the fixed evaluator.
