export type CountyCoverageStatus =
  | "live"
  | "partial"
  | "coming_soon"
  | "degraded";

export type CompanyCountyStatus =
  | "active"
  | "scheduled"
  | "ending"
  | "expired";

export interface CountyRecord {
  id: string;
  slug: string;
  name: string;
  nation: string;
  active: boolean;
}

export interface CompanyCountyRecord {
  id: string;
  company_id: string;
  county_id: string;
  status: CompanyCountyStatus;
  starts_at: string | null;
  ends_at: string | null;
  locked_until: string | null;
  county?: CountyRecord | null;
}
