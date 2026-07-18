export type FleetVehicleMaster = {
  vehicle_no: string;
  station_code: string;
  rc_location: string;
  registration_expiry: string;
  insurance_expiry: string;
  puc_expiry: string;
  fitness_expiry: string;
  tax_expiry: string;
  model: string;
  fuel_type: string;
};

export const fleetVehicles: FleetVehicleMaster[] = [
  { vehicle_no: "KL11BW5621", station_code: "KOZA", rc_location: "KOZA", registration_expiry: "2037-08-23", insurance_expiry: "2026-08-17", puc_expiry: "", fitness_expiry: "2027-01-09", tax_expiry: "2027-06-30", model: "OSM Range+", fuel_type: "EV" },
  { vehicle_no: "KL11BX0723", station_code: "KOZA", rc_location: "PMB", registration_expiry: "2037-11-13", insurance_expiry: "2026-11-14", puc_expiry: "", fitness_expiry: "2027-03-13", tax_expiry: "2027-09-30", model: "OSM Range+", fuel_type: "EV" },
  { vehicle_no: "KL11BX0806", station_code: "KOZA", rc_location: "KOZA", registration_expiry: "2037-11-16", insurance_expiry: "2026-11-14", puc_expiry: "", fitness_expiry: "2026-12-11", tax_expiry: "2027-09-30", model: "OSM Range+", fuel_type: "EV" },
  { vehicle_no: "KL11BY6479", station_code: "KLZH", rc_location: "KOZA", registration_expiry: "2038-09-06", insurance_expiry: "2026-09-03", puc_expiry: "2026-10-07", fitness_expiry: "2027-10-08", tax_expiry: "2028-06-30", model: "Mahindra Jeeto+", fuel_type: "Diesel" },
  { vehicle_no: "KL11BZ0701", station_code: "KTUB", rc_location: "KLZH", registration_expiry: "As per Fitness", insurance_expiry: "2026-11-20", puc_expiry: "2026-11-19", fitness_expiry: "2025-11-22", tax_expiry: "2028-09-30", model: "Piaggio Ape Xtra LDX", fuel_type: "Diesel" },
  { vehicle_no: "KL11BZ0772", station_code: "KTUB", rc_location: "RTO Agent", registration_expiry: "As per Fitness", insurance_expiry: "2026-12-02", puc_expiry: "2027-03-01", fitness_expiry: "2028-03-16", tax_expiry: "2028-09-30", model: "Piaggio Ape Xtra LDX", fuel_type: "Diesel" },
  { vehicle_no: "KL11BZ1869", station_code: "ERSE", rc_location: "PMB", registration_expiry: "As per Fitness", insurance_expiry: "2026-12-09", puc_expiry: "2026-12-09", fitness_expiry: "2028-01-12", tax_expiry: "2028-09-30", model: "Mahindra Jeeto+", fuel_type: "Diesel" },
  { vehicle_no: "KL11BZ1872", station_code: "ERSE", rc_location: "PMB", registration_expiry: "As per Fitness", insurance_expiry: "2026-12-11", puc_expiry: "2027-01-07", fitness_expiry: "2028-01-08", tax_expiry: "2028-09-30", model: "Mahindra Jeeto+", fuel_type: "Diesel" },
  { vehicle_no: "KL11BZ1894", station_code: "KOZA", rc_location: "KOZA", registration_expiry: "As per Fitness", insurance_expiry: "2026-12-26", puc_expiry: "2026-12-25", fitness_expiry: "2027-12-29", tax_expiry: "2028-09-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11BZ9896", station_code: "PEUA", rc_location: "KOZA", registration_expiry: "As per Fitness", insurance_expiry: "2027-05-13", puc_expiry: "2026-05-16", fitness_expiry: "2026-05-17", tax_expiry: "2029-03-31", model: "Piaggio Ape Xtra LDX", fuel_type: "Diesel" },
  { vehicle_no: "KL11CA1432", station_code: "TLPA", rc_location: "KOZA", registration_expiry: "As per Fitness", insurance_expiry: "2027-05-13", puc_expiry: "2026-06-10", fitness_expiry: "2026-06-12", tax_expiry: "2029-03-31", model: "Piaggio Ape Xtra LDX", fuel_type: "CNG" },
  { vehicle_no: "KL11CA5156", station_code: "KGQA", rc_location: "KOZA", registration_expiry: "As per Fitness", insurance_expiry: "2026-08-18", puc_expiry: "2026-08-25", fitness_expiry: "2026-08-23", tax_expiry: "2029-06-30", model: "Piaggio Ape Xtra LDX", fuel_type: "Diesel" },
  { vehicle_no: "KL60S6982", station_code: "ERSN", rc_location: "ERSN", registration_expiry: "2036-04-16", insurance_expiry: "2026-04-15", puc_expiry: "2027-02-04", fitness_expiry: "2028-02-09", tax_expiry: "2026-03-31", model: "TATA Ace Gold", fuel_type: "Petrol" },
  { vehicle_no: "KL11CB7565", station_code: "KGQA", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2027-04-01", puc_expiry: "2026-04-02", fitness_expiry: "2027-04-02", tax_expiry: "2029-12-31", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CB7606", station_code: "KOZA", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2027-04-01", puc_expiry: "2027-04-20", fitness_expiry: "2027-04-03", tax_expiry: "2029-12-31", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CB7682", station_code: "KTUB", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2027-04-01", puc_expiry: "2027-04-19", fitness_expiry: "2027-04-02", tax_expiry: "2029-12-31", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CB8204", station_code: "QLDA", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2027-04-16", puc_expiry: "2026-04-18", fitness_expiry: "2027-04-18", tax_expiry: "2030-03-31", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CB8252", station_code: "PEUA", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2027-04-16", puc_expiry: "2026-04-18", fitness_expiry: "2027-04-18", tax_expiry: "2030-03-31", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC2822", station_code: "TLPB", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-09", puc_expiry: "2026-07-16", fitness_expiry: "2027-07-16", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC2815", station_code: "TLPB", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-04", puc_expiry: "2026-07-16", fitness_expiry: "2027-07-16", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC2857", station_code: "TLPB", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-06", puc_expiry: "2026-07-16", fitness_expiry: "2027-07-16", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC2832", station_code: "TLPA", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-09", puc_expiry: "2026-07-16", fitness_expiry: "2027-07-16", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC2749", station_code: "QLDA", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-09", puc_expiry: "2026-07-15", fitness_expiry: "2027-07-15", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC2758", station_code: "QLDA", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-09", puc_expiry: "2026-07-15", fitness_expiry: "2027-07-15", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC2792", station_code: "KGQA", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-04", puc_expiry: "2026-07-15", fitness_expiry: "2027-07-15", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC3037", station_code: "ERSE", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-18", puc_expiry: "2026-07-21", fitness_expiry: "2027-07-21", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC3093", station_code: "ERSE", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-20", puc_expiry: "2026-07-21", fitness_expiry: "2027-07-21", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC3048", station_code: "PMB", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-20", puc_expiry: "2026-07-21", fitness_expiry: "2027-07-21", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC3016", station_code: "ERSE", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-20", puc_expiry: "2026-07-21", fitness_expiry: "2027-07-21", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC3098", station_code: "ERSE", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-20", puc_expiry: "2026-07-21", fitness_expiry: "2027-07-21", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC3058", station_code: "ERSE", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-20", puc_expiry: "2026-07-21", fitness_expiry: "2027-07-21", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" },
  { vehicle_no: "KL11CC3081", station_code: "ERSE", rc_location: "Digital", registration_expiry: "As per Fitness", insurance_expiry: "2026-07-18", puc_expiry: "2026-07-21", fitness_expiry: "2027-07-21", tax_expiry: "2030-06-30", model: "Mahindra Jeeto Strong", fuel_type: "Diesel" }
];
