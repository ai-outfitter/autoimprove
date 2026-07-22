export const BACKEND_IDS = Object.freeze(['replicad']);

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

const at = (x, y, z) => [x, y, z];
const cube = (name, size, center = at(0, 0, 0)) => ({
  name,
  primitive: 'cube',
  center,
  size,
});
const box = (name, dimensions, center = at(0, 0, 0)) => ({
  name,
  primitive: 'box',
  center,
  dimensions,
});
const sphere = (name, radius, center = at(0, 0, 0)) => ({
  name,
  primitive: 'sphere',
  center,
  radius,
});

const model = (id, part, extra = {}) => ({ id, kind: 'model', parts: [part], ...extra });
const assembly = (id, parts, extra = {}) => ({ id, kind: 'assembly', parts, ...extra });

const task = ({ id, split, kind, publicSpec, evaluationSpecs }) => deepFreeze({
  id: `replicad-${split}-${id}`,
  split,
  description: `Implement a generic Replicad ${kind} builder from the supplied specification.`,
  payload: {
    backend: 'replicad',
    kind,
    split,
    publicSpec,
    evaluationSpecs,
  },
});

const taskCases = [
  task({
    id: 'cube-basic',
    split: 'train',
    kind: 'model',
    publicSpec: model('public-cube-basic', cube('cube', 10)),
    evaluationSpecs: [
      model('train-cube-basic-1', cube('cube', 7, at(2, -1, 3))),
      model('train-cube-basic-2', cube('block', 12.5, at(-4, 5, 1))),
    ],
  }),
  task({
    id: 'cube-positioned',
    split: 'train',
    kind: 'model',
    publicSpec: model('public-cube-positioned', cube('workpiece', 6, at(3, -2, 1))),
    evaluationSpecs: [
      model('train-cube-positioned-1', cube('workpiece', 4.5, at(-6, 2, 5))),
      model('train-cube-positioned-2', cube('die', 9, at(1.5, 4, -3))),
    ],
  }),
  task({
    id: 'sphere-basic',
    split: 'train',
    kind: 'model',
    publicSpec: model('public-sphere-basic', sphere('sphere', 5)),
    evaluationSpecs: [
      model('train-sphere-basic-1', sphere('sphere', 3, at(4, -2, 1))),
      model('train-sphere-basic-2', sphere('ball', 7.25, at(-5, 3, 2))),
    ],
  }),
  task({
    id: 'sphere-positioned',
    split: 'train',
    kind: 'model',
    publicSpec: model('public-sphere-positioned', sphere('orb', 2.5, at(8, 0, -1))),
    evaluationSpecs: [
      model('train-sphere-positioned-1', sphere('orb', 4.25, at(-3, -6, 2))),
      model('train-sphere-positioned-2', sphere('bearing', 1.75, at(2, 5, 7))),
    ],
  }),
  task({
    id: 'assembly-two-part',
    split: 'train',
    kind: 'assembly',
    publicSpec: assembly('public-assembly-two-part', [
      cube('base', 10),
      sphere('orb', 5, at(18, 0, 0)),
    ]),
    evaluationSpecs: [
      assembly('train-assembly-two-part-1', [
        cube('base', 8, at(1, 0, 0)),
        sphere('orb', 3, at(13, 0, 0)),
      ]),
      assembly('train-assembly-two-part-2', [
        cube('base', 5, at(-2, 1, 0)),
        sphere('orb', 2.5, at(7, 1, 0)),
      ]),
    ],
  }),
  task({
    id: 'assembly-renamed',
    split: 'train',
    kind: 'assembly',
    publicSpec: assembly('public-assembly-renamed', [
      cube('pedestal', 6, at(0, 0, 0)),
      sphere('marker', 2, at(0, 0, 8)),
    ]),
    evaluationSpecs: [
      assembly('train-assembly-renamed-1', [
        cube('foundation', 9, at(2, -1, 0)),
        sphere('locator', 2.25, at(2, -1, 9)),
      ]),
      assembly('train-assembly-renamed-2', [
        cube('plinth', 4, at(-3, 2, 1)),
        sphere('beacon', 1.5, at(-3, 8, 1)),
      ]),
    ],
  }),
  task({
    id: 'cube-parametric',
    split: 'val',
    kind: 'model',
    publicSpec: model('public-val-cube', cube('sample', 11, at(1, 2, 3))),
    evaluationSpecs: [
      model('val-cube-parametric-1', cube('sample', 6.75, at(-5, 4, -2))),
      model('val-cube-parametric-2', cube('voxel', 14, at(3, -7, 2))),
    ],
  }),
  task({
    id: 'sphere-parametric',
    split: 'val',
    kind: 'model',
    publicSpec: model('public-val-sphere', sphere('sample', 3.5, at(-1, 2, 4))),
    evaluationSpecs: [
      model('val-sphere-parametric-1', sphere('sample', 6.5, at(5, -3, 1))),
      model('val-sphere-parametric-2', sphere('globe', 2.2, at(-4, 6, -5))),
    ],
  }),
  task({
    id: 'assembly-clearance',
    split: 'val',
    kind: 'assembly',
    publicSpec: assembly('public-val-assembly-clearance', [
      cube('frame', 7),
      sphere('insert', 2, at(11, 0, 0)),
    ]),
    evaluationSpecs: [
      assembly('val-assembly-clearance-1', [
        cube('frame', 12, at(-1, 2, 0)),
        sphere('insert', 3, at(16, 2, 0)),
      ]),
      assembly('val-assembly-clearance-2', [
        cube('frame', 5.5, at(4, -2, 3)),
        // Tangent contact: distance is zero but intersection volume must stay zero.
        sphere('insert', 1.25, at(4, 2, 3)),
      ]),
    ],
  }),
  task({
    id: 'assembly-names',
    split: 'val',
    kind: 'assembly',
    publicSpec: assembly('public-val-assembly-names', [
      cube('anchor', 5, at(-4, 0, 0)),
      sphere('target', 2, at(4, 0, 0)),
    ]),
    evaluationSpecs: [
      assembly('val-assembly-names-1', [
        cube('datum', 7, at(0, -3, 1)),
        sphere('probe', 1.75, at(0, 5, 1)),
      ]),
      assembly('val-assembly-names-2', [
        cube('mount', 4.5, at(-6, 2, -1)),
        sphere('sensor', 2.5, at(3, 2, -1)),
      ]),
    ],
  }),
  task({
    id: 'cadtestbench-00003247',
    split: 'test',
    kind: 'model',
    publicSpec: model('public-test-box', box('prism', [0.5, 1.1, 0.4])),
    evaluationSpecs: [
      model('test-cadtestbench-00003247', box('prism', [0.3, 0.7, 0.3]), {
        source: {
          benchmark: 'CADTestBench',
          sampleId: '00003247',
          partition: 'detailed',
        },
      }),
    ],
  }),
  task({
    id: 'cube-held-out',
    split: 'test',
    kind: 'model',
    publicSpec: model('public-test-cube', cube('solid', 8, at(2, 1, -1))),
    evaluationSpecs: [
      model('test-cube-held-out-1', cube('solid', 13.5, at(-7, 3, 4))),
      model('test-cube-held-out-2', cube('calibration', 3.25, at(6, -5, 2))),
    ],
  }),
  task({
    id: 'sphere-held-out',
    split: 'test',
    kind: 'model',
    publicSpec: model('public-test-sphere', sphere('solid', 4, at(-2, 1, 3))),
    evaluationSpecs: [
      model('test-sphere-held-out-1', sphere('solid', 8.5, at(4, -6, 2))),
      model('test-sphere-held-out-2', sphere('calibration', 1.4, at(-7, 5, -3))),
    ],
  }),
  task({
    id: 'assembly-held-out',
    split: 'test',
    kind: 'assembly',
    publicSpec: assembly('public-test-assembly', [
      cube('base', 9),
      sphere('orb', 3, at(14, 0, 0)),
    ]),
    evaluationSpecs: [
      assembly('test-assembly-held-out-1', [
        cube('base', 6, at(-2, 0, 1)),
        sphere('orb', 2.75, at(8, 0, 1)),
      ]),
      assembly('test-assembly-held-out-2', [
        cube('base', 11, at(3, -2, 0)),
        sphere('orb', 3.5, at(3, 12, 0)),
      ]),
    ],
  }),
  task({
    id: 'assembly-renamed',
    split: 'test',
    kind: 'assembly',
    publicSpec: assembly('public-test-assembly-renamed', [
      cube('housing', 5, at(-4, 0, 0)),
      sphere('indicator', 1.5, at(3, 0, 0)),
    ]),
    evaluationSpecs: [
      assembly('test-assembly-renamed-1', [
        cube('chassis', 7.5, at(0, 4, -1)),
        sphere('fiducial', 2, at(0, -3, -1)),
      ]),
      assembly('test-assembly-renamed-2', [
        cube('fixture', 4, at(5, 1, 2)),
        sphere('reference', 1.25, at(-1, 1, 2)),
      ]),
    ],
  }),
  task({
    id: 'assembly-three-part',
    split: 'test',
    kind: 'assembly',
    publicSpec: assembly('public-test-assembly-three-part', [
      cube('base', 6, at(0, 0, 0)),
      sphere('orb', 2, at(9, 0, 0)),
      cube('cap', 4, at(17, 0, 0)),
    ]),
    evaluationSpecs: [
      assembly('test-assembly-three-part-1', [
        cube('pedestal', 8, at(-2, 1, 0)),
        sphere('marker', 2.5, at(10, 1, 0)),
        cube('stop', 3, at(18, 1, 0)),
      ]),
      assembly('test-assembly-three-part-2', [
        sphere('left', 1.75, at(-8, -2, 3)),
        cube('center', 5, at(0, -2, 3)),
        sphere('right', 2.25, at(8, -2, 3)),
      ]),
    ],
  }),
];

export const tasks = deepFreeze(taskCases);

export const splitIds = deepFreeze({
  train: tasks.filter((candidate) => candidate.split === 'train').map((candidate) => candidate.id),
  val: tasks.filter((candidate) => candidate.split === 'val').map((candidate) => candidate.id),
  test: tasks.filter((candidate) => candidate.split === 'test').map((candidate) => candidate.id),
});

export const taskManifest = deepFreeze(tasks.map((candidate) => ({
  id: candidate.id,
  split: candidate.split,
  kind: candidate.payload.kind,
  publicSpec: candidate.payload.publicSpec,
  evaluationSpecs: candidate.payload.evaluationSpecs,
})));

export const splitOverride = splitIds;
