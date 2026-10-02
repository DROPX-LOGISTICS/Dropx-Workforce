import test from 'node:test';
import assert from 'node:assert/strict';
import { groupProviderPendency, recentProviderObservations, clientIdPending } from './provider-pendency.ts';
const observation = (changes = {}) => ({ id: 'a', providerId: 'amazon', providerMemberId: '2001', providerName: 'Amazon', sourceName: 'DA', stationCode: 'A', firstSeen: '2026-06-01', lastSeen: '2026-09-30', dailyRows: 3, deliveries: 12, reason: 'Unlinked', ...changes });
test('one client ID counts once across stations while retaining evidence', () => {
  const rows = groupProviderPendency([observation(), observation({ stationCode: 'B', deliveries: 0, suggestedWorkforceId: 'do-not-carry' })]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].stationCodes, ['A', 'B']);
  assert.equal(rows[0].dailyRows, 6);
  assert.equal(rows[0].deliveries, 12);
  assert.equal(rows[0].suggestedWorkforceId, undefined);
});
test('client boundaries remain separate and station filtering retains local activity', () => {
  const source = [observation(), observation({providerId:'other'}), observation({stationCode:'B'})];
  assert.equal(groupProviderPendency(source).length, 2);
  assert.equal(groupProviderPendency(source.filter(row=>row.stationCode==='B'))[0].dailyRows, 3);
});
test('latest report month drives recent pendency across a calendar rollover', () => {
  const source = [observation(), observation({providerMemberId:'older',lastSeen:'2026-08-31'}), observation({providerMemberId:'future',lastSeen:'2026-10-01'})];
  assert.deepEqual(recentProviderObservations(source,'2026-09-30').map(row=>row.providerMemberId), ['2001']);
  assert.deepEqual(recentProviderObservations(source,''), []);
});
test('latest name and original history survive grouping without mutating source', () => {
  const older = observation({sourceName:'Old import',lastSeen:'2026-06-30'});
  const newer = observation({sourceName:'Latest import',firstSeen:'2026-09-01'});
  assert.equal(groupProviderPendency([older,newer])[0].sourceName,'Latest import');
  assert.equal(groupProviderPendency([older,newer])[0].firstSeen,'2026-06-01');
  assert.equal(older.dailyRows,3);
});
test('client ID pendency excludes designations that do not require an ID', () => {
  assert.equal(clientIdPending({providerMemberId:'',requiresProviderId:false}),false);
  assert.equal(clientIdPending({providerMemberId:'',requiresProviderId:true}),true);
  assert.equal(clientIdPending({providerMemberId:'2001',requiresProviderId:true}),false);
});
