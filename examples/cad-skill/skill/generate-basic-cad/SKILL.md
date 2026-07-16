---
name: generate-basic-cad
description: Create simple, parameterized 3D CAD primitives and named multi-part assemblies with AnchorCAD/AnchorSCAD, Replicad, OpenTsCad/TSCAD, or scad-js. Use when a task asks for a cube, sphere, basic assembly, backend-native CAD source, or a small model that must preserve part names and placements.
---

# Generate Basic CAD

Create the requested model in the task's selected backend. Keep geometry
parameterized from the supplied specification and preserve assembly semantics.

## Follow the file contract

- Write `model.py` for `anchorscad` tasks and `model.mjs` for every other
  backend. Do not install packages or create a new project.
- Export one `build(spec)` function. Use `async function build(spec)` in
  JavaScript when initialization requires it.
- Return an object with `parts` and `preview`.
- Give every part exactly these fields: `name`, `primitive`, `center`, `shape`,
  plus `size` for a cube or `radius` for a sphere.
- Read dimensions, names, and centers from `spec.parts`; do not hardcode the
  example values.

Each input part uses one of these two schemas:

- `{ name, primitive: "cube", center: [x, y, z], size: number }`, where
  `size` is the cube's scalar side length.
- `{ name, primitive: "sphere", center: [x, y, z], radius: number }`.

This initial skill supports cubes, not unequal-sided boxes. Preserve each
provided `name` exactly.

For Python, return a dictionary. For JavaScript, return a plain object. Keep
`shape` as the backend-native object; the verifier consumes it in-process.

## Build primitives

- Build cubes and spheres with the requested backend, not hand-written mesh
  data or a backend-neutral substitute.
- Treat each `center` as a world-space center. Account for APIs whose boxes are
  corner-based or origin-based.
- Keep the native object for each part separate, even when also making a
  combined preview.

## Build assemblies

- Return one `parts` entry per requested instance, in specification order, with
  its requested name and center.
- Make `preview` contain every part in its placed position.
- Do not represent an assembly only as a fused solid or STL. The named `parts`
  array is the assembly/BOM contract.
- Clone native shapes before passing them to a destructive compound operation.

## Select the backend

- `anchorscad`: resolve the requested “AnchorCAD” name to AnchorSCAD. Use
  Python and import the `anchorscad` module supplied by `anchorscad-core`.
- `replicad`: use ESM imports from `replicad`. The verifier initializes
  OpenCascade before importing the model.
- `opentscad`: use the current TSCAD packages, `@tscad/modeling` and
  `@tscad/modeling/primitives`. This example resolves the requested
  “OpenTsCad” name to TSCAD.
- `scad-js`: use ESM imports from `scad-js` and return a serializable
  `ScadObject` preview.

Use the backend APIs named above without installing packages or probing outside
the task workspace. Keep the final source concise; the task evaluator supplies
runtime dependencies and performs verification after importing it.
