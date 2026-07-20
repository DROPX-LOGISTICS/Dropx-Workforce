# Amazon SCC Playwright Worker

This worker is the browser automation layer for DropX Ops Pulse portal checks.

It is intentionally separate from the Vercel dashboard. Vercel queues and stores check runs, while this service opens Amazon SCC with Playwright, inspects the station pages, and returns a structured result.

## Endpoints

- `GET /health` confirms the worker is alive.
- `POST /run` performs one queued SCC check.

The dashboard cron calls this worker using `OPS_PORTAL_WORKER_URL` and `OPS_PORTAL_WORKER_SECRET`.

## Required Environment Variables

```bash
PORT=8080
OPS_PORTAL_WORKER_SECRET=change-this-long-random-secret
HEADLESS=true
SLOW_MO_MS=0
WORKER_TIMEOUT_MS=90000
DEBUG_ARTIFACT_DIR=/tmp/dropx-scc-artifacts
SESSION_STATE_DIR=/var/lib/dropx-scc-worker/sessions
MANUAL_APPROVAL_WAIT_MS=45000
```

Then set these in the Vercel dashboard project:

```bash
OPS_PORTAL_WORKER_URL=https://bio.dropxlogistics.com/run
OPS_PORTAL_WORKER_SECRET=the-same-secret-as-the-worker
CRON_SECRET=your-existing-cron-secret
```

## Expected Request

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

`mfa_secret` is the authenticator setup key or full `otpauth://` URL, not the current 6-digit OTP. When this is saved in Settings > Amazon Connector, the worker can generate the current code during login. If Amazon shows push approval, captcha, or another manual verification screen, that cannot be bypassed; approve it once and the worker will save the browser session under `SESSION_STATE_DIR` for reuse.

## What It Checks

For `driver_reconciliation`:

- Logs in to Amazon SCC.
- Opens Driver Reconciliation.
- Applies station and business date where the page exposes controls.
- Reads table/body text.
- Returns Pass when no pending reconciliation is visible.
- Returns Fail when pending reconciliation rows/amounts are visible.
- Returns Manual Review if Amazon shows MFA, a blocker, or an unfamiliar page layout.

For `prepared_deposit`:

- Opens Bank Deposits.
- Clicks prepared deposit related action where available.
- Returns Pass when no liability/pending amount is visible.
- Returns Fail when a pending liability/amount is visible.

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

The worker never stores Amazon passwords. The dashboard sends credentials only for the current run over HTTPS.
The worker does store browser session cookies locally so repeated checks do not restart Amazon login every time.
