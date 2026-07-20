# Amazon SCC Playwright Worker

This worker is the live browser automation layer for DropX Ops Pulse COD checks.

It is intentionally separate from the Vercel dashboard and separate from biometric attendance. The dashboard stores settings and COD data. This worker opens Amazon SCC with Playwright, reads Driver Reconciliation / Bank Deposit pages, and sends structured results back to the dashboard.

## What This Solves

- The station team should not manually type every associate name.
- Ops Pulse > COD > Executive Reconciliation can fetch the SCC Driver Reconciliation roster for the selected station/date.
- Amazon SCC can ask for MFA, captcha, or manual approval. This worker supports a persistent interactive browser session so the owner can approve Amazon once and reuse the saved session.
- Biometric attendance remains untouched. This worker does not call `bio.dropxlogistics.com` and does not change attendance punch ingestion.

## Service Endpoints

- `GET /` opens the worker status page.
- `GET /health` confirms the worker is alive and shows configuration state.
- `GET /vnc.html` opens the worker browser when `ENABLE_VNC=true`.
- `POST /warmup` opens SCC and saves the browser session.
- `POST /run` performs one SCC check.

The dashboard calls this worker using `OPS_PORTAL_WORKER_URL` and `OPS_PORTAL_WORKER_SECRET`.

## Required Deployment Shape

Do not deploy this worker to Vercel. Vercel is not suitable for long-running Playwright browser sessions or saved Amazon login cookies.

Deploy this worker on a persistent Docker host such as:

- AWS EC2 / Lightsail
- Render private service with persistent disk
- Fly.io machine with persistent volume
- Any Ubuntu server with Docker and HTTPS reverse proxy

Recommended domain:

```text
scc.dropxlogistics.com
```

Keep this separate from:

```text
bio.dropxlogistics.com
```

`bio.dropxlogistics.com` is only for biometric device punch middleware.

## Worker Environment

Copy `.env.example` to `.env` on the worker host:

```bash
OPS_PORTAL_WORKER_SECRET=change-this-long-random-secret
VNC_PASSWORD=change-this-vnc-password
SLOW_MO_MS=0
WORKER_TIMEOUT_MS=240000
MANUAL_APPROVAL_WAIT_MS=300000
SCREEN_WIDTH=1440
SCREEN_HEIGHT=1000
```

The Docker compose file already sets:

```bash
HEADLESS=false
ENABLE_VNC=true
SESSION_STATE_DIR=/var/lib/dropx-scc-worker/sessions
DEBUG_ARTIFACT_DIR=/var/lib/dropx-scc-worker/artifacts
```

`SESSION_STATE_DIR` is mounted as a Docker volume. Do not remove it unless you want Amazon SCC to ask for login again.

## Start The Worker

From this folder:

```bash
docker compose up -d --build
```

Open:

```text
https://scc.dropxlogistics.com/
```

Then open:

```text
https://scc.dropxlogistics.com/vnc.html
```

Enter the VNC password from `.env`, then approve Amazon SCC login/MFA inside that browser.

## Connect The Dashboard

Set these in the Vercel dashboard project:

```bash
OPS_PORTAL_WORKER_URL=https://scc.dropxlogistics.com/run
OPS_PORTAL_WORKER_SECRET=the-same-secret-as-the-worker
CRON_SECRET=your-existing-cron-secret
```

Then in the dashboard:

1. Open Settings > Amazon Connector.
2. Save Amazon SCC credentials.
3. Click `Login worker once`.
4. If Amazon asks for MFA or manual verification, open the worker noVNC browser and approve it.
5. Open Ops Pulse > COD > Executive Reconciliation.
6. Select date and station.
7. Click `Sync SCC now`.

If Amazon accepts the saved session, associate rows should be imported automatically from SCC Driver Reconciliation.

## Can The Owner Login In The Worker?

Yes. That is the correct stable flow.

The owner cannot reuse normal laptop Chrome login directly because Playwright runs in its own browser on the worker host. Instead:

- Open the worker browser through noVNC.
- Login to Amazon SCC once.
- Approve MFA/captcha/manual prompt if Amazon asks.
- The worker saves session cookies in `SESSION_STATE_DIR`.
- Scheduled checks reuse that worker session.

If Amazon expires the session later, repeat the same noVNC login once.

## Does This Affect Biometric Attendance?

No.

Biometric attendance and SCC automation are separated:

- Biometric device punches go to `bio.dropxlogistics.com`.
- SCC automation goes to `scc.dropxlogistics.com`.
- SCC worker reads Amazon SCC and writes Ops Pulse/COD tables only.
- It does not touch attendance punch APIs, attendance reports, device master ingestion, or payroll attendance calculations.

## Expected Run Request

```json
{
  "run_id": "...",
  "company_id": "...",
  "station_code": "JDBD",
  "portal_station_code": "JDBD",
  "check_date": "2026-07-18",
  "check_type": "driver_reconciliation",
  "login_url": "https://www.amazonlogistics.eu/station/dashboard/workitemsvisibility",
  "username": "amazon-login",
  "password": "amazon-password",
  "mfa_secret": null,
  "urls": {
    "driver_reconciliation": "https://www.amazonlogistics.eu/station/dashboard/driverreconciliation",
    "bank_deposits": "https://www.amazonlogistics.eu/station/dashboard/bankdeposits"
  }
}
```

`mfa_secret` is the authenticator setup key or full `otpauth://` URL, not the current 6-digit OTP. If Amazon shows push approval, captcha, or another manual verification screen, it cannot be bypassed; approve it once in the worker browser.

## What It Checks

For `driver_reconciliation`:

- Logs in to Amazon SCC.
- Opens Driver Reconciliation.
- Applies station and business date where the page exposes controls.
- Reads associate rows, expected amount, pending amount, pending details, and page status.
- Returns structured associate rows to Ops Pulse COD.

For `prepared_deposit`:

- Opens Bank Deposits.
- Clicks prepared deposit related action where available.
- Returns Pass when no liability/pending amount is visible.
- Returns Fail when pending liability or amount is visible.

## Local Test

```bash
npm install
npm start
```

In another terminal:

```bash
curl -X POST http://localhost:8080/run \
  -H "Authorization: Bearer $OPS_PORTAL_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d @sample-request.json
```

## Operational Notes

- Keep the worker URL private where possible.
- Always use HTTPS in production.
- Rotate `OPS_PORTAL_WORKER_SECRET` if it is shared accidentally.
- If SCC layout changes, the extraction logic in `server.mjs` may need an update.
- Save debug artifacts only on secured storage because screenshots may show Amazon operational data.
