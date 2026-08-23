import type {
  NormalisedPlanningApplication,
  PlanningApplicationField,
  PlanningSourceRecord
} from "../types.ts";

type CsvRow = Record<string, string>;

function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];

    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, "").trim());
  return rows
    .slice(1)
    .filter((values) => values.some((value) => value.trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function nullable(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function numeric(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function fieldValue(
  row: CsvRow,
  fields: Partial<Record<PlanningApplicationField, string>>,
  field: PlanningApplicationField
) {
  const sourceField = fields[field];
  return sourceField ? row[sourceField] : undefined;
}

export function mapCsvRow(
  source: PlanningSourceRecord,
  row: CsvRow
): NormalisedPlanningApplication | null {
  const fields = source.config?.fields ?? {};
  const externalReference = nullable(fieldValue(row, fields, "externalReference"));
  const proposal = nullable(fieldValue(row, fields, "proposal"));

  if (!externalReference || !proposal) return null;

  return {
    externalReference,
    address: nullable(fieldValue(row, fields, "address")),
    postcode: nullable(fieldValue(row, fields, "postcode")),
    latitude: numeric(fieldValue(row, fields, "latitude")),
    longitude: numeric(fieldValue(row, fields, "longitude")),
    proposal,
    applicationType: nullable(fieldValue(row, fields, "applicationType")),
    stage: nullable(fieldValue(row, fields, "stage")),
    submittedAt: nullable(fieldValue(row, fields, "submittedAt")),
    validatedAt: nullable(fieldValue(row, fields, "validatedAt")),
    decisionAt: nullable(fieldValue(row, fields, "decisionAt")),
    decision: nullable(fieldValue(row, fields, "decision")),
    applicantName: nullable(fieldValue(row, fields, "applicantName")),
    agentName: nullable(fieldValue(row, fields, "agentName")),
    agentContact: nullable(fieldValue(row, fields, "agentContact")),
    sourceUrl: nullable(fieldValue(row, fields, "sourceUrl")) ?? source.endpointUrl,
    rawPayload: row
  };
}

export async function fetchCsvApplications(
  source: PlanningSourceRecord
): Promise<NormalisedPlanningApplication[]> {
  const response = await fetch(source.endpointUrl, {
    headers: {
      "user-agent": "ProjectSignal/0.2 planning source scanner",
      ...(source.config?.requestHeaders ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`${source.councilName} planning feed returned ${response.status}`);
  }

  return parseCsv(await response.text())
    .map((row) => mapCsvRow(source, row))
    .filter((application): application is NormalisedPlanningApplication => application !== null);
}
