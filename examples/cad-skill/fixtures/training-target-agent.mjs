import { access, writeFile } from 'node:fs/promises';

await access('node_modules').then(
  () => { throw new Error('target workspace leaked the repository dependency link'); },
  (error) => { if (error?.code !== 'ENOENT') throw error; },
);

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;

const trained = prompt.includes('TRAINING_FIXTURE_READY');
const source = trained
  ? `import { cube, sphere, union } from 'scad-js';

const makeShape = (part) => {
  if (part.primitive === 'cube') return cube(part.size).translate(part.center);
  if (part.primitive === 'sphere') return sphere(part.radius).translate(part.center);
  throw new Error(\`unsupported primitive: \${part.primitive}\`);
};

export async function build(spec) {
  const parts = spec.parts.map((part) => ({ ...part, shape: makeShape(part) }));
  const preview = parts.length === 1 ? parts[0].shape : union(...parts.map((part) => part.shape));
  return { parts, preview };
}
`
  : `export async function build() {
  return { parts: [], preview: null };
}
`;

await writeFile('model.mjs', source);
console.log(trained ? 'wrote trained fixture' : 'wrote baseline fixture');
