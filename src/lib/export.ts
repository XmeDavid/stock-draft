import * as XLSX from "xlsx";

export type ExportData = {
  currency: string;
  startingCapital: number;
  players: { name: string; strategy: string; currentValue: number; gainPct: number }[];
  history: { date: string; playerName: string; totalValue: number; stale: boolean }[];
  positions: { playerName: string; symbol: string; assetName: string; allocation: number; quantity: number; startPrice: number; isMvp?: boolean }[];
};

export function buildWorkbook(data: ExportData): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    data.players.map((p, i) => ({
      Rank: i + 1, Player: p.name, Strategy: p.strategy,
      [`Value (${data.currency})`]: p.currentValue, "Gain %": p.gainPct,
    }))), "Leaderboard");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    data.history.map((h) => ({
      Date: h.date, Player: h.playerName,
      [`Value (${data.currency})`]: h.totalValue, Stale: h.stale ? "yes" : "",
    }))), "History");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    data.positions.map((p) => ({
      Player: p.playerName, Symbol: p.symbol, Asset: p.assetName,
      MVP: p.isMvp ? "yes" : "",
      [`Allocation (${data.currency})`]: p.allocation, Quantity: p.quantity,
      [`Start price (${data.currency})`]: p.startPrice,
    }))), "Positions");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
