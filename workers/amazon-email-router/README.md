# Amazon onboarding email router

This Cloudflare Email Worker accepts messages only after the recipient has been reserved by the Workforce beta flow. It sends message metadata and the first Amazon HTTPS action link to the authenticated Workforce ingest endpoint. It does not create a mailbox and does not retain raw MIME content.

The two-station pilot uses a Resend-provided inbound domain because `dropxlogistics.com` DNS and mail are hosted by Google. The Worker remains available for a later branded Cloudflare zone; switching providers only changes environment and station master values.

Required setup:

1. Enable Email Routing only for the isolated alias subdomain. Do not replace the apex domain MX records.
2. Create a literal Send to Worker routing rule for each reserved alias. The Workforce backend does this through the Cloudflare API before it queues the Amazon invitation. Cloudflare does not support catch-all rules on Email Routing subdomains.
3. Add the same random `WORKFORCE_EMAIL_INGEST_SECRET` to this Worker and the Workforce Vercel project.
4. Configure each pilot station's backend alias pattern in Workforce, for example `{first_name}.{station_code}.{unique}@drivers.dropxlogistics.com`.

Unknown recipients are rejected by the Worker. Alias addresses are never recycled.
