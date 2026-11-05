import { NextResponse } from "next/server";
import { mergerMappings } from "@/lib/mergerMap";
import { AlreadyAppliedError, CorporateActionError, parseEffectiveDate } from "@/lib/corporateActions";
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

/** A number, or "new:old" / "new/old" so a 1-for-30 reverse split can be typed exactly as "1:30". */
function readRatio(value: unknown, label: string): number {
  if (typeof value === "string") {
    const match = /^\s*([0-9]*\.?[0-9]+)\s*[:/]\s*([0-9]*\.?[0-9]+)\s*$/.exec(value);
    if (match) return readPositive(Number(match[1]) / Number(match[2]), label);
  }
  return readPositive(value, label);
}

function optionalEffectiveAt(value: unknown): number | undefined {
  const text = optionalText(value);
  if (text === undefined) return undefined;
  try {
    return parseEffectiveDate(text);
  } catch (error) {
    throw httpError((error as Error).message, 400);
  }
}

function optionalRequestId(value: unknown): string | undefined {
  const text = optionalText(value);
  if (text !== undefined && text.length > 100) throw httpError("requestId is too long", 400);
  return text;
}

function parseAction(body: unknown): AdminCorporateAction {
  if (!body || typeof body !== "object") throw httpError("Expected a corporate action", 400);
  const kind = (body as { kind?: unknown }).kind;
  const record = body as Record<string, unknown>;
  const meta = {
    requestId: optionalRequestId(record.requestId),
    effectiveAt: optionalEffectiveAt(record.effectiveDate),
  };
  switch (kind) {
    case "sync":
      return { kind: "sync" };
    case "split":
      return { kind: "split", symbol: readSymbol(record.symbol, "symbol"), ratio: readRatio(record.ratio, "ratio"), ...meta };
    case "cash":
      return {
        kind: "cash",
        symbol: readSymbol(record.symbol, "symbol"),
        cashPerShare: readPositive(record.cashPerShare, "cashPerShare"),
        ...meta,
      };
    case "rename":
      return {
        kind: "rename",
        symbol: readSymbol(record.symbol, "symbol"),
        toSymbol: readSymbol(record.toSymbol, "toSymbol"),
        name: optionalText(record.name),
        ...meta,
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
        ratio: readRatio(record.ratio, "ratio"),
        acquirerName: optionalText(record.acquirerName),
        quoteCurrency,
        ...meta,
      };
    }
    case "edit": {
      const positionId = record.positionId;
      if (typeof positionId !== "number" || !Number.isInteger(positionId) || positionId <= 0) {
        throw httpError("positionId must be a positive integer", 400);
      }
      const expectedRevision = record.expectedRevision;
      if (expectedRevision !== undefined && (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision))) {
        throw httpError("expectedRevision must be an integer", 400);
      }
      return {
        kind: "edit",
        positionId,
        quantity: optionalPositive(record.quantity, "quantity"),
        startPrice: optionalPositive(record.startPrice, "startPrice"),
        allocation: optionalPositive(record.allocation, "allocation"),
        requestId: meta.requestId,
        expectedRevision,
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
    // The fresh book comes back with the summary so the panel can never keep editing stale quantities.
    // A failed reload must not report the committed action as failed; the panel reloads instead.
    const book = await listCorporateActionBook().catch(() => null);
    return NextResponse.json({ ok: true, ...result, book });
  } catch (error) {
    const status = (error as { status?: number }).status
      ?? (error instanceof AlreadyAppliedError ? 409 : error instanceof CorporateActionError ? 400 : 500);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
