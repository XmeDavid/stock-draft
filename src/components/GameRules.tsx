type GameRulesProps = {
  currency: string;
  picksPerPlayer: number;
  perPickAmount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function GameRules({
  currency,
  picksPerPlayer,
  perPickAmount,
  open,
  onOpenChange,
}: GameRulesProps) {
  const startingCapital = picksPerPlayer * perPickAmount;
  const money = (value: number) =>
    `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`;

  const steps = [
    {
      title: "Join the race",
      body: "Use the shared invite code to create your player account. The code only gets you in—you choose your own username and password.",
    },
    {
      title: "Draft your portfolio",
      body: `The order is randomized, then snakes back and forth. You make ${picksPerPlayer} picks worth ${money(perPickAmount)} each, for ${money(startingCapital)} of virtual starting capital.`,
    },
    {
      title: "Every pick is unique",
      body: "Choose stocks, ETFs, or crypto available through Yahoo Finance. Once a company or asset has been drafted, nobody else can take the same or an alternate listing.",
    },
    {
      title: "Back one MVP",
      body: "After the draft, privately choose one of your picks as MVP. Its profit or loss counts double, but that position can never score below zero.",
    },
    {
      title: "Hold until the finish",
      body: "Prices and quantities lock when the race starts. There is no trading or rebalancing; the leaderboard follows live quotes and records daily history.",
    },
    {
      title: "Highest value wins",
      body: "At the race deadline, one final snapshot is taken. The player with the highest total portfolio value—and therefore the best return—wins.",
    },
  ];

  return (
    <section id="rules" aria-label="Game rules" className="scroll-mt-4">
      <details
        open={open}
        onToggle={(event) => onOpenChange(event.currentTarget.open)}
        className="group overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-emerald-50 shadow-sm dark:border-indigo-900/70 dark:from-indigo-950/40 dark:via-gray-950 dark:to-emerald-950/30"
      >
        <summary className="flex cursor-pointer list-none items-center gap-4 p-4 marker:content-none sm:p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-xl text-white shadow-sm" aria-hidden="true">
            ♟
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
              New here?
            </span>
            <span className="mt-0.5 block text-lg font-black">How the game works</span>
            <span className="mt-1 hidden text-sm text-gray-600 dark:text-gray-300 sm:block">
              {picksPerPlayer} picks · snake draft · one double-scoring MVP · highest value wins
            </span>
          </span>
          <span className="rounded-full border border-indigo-200 bg-white/70 px-3 py-1.5 text-xs font-bold text-indigo-700 dark:border-indigo-800 dark:bg-gray-900/70 dark:text-indigo-300">
            {open ? "Hide rules" : "View rules"}
          </span>
          <span
            aria-hidden="true"
            className="text-xl text-indigo-500 transition-transform duration-200 group-open:rotate-180"
          >
            ⌄
          </span>
        </summary>

        <div className="space-y-5 border-t border-indigo-100 p-4 dark:border-indigo-900/70 sm:p-6">
          <p className="max-w-2xl text-sm text-gray-600 dark:text-gray-300">
            Build a virtual buy-and-hold portfolio, follow it through the race, and finish ahead of your friends.
          </p>

          <ol className="grid gap-3 sm:grid-cols-2">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="flex gap-3 rounded-xl border border-white/80 bg-white/80 p-4 dark:border-white/10 dark:bg-gray-900/75"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-black text-white">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-bold">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <p className="rounded-xl bg-gray-900 px-4 py-3 text-sm text-gray-200">
            This is a game using virtual money—no real trades are placed, and nothing here is investment advice.
          </p>
        </div>
      </details>
    </section>
  );
}
