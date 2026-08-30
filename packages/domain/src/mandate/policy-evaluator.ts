import type { ActionRequestInput, PolicyReason, PolicySnapshot, TravelMandate, TravelCategory } from '@travel/contracts';

export interface PolicyDecision { allowed: boolean; requiresFreshUserDecision: boolean; reasons: PolicyReason[]; mandateVersion?: number }

const reason = (code: string, message: string, blocking = true): PolicyReason => ({ code, message, blocking });
const exposure = (snapshot: PolicySnapshot) => snapshot.currentBudget.estimated.amountCents + snapshot.currentBudget.reserved.amountCents + snapshot.currentBudget.committed.amountCents + snapshot.currentBudget.paid.amountCents - snapshot.currentBudget.released.amountCents;
const categoryFor = (kind?: ActionRequestInput['bookingType']): TravelCategory | undefined => kind === 'train' || kind === 'flight' ? 'transport' : kind;

export function evaluateExecutionPolicy(action: ActionRequestInput, mandate: TravelMandate | null, current: PolicySnapshot): PolicyDecision {
  const reasons: PolicyReason[] = [];
  const fresh = (code: string, message: string) => reasons.push(reason(code, message));
  const highRisk = action.risk === 'commit' || action.risk === 'redirect';
  if (action.kind === 'budget_override') fresh('action_not_authorized', 'budget overrides require a new explicit mandate');
  if (highRisk && action.kind === 'booking') {
    if (!action.supplierId) fresh('supplier_required', 'supplier is required for booking execution');
    if (!action.bookingType) fresh('booking_type_required', 'booking type is required for booking execution');
    if (action.refundable === undefined) fresh('refundability_required', 'refundability is required for booking execution');
    if (!action.offerSnapshotHash) fresh('offer_snapshot_required', 'offer snapshot is required for booking execution');
  }
  if (highRisk && action.kind === 'traveler_data' && (!action.requestedSensitiveFields || action.requestedSensitiveFields.length === 0)) {
    fresh('sensitive_fields_required', 'requested sensitive fields are required');
  }
  if (!mandate) {
    if (highRisk || action.kind === 'traveler_data' || action.kind === 'cancel' || action.kind === 'refund') {
      fresh('user_confirmation_required', 'a fresh user decision is required for this action');
      return { allowed: false, requiresFreshUserDecision: true, reasons };
    }
    return { allowed: true, requiresFreshUserDecision: false, reasons };
  }
  if (mandate.tripId !== action.tripId) fresh('mandate_trip_mismatch', 'mandate does not belong to this trip');
  const now = Date.parse(current.now);
  if (mandate.revokedAt && Date.parse(mandate.revokedAt) <= now) fresh('mandate_revoked', 'mandate has been revoked');
  if (Date.parse(mandate.validUntil) <= now) fresh('mandate_expired', 'mandate has expired');
  if (action.supplierId && !mandate.allowedSuppliers.includes(action.supplierId)) fresh('supplier_not_allowed', 'supplier is not allow-listed');
  if (action.bookingType && !mandate.allowedBookingTypes.includes(action.bookingType)) fresh('booking_type_not_allowed', 'booking type is outside the mandate');
  if (mandate.refundableOnly && action.refundable === false) fresh('non_refundable_not_allowed', 'only refundable offers are allowed');
  if (action.requestedAmount) {
    if (action.requestedAmount.amountCents > mandate.maxSingleOrderAmount.amountCents) fresh('single_order_limit_exceeded', 'single order amount exceeds mandate limit');
    if (exposure(current) + action.requestedAmount.amountCents > mandate.totalBudgetLimit.amountCents) fresh('budget_exceeded', 'action exceeds mandate budget');
    const category = categoryFor(action.bookingType);
    const limit = category ? mandate.categoryLimits[category]?.amountCents : undefined;
    const paid = category ? current.currentBudget.categoryPaid[category]?.amountCents ?? 0 : 0;
    if (limit !== undefined && paid + action.requestedAmount.amountCents > limit) fresh('category_budget_exceeded', 'action exceeds category budget');
  }
  if (action.offerSnapshotHash && action.offerSnapshotHash !== current.currentOfferSnapshotHash) fresh('price_or_offer_changed', 'offer changed since the policy decision');
  if (action.requestedSensitiveFields?.some(field => !mandate.allowedSensitiveFields.includes(field))) fresh('sensitive_field_not_allowed', 'requested sensitive field is outside the mandate');
  if (action.kind === 'cancel' && highRisk) fresh('high_risk_cancellation', 'cancellation requires a fresh user decision');
  return { allowed: reasons.every(item => !item.blocking), requiresFreshUserDecision: reasons.some(item => item.code === 'user_confirmation_required' || item.code === 'price_or_offer_changed' || item.code === 'high_risk_cancellation'), reasons, mandateVersion: mandate.version };
}
