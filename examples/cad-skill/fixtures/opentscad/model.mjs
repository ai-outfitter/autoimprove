import { defineModel } from '@tscad/modeling';
import { cube, sphere } from '@tscad/modeling/primitives';

const makeShape = (part) => {
  if (part.primitive === 'cube') return cube({ size: part.size, center: part.center });
  if (part.primitive === 'sphere') return sphere({ radius: part.radius, center: part.center });
  throw new Error(`unsupported primitive: ${part.primitive}`);
};

export async function build(spec) {
  const parts = spec.parts.map((part) => ({ ...part, shape: makeShape(part) }));
  const definition = defineModel({ model: () => parts.map((part) => part.shape) });
  return { parts, preview: definition.model({}) };
}
