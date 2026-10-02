export type ProviderObservation = {
  id: string;
  providerId: string;
  providerMemberId: string;
  providerName: string;
  sourceName: string;
  stationCode: string;
  firstSeen: string;
  lastSeen: string;
  dailyRows: number;
  deliveries: number;
  reason: string;
  suggestedWorkforceId?: string;
  suggestedDropxId?: string;
  suggestedName?: string;
};

export type ProviderPendency = ProviderObservation & { stationCodes: string[]; observationCount: number };

// These are provider identifiers, not a count of people. Preserve station history
// without counting the same client ID repeatedly or inferring a payroll identity.
export function groupProviderPendency(observations: ProviderObservation[]) {
  const grouped = new Map<string, ProviderPendency>();
  for (const row of [...observations].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))) {
    const member = row.providerMemberId.trim().toUpperCase();
    if (!member) continue;
    const key = `${row.providerId}:${member}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...row, id: key, providerMemberId: member, stationCodes: [row.stationCode], observationCount: 1 });
      continue;
    }
    existing.firstSeen = existing.firstSeen < row.firstSeen ? existing.firstSeen : row.firstSeen;
    existing.dailyRows += row.dailyRows;
    existing.deliveries += row.deliveries;
    existing.observationCount++;
    if (!existing.stationCodes.includes(row.stationCode)) existing.stationCodes.push(row.stationCode);
    // A cross-station observation is never sufficient to suggest a person's identity.
    existing.suggestedWorkforceId = undefined;
    existing.suggestedDropxId = undefined;
    existing.suggestedName = undefined;
  }
  return [...grouped.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.providerMemberId.localeCompare(b.providerMemberId));
}

export function recentProviderObservations(observations: ProviderObservation[], latestReportDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latestReportDate)) return [];
  const start = `${latestReportDate.slice(0, 7)}-01`;
  return observations.filter(row => row.lastSeen >= start && row.lastSeen <= latestReportDate);
}

export function clientIdPending(row: { providerMemberId: string; requiresProviderId?: boolean }) {
  return row.requiresProviderId !== false && !row.providerMemberId.trim();
}
