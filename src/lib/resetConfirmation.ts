export const RESET_CONFIRMATION = "RESET ALL GAME DATA";

export function isResetConfirmation(value: unknown): boolean {
  return value === RESET_CONFIRMATION;
}
