# Planning source test operations

The source-test tools are local/read-only. They normalize official responses in memory and never write to Supabase.

## One source

Use `npm run planning:test-source -- -- --adapter ...` with the provider, official endpoint, bounded lookback, page cap, and optional details. The extra `--` is retained for Windows/npm compatibility.

The command prints safe normalized records and can add opportunity scoring. Endpoint query secrets and configured sensitive headers are redacted from output and failures.

## Evidenced source batch

Use:

```text
npm run planning:test-coverage -- -- --county staffordshire --lookback-days 7 --max-pages 10 --enrich-details false --json
```

Omit `--county` to test all evidenced executable official sources. The runner:

- allows at most two source tests globally;
- allows one active test per hostname;
- caps lookback at 31 days and pages at 25;
- defaults detail enrichment off for the national batch;
- isolates individual failures and returns a non-zero exit code if any source fails;
- excludes known blocked and unclassified official routes;
- does not test 337 PlanIt fallbacks in a burst.

## Coverage inventory

`npm run planning:generate-coverage` refreshes `planning-authority-coverage.md` and its JSON companion from the public Planning Data LPA registry plus the evidenced source catalogue. The snapshot distinguishes geographic fallback coverage from official-source coverage.

Do not run the batch against production from a scheduler, do not place secrets in endpoints, and do not infer source activation from a local pass.
