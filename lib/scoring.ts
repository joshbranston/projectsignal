const postcodePattern = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

export function extractPostcode(address: string) {
  const match = address.match(postcodePattern);
  return match ? match[1].toUpperCase().replace(/\s+/g, " ") : "";
}

const positiveRules: Array<[RegExp, number, string]> = [
  [/\bbi[- ]?fold/i, 3.5, "bifold doors"],
  [/\bglaz(?:e|ed|ing)\b/i, 3.0, "glazing"],
  [/\breplacement windows?\b/i, 3.5, "replacement windows"],
  [/\bwindows?\b/i, 2.4, "windows"],
  [/\bdoors?\b/i, 2.0, "doors"],
  [/\bshopfront\b/i, 2.4, "shopfront"],
  [/\bnew build\b|\bnew dwelling\b|\berection of (?:a |an )?dwelling\b/i, 2.8, "new dwelling"],
  [/\b\d+\s+(?:new\s+)?dwellings?\b|\bresidential development\b/i, 3.0, "multi-unit residential"],
  [/\btwo[- ]storey\b|\btwo storey\b/i, 1.7, "two-storey extension"],
  [/\bsingle[- ]storey\b|\bsingle storey\b/i, 1.1, "single-storey extension"],
  [/\brear extension\b|\bside extension\b|\bfront extension\b|\bextension\b/i, 1.5, "extension"],
  [/\bconversion\b/i, 0.9, "conversion"],
  [/\bconservatory\b|\borangery\b/i, 1.8, "conservatory/orangery"],
  [/\bdormer\b|\bloft conversion\b/i, 0.8, "loft/dormer"],
  [/\bdemolition\b.*\berection\b/i, 1.1, "redevelopment"]
];

const negativeRules: Array<[RegExp, number, string]> = [
  [/\btree works?\b|\bcanopy\b|\bcrown lift\b|\bsycamore\b|\boak\b/i, -5, "tree works"],
  [/\badvert(?:isement|ising)\b|\bsignage\b/i, -3, "advertising/signage"],
  [/\btelecom\b|\bantenna\b|\bmast\b/i, -4, "telecoms"],
  [/\bchange of use\b/i, -1.7, "change of use"],
  [/\bhouse in multiple occupation\b|\bHMO\b/i, -2.5, "HMO"],
  [/\bdischarge of conditions?\b|\bvariation of condition\b/i, -2.5, "conditions"]
];

function valueBand(text: string) {
  const t = text.toLowerCase();
  const multi = t.match(/\b(\d+)\s+(?:new\s+)?dwellings?\b/);
  if (multi) {
    const n = Number(multi[1]);
    if (n >= 10) return [50000, 250000] as const;
    if (n >= 3) return [25000, 100000] as const;
    return [15000, 50000] as const;
  }
  if (/new dwelling|new build|erection of (?:a )?dwelling/.test(t)) return [10000, 30000] as const;
  if (/two[- ]storey/.test(t)) return [8000, 25000] as const;
  if (/bifold|bi-fold|glazing|replacement windows/.test(t)) return [5000, 20000] as const;
  if (/single[- ]storey|extension/.test(t)) return [5000, 15000] as const;
  if (/conservatory|orangery/.test(t)) return [4000, 15000] as const;
  if (/shopfront/.test(t)) return [5000, 25000] as const;
  return [2000, 10000] as const;
}

export function scoreWindowsOpportunity(proposal: string, address = "", decision = "") {
  const text = `${proposal} ${address}`;
  let score = 1;
  const positives: string[] = [];
  const negatives: string[] = [];

  for (const [rule, points, tag] of positiveRules) {
    if (rule.test(text)) {
      score += points;
      positives.push(tag);
    }
  }

  for (const [rule, points, tag] of negativeRules) {
    if (rule.test(text)) {
      score += points;
      negatives.push(tag);
    }
  }

  const decisionText = decision.toLowerCase();
  let stage = "Live / awaiting decision";
  if (/grant|approve|permitted/.test(decisionText)) {
    stage = "Approved";
    score += 0.6;
  } else if (/refus/.test(decisionText)) {
    stage = "Refused";
    score -= 2;
  } else if (/withdraw/.test(decisionText)) {
    stage = "Withdrawn";
    score -= 2.5;
  } else {
    score += 0.9;
  }

  const unique = new Set(positives).size;
  if (unique >= 3) score += 0.8;
  if (unique >= 5) score += 0.5;

  score = Math.max(0, Math.min(10, Math.round(score * 10) / 10));
  const [minValue, maxValue] = valueBand(text);

  const reason = positives.length
    ? `Matches: ${Array.from(new Set(positives)).join(", ")}.${negatives.length ? ` Lowered by: ${Array.from(new Set(negatives)).join(", ")}.` : ""}`
    : "No strong glazing/project signal detected.";

  const priority = score >= 8.5 ? "HOT" : score >= 7 ? "HIGH" : score >= 5.5 ? "MEDIUM" : "LOW";
  const recommended =
    score >= 8.5
      ? "Research the applicant or agent and make contact as soon as possible."
      : score >= 7
        ? "Research the project and contact within 1–2 working days."
        : "Review before deciding whether to contact.";

  return {
    score,
    stage,
    priority,
    minValue,
    maxValue,
    reason,
    recommended,
    postcode: extractPostcode(address)
  };
}
