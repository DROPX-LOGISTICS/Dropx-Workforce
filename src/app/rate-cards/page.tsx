import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";

export default function RateCardsPage() {
  return (
    <AppShell active="Rate Cards">
      <PageHead
        eyebrow="Finance"
        title="Rate cards"
        subtitle="Versioned provider and station rates. Earnings lookup uses provider, station, metric, and work date."
        action={<button className="button">New rate card</button>}
      />

      <section className="panel">
        <div className="panel-head toolbar">
          <div>
            <h2>Active and draft rate cards</h2>
            <p className="subtle">A rate card can change mid-month; old daily earnings must continue using the rate effective on that work date.</p>
          </div>
          <div className="filters">
            <select className="select" defaultValue="all">
              <option value="all">All stations</option>
            </select>
            <button className="button secondary">Export</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Provider</th>
                <th>Station</th>
                <th>Effective From</th>
                <th>Pay Type</th>
                <th>Delivery</th>
                <th>Return</th>
                <th>MFN</th>
                <th>Fuel</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={10} className="empty-cell">No rate cards found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
