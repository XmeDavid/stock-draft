import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * MVP picks stay secret until every player has locked one; then all are
 * revealed at once. Only drafted picks (with a pick index) count, so the
 * race-start cash row never does. `/api/draft` and the public standings both
 * use this, so the two can never disagree about the reveal moment.
 */
export function mvpRevealed(
  playerCount: number,
  positions: { isMvp: boolean; pickIndex: number | null }[],
): boolean {
  const locked = positions.filter((position) => position.pickIndex !== null && position.isMvp).length;
  return playerCount > 0 && locked === playerCount;
}

/** True when the request carries a valid admin session cookie. Admins always see MVP picks. */
export function isAdminRequest(req: { cookies: { get(name: string): { value: string } | undefined } }): boolean {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET ?? "");
}
