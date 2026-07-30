import { compareSync, hashSync } from "bcryptjs";

export function hashPassword(password: string): string {
  return hashSync(password, 12);
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    return compareSync(password, stored);
  } catch {
    return false;
  }
}
