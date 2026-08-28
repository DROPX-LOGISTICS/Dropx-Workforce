# DropX Workforce

Production: [workforce.dropxlogistics.com](https://workforce.dropxlogistics.com)

Source: [DROPX-LOGISTICS/Dropx-Workforce](https://github.com/DROPX-LOGISTICS/Dropx-Workforce)

Independent Workforce operations product for associate and operations-partner onboarding, registration, activation, provider IDs, rate cards, communications, and lifecycle management.

## Current Status

The product is live with a Workforce-only navigation and designation boundary. Existing in-progress registrations remain on the protected compatibility flow while Workforce records are mirrored into the dedicated data model.

## Local Setup

```bash
npm install
npm run dev
```

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://uimajyffojydenqsegjv.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=https://workforce.dropxlogistics.com
CASH_RECON_WORKER_URL=https://cash-recon-worker.withered-voice-1c40.workers.dev
CASH_RECON_ADMIN_KEY=
REPORT_AUTO_WORKER_URL=https://report-auto-worker.withered-voice-1c40.workers.dev
REPORT_AUTO_ADMIN_KEY=
# Set to false to hide the Auto upload button until the worker is deployed
# REPORT_AUTO_UI_ENABLED=true
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser or mobile code.

## Data Safety

- Workforce/People isolation is master-driven through each designation's business category.
- Existing invited registrations continue through the compatibility path and mirror into the Workforce data model.
- Workforce screens query only Workforce-classified designations and profiles.
- Run `npm run build` before deployment; the prebuild boundary check protects contractor registration tables from direct writes.

## Invitation Email Sender

User invitations are sent by Supabase Auth when `Send email invitation` is checked while creating a user. To send from `notification@dropxlogistics.com`, configure custom SMTP in Supabase Auth with:

- Sender email: `notification@dropxlogistics.com`
- Sender name: `DropX`
- SMTP host, port, username, and password from the DropX email provider
- Verified DNS records for SPF, DKIM, and DMARC

Keep the Supabase redirect allowlist including `https://workforce.dropxlogistics.com/login` and `https://workforce.dropxlogistics.com/auth/callback`.

## Vercel Setup

The dedicated `dropx-workforce` Vercel project is connected to this repository. Production releases must originate from a pushed GitHub commit; direct local deployments are prohibited. Database migrations use the GitHub workflow documented in [docs/workforce-release-process.md](docs/workforce-release-process.md).

## Workforce Product Areas

- Workforce command dashboard
- Workforce register and onboarding journeys
- Operations-partner onboarding for van renters, van vendors, sorters, and cleaning staff
- Provider ID onboarding and rate-card mapping
- Activation and lifecycle management
- DropX One and WhatsApp communications
- Workforce-only designations, users, roles, and access
