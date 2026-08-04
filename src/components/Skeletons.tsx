function Pulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-200/80 dark:bg-gray-800/70 ${className}`} />;
}

/** Placeholder for the season area (banner, chart, leaderboard) while standings load. */
export function SeasonSkeleton() {
  return (
    <>
      <Pulse className="h-24 rounded-2xl" />
      <div>
        <Pulse className="h-[360px] w-full" />
        <div className="mt-2 flex gap-1.5">
          {[0, 1, 2, 3].map((i) => <Pulse key={i} className="h-6 w-20 rounded-full" />)}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="border-b border-gray-200 p-4 last:border-b-0 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <Pulse className="h-6 w-6" />
              <Pulse className="h-3 w-3 rounded-full" />
              <Pulse className="h-4 w-40" />
              <Pulse className="ml-auto h-4 w-24" />
              <Pulse className="h-4 w-16" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Full-page placeholder shown before the first draft payload arrives. */
export function PageSkeleton() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <header className="flex items-center justify-between rounded-2xl border border-white/70 bg-white/75 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-gray-950/65">
        <div className="space-y-2">
          <Pulse className="h-3 w-36" />
          <Pulse className="h-7 w-56" />
          <Pulse className="h-3 w-64" />
        </div>
        <div className="flex gap-3">
          <Pulse className="h-9 w-20" />
          <Pulse className="h-9 w-24" />
        </div>
      </header>
      <SeasonSkeleton />
    </main>
  );
}
