begin;

-- The reconciliation is an explicitly invoked, advisory-locked SuperAdmin
-- maintenance operation. Give only this function enough time to preserve and
-- re-key the complete legacy set; normal application statements keep their
-- existing timeout.
alter function public.reconcile_legacy_workforce_aliases()
  set statement_timeout = '120s';

commit;
