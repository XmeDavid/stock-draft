import { verifyToken } from "@/lib/session";

export const PLAYER_COOKIE = "race_player";

export function playerIdFromCookie(cookieValue: string | undefined): number | null {
  const payload = verifyToken<{ playerId?: unknown }>(cookieValue, process.env.SESSION_SECRET ?? "");
  return typeof payload?.playerId === "number" ? payload.playerId : null;
}
