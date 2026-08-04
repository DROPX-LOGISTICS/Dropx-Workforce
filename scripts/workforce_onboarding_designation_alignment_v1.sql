begin;

-- Delivery-associate roles use the Field Executive onboarding lifecycle even
-- though the signed commercial terms establish an independent-contractor
-- relationship. Keep them out of the employee/HR onboarding category.
update public.designations
set onboarding_categories = array['field_executives']::text[],
    portal_permissions = jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(portal_permissions, '{}'::jsonb), '{ops,add}', 'true'::jsonb, true),
        '{ops,view}', 'true'::jsonb, true
      ),
      '{ops,edit}', 'false'::jsonb, true
    ),
    updated_at = now()
where upper(code) in ('DA', 'DCD', 'ODCD', 'PTDA');

notify pgrst, 'reload schema';

commit;
