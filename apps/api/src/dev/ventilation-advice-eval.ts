import { evaluatePolicies, evaluateSensitivity, formatPolicies, formatSensitivity } from "../modules/ventilation/advice-eval.js";

/** The advice against the error of lambda_open and against "always open" and "never": pnpm --filter @weather/api ventilation:advice-eval */
console.log("Sensitivity to the error of lambda_open (true value 9.1 1/h), 99 situations of inside and outside dust\n");
console.log(formatSensitivity(evaluateSensitivity([-0.5, -0.2, 0.2, 0.5])));
console.log("\nOne simulated day, the lesson hours 13:30-17:50, true lambda_open known\n");
console.log(formatPolicies(evaluatePolicies()));
console.log("\nThe same, but the advice believes lambda_open = 4.5 (the value is half of the truth)\n");
console.log(formatPolicies(evaluatePolicies({ lambdaAssumed: 4.5 })));
