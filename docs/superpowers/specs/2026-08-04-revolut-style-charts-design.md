# Revolut-style charts

## Goal

Replace the default-looking recharts styling on the two progress charts with a minimal, Revolut-inspired look, and add hover/expand highlighting plus sorted list tooltips.

## Approach

Restyle the existing recharts components directly. No shadcn install — shadcn charts are recharts underneath, and the project has none of its infrastructure. Zero new dependencies.

## Components

### `StandingsSection` (new, client)

Wraps `Chart` + `Leaderboard` on the home page. Holds highlight state:

- `openId` — player whose leaderboard row is expanded (reported by `Leaderboard` via new optional `onOpenChange` prop).
- `hoverId` — player whose line/legend chip is hovered in the chart.
- Effective highlight passed to `Chart` is `hoverId ?? openId`.

`page.tsx` swaps `<Chart /><Leaderboard />` for `<StandingsSection />`.

### `Chart` (main progress chart)

Revolut treatment:

- Smooth lines, no dots, no gridlines, no axis lines or tick lines. Sparse muted date labels on X; a few compact-notation value labels on Y. Dashed starting-capital reference line, very faint.
- Highlighted player: 3px line + soft vertical gradient area fill under it in the player's color (fades to transparent). All other lines fade to ~25% opacity. No highlight → all lines normal.
- Hovering a line highlights it (widened invisible hit area if needed); default recharts `Legend` replaced with a compact row of colored chips — hovering a chip highlights that player.
- Custom tooltip: rounded glassy dark card. Date header, then **all players sorted by portfolio value desc**: color dot, name, value. Highlighted player's row emphasized.

### `ProfileChart` (per-player pick performance)

Same treatment, self-contained hover state:

- `Total` gets the bold-line + gradient fill in the player's color; pick lines thin, hover-highlightable.
- Custom tooltip lists positions **sorted by return desc**, same card styling.
- Stripped axes as above; keep the 0% reference line, faint.

### `Leaderboard`

Adds optional `onOpenChange?: (id: number | null) => void`, called whenever the expanded row changes. No other changes.

## Error handling

Unchanged: charts render nothing / placeholder text when history is empty. Tooltip handles null/missing values (gaps in history) by skipping them in the sorted list.

## Testing

No existing component tests. Verify visually via dev server: hover lines and chips, expand leaderboard rows, check tooltips sort correctly, check light and dark mode.
