import { buildEnglandAuthorityCountyMappings } from "../territory/england-authority-counties.ts";

const EXPECTED_FIRST_ENTITY = 626001;
const EXPECTED_LAST_ENTITY = 626337;
const EXPECTED_AUTHORITY_COUNT = EXPECTED_LAST_ENTITY - EXPECTED_FIRST_ENTITY + 1;

const PILOT_SLUGS: Readonly<Record<number, string>> = {
  626034: "wigan",
  626081: "erewash",
  626084: "south-derbyshire",
  626086: "charnwood",
  626088: "hinckley-bosworth",
  626090: "north-west-leicestershire",
  626118: "east-staffordshire"
};

export type EnglandAuthorityRegistryRow = {
  entity: number;
  name: string;
  reference: string | null;
  slug: string;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
};

export type RegistrySyncResult = {
  authoritiesFetched: number;
  authoritiesActive: number;
  authoritiesInserted: number;
  authoritiesUpdated: number;
  mappingsWritten: number;
};

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Planning Data authority must be an object");
  }
  return input as Record<string, unknown>;
}

function optionalText(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function slugifyAuthorityName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function buildPlanningDataAuthorityUrl() {
  const url = new URL("https://www.planning.data.gov.uk/entity.json");
  url.searchParams.set("dataset", "local-planning-authority");
  url.searchParams.set("limit", "500");
  for (const field of ["entity", "name", "reference", "start-date", "end-date"]) {
    url.searchParams.append("field", field);
  }
  return url.toString();
}

export function normalisePlanningDataAuthority(
  input: unknown,
  today = new Date()
): EnglandAuthorityRegistryRow {
  const record = asRecord(input);
  const entity = Number(record.entity);
  if (!Number.isInteger(entity)) throw new Error("Planning Data authority entity must be an integer");

  const rawName = optionalText(record.name);
  if (!rawName) throw new Error(`Planning Data authority ${entity} is missing a name`);

  const name = rawName.replace(/\s+LPA$/i, "").trim();
  const reference = optionalText(record.reference);
  const startDate = optionalText(record["start-date"]);
  const endDate = optionalText(record["end-date"]);
  const slug = PILOT_SLUGS[entity] ?? slugifyAuthorityName(name);
  const active = !endDate || endDate >= dateOnly(today);

  return {
    entity,
    name,
    reference,
    slug,
    startDate,
    endDate,
    active
  };
}

export function validateEnglandAuthorityRegistry(rows: Array<{ entity: number }>) {
  if (rows.length !== EXPECTED_AUTHORITY_COUNT) {
    throw new Error(`Expected ${EXPECTED_AUTHORITY_COUNT} England LPAs, received ${rows.length}`);
  }

  const entities = rows.map((row) => row.entity);
  const unique = new Set(entities);
  if (unique.size !== rows.length) {
    throw new Error("Planning Data LPA response contains duplicate entity IDs; expected unique authorities");
  }

  for (let entity = EXPECTED_FIRST_ENTITY; entity <= EXPECTED_LAST_ENTITY; entity++) {
    if (!unique.has(entity)) {
      throw new Error(`Planning Data LPA response is missing expected entity ${entity}`);
    }
  }
}

export async function fetchEnglandAuthorityRegistry(
  fetchImpl: typeof fetch = fetch
): Promise<EnglandAuthorityRegistryRow[]> {
  const response = await fetchImpl(buildPlanningDataAuthorityUrl(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "ProjectSignal/0.4 (+https://projectsignal-tau.vercel.app)"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Planning Data LPA registry returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { count?: unknown; entities?: unknown };
  if (!Array.isArray(payload.entities)) {
    throw new Error("Planning Data LPA registry response is missing entities");
  }

  if (payload.count !== undefined && Number(payload.count) !== EXPECTED_AUTHORITY_COUNT) {
    throw new Error(
      `Planning Data LPA registry reported ${String(payload.count)} authorities; expected ${EXPECTED_AUTHORITY_COUNT}`
    );
  }

  const rows = payload.entities.map((item) => normalisePlanningDataAuthority(item));
  validateEnglandAuthorityRegistry(rows);
  return rows.sort((a, b) => a.entity - b.entity);
}

function numberFromRpc(data: unknown, key: string) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return 0;
  const value = Number((data as Record<string, unknown>)[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export async function syncEnglandAuthorityRegistry(
  admin: any,
  fetchImpl: typeof fetch = fetch
): Promise<RegistrySyncResult> {
  const authorities = await fetchEnglandAuthorityRegistry(fetchImpl);
  const mappings = buildEnglandAuthorityCountyMappings();

  const { data: registryData, error: registryError } = await admin.rpc(
    "sync_england_lpa_registry",
    { p_authorities: authorities }
  );
  if (registryError) throw registryError;

  const { data: mappingData, error: mappingError } = await admin.rpc(
    "sync_england_lpa_county_mappings",
    { p_mappings: mappings }
  );
  if (mappingError) throw mappingError;

  return {
    authoritiesFetched: authorities.length,
    authoritiesActive: authorities.filter((authority) => authority.active).length,
    authoritiesInserted: numberFromRpc(registryData, "inserted"),
    authoritiesUpdated: numberFromRpc(registryData, "updated"),
    mappingsWritten: numberFromRpc(mappingData, "mappingsWritten")
  };
}
