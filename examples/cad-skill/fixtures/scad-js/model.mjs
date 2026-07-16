import { cube, sphere, union } from 'scad-js';

const makeShape = (part) => {
  if (part.primitive === 'cube') return cube(part.size).translate(part.center);
  if (part.primitive === 'sphere') return sphere(part.radius).translate(part.center);
  throw new Error(`unsupported primitive: ${part.primitive}`);
};

export async function build(spec) {
  const parts = spec.parts.map((part) => ({ ...part, shape: makeShape(part) }));
  const preview = parts.length === 1
    ? parts[0].shape
    : union(...parts.map((part) => part.shape));
  return { parts, preview };
}
