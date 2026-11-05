import { NextResponse } from "next/server";
import { mergerMappings } from "@/lib/mergerMap";
import {
  executeCorporateAction,
  listCorporateActionBook,
  type AdminCorporateAction,
} from "@/lib/applyCorporateActions";

export const dynamic = "force-dynamic";

function httpError(message: string, status: number): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = status;
  return error;
}

function readSymbol(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw httpError(`${label} is required`, 400);
  return value.trim().toUpperCase();
}

function readPositive(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || number <= 0) throw httpError(`${label} must be a positive number`, 400);
  return number;
}

function optionalPositive(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return readPositive(value, label);
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseAction(body: unknown): AdminCorporateAction {
  if (!body || typeof body !== "object") throw httpError("Expected a corporate action", 400);
  const kind = (body as { kind?: unknown }).kind;
  const record = body as Record<string, unknown>;
  switch (kind) {
    case "sync":
      return { kind: "sync" };
    case "split":
      return { kind: "split", symbol: readSymbol(record.symbol, "symbol"), ratio: readPositive(record.ratio, "ratio") };
    case "cash":
      return {
        kind: "cash",
        symbol: readSymbol(record.symbol, "symbol"),
        cashPerShare: readPositive(record.cashPerShare, "cashPerShare"),
      };
    case "rename":
      return {
        kind: "rename",
        symbol: readSymbol(record.symbol, "symbol"),
        toSymbol: readSymbol(record.toSymbol, "toSymbol"),
        name: optionalText(record.name),
      };
    case "stock": {
      const quoteCurrency = optionalText(record.quoteCurrency)?.toUpperCase();
      if (quoteCurrency && !/^[A-Z]{3}$/.test(quoteCurrency)) {
        throw httpError("quoteCurrency must be a 3-letter code", 400);
      }
      return {
        kind: "stock",
        symbol: readSymbol(record.symbol, "symbol"),
        acquirerSymbol: readSymbol(record.acquirerSymbol, "acquirerSymbol"),
        ratio: readPositive(record.ratio, "ratio"),
        acquirerName: optionalText(record.acquirerName),
        quoteCurrency,
      };
    }
    case "edit": {
      const positionId = record.positionId;
      if (typeof positionId !== "number" || !Number.isInteger(positionId) || positionId <= 0) {
        throw httpError("positionId must be a positive integer", 400);
      }
      return {
        kind: "edit",
        positionId,
        quantity: optionalPositive(record.quantity, "quantity"),
        startPrice: optionalPositive(record.startPrice, "startPrice"),
        allocation: optionalPositive(record.allocation, "allocation"),
      };
    }
    default:
      throw httpError("kind must be split, stock, cash, rename, edit, or sync", 400);
  }
}

export async function GET() {
  try {
    const book = await listCorporateActionBook();
    return NextResponse.json({ ...book, mappings: mergerMappings });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const action = parseAction(await req.json().catch(() => null));
    const result = await executeCorporateAction(action);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
