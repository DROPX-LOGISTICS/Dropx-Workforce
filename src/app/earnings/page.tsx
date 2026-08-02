import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";

export default async function EarningsPage() {
  await requirePagePermission("earnings", "access");
  return (
    <AppShell active="Earnings Review" pageCode="earnings">
      <PageHead
        eyebrow="Payroll preparation"
        title="Month-to-date earnings review"
        subtitle="Every salary figure is built from provider daily counts, date-effective mapping, rate cards, holds, and approved adjustments."
        action={<button className="button">Generate salary report</button>}
      />

      <section className="grid two">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Payroll close checklist</h2>
              <p className="subtle">Finance should lock salary only after these checks are green.</p>
            </div>
          </div>
          <div className="panel-body calculation">
            <div className="calc-row"><span>All report rows mapped</span><strong>0 pending</strong></div>
            <div className="calc-row"><span>All rate cards approved</span><strong>0 pending</strong></div>
            <div className="calc-row"><span>Corrections approved</span><strong>0 pending</strong></div>
            <div className="calc-row"><span>Payout holds cleared or excluded</span><strong>0 holds</strong></div>
            <div className="calc-row total"><span>Current status</span><span>No payroll data</span></div>
          </div>
        </div>

        <aside className="panel">
          <div className="panel-head"><h2>DA app earning view</h2></div>
          <div className="panel-body calculation">
            <div className="calc-row"><span>Today</span><strong>after latest import</strong></div>
            <div className="calc-row"><span>Month-to-date</span><strong>estimated until locked</strong></div>
            <div className="calc-row"><span>Provider IDs used</span><strong>shown for trust</strong></div>
            <div className="calc-row"><span>Disputes</span><strong>date/provider line based</strong></div>
            <div className="calc-row total"><span>Final salary</span><span>visible after payroll close</span></div>
          </div>
        </aside>
      </section>

      <section className="panel">
        <div className="panel-head toolbar">
          <div>
            <h2>Salary review table</h2>
            <p className="subtle">Gross can calculate even when net payout is held. Holds must be resolved or excluded before export.</p>
          </div>
          <div className="filters">
            <input className="field" type="date" defaultValue="2026-06-01" />
            <input className="field" type="date" defaultValue="2026-06-15" />
            <button className="button secondary">Refresh</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>DropX ID</th>
                <th>Name</th>
                <th>Station</th>
                <th>Provider IDs Used</th>
                <th>Delivery</th>
                <th>Returns</th>
                <th>MFN</th>
                <th>Gross</th>
                <th>Net</th>
                <th>Hold</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={11} className="empty-cell">No salary review data found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Line-level earning trace</h2>
            <p className="subtle">This trace is what a manager/admin opens when a DA disputes a daily earning.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Work date</th><th>Provider ID</th><th>Paid DropX ID</th><th>Delivered</th><th>Rate</th><th>Payable</th></tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={6} className="empty-cell">No earning trace rows found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
