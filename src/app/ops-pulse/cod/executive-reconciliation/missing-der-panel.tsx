"use client";

import { AssociateEntryBuilder, type AssociateOption } from "./associate-entry-builder";

export function MissingDerPanel({
  associates,
  businessDate,
  canEdit,
  driversReady = true,
  initiallyHiddenProviderIds = [],
  locationId,
  returnHref,
  stationCode,
  stationLabel
}: {
  associates: AssociateOption[];
  businessDate: string;
  canEdit: boolean;
  driversReady?: boolean;
  initiallyHiddenProviderIds?: string[];
  locationId: string;
  returnHref: string;
  stationCode: string;
  stationLabel: string;
}) {
  return (
    <details className="panel reconciliation-support-panel">
      <summary>
        Add associate missing from DER
        {!driversReady ? " (waiting for drivers…)" : ""}
      </summary>
      <div className="panel-body">
        {!driversReady ? (
          <p className="subtle">
            Locked until driver denominations finish loading. Use Refresh drivers if this stays pending.
          </p>
        ) : (
          <>
            <p className="subtle" style={{ marginBottom: 12 }}>
              Names from cash-recon that are not on the station DB list, including unmapped Amazon drivers
              (Driver ID only — type the employee name before save), plus <strong>Other</strong> for a fully manual associate.
            </p>
            <AssociateEntryBuilder
              associates={associates}
              businessDate={businessDate}
              canEdit={canEdit}
              initiallyHiddenProviderIds={initiallyHiddenProviderIds}
              locationId={locationId}
              returnHref={returnHref}
              stationCode={stationCode}
              stationLabel={stationLabel}
              emptyHint="No extra recon names for this station/date."
            />
          </>
        )}
      </div>
    </details>
  );
}
