"use client";

import { useState } from "react";

function monthStart(value: string) { return `${value.slice(0, 8)}01`; }
function yearStart(value: string) { return `${value.slice(0, 4)}-01-01`; }
function weekStart(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((weekday + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function CapacityAssociateFilters({
  band,
  end,
  preset,
  start,
  station,
  stations,
  view,
}: {
  band: string;
  end: string;
  preset: string;
  start: string;
  station?: string;
  stations: string;
  view?: string;
}) {
  const [period, setPeriod] = useState(preset);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);

  function changePeriod(next: string) {
    setPeriod(next);
    if (next === "custom") return;
    const nextTo = to;
    setFrom(next === "yesterday" ? nextTo : next === "wtd" ? weekStart(nextTo) : next === "ytd" ? yearStart(nextTo) : monthStart(nextTo));
  }

  function changeTo(next: string) {
    setTo(next);
    if (period !== "custom") {
      setFrom(period === "yesterday" ? next : period === "wtd" ? weekStart(next) : period === "ytd" ? yearStart(next) : monthStart(next));
    }
  }

  return <form className="capacity-period-filter capacity-associate-filter" method="get">
    <input name="stations" type="hidden" value={stations}/>
    {station ? <input name="station" type="hidden" value={station}/> : null}
    {view ? <input name="view" type="hidden" value={view}/> : null}
    <label>SPR level<select name="band" defaultValue={band}><option value="all">All SPR levels</option><option value="low">Below target</option><option value="target">Target to safe</option><option value="high">Above safe</option></select></label>
    <label>Period<select name="preset" onChange={(event) => changePeriod(event.target.value)} value={period}><option value="yesterday">Yesterday</option><option value="wtd">Week to date</option><option value="mtd">Month to date</option><option value="ytd">Year to date</option><option value="custom">Custom</option></select></label>
    <label>From<input name="from" onChange={(event) => { setFrom(event.target.value); setPeriod("custom"); }} type="date" value={from}/></label>
    <label>To<input name="to" onChange={(event) => changeTo(event.target.value)} type="date" value={to}/></label>
    <button className="button compact">Apply</button>
  </form>;
}
