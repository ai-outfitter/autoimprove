import { makeBox, makeCompound, makeSphere } from 'replicad';

const makeShape = (part) => {
  if (part.primitive === 'cube' || part.primitive === 'box') {
    const dimensions = part.primitive === 'cube'
      ? [part.size, part.size, part.size]
      : part.dimensions;
    const min = part.center.map((value, axis) => value - dimensions[axis] / 2);
    const max = part.center.map((value, axis) => value + dimensions[axis] / 2);
    return makeBox(min, max);
  }
  if (part.primitive === 'sphere') {
    return makeSphere(part.radius).translate(part.center);
  }
  throw new Error(`unsupported primitive: ${part.primitive}`);
};

export async function build(spec) {
  const parts = spec.parts.map((part) => ({ ...part, shape: makeShape(part) }));
  const preview = parts.length === 1
    ? parts[0].shape.clone()
    : makeCompound(parts.map((part) => part.shape.clone()));
  return { parts, preview };
}
