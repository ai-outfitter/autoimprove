import { access, readFile, writeFile } from 'node:fs/promises';

await access('node_modules').then(
  () => { throw new Error('target workspace leaked the repository dependency link'); },
  (error) => { if (error?.code !== 'ENOENT') throw error; },
);

for await (const _chunk of process.stdin) {
  // The fixture models a harness that receives the task prompt but resolves
  // the trainable skill through the copied Outfitter profile.
}

const skill = await readFile(
  '.agents/agents/cad/skills/generate-replicad-cad/SKILL.md',
  'utf8',
);
const trained = skill.includes('TRAINING_FIXTURE_READY');
const source = trained
  ? `import { makeBox, makeCompound, makeSphere } from 'replicad';

const makeShape = (part) => {
  if (part.primitive === 'sphere') return makeSphere(part.radius).translate(part.center);
  const dimensions = part.primitive === 'cube'
    ? [part.size, part.size, part.size]
    : part.dimensions;
  if (!Array.isArray(dimensions)) throw new Error(\`unsupported primitive: \${part.primitive}\`);
  const min = part.center.map((value, axis) => value - dimensions[axis] / 2);
  const max = part.center.map((value, axis) => value + dimensions[axis] / 2);
  return makeBox(min, max);
};

export async function build(spec) {
  const parts = spec.parts.map((part) => ({ ...part, shape: makeShape(part) }));
  const preview = parts.length === 1
    ? parts[0].shape.clone()
    : makeCompound(parts.map((part) => part.shape.clone()));
  return { parts, preview };
}
`
  : `export async function build() {
  return { parts: [], preview: null };
}
`;

await writeFile('model.mjs', source);
console.log(trained ? 'wrote trained fixture' : 'wrote baseline fixture');
