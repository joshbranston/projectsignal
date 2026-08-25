import { writeFile } from "node:fs/promises";
import { fetchEnglandAuthorityRegistry } from "../lib/planning/authority-registry.ts";
import { buildEnglandAuthorityCountyMappings } from "../lib/territory/england-authority-counties.ts";
import { EVIDENCED_OFFICIAL_PLANNING_SOURCES } from "../lib/planning/coverage-catalogue.ts";
import { buildPlanningCoverageInventory } from "../lib/planning/coverage.ts";
import {
  formatPlanningCoverageMarkdown,
  formatPlanningSourcePlatformsMarkdown,
  planningCoverageSnapshot
} from "../lib/planning/coverage-report.ts";

const authorities = await fetchEnglandAuthorityRegistry();
const inventory = buildPlanningCoverageInventory(
  authorities,
  buildEnglandAuthorityCountyMappings(),
  [...EVIDENCED_OFFICIAL_PLANNING_SOURCES]
);
const generatedAt = new Date();

await Promise.all([
  writeFile("docs/planning-authority-coverage.md", formatPlanningCoverageMarkdown(inventory, generatedAt)),
  writeFile("docs/planning-source-platforms.md", formatPlanningSourcePlatformsMarkdown(inventory, generatedAt)),
  writeFile(
    "docs/planning-authority-coverage.json",
    `${JSON.stringify(planningCoverageSnapshot(inventory, generatedAt), null, 2)}\n`
  )
]);

process.stdout.write(`Wrote planning coverage for ${inventory.length} authorities.\n`);
