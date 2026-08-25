import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const settingsPage = readFileSync(
  new URL("../../app/dashboard/settings/page.tsx", import.meta.url),
  "utf8"
);

test("mobile dashboard shell can shrink without widening opportunity pages", () => {
  const start = css.indexOf("@media (max-width: 820px)");
  const end = css.indexOf("/* Customer opportunity manager */", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const mobileRules = css.slice(start, end);
  assert.match(
    mobileRules,
    /\.app-shell\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*\}/
  );
  assert.match(mobileRules, /\.sidebar,\s*\.main\s*\{\s*min-width:\s*0;\s*\}/);
  assert.match(mobileRules, /\.settings-grid\s*\{\s*grid-template-columns:\s*1fr;\s*\}/);
});

test("territory and billing grid uses the responsive stylesheet", () => {
  assert.match(settingsPage, /className="grid3 settings-grid"/);
  assert.doesNotMatch(settingsPage, /style=\{\{\s*gridTemplateColumns:/);
});
