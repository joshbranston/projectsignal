export function configuredStripePriceId(value?: string) {
  const priceId = value?.trim();
  if (!priceId) throw new Error("Stripe price is not configured");
  return priceId;
}

export function billingDatabaseError(operation: string, error?: { message?: string } | null) {
  const value = new Error(error?.message || "Database request failed") as Error & { operation: string };
  value.name = "BillingDatabaseError";
  value.operation = operation;
  return value;
}

export function safeBillingDiagnostic(error: unknown) {
  if (!error || typeof error !== "object") {
    return { name: "UnknownBillingError", code: null, type: null };
  }
  const value = error as { name?: unknown; code?: unknown; type?: unknown; operation?: unknown };
  return {
    name: String(value.name || "BillingError"),
    code: value.code == null ? null : String(value.code),
    type: value.type == null ? null : String(value.type),
    ...(value.operation == null ? {} : { operation: String(value.operation) })
  };
}
