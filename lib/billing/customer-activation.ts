type SupabaseResult<T> = PromiseLike<{ data: T | null; error: { message?: string } | null }>;

type AdminClient = {
  rpc(name: string, args: Record<string, unknown>): SupabaseResult<unknown>;
};

export type InitialCustomerAccessInput = {
  companyId: string;
  effectiveAt: string;
  lockedUntil: string | null;
  stripeEventId: string | null;
};

function databaseError(operation: string, error: { message?: string } | null) {
  return new Error(`${operation}: ${error?.message || "database request failed"}`);
}

export async function activateInitialCustomerAccess(
  admin: AdminClient,
  input: InitialCustomerAccessInput
) {
  const activation = await admin.rpc("activate_initial_customer_access", {
    p_company_id: input.companyId,
    p_effective_at: input.effectiveAt,
    p_locked_until: input.lockedUntil,
    p_stripe_event_id: input.stripeEventId
  });

  if (activation.error) {
    throw databaseError("Could not activate and backfill customer access", activation.error);
  }
  const data = activation.data && typeof activation.data === "object"
    ? activation.data as { activatedCounties?: unknown; backfilledOpportunities?: unknown }
    : {};

  return {
    activatedCounties: Number(data.activatedCounties ?? 0),
    backfilledOpportunities: Number(data.backfilledOpportunities ?? 0)
  };
}
