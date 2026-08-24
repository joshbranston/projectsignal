import { runPlanningSourceTestCli } from "../lib/planning/source-test-cli.ts";

process.exitCode = await runPlanningSourceTestCli(process.argv.slice(2), {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value)
});
