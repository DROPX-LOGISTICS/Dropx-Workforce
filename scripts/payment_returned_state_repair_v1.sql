begin;

-- Repair legacy requests whose latest lifecycle action is Returned while the
-- request row was left in Pending. Requests with any later action are ignored.
with latest_action as (
  select distinct on (approvals.payment_request_id)
    approvals.payment_request_id,
    lower(approvals.action) as action
  from public.payment_request_approvals approvals
  where approvals.payment_request_id is not null
  order by approvals.payment_request_id, approvals.created_at desc, approvals.id desc
)
update public.payment_requests requests
set
  status = 'returned',
  approval_status = 'RETURNED',
  updated_at = now()
from latest_action
where latest_action.payment_request_id = requests.id
  and latest_action.action = 'returned'
  and lower(coalesce(requests.status, '')) in ('pending', 'approved')
  and upper(coalesce(requests.approval_status, '')) in ('PENDING', 'APPROVED');

commit;
