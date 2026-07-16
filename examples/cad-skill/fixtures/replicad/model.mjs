import { makeBox, makeCompound, makeSphere } from 'replicad';

const makeShape = (part) => {
  if (part.primitive === 'cube') {
    const half = part.size / 2;
    const min = part.center.map((value) => value - half);
    const max = part.center.map((value) => value + half);
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
