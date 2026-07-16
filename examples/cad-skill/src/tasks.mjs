export const BACKEND_IDS = Object.freeze([
  'anchorscad',
  'replicad',
  'opentscad',
  'scad-js',
]);

const at = (x, y, z) => Object.freeze([x, y, z]);

const cube = (name, size, center = at(0, 0, 0)) =>
  Object.freeze({ name, primitive: 'cube', center, size });

const sphere = (name, radius, center = at(0, 0, 0)) =>
  Object.freeze({ name, primitive: 'sphere', center, radius });

const taskCases = Object.freeze([
  Object.freeze({
    split: 'train',
    idSuffix: 'cube-10',
    kind: 'cube',
    parts: Object.freeze([cube('cube', 10)]),
  }),
  Object.freeze({
    split: 'train',
    idSuffix: 'sphere-5',
    kind: 'sphere',
    parts: Object.freeze([sphere('sphere', 5)]),
  }),
  Object.freeze({
    split: 'train',
    idSuffix: 'assembly-10-5',
    kind: 'assembly',
    parts: Object.freeze([
      cube('base', 10, at(0, 0, 0)),
      sphere('orb', 5, at(18, 0, 0)),
    ]),
  }),
  Object.freeze({
    split: 'val',
    idSuffix: 'cube-12',
    kind: 'cube',
    parts: Object.freeze([cube('cube', 12)]),
  }),
  Object.freeze({
    split: 'val',
    idSuffix: 'assembly-8-4',
    kind: 'assembly',
    parts: Object.freeze([
      cube('base', 8, at(0, 0, 0)),
      sphere('orb', 4, at(14, 0, 0)),
    ]),
  }),
  Object.freeze({
    split: 'test',
    idSuffix: 'cube-14',
    kind: 'cube',
    parts: Object.freeze([cube('cube', 14)]),
  }),
  Object.freeze({
    split: 'test',
    idSuffix: 'sphere-7',
    kind: 'sphere',
    parts: Object.freeze([sphere('sphere', 7)]),
  }),
  Object.freeze({
    split: 'test',
    idSuffix: 'assembly-6-3',
    kind: 'assembly',
    parts: Object.freeze([
      cube('base', 6, at(0, 0, 0)),
      sphere('orb', 3, at(11, 0, 0)),
    ]),
  }),
]);

const describePart = (part) => {
  const dimensions = part.primitive === 'cube' ? `side ${part.size}` : `radius ${part.radius}`;
  return `${part.name} ${part.primitive} (${dimensions}) centered at [${part.center.join(', ')}]`;
};

const makeTask = (backend, taskCase) => {
  const id = `${backend}-${taskCase.split}-${taskCase.idSuffix}`;
  const payload = Object.freeze({
    backend,
    kind: taskCase.kind,
    parts: taskCase.parts,
  });

  return Object.freeze({
    id,
    description: `Create a ${taskCase.kind} with ${backend}: ${taskCase.parts.map(describePart).join('; ')}.`,
    payload,
  });
};

export const tasks = Object.freeze(
  BACKEND_IDS.flatMap((backend) => taskCases.map((taskCase) => makeTask(backend, taskCase))),
);

export const splitIds = Object.freeze({
  train: Object.freeze(
    tasks.filter((task) => task.id.includes('-train-')).map((task) => task.id),
  ),
  val: Object.freeze(tasks.filter((task) => task.id.includes('-val-')).map((task) => task.id)),
  test: Object.freeze(tasks.filter((task) => task.id.includes('-test-')).map((task) => task.id)),
});

// Alias matches autoimprove's TrainOptions field name.
export const splitOverride = splitIds;
