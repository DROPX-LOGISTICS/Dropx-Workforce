# DropX Partner Dashboard

Next.js dashboard for Provider ID mapping, rate cards, report imports, earnings, exceptions, and salary controls.

## Current Status

This frontend is scaffolded with mock data and is ready to connect to the Supabase schema that has already been applied to the `DropX Partner` project.

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
NEXT_PUBLIC_APP_URL=https://dashboard.dropxlogistics.com
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser or mobile code.

## Invitation Email Sender

User invitations are sent by Supabase Auth when `Send email invitation` is checked while creating a user. To send from `notification@dropxlogistics.com`, configure custom SMTP in Supabase Auth with:

- Sender email: `notification@dropxlogistics.com`
- Sender name: `DropX`
- SMTP host, port, username, and password from the DropX email provider
- Verified DNS records for SPF, DKIM, and DMARC

Keep the Supabase redirect allowlist including `https://dashboard.dropxlogistics.com/login` and `https://dashboard.dropxlogistics.com/auth/callback`.

## Vercel Setup

1. Push this folder to a GitHub repository.
2. Import the repository in Vercel.
3. Set the environment variables above in Vercel project settings.
4. Deploy.

## MVP Screens

- Dashboard
- Delivery Associate register
- Provider ID mapping
- Rate cards
- Report upload
- Earnings
- Exception queue
- Settings

## Next Build Steps

1. Replace mock data with Supabase reads.
2. Add auth and role redirects.
3. Add station-level access filters for managers.
4. Build Provider ID mapping create/correct workflow.
5. Build Amazon report import using the sample `111.xlsx`.
6. Add daily earnings calculation API route.
