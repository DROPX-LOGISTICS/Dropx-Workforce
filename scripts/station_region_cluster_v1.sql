alter table public.stations
  add column if not exists region text,
  add column if not exists cluster text;

create index if not exists stations_company_region_cluster_idx
  on public.stations(company_id, region, cluster, station_code);

create temporary table station_hierarchy_import (
  station_code text primary key,
  station_name text not null,
  state_name text not null,
  region text not null,
  cluster text not null
) on commit drop;

insert into station_hierarchy_import (station_code, station_name, state_name, region, cluster) values
('KGQA','Kasargod','Kerala','KL','Sreerag'),('KGQC','Kasargod','Kerala','KL','Sreerag'),('TLPA','Chalode','Kerala','KL','Sreerag'),('TLPB','Iritty','Kerala','KL','Sreerag'),
('PEUA','Kuttiady','Kerala','KL','Sreejyothish'),('KGQE','Nadapuram','Kerala','KL','Sreejyothish'),('PMB','Perambra','Kerala','KL','Sreejyothish'),('CHM','Chempanoda','Kerala','KL','Sreejyothish'),
('QLDA','Koyilandy','Kerala','KL','Shihab'),('KOZA','Kozhikode','Kerala','KL','Shihab'),('KLZH','Sulthan Bathery','Kerala','KL','Shihab'),('KTUB','Nilambur','Kerala','KL','Shihab'),('KTUH','Vaniyambalam','Kerala','KL','Shihab'),
('ERSE','Perumbavoor','Kerala','KL','Dhananjay'),('GDRD','Gudur','Andhra Pradesh','AP','Suresh'),('XAPH','Kota','Andhra Pradesh','AP','Suresh'),('GNTF','Amaravathi','Andhra Pradesh','AP','Bharat'),
('GNTI','Cheerala','Andhra Pradesh','AP','Bharat'),('XAPL','Inkollu','Andhra Pradesh','AP','Bharat'),('GYMC','Chandragiri','Andhra Pradesh','AP','Bharat'),('XAPI','Bakharapeta','Andhra Pradesh','AP','Bharat'),
('NLRC','Buchireddy Palem','Andhra Pradesh','AP','Bharat'),('NLRE','Parameshwar Nagar','Andhra Pradesh','AP','Suresh'),('NLRF','Kavali','Andhra Pradesh','AP','Bharat'),('TIRC','Puthur','Andhra Pradesh','AP','Bharat'),
('JDBD','Jagdalpur','Chattisgarh','ODCG','Himansu'),('JGBA','Kondagaon','Chattisgarh','ODCG','Himansu'),('RPRN','Narayanpur','Chattisgarh','ODCG','Himansu'),
('JUGD','Jharsughuda','Odisha','ODCG','Jagathnath'),('SPBE','Kuchinda','Odisha','ODCG','Jagathnath'),('JUGF','Sundergarh','Odisha','ODCG','Jagathnath'),('KANA','Phulbani','Odisha','ODCG','Jagathnath'),
('KDJE','Barbil','Odisha','ODCG','Jagathnath'),('KDJG','Champua','Odisha','ODCG','Jagathnath'),('SBPD','Sambalpur','Odisha','ODCG','Jagathnath'),('JUGE','Bandhbahal','Odisha','ODCG','Jagathnath'),
('PHN','Phulnakhra','Odisha','ODCG','Jagathnath'),('KTUO','Kothamangalam','Kerala','KL','Dhananjay'),('HBSC','Sambalpur','Odisha','ODCG','Jagathnath'),('MEP','Meppayur','Kerala','KL','Sreejyothish'),
('AWEZ','Kalady','Kerala','KL','Dhananjay'),('RENG','Rengali','Odisha','ODCG','Jagathnath'),('HO','Manjeri','Kerala','KL','Suja'),('ERSN','Payyoli','Kerala','KL','Sreejyothish'),('KLZA','Vadakara','Kerala','KL','Sreejyothish');

update public.stations as station
set station_name = source.station_name,
    state = source.state_name,
    region = source.region,
    cluster = source.cluster
from station_hierarchy_import as source
where upper(station.station_code) = source.station_code;
