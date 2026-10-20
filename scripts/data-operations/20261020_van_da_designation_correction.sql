-- One-time, explicitly requested DA designation correction, 20 October 2026.
-- Data operation only: no schema, payment, mapping, Fleet or app changes.
-- Default execution is a rollback rehearsal. For the approved live operation,
-- replace the final ROLLBACK with COMMIT; retain every validation unchanged.
-- T1013 is ODCD by explicit user confirmation despite its company-owned default.
-- DF1173 is linked by its exact Amazon ID despite a Fleet/payment station mismatch.
-- One Fleet default without a verified Workforce identity is excluded.
begin isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $correction$
declare
  v_company constant uuid := '43866344-b550-4e8a-9a2d-9d23f3d8a997';
  v_day constant date := date '2026-10-20';
  v_da constant uuid := '0bb05cb0-a9ae-4520-b840-633acbfd0d47';
  v_scope constant jsonb := $scope$[
  {
    "workforce_id": "737b5074-e1f5-4227-8deb-223ca257e152",
    "dropx_id": "DROPX1113",
    "target": "DCD",
    "amazon_ids": [
      "2000030607055"
    ],
    "mapping_ids": [
      "656616dc-da6d-4c8d-b738-3cf763990cfe"
    ],
    "fleet_defaults": [
      "cdb294f6-51c6-404f-861a-4985fd1c8eab"
    ]
  },
  {
    "workforce_id": "18e30951-e478-45a9-9993-acb6a31c9d34",
    "dropx_id": "DROPX1143",
    "target": "DCD",
    "amazon_ids": [
      "2000062640005"
    ],
    "mapping_ids": [
      "7597d2e8-701c-4b5e-8a10-140425e77b33"
    ],
    "fleet_defaults": [
      "0848ddcb-c0d2-40a8-a316-65fc2122aa9f"
    ]
  },
  {
    "workforce_id": "8cbb4bf8-7965-4ee6-9632-6e9beb23dd81",
    "dropx_id": "DROPX2150",
    "target": "DCD",
    "amazon_ids": [
      "2000054125675"
    ],
    "mapping_ids": [
      "818cb098-8702-4d2a-9593-1f340db77000"
    ],
    "fleet_defaults": [
      "aac5ec07-be57-4bdd-b938-dcd8e094c9b4"
    ]
  },
  {
    "workforce_id": "f7bacbea-c4bb-4265-b041-0ed9479a0cc9",
    "dropx_id": "DROPX3114",
    "target": "DCD",
    "amazon_ids": [
      "2000049147680"
    ],
    "mapping_ids": [
      "d7549981-2cf8-424d-affd-aa2ea6e9e4b1"
    ],
    "fleet_defaults": [
      "158e2d40-091e-495c-ac4d-b3fc28104949"
    ]
  },
  {
    "workforce_id": "036d7026-ae9e-4cf8-af2f-606b0a53be88",
    "dropx_id": "DROPX5081",
    "target": "DCD",
    "amazon_ids": [
      "2000031118880"
    ],
    "mapping_ids": [
      "d6fe7f0b-9bc9-4bcb-8d8a-332cdd86b018"
    ],
    "fleet_defaults": [
      "658d7871-27f8-41e8-932f-3173e253c30d"
    ]
  },
  {
    "workforce_id": "4fdc83e7-b442-4d85-a7f9-50c403dec67c",
    "dropx_id": "DROPX5175",
    "target": "DCD",
    "amazon_ids": [
      "2000052977465"
    ],
    "mapping_ids": [
      "d4ffa854-8221-4477-a751-feb451ba2120"
    ],
    "fleet_defaults": [
      "904c2221-29c8-40eb-83aa-23cf8c98ee27"
    ]
  },
  {
    "workforce_id": "3421ea04-f1b7-4d6d-a5e3-da673568751f",
    "dropx_id": "DROPX5234",
    "target": "DCD",
    "amazon_ids": [
      "2000064697745"
    ],
    "mapping_ids": [
      "06cddbff-5a12-453d-a248-e748b6e5c0ab"
    ],
    "fleet_defaults": [
      "936fde85-c1f9-4829-81bd-fcc816044148"
    ]
  },
  {
    "workforce_id": "f74e1689-798f-47fb-8d5e-b44df7e9a4e2",
    "dropx_id": "F280029",
    "target": "DCD",
    "amazon_ids": [
      "2000070521375"
    ],
    "mapping_ids": [
      "57324c03-752a-4419-b867-41ea808e3efc"
    ],
    "fleet_defaults": [
      "6df24b96-37c7-4409-a1f5-89e52bd9c8a8"
    ]
  },
  {
    "workforce_id": "1d77157b-16ec-4e1e-8abf-9b9b68e95960",
    "dropx_id": "F280038",
    "target": "DCD",
    "amazon_ids": [
      "2000071657475"
    ],
    "mapping_ids": [
      "c7d5ae8e-81f7-4826-9854-37630b5940eb"
    ],
    "fleet_defaults": [
      "c62a0d62-af9a-4600-b3f1-54cfd4ef405b"
    ]
  },
  {
    "workforce_id": "ec7dd2f0-36aa-4492-aa8a-7c0198679576",
    "dropx_id": "KLZH4133",
    "target": "DCD",
    "amazon_ids": [
      "2000054125290"
    ],
    "mapping_ids": [
      "0c8843a4-0a21-41bd-ad6c-a8d74cd13b76"
    ],
    "fleet_defaults": [
      "778acc14-d0cb-4acd-95d0-60f98191aab8"
    ]
  },
  {
    "workforce_id": "1837679b-848c-4020-92d2-7ad6e036cf57",
    "dropx_id": "KOZA5254",
    "target": "DCD",
    "amazon_ids": [
      "2000072666265"
    ],
    "mapping_ids": [
      "70210ebc-dd4a-45bb-8891-782e80e6ff14"
    ],
    "fleet_defaults": [
      "31c20f7e-8086-43ca-a194-3f062d9b3cc3"
    ]
  },
  {
    "workforce_id": "03f1fd24-2bce-42ae-89bf-8f34809a7a06",
    "dropx_id": "PEUA8079",
    "target": "DCD",
    "amazon_ids": [
      "2000072644870"
    ],
    "mapping_ids": [
      "4732641f-0447-40b1-8c0f-234c8239bdf1"
    ],
    "fleet_defaults": [
      "5224280d-375f-47e3-b396-3119a8142ca2"
    ]
  },
  {
    "workforce_id": "25e3b817-7eb4-413f-84cb-2e5f109756e5",
    "dropx_id": "PEUA8097",
    "target": "DCD",
    "amazon_ids": [
      "2000076907470"
    ],
    "mapping_ids": [
      "a9efb199-08ba-45f5-a09f-7804be50a497"
    ],
    "fleet_defaults": [
      "60c5b5e7-6219-45af-bf6a-b97095e07d10"
    ]
  },
  {
    "workforce_id": "d9a1d520-3088-44cf-ac50-340b8fd5accb",
    "dropx_id": "QLDA1049",
    "target": "DCD",
    "amazon_ids": [
      "2000054952835"
    ],
    "mapping_ids": [
      "bc099cb3-7ad4-4e8a-b6ad-1ed928713699"
    ],
    "fleet_defaults": [
      "24d2cb26-7680-4568-a849-d83c25ae4aa0"
    ]
  },
  {
    "workforce_id": "29ddebe6-9ff7-4333-a79c-f0e512eba21c",
    "dropx_id": "QLDA1052",
    "target": "DCD",
    "amazon_ids": [
      "2000070456675"
    ],
    "mapping_ids": [
      "b420d53d-4765-42a5-8292-f96c8014ee6f"
    ],
    "fleet_defaults": [
      "0b67a552-ca56-4688-9284-13d266d553df"
    ]
  },
  {
    "workforce_id": "6737d50f-c2a8-43ae-8b7b-1ee725176b7d",
    "dropx_id": "QLDA1080",
    "target": "DCD",
    "amazon_ids": [
      "2000074125460"
    ],
    "mapping_ids": [
      "30b36eff-15ac-42d6-8468-e98bd5e245a6"
    ],
    "fleet_defaults": [
      "7a298e24-26ef-4bba-ab84-e5b16f28f703"
    ]
  },
  {
    "workforce_id": "5fddab6e-2258-4292-99eb-e4daed53fe58",
    "dropx_id": "T1015",
    "target": "DCD",
    "amazon_ids": [
      "2000064755715"
    ],
    "mapping_ids": [
      "9d6e50d4-5e24-473d-9c9a-30b5c0560dec"
    ],
    "fleet_defaults": [
      "19901936-b60b-4ac7-ab59-c9faeb2ce6a6"
    ]
  },
  {
    "workforce_id": "1f775d3b-7d01-4ae4-85d5-2aa71d65e23e",
    "dropx_id": "TLPA3191",
    "target": "DCD",
    "amazon_ids": [
      "2000079237620"
    ],
    "mapping_ids": [
      "39102921-b16e-4c19-b958-bacb3699e609"
    ],
    "fleet_defaults": [
      "964aa844-f9bc-49ae-89a3-faa81881d835"
    ]
  },
  {
    "workforce_id": "b5a88b0a-b2c6-4860-a660-e4017c1c8525",
    "dropx_id": "DF1222",
    "target": "ODCD",
    "amazon_ids": [
      "2000073888725"
    ],
    "mapping_ids": [
      "c8dbeb15-86ed-4538-8113-ccd264954ffb"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "a78ce9de-d520-47d5-93b7-866916d168af",
    "dropx_id": "DF1272",
    "target": "ODCD",
    "amazon_ids": [
      "2000079984215"
    ],
    "mapping_ids": [
      "9662edbd-6380-4b07-a927-ac14a39b5d17"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "3816675f-8265-4344-bafe-cc317d874e4b",
    "dropx_id": "DF1284",
    "target": "ODCD",
    "amazon_ids": [
      "2000083195385"
    ],
    "mapping_ids": [
      "91939dfd-c064-408b-8438-efabf5bbbb7a",
      "bca49779-19b3-4f6c-88e4-07ed66641792"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "47c8ea3c-dd85-4077-88dc-453babd9476b",
    "dropx_id": "DROPX3162",
    "target": "ODCD",
    "amazon_ids": [
      "2000066058010"
    ],
    "mapping_ids": [
      "a0d17ae4-c1af-429e-99d1-a8f86b987c6e"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "6b7ed434-f31d-4a76-a840-6eccfaceedfc",
    "dropx_id": "F280089",
    "target": "ODCD",
    "amazon_ids": [
      "2000080212370"
    ],
    "mapping_ids": [
      "fa15de29-178d-4ec9-9f25-c490026ca587"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "f4a39c14-091c-40c6-9b1b-f2841fb67fcf",
    "dropx_id": "F280090",
    "target": "ODCD",
    "amazon_ids": [
      "2000080430720"
    ],
    "mapping_ids": [
      "e973b080-dc2c-4707-aa23-88a0cddd20ab"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "d7ffb273-436d-4e04-990a-442a6f1c6b76",
    "dropx_id": "GDRD80093",
    "target": "ODCD",
    "amazon_ids": [
      "2000081508860"
    ],
    "mapping_ids": [
      "a57213a0-1dc8-4410-8ae3-28fdea30edfd",
      "68a81070-4606-4b9b-b127-66f27f5d4c68"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "6eaccbbe-b42c-4d10-9ff1-d05f8176a3dc",
    "dropx_id": "GYMC70119",
    "target": "ODCD",
    "amazon_ids": [
      "2000055927555"
    ],
    "mapping_ids": [
      "5926068b-36a6-43d1-99a8-08dbda1b50f6"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "b24055ed-d420-45ae-ab69-5c83b8b66def",
    "dropx_id": "KTUB2290",
    "target": "ODCD",
    "amazon_ids": [
      "2000080027330"
    ],
    "mapping_ids": [
      "5c6a7b42-8815-480a-b310-3eee5f4f3f4d"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "9b774a0b-7b85-4583-a596-8079f8edf919",
    "dropx_id": "N1013",
    "target": "ODCD",
    "amazon_ids": [
      "2000078396420"
    ],
    "mapping_ids": [
      "1705fb03-9bcd-419a-a9b3-0cc802c13ab2"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "53d58c93-e353-4f35-8f77-c97de6119f00",
    "dropx_id": "N1025",
    "target": "ODCD",
    "amazon_ids": [
      "2000078360820"
    ],
    "mapping_ids": [
      "42dfcced-2f48-42c2-9c17-46e5fd3c2759"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "5d7b8a93-d478-4162-9fc9-b771116e5c52",
    "dropx_id": "N1062",
    "target": "ODCD",
    "amazon_ids": [
      "2000080009010"
    ],
    "mapping_ids": [
      "ede9ad9c-263f-4ab0-8a85-7266dd3a52dc"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "f63d5dc6-e948-42cf-bdb7-992bc437e56b",
    "dropx_id": "NLRE60073",
    "target": "ODCD",
    "amazon_ids": [
      "2000054916710"
    ],
    "mapping_ids": [
      "5708cf22-63e0-4ace-96f5-9edfe902814d"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "074b22db-a9f7-43eb-9005-a94b24843cb8",
    "dropx_id": "QLDA1012",
    "target": "ODCD",
    "amazon_ids": [
      "2000028030355"
    ],
    "mapping_ids": [
      "2b8b13eb-fb60-4d25-8cda-224626ff1973"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "1f8f7fc5-07d8-442f-8ebd-3c46a769f352",
    "dropx_id": "QLDA1102",
    "target": "ODCD",
    "amazon_ids": [
      "2000054114055"
    ],
    "mapping_ids": [
      "36b45b3e-e4c1-4dfa-9419-5622cef1b558"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "6fbb1157-5e5a-4b2e-b0c4-ea9458e5100e",
    "dropx_id": "T1005",
    "target": "ODCD",
    "amazon_ids": [
      "2000051889355"
    ],
    "mapping_ids": [
      "439feedf-9fc6-4d3a-bc5b-b34490fc1dc0"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "537f8aab-a746-4867-ac1c-fba4da4257ca",
    "dropx_id": "T1008",
    "target": "ODCD",
    "amazon_ids": [
      "2000051900355"
    ],
    "mapping_ids": [
      "f9ddc066-e1ce-408e-aec2-1047f751999c"
    ],
    "fleet_defaults": []
  },
  {
    "workforce_id": "16e3a0eb-df46-4043-a919-144a1dd37d86",
    "dropx_id": "T1013",
    "target": "ODCD",
    "amazon_ids": [
      "2000017016245"
    ],
    "mapping_ids": [
      "ab7a0634-6512-42f1-ae81-6156e5beb6fd",
      "15ddcb7d-1f52-4fce-aac4-94c8fec73f7b"
    ],
    "fleet_defaults": [
      "fbbd3600-3309-429a-a4dd-11ad8c1af584"
    ]
  },
  {
    "workforce_id": "ef9b3fb2-888c-421b-8dbf-715376a9e57c",
    "dropx_id": "DF1173",
    "target": "DCD",
    "amazon_ids": ["2000065285400"],
    "mapping_ids": ["1cf10573-9f0f-4a15-b181-7b22fde240dd"],
    "fleet_defaults": ["7675f77d-ae2b-46b1-9472-b7fb2f393eab"]
  }
]$scope$::jsonb;
  v_ids uuid[];
  v_row jsonb;
  v_before jsonb;
  v_after jsonb;
  v_target public.designations%rowtype;
  v_old_master public.designations%rowtype;
  v_mapping_hash text;
  v_allocation_hash text;
  v_other_workforce_hash text;
  v_count integer := 0;
  v_result jsonb := '[]'::jsonb;
begin
  if (now() at time zone 'Asia/Kolkata')::date <> v_day then
    raise exception 'This dated correction must be re-audited before running on another day.';
  end if;
  select array_agg((x->>'workforce_id')::uuid order by x->>'workforce_id')
    into v_ids from jsonb_array_elements(v_scope) x;
  if cardinality(v_ids) <> 37 or
     (select count(distinct x) from unnest(v_ids) x) <> 37 then
    raise exception 'Scope must contain exactly 37 distinct Workforce profiles.';
  end if;
  -- Lock only the profiles and evidence used by this operation.
  perform 1 from public.workforce w
    where w.id=any(v_ids) and w.company_id=v_company order by w.id for update;
  perform 1 from public.field_executive_provider_mappings m
    where m.workforce_id=any(v_ids) and m.company_id=v_company order by m.id for update;
  perform 1 from public.fleet_vehicle_da_defaults f
    where f.company_id=v_company and f.id in (
      select jsonb_array_elements_text(x->'fleet_defaults')::uuid
      from jsonb_array_elements(v_scope) x
    ) order by f.id for update;
  perform 1 from public.fleet_vehicles v
    where v.company_id=v_company and v.id in (
      select f.vehicle_id from public.fleet_vehicle_da_defaults f
      where f.company_id=v_company and f.id in (
        select jsonb_array_elements_text(x->'fleet_defaults')::uuid
        from jsonb_array_elements(v_scope) x
      )
    ) order by v.id for update;

  select * into strict v_old_master from public.designations
    where company_id=v_company and id=v_da and code='DA' and is_active;
  select md5(coalesce(string_agg(to_jsonb(m)::text,'' order by m.id),''))
    into v_mapping_hash from public.field_executive_provider_mappings m where m.company_id=v_company;
  select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by a.id),''))
    into v_allocation_hash from public.workforce_payment_allocations a where a.company_id=v_company;
  select md5(coalesce(string_agg(to_jsonb(w)::text,'' order by w.id),''))
    into v_other_workforce_hash from public.workforce w where not(w.id=any(v_ids));

  for v_row in select value from jsonb_array_elements(v_scope) order by value->>'workforce_id' loop
    select to_jsonb(w) into strict v_before from public.workforce w
      where w.id=(v_row->>'workforce_id')::uuid and w.company_id=v_company
        and w.dropx_id=v_row->>'dropx_id' and w.designation_id=v_da
        and w.designation='Delivery Associate' and w.is_active and w.deleted_at is null;
    select * into strict v_target from public.designations d
      where d.company_id=v_company and d.code=v_row->>'target' and d.is_active;
    if v_target.is_field_operations is distinct from v_old_master.is_field_operations
       or v_target.provider_mapping_required is distinct from v_old_master.provider_mapping_required then
      raise exception 'Payment policy would change for %; aborting.',v_row->>'dropx_id';
    end if;
    if not exists (
      select 1 from public.field_executive_provider_mappings m
      join public.payment_methods p on p.id=m.payment_method_id
      where m.company_id=v_company and m.workforce_id=(v_row->>'workforce_id')::uuid
        and m.status='active' and m.effective_from<=v_day and coalesce(m.effective_to,v_day)>=v_day
        and m.id in (select jsonb_array_elements_text(v_row->'mapping_ids')::uuid)
        and m.provider_member_id in (select jsonb_array_elements_text(v_row->'amazon_ids'))
        and (v_row->>'target'='DCD' or p.code in ('PER_PACKET_VAN_RENT_PER_DAY','PER_PACKET_VAN_RENT_PER_MONTH'))
    ) then raise exception 'Current mapping evidence changed for %.',v_row->>'dropx_id'; end if;
    if v_row->>'target'='DCD' and not exists (
      select 1 from public.fleet_vehicle_da_defaults f
      join public.fleet_vehicles v on v.id=f.vehicle_id and v.company_id=f.company_id
      join public.stations s on s.company_id=f.company_id and s.station_code=f.station_code
      join public.field_executive_provider_mappings m
        on m.company_id=f.company_id and m.provider_member_id=f.provider_employee_id
        and (m.station_id=s.id or (
          v_row->>'dropx_id'='DF1173'
          and m.id='1cf10573-9f0f-4a15-b181-7b22fde240dd'::uuid
          and f.id='7675f77d-ae2b-46b1-9472-b7fb2f393eab'::uuid
        ))
      where f.company_id=v_company and f.id in (select jsonb_array_elements_text(v_row->'fleet_defaults')::uuid)
        and v.ownership_type='own' and v.deployment_status='deployed'
        and (upper(btrim(s.region))='KL' or lower(btrim(s.state)) in ('kl','kerala'))
        and m.workforce_id=(v_row->>'workforce_id')::uuid and m.status='active'
        and m.effective_from<=v_day and coalesce(m.effective_to,v_day)>=v_day
    ) then raise exception 'Kerala company-owned default changed for %.',v_row->>'dropx_id'; end if;

    update public.workforce set designation_id=v_target.id,designation=v_target.name,updated_at=now()
      where company_id=v_company and id=(v_row->>'workforce_id')::uuid
        and dropx_id=v_row->>'dropx_id' and designation_id=v_da;
    if not found then raise exception 'Profile was not updated: %.',v_row->>'dropx_id'; end if;
    select to_jsonb(w) into strict v_after from public.workforce w where w.id=(v_row->>'workforce_id')::uuid;
    if (v_before-array['designation_id','designation','updated_at']) is distinct from
       (v_after-array['designation_id','designation','updated_at']) then
      raise exception 'An unrelated profile field changed: %.',v_row->>'dropx_id';
    end if;
    if v_after->>'designation_id' <> v_target.id::text or v_after->>'designation' <> v_target.name then
      raise exception 'Designation validation failed: %.',v_row->>'dropx_id';
    end if;
    v_count:=v_count+1;
    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'dropx_id',v_row->>'dropx_id','name',v_after->>'full_name',
      'workforce_id',v_row->>'workforce_id','old_designation','DA','new_designation',v_target.code,
      'amazon_ids',v_row->'amazon_ids','updated_at',v_after->>'updated_at'));
  end loop;
  if v_count<>37 then raise exception 'Unexpected correction count: %.',v_count; end if;
  if v_mapping_hash is distinct from (
    select md5(coalesce(string_agg(to_jsonb(m)::text,'' order by m.id),''))
    from public.field_executive_provider_mappings m where m.company_id=v_company
  ) then raise exception 'Payment mappings changed; entire operation rolled back.'; end if;
  if v_allocation_hash is distinct from (
    select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by a.id),''))
    from public.workforce_payment_allocations a where a.company_id=v_company
  ) then raise exception 'Direct payment terms changed; entire operation rolled back.'; end if;
  if v_other_workforce_hash is distinct from (
    select md5(coalesce(string_agg(to_jsonb(w)::text,'' order by w.id),''))
    from public.workforce w where not(w.id=any(v_ids))
  ) then raise exception 'An out-of-scope profile changed; entire operation rolled back.'; end if;
  perform set_config('dropx.designation_correction_result',jsonb_build_object(
    'changed',v_count,'odcd',18,'dcd',19,'mapping_unchanged',true,
    'direct_pay_unchanged',true,'other_profiles_unchanged',true,
    'mapping_hash',v_mapping_hash,'allocation_hash',v_allocation_hash,'profiles',v_result
  )::text,true);
end
$correction$;
select current_setting('dropx.designation_correction_result')::jsonb as designation_correction;
rollback;
