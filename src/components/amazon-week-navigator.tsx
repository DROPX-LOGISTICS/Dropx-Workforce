"use client";

import { useRouter } from "next/navigation";

export function AmazonWeekNavigator({
  selectedWeek,
  currentWeek,
  stations
}: {
  selectedWeek: number;
  currentWeek: number;
  stations: string;
}) {
  const router = useRouter();
  function openWeek(week: number) {
    const params = new URLSearchParams({ view: "sls", week: String(week) });
    if (stations) params.set("stations", stations);
    router.push(`/ops-pulse/performance?${params.toString()}`);
  }

  return (
    <div className="week-navigator">
      <button aria-label={`Previous week ${selectedWeek - 1}`} disabled={selectedWeek <= 1} onClick={() => openWeek(selectedWeek - 1)}>‹</button>
      <label>
        <span>AMAZON WEEK</span>
        <select key={selectedWeek} aria-label="Amazon week" value={selectedWeek} onChange={(event) => openWeek(Number(event.target.value))}>
          {Array.from({ length: currentWeek }, (_, index) => currentWeek - index).map((week) => <option key={week} value={week}>Week {week}</option>)}
        </select>
      </label>
      <button aria-label={`Next week ${selectedWeek + 1}`} disabled={selectedWeek >= currentWeek} onClick={() => openWeek(selectedWeek + 1)}>›</button>
    </div>
  );
}
