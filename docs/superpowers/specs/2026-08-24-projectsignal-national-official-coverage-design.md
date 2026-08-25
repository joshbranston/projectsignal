# ProjectSignal national official planning coverage design

## Objective

Classify all 337 ProjectSignal planning-authority entities with zero unexplained entries, maximize safely verified official-source readiness, and retain PlanIt for every blocked, unsupported, or not-yet-activated authority.

## Chosen approach

Use a reproducible hybrid classification pipeline rather than 318 unrelated manual searches:

1. Planning Data remains the authority identity source. Its `local-authority` records provide council websites and mappings to the 337 LPA references.
2. The current nationwide PlanNexus coverage index is a discovery hint for platform family and original portal URL. It is never a runtime ProjectSignal dependency.
3. Every discovered portal is independently requested with ordinary Node 22 HTTPS. Response URL, transport result, status, content type, HTML/asset/path signatures, and investigation date become evidence.
4. Official council-page links from GDS historical local-service data and current redirects provide an additional provenance clue where available.
5. Existing adapters are tested before new code. A source becomes `OFFICIAL_READY` only after a complete bounded application search succeeds. Merely identifying an adapter family is not enough.
6. New adapters are platform-level and accepted only with bounded incremental search, proven completeness, understood pagination, safe detail navigation, and no security bypass.

Manual web research is reserved for unmatched authorities and ambiguous platform signatures. Blanket unsupported classification without evidence is prohibited.

## Canonical model

Each authority classification records:

- authority slug and Planning Data identity;
- official council page;
- official planning portal URL;
- platform and adapter/provider when supported;
- exact classification taxonomy;
- safe evidence and blocker text;
- last investigated date;
- local verification state and record count when tested;
- active PlanIt fallback.

Exact terminal classifications are `OFFICIAL_LIVE`, `OFFICIAL_READY`, the six blocked categories, `OFFICIAL_UNSUPPORTED`, and `UNCLASSIFIED`. Generated coverage fails when duplicate authority entries, unsafe portal protocols, missing evidence, or unexplained authorities remain.

Legacy LPA entities retained in the 337 baseline but replaced by current unitary authorities are classified `OFFICIAL_UNSUPPORTED` with the successor authority named. They remain in the matrix because ProjectSignal's customer mapping deliberately retains all 337 entities.

## Discovery and verification flow

```text
Planning Data LPA registry
        +
Planning Data local-authority websites
        +
nationwide platform/portal discovery hints
        ↓
same-origin HTTPS portal probe
        ↓
signature classifier
        ↓
existing adapter candidate / unsupported family / transport blocker
        ↓
bounded 7-day source run for supported candidates
        ↓
OFFICIAL_READY or explicit fail-closed classification
```

Discovery requests use global concurrency 2, per-host concurrency 1, bounded timeouts, limited transient retries, and no documents or attachments. Redirects and any bootstrap/API destinations are validated before use.

## Adapter policy

Reuse Idox, MasterGov, ASSURE, StatMap, Agile, and CSV first. Detail enrichment is disabled during mass classification. Deep verification uses default detail concurrency 4 and maximum 5 only for sources that pass base search.

Platform identification alone does not justify promotion. Unknown, obsolete, unbounded, WAF-protected, invalid-TLS, plaintext-only, or incomplete portals keep PlanIt and receive the matching terminal classification.

## Generated artifacts

The static catalogue is source-controlled and contains all 337 terminal classifications. Generation produces the Markdown and JSON authority/county matrices. The batch runner selects only live/ready entries and never automatically executes blocked or unsupported portals.

## Security

- HTTPS only; certificate verification always enabled.
- No WAF/CAPTCHA bypass, proxying, fingerprint rotation, or browser-dependent production path.
- No attachments, drawings, PDFs, or document tabs.
- Safe diagnostics only: operation, hostname, status, nested transport code, and response class.
- No cookies, CSRF tokens, request credentials, query secrets, or full bodies in generated evidence.
- Bounded pagination, detail concurrency, redirects, response size, and retry count.

## Verification

Fixture tests cover taxonomy validation, discovery parsing, platform signatures, zero-unclassified enforcement, batch selection, pagination/completeness, redirect safety and redaction. Live verification is read-only and documented separately. Final gates are `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
