create index if not exists workforce_amazon_email_pilot_station_fk_idx
  on public.workforce_amazon_email_pilot_candidates(station_id);

create index if not exists workforce_amazon_email_pilot_designation_fk_idx
  on public.workforce_amazon_email_pilot_candidates(designation_id);

create index if not exists workforce_amazon_email_pilot_created_by_fk_idx
  on public.workforce_amazon_email_pilot_candidates(created_by);

create index if not exists workforce_amazon_email_pilot_invitation_fk_idx
  on public.workforce_amazon_email_pilot_candidates(invitation_request_id)
  where invitation_request_id is not null;
