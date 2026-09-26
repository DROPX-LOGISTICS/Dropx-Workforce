import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentMethodInput } from './payment-method-input.ts';
const id = '10000000-0000-0000-0000-000000000001';
function form() { const f = new FormData(); f.set('code', ' per_packet '); f.set('name', ' Per Packet '); f.set('source_of_truth','amazon_daily_shipment'); f.append('field_ids', id); return f; }
test('normalizes codes and deduplicates shared field IDs', () => {
  const f = form(); f.append('field_ids', id);
  assert.deepEqual(parsePaymentMethodInput(f, false), { id: null, code: 'PER_PACKET', name: 'Per Packet', fieldIds: [id], sourceOfTruth:'amazon_daily_shipment', calculationBasis:'shipment_activity' });
});
test('rejects missing fields, malformed IDs and arbitrary codes', () => {
  for (const [key, value] of [['field_ids', 'bad'], ['code', 'bad code'], ['name', '']]) {
    const f = form(); f.set(key, value); assert.throws(() => parsePaymentMethodInput(f, false));
  }
  const f = form(); f.delete('field_ids'); assert.throws(() => parsePaymentMethodInput(f, false));
  assert.throws(() => parsePaymentMethodInput(form(), true));
});
