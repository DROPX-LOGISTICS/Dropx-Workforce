-- Generated from Station Addresses - Copy.xlsx on 2026-06-21.
-- Replaces provider, model, and location masters while preserving UUIDs for matching codes.
begin;

create temp table import_providers (
  code text primary key,
  name text not null
) on commit drop;

create temp table import_models (
  provider_code text not null,
  code text not null,
  name text not null,
  primary key (provider_code, code)
) on commit drop;

create temp table import_stations (
  station_code text primary key,
  station_name text not null,
  provider_code text not null,
  model_code text not null,
  address text not null,
  address_line1 text not null,
  city text,
  state text,
  postal_code text,
  station_email text,
  latitude numeric(10, 7),
  longitude numeric(10, 7)
) on commit drop;

insert into import_providers (code, name) values
  ('AMAZON', 'Amazon'),
  ('DROPX', 'DropX'),
  ('FLIPKART', 'Flipkart'),
  ('MEESHO', 'Meesho');

insert into import_models (provider_code, code, name) values
  ('AMAZON', 'EDSP', 'EDSP'),
  ('AMAZON', 'NOW', 'NOW'),
  ('AMAZON', 'XPT', 'XPT'),
  ('DROPX', 'HO', 'HO'),
  ('FLIPKART', 'MDH', 'MDH'),
  ('FLIPKART', 'ODH', 'ODH'),
  ('MEESHO', 'FM', 'FM');

insert into import_stations (
  station_code,
  station_name,
  provider_code,
  model_code,
  address,
  address_line1,
  city,
  state,
  postal_code,
  station_email,
  latitude,
  longitude
) values
  ('HO', 'HO', 'DROPX', 'HO', '33/450-U,V,Z(1), 3rd Floor, City Point Mall, Manjeri, Malappuram, KL, 676121', '33/450-U,V,Z(1), 3rd Floor, City Point Mall, Manjeri', 'Malappuram', 'KL', '676121', 'contact@dropxlogistics.com', 11.1204389, 76.1130868),
  ('KGQA', 'KGQA', 'AMAZON', 'EDSP', '16/405U, D2 Building, Izzath Nagar, Ulliyathadukka, Kasaragod, KL, 671123', '16/405U, D2 Building, Izzath Nagar, Ulliyathadukka', 'Kasaragod', 'KL', '671123', 'kgqa@dropxlogistics.com', 12.535151, 75.004059),
  ('TLPA', 'TLPA', 'AMAZON', 'EDSP', 'AP 1/161B, SR Complex, Sathkarma Bus Stop, Muzhappala, Kannur, KL, 670611', 'AP 1/161B, SR Complex, Sathkarma Bus Stop, Muzhappala', 'Kannur', 'KL', '670611', 'tlpa@dropxlogistics.com', 11.9102417, 75.4914798),
  ('KTUB', 'KTUB', 'AMAZON', 'EDSP', '21/170D, Mullakkal Building, Muthukad, Nilambur, Malappuram, KL, 679330', '21/170D, Mullakkal Building, Muthukad, Nilambur', 'Malappuram', 'KL', '679330', 'ktub@dropxlogistics.com', 11.2718155, 76.2491261),
  ('KLZH', 'KLZH', 'AMAZON', 'EDSP', '6/400 A3, 3rd Mile, Forest Kuppadi, Sulthan Bathery, Wayanad, KL, 673592', '6/400 A3, 3rd Mile, Forest Kuppadi, Sulthan Bathery', 'Wayanad', 'KL', '673592', 'klzh@dropxlogistics.com', 11.698841, 76.259911),
  ('KOZA', 'KOZA', 'AMAZON', 'EDSP', 'DROPX LOGISTICS, 23/337, Koodathingal Warehouse, Neythukulangara Junction, Chevayur, Kozhikode, KL, 673017', 'DROPX LOGISTICS, 23/337, Koodathingal Warehouse, Neythukulangara Junction, Chevayur', 'Kozhikode', 'KL', '673017', 'koza@dropxlogistics.com', 11.265875, 75.825172),
  ('KTUH', 'KTUH', 'AMAZON', 'XPT', 'DROPX LOGISTICS, 10/136B Chemmanam Road, Thachankode, Vaniyambalam, Malappuram, KL, 679339', 'DROPX LOGISTICS, 10/136B Chemmanam Road, Thachankode, Vaniyambalam', 'Malappuram', 'KL', '679339', 'ktub@dropxlogistics.com', 11.190595, 76.268715),
  ('PEUA', 'PEUA', 'AMAZON', 'EDSP', 'KP 3/156B, PP Building, Vatayam, Kuttiady, Kozhikode, KL, 673507', 'KP 3/156B, PP Building, Vatayam, Kuttiady', 'Kozhikode', 'KL', '673507', 'peua@dropxlogistics.com', 11.653251, 75.731018),
  ('PMB', 'PMB', 'FLIPKART', 'ODH', '8/50C, ILLATH BUILDING, MULIYANGAL, PERAMBRA, KOZHIKODE, KL, 673525', '8/50C, ILLATH BUILDING, MULIYANGAL, PERAMBRA', 'KOZHIKODE', 'KL', '673525', 'pmb@dropxlogistics.com', 11.5347707, 75.7769557),
  ('CHM', 'CHM', 'FLIPKART', 'MDH', '14/407A, 407B, Thaniyode, Chakkittapara Road, Kozhikode, KL, 673526', '14/407A, 407B, Thaniyode, Chakkittapara Road', 'Kozhikode', 'KL', '673526', 'chm@dropxlogistics.com', 11.5674708, 75.8079335),
  ('KANA', 'KANA', 'AMAZON', 'EDSP', 'No. 40, Khata 22, Plot 2068/2063, At-Narayani Sahi, Phulbani, OD, 762001', 'No. 40, Khata 22, Plot 2068/2063, At-Narayani Sahi', 'Phulbani', 'OD', '762001', 'kana@dropxlogistics.com', 20.47283, 84.23824),
  ('JDBD', 'JDBD', 'AMAZON', 'EDSP', 'Khasra No 14/5, Village Palli, Chitrakote Road, Jagdalpur, Bastar, CG, 494001', 'Khasra No 14/5, Village Palli, Chitrakote Road, Jagdalpur', 'Bastar', 'CG', '494001', 'jdbd@dropxlogistics.com', 19.09679, 81.96974),
  ('RPRN', 'RPRN', 'AMAZON', 'EDSP', 'Nandi Complex, D.N.K Colony, Subhash Chowk, Narayanpur, CG, 494661', 'Nandi Complex, D.N.K Colony, Subhash Chowk', 'Narayanpur', 'CG', '494661', 'rprn@dropxlogistics.com', 19.71938, 81.23864),
  ('DLB', 'DLB', 'MEESHO', 'FM', 'B73, Ground Floor, 1st Main, DDUTTL, 2nd Stage, Yeshwanthpur, Bangalore, KA, 560022', 'B73, Ground Floor, 1st Main, DDUTTL, 2nd Stage, Yeshwanthpur', 'Bangalore', 'KA', '560022', 'dlb@dropxlogistics.com', 13.022024, 77.535679),
  ('JGBA', 'JGBA', 'AMAZON', 'EDSP', 'No. 05 Denteshwari Chambers, Kharsa No 245/4, Gandhi Ward, Kondagaon, CG, 494226', 'No. 05 Denteshwari Chambers, Kharsa No 245/4, Gandhi Ward', 'Kondagaon', 'CG', '494226', 'jgba@dropxlogistics.com', 19.60613, 81.67313),
  ('KDJE', 'KDJE', 'AMAZON', 'EDSP', 'Plot No. 49/632, Khata No. 61/8, Mouza-Serenda, Unit No. 14, PO-Serenda, Ps-Barbil, Keonjhar, OD, 758035', 'Plot No. 49/632, Khata No. 61/8, Mouza-Serenda, Unit No. 14, PO-Serenda, Ps-Barbil', 'Keonjhar', 'OD', '758035', 'kdje@dropxlogistics.com', 22.08218, 85.38572),
  ('QLDA', 'QLDA', 'AMAZON', 'EDSP', '26/101F, Moidu Tower, Ground Floor, Kanayankode, Koyilandy, Kozhikode, KL, 673620', '26/101F, Moidu Tower, Ground Floor, Kanayankode, Koyilandy', 'Kozhikode', 'KL', '673620', 'qlda@dropxlogistics.com', 11.4454926, 75.7275699),
  ('PHN', 'PHN', 'FLIPKART', 'MDH', 'Plot No. 737, Khata No. 170, NewKacharamal, Adalia, Cuttack Sadar, CUTTACK, OD, 754001', 'Plot No. 737, Khata No. 170, NewKacharamal, Adalia, Cuttack Sadar', 'CUTTACK', 'OD', '754001', 'phn@dropxlogistics.com', 20.3678479, 85.8911429),
  ('GNTI', 'GNTI', 'AMAZON', 'EDSP', '8-25-13, L.B.S. Nagar, Perala, Chirala, Gavinivari Palem, Chirala, Bapatla, AP, 523157', '8-25-13, L.B.S. Nagar, Perala, Chirala, Gavinivari Palem, Chirala', 'Bapatla', 'AP', '523157', 'gnti@dropxlogistics.com', 15.830694, 80.367722),
  ('GDRD', 'GDRD', 'AMAZON', 'EDSP', 'No. 8/282, NH-16, Chillakur, Gudur, Nellore, AP, 524412', 'No. 8/282, NH-16, Chillakur, Gudur', 'Nellore', 'AP', '524412', 'gdrd@dropxlogistics.com', 14.130787, 79.865732),
  ('GNTF', 'GNTF', 'AMAZON', 'EDSP', 'No.110/3, Sri Vasai Service Center, Backside, Amaravathi, Guntur, AP, 522020', 'No.110/3, Sri Vasai Service Center, Backside, Amaravathi', 'Guntur', 'AP', '522020', 'gntf@dropxlogistics.com', 16.563688, 80.3589482),
  ('NLRF', 'NLRF', 'AMAZON', 'EDSP', 'No. 19-5-16, RRC Building, Ground Floor, Rama Nagar, GNT Road, Musunuru, Nellore, AP, 524201', 'No. 19-5-16, RRC Building, Ground Floor, Rama Nagar, GNT Road, Musunuru', 'Nellore', 'AP', '524201', 'nlrf@dropxlogistics.com', 14.8838403, 79.9893785),
  ('NLRC', 'NLRC', 'AMAZON', 'EDSP', '6-2-218, NB Road, North Revenue, Ward-1, Buchireddipalem, Nellore, AP, 524305', '6-2-218, NB Road, North Revenue, Ward-1, Buchireddipalem', 'Nellore', 'AP', '524305', 'nlrc@dropxlogistics.com', 14.536912, 79.875777),
  ('NLRE', 'NLRE', 'AMAZON', 'EDSP', 'Plot No. 11, Parameswari Nagar, Sulluru Sullurpeta, Tirupathi, AP, 524121', 'Plot No. 11, Parameswari Nagar, Sulluru Sullurpeta', 'Tirupathi', 'AP', '524121', 'nlre@dropxlogistics.com', 13.705667, 80.0135),
  ('GYMC', 'GYMC', 'AMAZON', 'EDSP', '3-147, Groud Floor, Srinivasamangapuram, Mittapalem, Tirupati, AP, 17102', '3-147, Groud Floor, Srinivasamangapuram, Mittapalem', 'Tirupati', 'AP', '17102', 'gymc@dropxlogistics.com', 13.6113055, 79.3308371),
  ('TIRC', 'TIRC', 'AMAZON', 'EDSP', '32-6-96, Eslapuram Main Road, Opposite to Current Sub Station, Puttur, AP, 517583', '32-6-96, Eslapuram Main Road, Opposite to Current Sub Station', 'Puttur', 'AP', '517583', 'tirc@dropxlogistics.com', 13.452736, 79.547899),
  ('JUGD', 'JUGD', 'AMAZON', 'EDSP', 'Plot No. 268, MS Khata No. 117/659 of Mouza - Beharapata, Jharsuguda, OD, 768202', 'Plot No. 268, MS Khata No. 117/659 of Mouza - Beharapata', 'Jharsuguda', 'OD', '768202', 'jugd@dropxlogistics.com', 21.86751, 83.99611),
  ('SPBE', 'SPBE', 'AMAZON', 'XPT', 'Plot No. 402/2511, Khata No. 404/419, Kuchinda Town, Anandpur, Kochinda, Sambalpur, OD, 768222', 'Plot No. 402/2511, Khata No. 404/419, Kuchinda Town, Anandpur, Kochinda', 'Sambalpur', 'OD', '768222', 'jugd@dropxlogistics.com', 21.74555, 84.35396),
  ('KGQE', 'KGQE', 'AMAZON', 'XPT', '22/304-A8, A9, Puthusseri Complex, Kastoorikkulam-Iyyankode Road, Nadapuram, Kozhikode, KL, 673504', '22/304-A8, A9, Puthusseri Complex, Kastoorikkulam-Iyyankode Road, Nadapuram', 'Kozhikode', 'KL', '673504', 'peua@dropxlogistics.com', 11.690354, 75.658531),
  ('ERSE', 'ERSE', 'AMAZON', 'EDSP', '15/45A, Amay Warehouse, Thodaparambu, Perumbavoor, Ernankulam, KL, 683544', '15/45A, Amay Warehouse, Thodaparambu, Perumbavoor', 'Ernankulam', 'KL', '683544', 'erse@dropxlogistics.com', 10.131122, 76.482803),
  ('TLPB', 'TLPB', 'AMAZON', 'EDSP', '14/82C, Souparnika Complex, Peruvamparamba, Padiyoor, Iritty, Kannur, KL, 670703', '14/82C, Souparnika Complex, Peruvamparamba, Padiyoor, Iritty', 'Kannur', 'KL', '670703', 'tlpb@dropxlogistics.com', 11.98757, 75.646713),
  ('XAPI', 'XAPI', 'AMAZON', 'XPT', '13/50 Balaji Palli, Ground Floor, Chinagottigallu, Bhakarapet, Chittoor, AP, 517194', '13/50 Balaji Palli, Ground Floor, Chinagottigallu, Bhakarapet', 'Chittoor', 'AP', '517194', 'gymc@dropxlogistics.com', 13.6494935, 79.1588394),
  ('KGQC', 'KGQC', 'AMAZON', 'XPT', '7/46C, Aysha Residency, Nalamvadukal, Udma, Kasaragod, KL, 671319', '7/46C, Aysha Residency, Nalamvadukal, Udma', 'Kasaragod', 'KL', '671319', 'kgqa@dropxlogistics.com', 12.439282, 75.029457),
  ('KDJG', 'KDJG', 'AMAZON', 'XPT', 'Plot No 450/1314, Room No 15, Mandir Sahi, Champua Raruan Rd,Champua, Kendujhar, OD, 758041', 'Plot No 450/1314, Room No 15, Mandir Sahi, Champua Raruan Rd,Champua', 'Kendujhar', 'OD', '758041', 'kdje@dropxlogistics.com', 22.063312, 85.6706),
  ('XAPL', 'XAPL', 'AMAZON', 'XPT', 'No. 2-290 Kadavakuduru Road, Inkollu, AP, 523167', 'No. 2-290 Kadavakuduru Road', 'Inkollu', 'AP', '523167', 'gnti@dropxlogistics.com', 15.8245921, 80.1918862),
  ('SBPD', 'SBPD', 'AMAZON', 'EDSP', 'Holding No. 919, Ward No. 13, Sambalpur Municipal Corporation, Remed Chawk, Khetrajpur, Sambalpur, OD, 768003', 'Holding No. 919, Ward No. 13, Sambalpur Municipal Corporation, Remed Chawk, Khetrajpur', 'Sambalpur', 'OD', '768003', 'sbpd@dropxlogistics.com', 21.5012, 83.9439),
  ('JUGE', 'JUGE', 'AMAZON', 'XPT', 'SAPADA, Bandhbahal Colony, Bandhbahal, Lakhanpur, JHARSUGUDA, OD, 768211', 'SAPADA, Bandhbahal Colony, Bandhbahal, Lakhanpur', 'JHARSUGUDA', 'OD', '768211', 'sbpd@dropxlogistics.com', 21.7534196, 83.8674574),
  ('XAPH', 'XAPH', 'AMAZON', 'XPT', 'Kota Cross Cicular road, Ground Floor, Kotta, SPSR Nellore, AP, 524411', 'Kota Cross Cicular road, Ground Floor, Kotta', 'SPSR Nellore', 'AP', '524411', 'gdrd@dropxlogistics.com', 14.025064, 80.039818),
  ('TTA5', 'TTA5', 'AMAZON', 'NOW', 'Ground Floor , 12-7-133/81/2/1, Moosapet, Hyderabad, TS, 500072', 'Ground Floor , 12-7-133/81/2/1, Moosapet', 'Hyderabad', 'TS', '500072', 'tta5@dropxlogistics.com', 17.475972, 78.418194),
  ('TTB3', 'TTB3', 'AMAZON', 'NOW', 'Ground Floor , Sy No 306 & 307, H.No 1-119/306, Nizampet, Hyderabad, TS, 500090', 'Ground Floor , Sy No 306 & 307, H.No 1-119/306, Nizampet', 'Hyderabad', 'TS', '500090', 'ttb3@dropxlogistics.com', 17.517913, 78.379277),
  ('TCC3', 'TCC3', 'AMAZON', 'NOW', 'DROPX LOGISTICS. No 68/3 Kamaraj Avenue 1st Street, Gandhi Nagar 1st Main Road , Adyar, Chennai, TN, 600020', 'DROPX LOGISTICS. No 68/3 Kamaraj Avenue 1st Street, Gandhi Nagar 1st Main Road , Adyar', 'Chennai', 'TN', '600020', 'tcc3@dropxlogistics.com', 13.002134, 80.248964),
  ('TCD4', 'TCD4', 'AMAZON', 'NOW', 'Survey No: 115/1G, Old Door No:7 New Door No 29, Pillayarkoil Street, Nesapakkam, Chennai, TN, 600078', 'Survey No: 115/1G, Old Door No:7 New Door No 29, Pillayarkoil Street, Nesapakkam', 'Chennai', 'TN', '600078', 'tcd4@dropxlogistics.com', 13.037006, 80.191457),
  ('MEP', 'MEP', 'FLIPKART', 'MDH', 'No. 4 /46E, F, Edathil mukk, Meppayur, Kozhikode, KL, 673524', 'No. 4 /46E, F, Edathil mukk, Meppayur', 'Kozhikode', 'KL', '673524', 'mep@dropxlogistics.com', 11.542053, 75.712847),
  ('KTUO', 'KTUO', 'AMAZON', 'EDSP', '1/388E, Pothanikkad Road, Kozhipilly, Kothamangalam, Ernakulam, KL, 686691', '1/388E, Pothanikkad Road, Kozhipilly, Kothamangalam', 'Ernakulam', 'KL', '686691', 'ktuo@dropxlogistics.com', 10.05239, 76.63609),
  ('ERSN', 'ERSN', 'AMAZON', 'EDSP', '10/2C, Transformer Jn, Pallikkara, Payyoli, Kozhikode, KL, 673522', '10/2C, Transformer Jn, Pallikkara, Payyoli', 'Kozhikode', 'KL', '673522', 'ersn@dropxlogistics.com', 11.499292, 75.637566),
  ('TZC4', 'TZC4', 'AMAZON', 'NOW', '79/25, Rahat Building, Bansmandi Kanpur Nagar, Kanpur, UP, 208001', '79/25, Rahat Building, Bansmandi Kanpur Nagar', 'Kanpur', 'UP', '208001', 'tzc4@dropxlogistics.com', 26.462029, 80.341067),
  ('KLZA', 'KLZA', 'AMAZON', 'EDSP', 'Chethamangalam Temple Road, Chorode Panchayath, Vatakara, Kozhikode, KL, 673106', 'Chethamangalam Temple Road, Chorode Panchayath, Vatakara', 'Kozhikode', 'KL', '673106', 'klza@dropxlogistics.com', 11.61979, 75.58657),
  ('KTUR', 'KTUR', 'AMAZON', 'EDSP', '10/451A, Amarambalam Road, Vaniyambalam, Wandoor, Malappuram, KL, 679339', '10/451A, Amarambalam Road, Vaniyambalam, Wandoor', 'Malappuram', 'KL', '679339', 'ktur@dropxlogistics.com', 11.195707, 76.261065);

do $validation$
begin
  if (select count(*) from import_providers) <> 4 then
    raise exception 'Provider staging count is incorrect';
  end if;
  if (select count(*) from import_models) <> 7 then
    raise exception 'Model staging count is incorrect';
  end if;
  if (select count(*) from import_stations) <> 48 then
    raise exception 'Location staging count is incorrect';
  end if;
end
$validation$;

insert into public.providers (code, name, is_active)
select code, name, true
from import_providers
on conflict (code) do update
set name = excluded.name,
    is_active = true,
    updated_at = now();

insert into public.location_models (provider_id, code, name, description, is_active)
select p.id, m.code, m.name, null, true
from import_models m
join public.providers p on p.code = m.provider_code
on conflict (provider_id, code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true,
    updated_at = now();

insert into public.stations (
  station_code,
  station_name,
  provider_id,
  location_model_id,
  address,
  address_line1,
  address_line2,
  city,
  state,
  postal_code,
  station_email,
  latitude,
  longitude,
  is_active
)
select
  s.station_code,
  s.station_name,
  p.id,
  lm.id,
  s.address,
  s.address_line1,
  null,
  s.city,
  s.state,
  s.postal_code,
  s.station_email,
  s.latitude,
  s.longitude,
  true
from import_stations s
join public.providers p on p.code = s.provider_code
join public.location_models lm on lm.provider_id = p.id and lm.code = s.model_code
on conflict (station_code) do update
set station_name = excluded.station_name,
    provider_id = excluded.provider_id,
    location_model_id = excluded.location_model_id,
    address = excluded.address,
    address_line1 = excluded.address_line1,
    address_line2 = excluded.address_line2,
    city = excluded.city,
    state = excluded.state,
    postal_code = excluded.postal_code,
    station_email = excluded.station_email,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    is_active = true,
    updated_at = now();

-- Reassign provider-linked operational rows for renamed source codes before deleting old masters.
do $reassign$
declare
  relation record;
  old_provider_id uuid;
  new_provider_id uuid;
  provider_pair record;
begin
  for provider_pair in
    select * from (values ('HO', 'DROPX'), ('MESHO', 'MEESHO')) as pairs(old_code, new_code)
  loop
    select id into old_provider_id from public.providers where code = provider_pair.old_code;
    select id into new_provider_id from public.providers where code = provider_pair.new_code;
    if old_provider_id is null or new_provider_id is null or old_provider_id = new_provider_id then
      continue;
    end if;

    for relation in
      select tc.table_schema, tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.constraint_schema = kcu.constraint_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
       and ccu.constraint_schema = tc.constraint_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and ccu.table_schema = 'public'
        and ccu.table_name = 'providers'
        and tc.table_name not in ('providers', 'location_models', 'stations')
    loop
      execute format(
        'update %I.%I set %I = $1 where %I = $2',
        relation.table_schema,
        relation.table_name,
        relation.column_name,
        relation.column_name
      ) using new_provider_id, old_provider_id;
    end loop;
  end loop;
end
$reassign$;

-- Remove deleted location IDs from user scopes. Matching location UUIDs are preserved by the upsert above.
update public.profiles p
set location_scope_ids = coalesce((
  select array_agg(scope_id)
  from unnest(p.location_scope_ids) as scope_id
  where scope_id in (
    select s.id
    from public.stations s
    join import_stations i on i.station_code = s.station_code
  )
), '{}'::uuid[])
where p.location_scope_ids is not null;

delete from public.stations s
where not exists (
  select 1 from import_stations i where i.station_code = s.station_code
);

delete from public.location_models lm
where not exists (
  select 1
  from import_models i
  join public.providers p on p.code = i.provider_code
  where p.id = lm.provider_id and i.code = lm.code
);

delete from public.providers p
where not exists (
  select 1 from import_providers i where i.code = p.code
);

do $final_check$
begin
  if (select count(*) from public.providers) <> 4 then
    raise exception 'Final provider count is not 4';
  end if;
  if (select count(*) from public.location_models) <> 7 then
    raise exception 'Final model count is not 7';
  end if;
  if (select count(*) from public.stations) <> 48 then
    raise exception 'Final location count is not 48';
  end if;
end
$final_check$;

commit;

select 'providers' as item, count(*) as imported_count from public.providers
union all
select 'models', count(*) from public.location_models
union all
select 'locations', count(*) from public.stations;
