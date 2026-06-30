// Shared test helpers: endpoints + full state isolation between runs.
//
// The root cause of the flaky suite was that adaptive health (Redis) and breaker
// state (in-memory in the engine) leak across runs, so routing stops being
// deterministic. Every script now calls resetAll() first to start from a clean
// slate, and asserts on PROPERTIES (e.g. "exactly one charge across all gateways")
// instead of a hard-coded gateway that adaptive routing is free to move off.

export const ENGINE = "http://localhost:3000";
export const A = "http://localhost:4001";
export const B = "http://localhost:4002";
export const C = "http://localhost:4003";
const MOCKS = [A, B, C];

export const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// Clear EVERYTHING that persists between runs: each mock's counters + behavior,
// the engine's Redis health counters, and the engine's in-memory breaker state.
export async function resetAll(): Promise<void> {
  await Promise.all(MOCKS.map((m) => post(`${m}/admin/reset`)));
  await post(`${ENGINE}/admin/health/reset`);
  await post(`${ENGINE}/admin/breakers/reset`);
}

export const statsOf = async (mockBase: string) =>
  (await fetch(`${mockBase}/admin/stats`)).json();

// Total real charges executed across ALL gateways — the routing-agnostic way to
// assert "exactly one charge happened", no matter which gateway handled it.
export async function totalChargesAcross(...mockBases: string[]): Promise<number> {
  const all = await Promise.all(mockBases.map(statsOf));
  return all.reduce((sum, s) => sum + (s.totalCharges ?? 0), 0);
}
