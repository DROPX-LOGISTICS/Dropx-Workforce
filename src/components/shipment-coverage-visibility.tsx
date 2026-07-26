"use client";

import { ReactNode, useEffect, useState } from "react";

const shipmentParsers = new Set(["delivered_shipment_detail", "inbound_shipment_detail"]);

export function ShipmentCoverageVisibility({ children, defaultVisible = false }: { children: ReactNode; defaultVisible?: boolean }) {
  const [visible, setVisible] = useState(defaultVisible);

  useEffect(() => {
    const handleSelection = (event: Event) => {
      const parserType = (event as CustomEvent<{ parserType?: string }>).detail?.parserType ?? "";
      setVisible(shipmentParsers.has(parserType));
    };
    window.addEventListener("report-import-source-change", handleSelection);
    return () => window.removeEventListener("report-import-source-change", handleSelection);
  }, []);

  return visible ? <>{children}</> : null;
}
