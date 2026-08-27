const postcodePattern = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const multiDwellingPattern = /\b(\d+)\s*(?:no\.?\s*)?(?:\d+\s*[- ]?\s*bed(?:room)?\s+)?(?:new\s+)?dwellings?\b/i;

const hardExclusionRules: Array<[RegExp, string]> = [
  [
    /\b(?:discharge|approval) of conditions?\b|\bdetails pursuant to conditions?\b|\bnon[- ]material amendment\b|\bsection 73\b|\bvariation of conditions?\b/i,
    "administrative follow-on application"
  ],
  [
    /\badvert(?:isement|ising)\b|\bsignage\b|\billuminated (?:fascia )?sign\b|\bwindow manifestations?\b/i,
    "advertising/signage"
  ],
  [/\btree works?\b|\bcrown lift\b|\bsycamore\b|\boak\b|\btelecom\b|\bantenna\b|\bmast\b/i, "non-building works"]
];

export function extractPostcode(address: string) {
  const match = address.match(postcodePattern);
  return match ? match[1].toUpperCase().replace(/\s+/g, " ") : "";
}

const explicitGlazingRules: Array<[RegExp, number, string]> = [
  [/\bbi[- ]?fold/i, 3.5, "bifold doors"],
  [/\bglaz(?:e|ed|ing)\b/i, 3.0, "glazing"],
  [/\breplacement windows?\b/i, 3.5, "replacement windows"],
  [/\bwindows?\b/i, 2.4, "windows"],
  [/\bdoors?\b/i, 2.0, "doors"],
  [/\bshopfront\b/i, 2.4, "shopfront"]
];

// Planning descriptions often omit windows and doors even when the project
// will almost certainly require them. Only the strongest matching implied
// project signal is applied so overlapping phrases do not inflate the score.
const impliedProjectRules: Array<[RegExp, number, string]> = [
  [
    /\bfirst[- ]floor\b[\s\S]{0,100}\bextension\b|\bextension\b[\s\S]{0,100}\bfirst[- ]floor\b/i,
    5.5,
    "first-floor extension"
  ],
  [
    /\btwo[- ]storey\b[\s\S]{0,100}\bextension\b|\bextension\b[\s\S]{0,100}\btwo[- ]storey\b/i,
    5.5,
    "two-storey extension"
  ],
  [new RegExp(`${multiDwellingPattern.source}|\\bresidential development\\b`, "i"), 5.8, "multi-unit residential"],
  [/\breplacement dwelling\b/i, 5.8, "replacement dwelling"],
  [
    /\bnew build\b|\bnew dwelling\b|\berection of (?:a |an |one )?dwelling\b|\berection of (?:a |an )?(?:detached |semi-detached )?bungalow\b|\brural worker(?:s|['’]s|s['’])? dwelling\b/i,
    5.5,
    "new dwelling"
  ],
  [/\bconservatory\b|\borangery\b/i, 5.5, "conservatory/orangery"],
  [
    /\bconversion\b[\s\S]{0,80}\b(?:dwelling|residential)\b|\b(?:barn|garage|outbuilding)\s+conversion\b/i,
    5.5,
    "residential conversion"
  ],
  [
    /\bsingle[- ]storey\b[\s\S]{0,100}\bextension\b|\bextension\b[\s\S]{0,100}\bsingle[- ]storey\b/i,
    3.9,
    "single-storey extension"
  ],
  [/\b(?:rear|side|front)\s+extension\b/i, 3.9, "extension"],
  [/\bdormer\b|\bloft conversion\b/i, 3.9, "loft/dormer"],
  [/\bdemolition\b[\s\S]*\berection\b/i, 3.9, "redevelopment"],
  [/\bextension\b/i, 3.6, "extension"],
  [/\bconversion\b/i, 2.5, "conversion"]
];

const negativeRules: Array<[RegExp, number, string]> = [
  [/\btree works?\b|\bcanopy\b|\bcrown lift\b|\bsycamore\b|\boak\b/i, -5, "tree works"],
  [/\badvert(?:isement|ising)\b|\bsignage\b/i, -3, "advertising/signage"],
  [/\btelecom\b|\bantenna\b|\bmast\b/i, -4, "telecoms"],
  [/\bchange of use\b/i, -1.7, "change of use"],
  [/\bhouse in multiple occupation\b|\bHMO\b/i, -2.5, "HMO"],
  [/\bdischarge of conditions?\b|\bvariation of condition\b/i, -2.5, "conditions"],
  [/\boutline (?:planning )?application\b/i, -1.5, "outline stage"],
  [/\bscreening opinion\b/i, -2.5, "screening opinion"]
];

function valueBand(text: string) {
  const t = text.toLowerCase();
  const multi = t.match(multiDwellingPattern);
  if (multi) {
    const n = Number(multi[1]);
    if (n >= 10) return [50000, 250000] as const;
    if (n >= 3) return [25000, 100000] as const;
    return [15000, 50000] as const;
  }
  if (/replacement dwelling/.test(t)) return [15000, 40000] as const;
  if (/new dwelling|new build|erection of (?:a |an |one )?dwelling|erection of (?:a |an )?(?:detached |semi-detached )?bungalow|rural worker(?:s|['’]s|s['’])? dwelling/.test(t)) return [10000, 30000] as const;
  if (/first[- ]floor|two[- ]storey/.test(t)) return [8000, 25000] as const;
  if (/bifold|bi-fold|glazing|replacement windows/.test(t)) return [5000, 20000] as const;
  if (/\breplacement of (?:one |1 |a )?(?:front |rear |side |external )?door\b|\bsingle (?:front |rear |side |external )?door\b/.test(t)) return [1500, 5000] as const;
  if (/\b(?:replacement of )?(?:several|multiple|two|three|four|five|six|seven|eight|nine|ten|\d+) windows?\b/.test(t)) return [4000, 15000] as const;
  if (/single[- ]storey|rear extension|side extension|front extension|extension/.test(t)) return [5000, 15000] as const;
  if (/conservatory|orangery/.test(t)) return [8000, 25000] as const;
  if (/dormer|loft conversion/.test(t)) return [5000, 15000] as const;
  if (/conversion/.test(t)) return [5000, 20000] as const;
  if (/shopfront/.test(t)) return [5000, 25000] as const;
  return [2000, 10000] as const;
}

export function scoreWindowsOpportunity(proposal: string, address = "", decision = "") {
  const text = `${proposal} ${address}`;

  for (const [rule, reason] of hardExclusionRules) {
    if (rule.test(proposal)) {
      return {
        score: 0,
        stage: "Review not required",
        priority: "LOW",
        minValue: 0,
        maxValue: 0,
        reason: `Excluded: ${reason}.`,
        recommended: "Do not treat this record as a new sales opportunity.",
        postcode: extractPostcode(address)
      };
    }
  }

  if (
    /\bgarage\b/i.test(proposal) &&
    /\b(?:replacement garage|erection of (?:a |an )?(?:replacement )?garage)\b/i.test(proposal) &&
    !/\b(?:conversion|dwelling|extension|windows?|doors?|glaz(?:e|ed|ing))\b/i.test(proposal)
  ) {
    return {
      score: 0,
      stage: "Review not required",
      priority: "LOW",
      minValue: 0,
      maxValue: 0,
      reason: "Excluded: garage-only work.",
      recommended: "Do not treat this record as a fenestration opportunity.",
      postcode: extractPostcode(address)
    };
  }

  let score = 1;
  const positives: string[] = [];
  const negatives: string[] = [];

  for (const [rule, points, tag] of explicitGlazingRules) {
    if (rule.test(text)) {
      score += points;
      positives.push(tag);
    }
  }

  let impliedSignal: { points: number; tag: string } | null = null;
  for (const [rule, points, tag] of impliedProjectRules) {
    if (rule.test(text) && (!impliedSignal || points > impliedSignal.points)) {
      impliedSignal = { points, tag };
    }
  }

  if (impliedSignal) {
    score += impliedSignal.points;
    positives.push(impliedSignal.tag);
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
