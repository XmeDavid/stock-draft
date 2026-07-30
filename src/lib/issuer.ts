export type IssuerAsset = {
  symbol: string;
  name: string;
  type: string;
};

const NON_DISTINGUISHING_WORDS = new Set([
  "ADR",
  "ADS",
  "AG",
  "BDR",
  "CO",
  "COMPANY",
  "CORP",
  "CORPORATION",
  "GDR",
  "HOLDING",
  "HOLDINGS",
  "INC",
  "INCORPORATED",
  "LIMITED",
  "LLC",
  "LTD",
  "NV",
  "PLC",
  "SA",
  "SE",
  "SPA",
]);

function normalizedIssuerName(name: string): string {
  const withoutSecurityLabels = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\bN\.?\s*V\.?\b/g, " ")
    .replace(/\bS\.?\s*A\.?\b/g, " ")
    .replace(/\bS\.?\s*E\.?\b/g, " ")
    .replace(/\bS\.?\s*P\.?\s*A\.?\b/g, " ")
    .replace(/\bCLASS\s+[A-Z0-9]+\b/g, " ")
    .replace(/\b(ORDINARY|COMMON)\s+(SHARES?|STOCK)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ");

  return withoutSecurityLabels
    .trim()
    .split(/\s+/)
    .filter((word) => !NON_DISTINGUISHING_WORDS.has(word))
    .join("-");
}

/**
 * Casual draft identity: equity listings and share classes from the same issuer
 * share a key. Funds, crypto, and other products remain distinct by ticker.
 */
export function issuerKey(asset: IssuerAsset): string {
  const symbol = asset.symbol.trim().toUpperCase();
  if (asset.type.toLowerCase() !== "equity") return `listing:${symbol}`;
  const normalizedName = normalizedIssuerName(asset.name);
  return `issuer:${normalizedName || symbol.split(".")[0]}`;
}

export function findDraftedIssuer<T extends IssuerAsset>(
  candidate: IssuerAsset,
  drafted: T[],
): T | undefined {
  const candidateKey = issuerKey(candidate);
  return drafted.find((asset) => issuerKey(asset) === candidateKey);
}
