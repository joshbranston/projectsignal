# Bounded planning source verification — 24 August 2026

All checks used 17–24 August 2026, maximum 10 pages, global concurrency 2, per-host concurrency 1, and no database writes. Discovery probes and adapter tests used verified HTTPS only.

## Executable catalogue batch

| Authority | Platform | Applications | Result |
| --- | --- | ---: | --- |
| Wigan | CSV/open data | 0 | Pass |
| Leicester | DEF/MasterGov | 24 | Pass |
| Blaby | Idox | 0 | Fail — summary-page timeout; one targeted retry also timed out |
| Charnwood | NEC ASSURE | 6 | Pass |
| Peak District National Park | NEC ASSURE | 29 | Pass |
| Lichfield | Idox | 17 | Pass |
| South Staffordshire | Idox | 8 | Pass |
| Cannock Chase | Agile Applications | 9 | Pass |
| East Staffordshire | StatMap HorizoNext | 5 | Pass |
| Rugby | Agile Applications | 20 | Pass |
| Peterborough | Agile Applications | 2 | Pass |
| Hammersmith and Fulham | NEC ASSURE | 36 | Pass |
| Islington | Agile Applications | 53 | Pass |
| Slough | Agile Applications | 32 | Pass |
| Mole Valley | StatMap HorizoNext | 7 | Pass |
| Lake District National Park | Agile Applications | 43 | Pass |
| New Forest National Park | Agile Applications | 35 | Pass |
| Yorkshire Dales National Park | Agile Applications | 26 | Pass |

Result: 18 sources tested, 17 passed and 1 isolated runtime timeout. Blaby remains production-proven `OFFICIAL_LIVE`; the current local result is retained as a runtime warning rather than silently discarded.

## Newly discovered supported-family verification

The classification pass tested 30 additional ASSURE, MasterGov, StatMap, and Agile candidates: 18 passed their base protocol and 12 failed closed on incompatible templates. Eleven non-empty passes were re-run with detail enrichment; all 11 base searches passed, but OPDC returned only a durable base record and no successful detail merge, so it remains incomplete. New Forest District resolved to the New Forest National Park client key and was rejected by the authority-identity check.

Nine additional sources met the complete-search, visible-reference, first-party ownership, and partial-or-complete detail-enrichment requirements and are recorded as `OFFICIAL_READY`. Zero-result protocol passes remain `OFFICIAL_BLOCKED_INCOMPLETE` because application normalization could not be proved.

No documents, drawings, PDFs, or attachments were requested by an adapter.
