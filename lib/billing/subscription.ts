export function getSubscriptionCurrentPeriodEnd(subscription: unknown) {
  if (!subscription || typeof subscription !== "object") return null;

  const root = subscription as {
    current_period_end?: unknown;
    items?: { data?: Array<{ current_period_end?: unknown }> };
  };

  if (typeof root.current_period_end === "number") {
    return root.current_period_end;
  }

  const itemPeriodEnd = root.items?.data?.[0]?.current_period_end;
  return typeof itemPeriodEnd === "number" ? itemPeriodEnd : null;
}

export function stripeUnixToIso(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}
