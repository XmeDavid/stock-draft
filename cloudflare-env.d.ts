declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ADMIN_PASSWORD?: string;
    SESSION_SECRET?: string;
    SNAPSHOT_HOUR?: string;
  }
}
