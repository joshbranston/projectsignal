import { runPlanningCoverageCli } from "../lib/planning/coverage-cli.ts";

process.exitCode = await runPlanningCoverageCli(process.argv.slice(2), {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value)
});

