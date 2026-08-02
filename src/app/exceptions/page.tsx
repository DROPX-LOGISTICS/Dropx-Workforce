import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";

export default async function ExceptionsPage() {
  await requirePagePermission("exceptions", "access");
  return (
    <AppShell active="Exceptions" pageCode="exceptions">
      <PageHead
        eyebrow="Controls"
        title="Exception queue"
        subtitle="Every exception must either become a valid earning line, a payout hold, or an approved adjustment before payroll approval."
        action={<button className="button warning">Escalate selected</button>}
      />

      <section className="panel">
        <div className="panel-head toolbar">
          <div>
            <h2>Open exceptions</h2>
            <p className="subtle">Managers handle station issues; Admin handles finance and correction approval.</p>
          </div>
          <div className="filters">
            <select className="select" defaultValue="all">
              <option value="all">All owners</option>
              <option value="Manager">Manager</option>
              <option value="Admin">Admin</option>
            </select>
            <button className="button secondary">Assign</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Exception</th>
                <th>Provider</th>
                <th>Station</th>
                <th>Count</th>
                <th>Owner</th>
                <th>Severity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={7} className="empty-cell">No open exceptions found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
