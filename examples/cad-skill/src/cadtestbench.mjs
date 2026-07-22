export {
  CADTESTBENCH_00003247_CADTESTS,
  CADTESTBENCH_00003247_CASE,
  CADTESTBENCH_00003247_SAMPLE,
  CADTESTBENCH_PROVENANCE,
} from './benchmark/cadtestbench-source.mjs';

export {
  AUTOIMPROVE_EXTENSION_CASES,
  CUBE_EXTENSION_CASE,
  NAMED_ASSEMBLY_EXTENSION_CASE,
  SPHERE_EXTENSION_CASE,
  createNamedAssemblyExtensionCase,
  createPrimitiveExtensionCase,
} from './benchmark/extensions.mjs';

export {
  CAD_ABSOLUTE_TOLERANCE,
  CAD_BREP_IOU_THRESHOLD,
  CAD_RELATIVE_TOLERANCE,
  aggregateCadEvaluations,
  benchmarkCaseForSpec,
  evaluateCadTask,
} from './benchmark/evaluator.mjs';
