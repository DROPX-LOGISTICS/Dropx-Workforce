# OpsPulse Network Planning

Network Planning is an in-place extension of the existing OpsPulse Service Network. It keeps the existing routes (`/ops-pulse/service-network` and `/ops-pulse/master/service-network`) and permission codes (`service_network` and `service_network_master`) so existing access assignments remain compatible.

## Activation

1. Run `scripts/ops_network_planning_v1.sql` in the Supabase SQL Editor.
2. Open **OpsPulse → Ops Masters → Network Planning Master**.
3. Select an active OpsPulse station, confirm its approved pincodes/SPR rule, and create its sectors.
4. Open **Network Planning**, create routes, allocate Field Executives, review capacity, and publish the day plan.

The migration creates explicit service-role grants and RLS policies. Browser roles (`anon` and `authenticated`) receive no direct table privileges; authenticated OpsPulse pages continue to use the existing server-side authorization and company/station scope.

## Station and map safety

- A station must already be active in the OpsPulse `stations` master and must be inside the user's location scope.
- Google My Maps/KML remains a reference boundary source. The module does not bulk-import or activate every mapped Kerala station.
- Coordinates are optional. Pincode and sector planning works without copying the full external coordinate set.
- A pincode outside the approved station rule, or shared between sectors, requires an explicit manual override in the master.

## Data model

- `ops_network_sectors`: station sector, expected volume, bike/van mix, TL and SSA ownership.
- `ops_network_sector_pincodes`: effective-dated pincode membership, including temporary/split/merged states.
- `ops_route_plans`: day route, sector, pincodes, vehicle/shift, expected volume, capacity override and temporary-change reason.
- `ops_route_roster`: FE allocation, replacement lineage, cross-sector source and roster status.
- `ops_network_backup_pool`: effective-dated bike/van backup priority.
- `ops_weekly_roster_templates`: reusable route and FE week patterns.
- `ops_network_delegations`: station/sector authority delegated to a TL or SSA.
- `ops_vehicle_incidents`: breakdown, unavailability and capacity exceptions.

Existing `field_executives.vehicle_type` and `attendance_daily` data are linked when available. Planned/actual headcount, load per FE, overloaded/unassigned routes, absenteeism, FE utilization and coverage gaps are derived in the application.

## Permissions

- Owner/Admin/Station Manager: operational planning and master configuration.
- Team Leader/SSA: operational planning, limited to owned or delegated sectors; master is view-only.
- Existing company and station scoping remains enforced for every server action and export.

## Optional sample

`scripts/ops_network_planning_sample_v1.sql` defines (but does not execute) a safe sample seeder. It requires the caller to pass an existing active OpsPulse station and creates three sectors, twelve sample pincodes and six routes. It never creates or activates a station.

```sql
select public.seed_ops_network_planning_sample(
  '<company-uuid>',
  '<existing-station-uuid>',
  'STATION_CODE'
);
```
