import { beforeEach, describe, expect, it, vi } from "vitest";
import { assets, players, positions, races, snapshots } from "@db/schema";
import { RESET_CONFIRMATION } from "@/lib/resetConfirmation";

const mocks = vi.hoisted(() => {
  const deleteRows = vi.fn(async (table: unknown) => {
    void table;
  });
  const values = vi.fn(async () => undefined);
  const insert = vi.fn((table: unknown) => {
    void table;
    return { values };
  });
  const transaction = vi.fn(async (callback: (tx: {
    delete: typeof deleteRows;
    insert: typeof insert;
  }) => Promise<void>) => callback({ delete: deleteRows, insert }));
  return { deleteRows, values, insert, transaction };
});

vi.mock("@/lib/db", () => ({
  getDb: () => ({ transaction: mocks.transaction }),
}));

import { POST } from "@/app/api/admin/reset/route";

function request(confirmation: unknown, password: unknown): Request {
  return new Request("http://localhost/api/admin/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation, password }),
  });
}

describe("admin game reset route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_PASSWORD = "admin-secret";
  });

  it("rejects an incorrect confirmation without touching the database", async () => {
    const response = await POST(request("almost", "admin-secret"));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an incorrect password without touching the database", async () => {
    const response = await POST(request(RESET_CONFIRMATION, "wrong"));
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("clears all game tables and creates a fresh race in one transaction", async () => {
    const response = await POST(request(RESET_CONFIRMATION, "admin-secret"));
    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.deleteRows.mock.calls.map(([table]) => table)).toEqual([
      snapshots,
      positions,
      players,
      assets,
      races,
    ]);
    expect(mocks.insert).toHaveBeenCalledWith(races);
    expect(mocks.values).toHaveBeenCalledWith({ id: 1 });
  });
});
