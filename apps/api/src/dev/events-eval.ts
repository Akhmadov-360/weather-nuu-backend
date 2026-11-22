import { formatTable, runEvaluation } from "../modules/events/run-eval.js";

const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
for (const noise of [1, 2]) {
  console.log(`\nsynthetic series, ${seeds.length} seeds x 14 days, noise x${noise}`);
  console.log(formatTable(runEvaluation(seeds, 14, noise)));
}
