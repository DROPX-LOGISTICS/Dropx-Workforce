import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateWorkforceEarnings,
  isWorkforceDate,
  workforceEarningsDateRange,
  workforceToday
} from "./workforce-earnings.ts";

function input(overrides = {}) {
  return {
    from: "2026-08-01",
    to: "2026-08-31",
    providers: [{ id: "provider-1", code: "AMAZON", name: "Amazon" }],
    stations: [{ id: "station-1", station_code: "ERSE", station_name: "Ernakulam" }],
    workforce: [{
      id: "workforce-1",
      full_name: "Test Associate",
      dropx_id: "DROPX100",
      designation_id: "designation-1",
      location_id: "station-1",
      source_profile_type: "field_executive",
      source_profile_id: "source-1",
      onboarding_status: "active",
      lifecycle_status: "active",
      is_active: true,
      bank_account_no: "1234567890",
      ifsc_code: "TEST0001"
    }],
    mappings: [{
      id: "mapping-1",
      workforce_id: null,
      field_executive_id: "source-1",
      contractor_id: null,
      employee_id: null,
      provider_id: "provider-1",
      station_id: "station-1",
      provider_member_id: "AMZ-100",
      effective_from: "2026-08-01",
      effective_to: null,
      pay_type: "PER_PACKET",
      payment_values: { DELIVERY_RATE: 10 },
      delivery_rate: null,
      pickup_rate: null,
      mfn_rate: null,
      mfn_return_rate: null,
      guarantee_amount: null,
      fuel_rate: null,
      status: "active"
    }],
    shipments: [{
      id: "shipment-1",
      client: "Amazon",
      work_date: "2026-08-20",
      station_code: "ERSE",
      provider_employee_id: "AMZ-100",
      provider_employee_name: "Test Associate",
      amazon_delivery: 30,
      swa_delivery: 0,
      c_return: 2,
      mfn: 0,
      mfn_return: 0,
      total_delivery: 30,
      total_activity: 32,
      da_total_pay: 0,
      mapping_status: "Mapped",
      updated_at: "2026-08-20T18:00:00.000Z"
    }],
    rateCards: [],
    campaigns: [],
    adjustments: [],
    ...overrides
  };
}

test("calculates live mapped earnings from shipment count and configured rate", () => {
  const result = calculateWorkforceEarnings(input());
  assert.equal(result.totalShipments, 30);
  assert.equal(result.totalBase, 300);
  assert.equal(result.totalNet, 300);
  assert.equal(result.readyWorkers, 1);
  assert.equal(result.exceptions.length, 0);
  assert.equal(result.summaries[0].bankAccountNo, "1234567890");
  assert.equal(result.summaries[0].ifscCode, "TEST0001");
});

test("resolves mappings transitioned directly to the canonical Workforce register", () => {
  const base = input();
  const result = calculateWorkforceEarnings(input({
    mappings: [{
      ...base.mappings[0],
      workforce_id: "workforce-1",
      field_executive_id: null
    }]
  }));
  assert.equal(result.totalShipments, 30);
  assert.equal(result.totalBase, 300);
  assert.equal(result.lines[0].workforceId, "workforce-1");
  assert.equal(result.lines[0].status, "ready");
});

test("supports the payment-head keys already stored in provider mappings", () => {
  const base = input();
  const result = calculateWorkforceEarnings(input({
    mappings: [{
      ...base.mappings[0],
      payment_values: { DELIVERY: 10, CRETURN: 5, SELLER_PICKUP: 4, SLLLER_RETURN: 2 }
    }],
    shipments: [{ ...base.shipments[0], c_return: 2, mfn: 3, mfn_return: 1, total_activity: 36 }]
  }));
  assert.equal(result.totalBase, 324);
  assert.equal(result.lines[0].trace.rates.customerReturn, 5);
  assert.equal(result.lines[0].trace.rates.mfn, 4);
  assert.equal(result.lines[0].trace.rates.mfnReturn, 2);
});

test("uses the most specific effective rate card and applies daily incentives", () => {
  const result = calculateWorkforceEarnings(input({
    rateCards: [{
      id: "card-1",
      company_id: "company-1",
      name: "ERSE Delivery",
      provider_id: "provider-1",
      station_id: "station-1",
      designation_id: "designation-1",
      pay_type: "per_shipment",
      effective_from: "2026-08-15",
      effective_to: null,
      delivery_rate: 12,
      return_rate: 5,
      mfn_rate: 0,
      mfn_return_rate: 0,
      fuel_rate: 1,
      fixed_amount: 0,
      guarantee_amount: 0,
      status: "active"
    }],
    campaigns: [{
      id: "campaign-1",
      name: "30+ delivery sprint",
      provider_id: "provider-1",
      station_id: "station-1",
      designation_id: null,
      metric: "total_delivery",
      calculation_type: "flat_threshold",
      threshold_value: 30,
      rate_value: 0,
      flat_amount: 100,
      maximum_amount: null,
      effective_from: "2026-08-18",
      effective_to: "2026-08-25",
      status: "active"
    }]
  }));
  assert.equal(result.totalBase, 400);
  assert.equal(result.totalIncentives, 100);
  assert.equal(result.totalNet, 500);
  assert.equal(result.lines[0].calculationSource, "rate_card");
});

test("supports activity, fixed daily, fixed monthly and hybrid payment types", () => {
  const cases = [
    { pay_type: "per_activity", delivery_rate: 10, fuel_rate: 1, fixed_amount: 0, guarantee_amount: 0, expected: 350 },
    { pay_type: "fixed_daily", delivery_rate: 0, fuel_rate: 0, fixed_amount: 700, guarantee_amount: 0, expected: 700 },
    { pay_type: "fixed_monthly", delivery_rate: 0, fuel_rate: 0, fixed_amount: 31000, guarantee_amount: 0, expected: 1000 },
    { pay_type: "hybrid", delivery_rate: 10, fuel_rate: 0, fixed_amount: 0, guarantee_amount: 500, expected: 500 }
  ];
  for (const paymentCase of cases) {
    const result = calculateWorkforceEarnings(input({
      rateCards: [{
        id: `card-${paymentCase.pay_type}`,
        company_id: "company-1",
        name: paymentCase.pay_type,
        provider_id: "provider-1",
        station_id: "station-1",
        designation_id: "designation-1",
        effective_from: "2026-08-01",
        effective_to: null,
        return_rate: 0,
        mfn_rate: 0,
        mfn_return_rate: 0,
        status: "active",
        ...paymentCase
      }]
    }));
    assert.equal(result.totalBase, paymentCase.expected, paymentCase.pay_type);
  }
});

test("uses an active rate card ahead of an imported payout and otherwise preserves the import", () => {
  const base = input();
  const importedOnly = calculateWorkforceEarnings(input({
    shipments: [{ ...base.shipments[0], da_total_pay: 777 }]
  }));
  assert.equal(importedOnly.totalBase, 777);
  assert.equal(importedOnly.lines[0].calculationSource, "imported_payout");

  const governed = calculateWorkforceEarnings(input({
    shipments: [{ ...base.shipments[0], da_total_pay: 777 }],
    rateCards: [{
      id: "governed-card",
      company_id: "company-1",
      name: "Approved commercial rule",
      provider_id: "provider-1",
      station_id: "station-1",
      designation_id: "designation-1",
      pay_type: "per_shipment",
      effective_from: "2026-08-01",
      effective_to: null,
      delivery_rate: 11,
      return_rate: 0,
      mfn_rate: 0,
      mfn_return_rate: 0,
      fuel_rate: 0,
      fixed_amount: 0,
      guarantee_amount: 0,
      status: "active"
    }]
  }));
  assert.equal(governed.totalBase, 330);
  assert.equal(governed.lines[0].calculationSource, "rate_card");
});

test("keeps unmapped shipments out of payable worker totals and exposes an exception", () => {
  const result = calculateWorkforceEarnings(input({ mappings: [] }));
  assert.equal(result.totalSourceShipments, 30);
  assert.equal(result.totalShipments, 0);
  assert.equal(result.totalNet, 0);
  assert.equal(result.summaries.length, 0);
  assert.equal(result.exceptions.length, 1);
  assert.equal(result.exceptions[0].status, "unmapped");
});

test("does not guess when one provider ID is ambiguous across unknown providers", () => {
  const base = input();
  const secondMapping = { ...base.mappings[0], id: "mapping-2", provider_id: "provider-2" };
  const result = calculateWorkforceEarnings(input({
    providers: [
      { id: "provider-1", code: "AMAZON", name: "Amazon" },
      { id: "provider-2", code: "OTHER", name: "Other Provider" }
    ],
    mappings: [...base.mappings, secondMapping],
    shipments: [{ ...base.shipments[0], client: "Unrecognized Provider Label" }]
  }));
  assert.equal(result.summaries.length, 0);
  assert.equal(result.exceptions[0].status, "unmapped");
  assert.match(result.exceptions[0].holdReasons.join(" "), /multiple providers/i);
});

test("does not guess across stations when an imported station is unknown", () => {
  const base = input();
  const secondMapping = { ...base.mappings[0], id: "mapping-station-2", station_id: "station-2" };
  const result = calculateWorkforceEarnings(input({
    mappings: [...base.mappings, secondMapping],
    shipments: [{ ...base.shipments[0], station_code: "UNKNOWN" }]
  }));
  assert.equal(result.summaries.length, 0);
  assert.equal(result.exceptions[0].status, "unmapped");
  assert.match(result.exceptions[0].holdReasons.join(" "), /station code/i);
});

test("holds an unknown station even when the provider ID has one candidate", () => {
  const base = input();
  const result = calculateWorkforceEarnings(input({
    shipments: [{ ...base.shipments[0], station_code: "UNKNOWN" }]
  }));
  assert.equal(result.summaries.length, 0);
  assert.equal(result.exceptions[0].status, "unmapped");
  assert.match(result.exceptions[0].holdReasons.join(" "), /station code/i);
});

test("does not choose between overlapping mappings assigned to different people", () => {
  const base = input();
  const secondWorkforce = {
    ...base.workforce[0],
    id: "workforce-2",
    source_profile_id: "source-2",
    dropx_id: "DROPX200",
    full_name: "Second Associate"
  };
  const secondMapping = {
    ...base.mappings[0],
    id: "mapping-person-2",
    field_executive_id: "source-2"
  };
  const result = calculateWorkforceEarnings(input({
    workforce: [...base.workforce, secondWorkforce],
    mappings: [...base.mappings, secondMapping]
  }));
  assert.equal(result.summaries.length, 0);
  assert.equal(result.exceptions[0].status, "unmapped");
  assert.match(result.exceptions[0].holdReasons.join(" "), /overlapping mappings/i);
});

test("prefers an exact-station ID mapping over an all-station fallback", () => {
  const base = input();
  const fallback = {
    ...base.mappings[0],
    id: "mapping-all-stations",
    station_id: null,
    payment_values: { DELIVERY: 5 }
  };
  const result = calculateWorkforceEarnings(input({ mappings: [fallback, ...base.mappings] }));
  assert.equal(result.totalBase, 300);
  assert.equal(result.lines[0].mappingId, "mapping-1");
});

test("includes approved ad hoc earnings and deductions with an auditable source", () => {
  const result = calculateWorkforceEarnings(input({
    adjustments: [
      { id: "bonus", workforce_id: "workforce-1", adjustment_type: "earning", category: "exception_delivery", amount: 250, effective_date: "2026-08-21", reason: "Approved exception", status: "approved" },
      { id: "deduction", workforce_id: "workforce-1", adjustment_type: "deduction", category: "asset_recovery", amount: 50, effective_date: "2026-08-22", reason: "Helmet recovery", status: "approved" }
    ]
  }));
  assert.equal(result.totalAdjustments, 250);
  assert.equal(result.totalDeductions, 50);
  assert.equal(result.totalNet, 500);
  assert.equal(result.summaries[0].grossAmount, 550);
});

test("accrues earnings but holds payout when bank details are incomplete", () => {
  const base = input();
  base.workforce[0].bank_account_no = null;
  const result = calculateWorkforceEarnings(base);
  assert.equal(result.totalNet, 300);
  assert.equal(result.heldWorkers, 1);
  assert.match(result.summaries[0].holdReasons.join(" "), /Bank details/i);
});

test("holds a non-positive net amount out of payable payroll", () => {
  const result = calculateWorkforceEarnings(input({
    adjustments: [
      { id: "large-recovery", workforce_id: "workforce-1", adjustment_type: "deduction", category: "cash_recovery", amount: 400, effective_date: "2026-08-22", reason: "Approved recovery", status: "approved" }
    ]
  }));
  assert.equal(result.summaries[0].netAmount, -100);
  assert.equal(result.heldWorkers, 1);
  assert.match(result.summaries[0].holdReasons.join(" "), /zero or negative/i);
});

test("validates real calendar dates before using them in finance queries", () => {
  assert.equal(isWorkforceDate("2026-08-31"), true);
  assert.equal(isWorkforceDate("2026-02-29"), false);
  assert.equal(isWorkforceDate("2026-99-99"), false);
  assert.deepEqual(workforceEarningsDateRange({ from: "2026-99-99", to: "2026-08-31" }), {
    from: "2026-08-01",
    to: "2026-08-31"
  });
});

test("uses the India business date at the UTC day boundary", () => {
  assert.equal(workforceToday(new Date("2026-08-28T20:00:00.000Z")), "2026-08-29");
});
