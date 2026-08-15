"use client";

export function PrintButton() {
  return <button className="button secondary compact" type="button" onClick={() => window.print()}>Print / Save PDF</button>;
}
