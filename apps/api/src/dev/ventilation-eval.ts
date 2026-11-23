import { evaluateEstimation, formatEstimateTable } from "../modules/ventilation/estimate-eval.js";

/** The table "recovered / true" for the estimation of λ (formula (3)): pnpm --filter @weather/api ventilation:eval */
const rows = evaluateEstimation({ lambdas: [2, 5, 9, 15], noises: [0.5, 1, 2], minutes: [10, 15, 30], runs: 200 });
console.log("Estimation of λ (1/h) on stretches by formula (3): C0 = 60, C_eq = 15 µg/m³, a reading every minute, 200 stretches per row\n");
console.log(formatEstimateTable(rows));
