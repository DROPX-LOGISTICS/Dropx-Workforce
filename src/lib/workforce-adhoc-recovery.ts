import { calculateWorkforceEarnings, type WorkforceEarningsInput, type WorkforceRateCard } from './workforce-earnings';

export type AdhocRecoveryContext = {
  requestId: string; companyId: string; stationId: string; stationCode: string;
  providerMemberId: string | null; deploymentDate: string | null; hash: string;
  input: WorkforceEarningsInput;
};
export type AdhocRecoveryQuote = {
  state: 'pending_date' | 'pending_mapping' | 'pending_source' | 'pending_rate' | 'applied' | 'zero';
  reason: string; workforceId?: string; amount?: number; mode?: 'count' | 'daily';
  evidence?: unknown;
};
const number = (value: unknown) => Number(value ?? 0);
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Names identify a source row; only an effective ID mapping identifies a worker.
 * Source rows are never mutated. Cash paid in Ops is NOT the recovery amount. */
export function quoteAdhocDayRecovery(context: AdhocRecoveryContext): AdhocRecoveryQuote {
  const pending = (state: AdhocRecoveryQuote['state'], reason: string): AdhocRecoveryQuote => ({state, reason});
  if (!context.deploymentDate) return pending('pending_date', 'Missing or ambiguous actual Deployment Date');
  if (!context.providerMemberId) return pending('pending_mapping', 'Awaiting unique Provider ID evidence for the SCC name');
  const snapshot = calculateWorkforceEarnings({...context.input,
    shipments: context.input.shipments.filter(row => row.client.trim().toUpperCase() === 'AMAZON')});
  const target = snapshot.lines.filter(line => line.sourceType === 'shipment'
    && line.workDate === context.deploymentDate && line.stationId === context.stationId
    && line.providerName.toUpperCase() === 'AMAZON'
    && line.providerMemberId.trim().toUpperCase() === context.providerMemberId!.trim().toUpperCase());
  if (!target.length) return pending('pending_source', 'Awaiting actual deployment-day Amazon shipment import');
  const workers = new Set(target.map(line => line.workforceId));
  if (workers.size !== 1 || workers.has(null) || target.some(line => !line.mappingId)) {
    return pending('pending_mapping', 'Awaiting one unambiguous Provider ID mapping effective on the deployment day');
  }
  const worker = target[0].workforceId!;
  const modes = new Set<string>();
  let deduction = 0;
  const dailyCards = new Set<string>();
  for (const line of target) {
    const mapping = context.input.mappings.find(row => row.id === line.mappingId)!;
    const card = line.trace.policyVersion as WorkforceRateCard | undefined;
    const payType = String(card?.pay_type ?? mapping.pay_type ?? '').toUpperCase();
    if (payType.includes('MONTH') || payType.includes('HYBRID') || payType.includes('VAN_RENT')) {
      return pending('pending_rate', 'Monthly or mixed fixed/variable scheme requires a reviewed recovery rule');
    }
    if (card?.pay_type === 'fixed_daily') {
      modes.add('daily');
      if (!dailyCards.has(card.id)) {
        dailyCards.add(card.id);
        const group = snapshot.lines.filter(other => other.workforceId === worker && other.workDate === context.deploymentDate
          && other.rateCardId === card.id && other.sourceType === 'shipment');
        deduction += group.reduce((sum, other) => sum + other.baseAmount, 0);
      }
      continue;
    }
    if (line.status === 'missing_rate' || line.calculationSource === 'unresolved'
      || (Number(mapping.payment_values?.DROPX_PERSONAL_TERMS) === 1 && !card)) {
      return pending('pending_rate', 'Awaiting a supported shipment rate or daily-MG scheme');
    }
    modes.add('count');
    let value = 0;
    if (card?.componentRules?.length) {
      for (const component of card.componentRules) {
        if (component.rule.calculationBasis !== 'shipment_quantity') return pending('pending_rate', 'Mixed component scheme requires review');
        const metric = component.rule.sourceMetric;
        const units = metric === 'amazon_delivery' || metric === 'total_delivery' ? line.amazonDelivery
          : metric === 'customer_return' ? line.customerReturn
          : metric === 'total_activity' ? line.amazonDelivery + line.customerReturn : 0;
        value += units * component.rate;
      }
    } else if (card) {
      value = card.pay_type === 'per_activity'
        ? (line.amazonDelivery + line.customerReturn) * number(card.delivery_rate)
        : line.amazonDelivery * number(card.delivery_rate) + line.customerReturn * number(card.return_rate);
    } else {
      const rates = line.trace.rates as {delivery: number; customerReturn: number} | undefined;
      if (rates) value = line.amazonDelivery * rates.delivery + line.customerReturn * rates.customerReturn;
      else if (line.activityPayments.delivery !== null && line.activityPayments.customerReturn !== null) {
        value = (line.totalDelivery > 0 ? line.activityPayments.delivery * line.amazonDelivery / line.totalDelivery : 0)
          + line.activityPayments.customerReturn;
      } else return pending('pending_rate', 'Imported payout has no verified Delivery/C-return rate breakdown');
    }
    if (!Number.isFinite(value) || value < 0 || cents(value) > line.baseAmount) {
      return pending('pending_rate', 'Recovery exceeds verified day earnings; review the rate/import');
    }
    deduction += value;
  }
  if (modes.size !== 1) return pending('pending_rate', 'Conflicting day schemes require review');
  const workerDay = snapshot.lines.filter(line => line.workforceId === worker && line.workDate === context.deploymentDate && line.sourceType === 'shipment');
  const otherDaily = workerDay.filter(line => (line.trace.policyVersion as WorkforceRateCard | undefined)?.pay_type === 'fixed_daily');
  if ((modes.has('count') && otherDaily.length) || (modes.has('daily') && workerDay.some(line => !dailyCards.has(line.rateCardId ?? '')))) {
    return pending('pending_rate', 'Different daily schemes or mixed count/daily IDs for this associate require review');
  }
  const amount = cents(deduction);
  if (!Number.isFinite(amount) || amount < 0) return pending('pending_rate', 'Invalid calculated day amount');
  return {
    state: amount > 0 ? 'applied' : 'zero', workforceId: worker, amount,
    mode: modes.has('daily') ? 'daily' : 'count',
    reason: modes.has('daily') ? 'One daily-MG entitlement, not the Adhoc cash amount'
      : 'Amazon Delivery count × delivery rate + C-return count × return rate; other earnings retained',
    evidence: target.map(line => ({sourceId: line.sourceId, mappingId: line.mappingId, rateCardId: line.rateCardId,
      workDate: line.workDate, originalCounts: line.trace.counts, baseAmount: line.baseAmount, rate: line.trace}))
  };
}
