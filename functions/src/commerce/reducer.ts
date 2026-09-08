import {
  COMMERCE_GRANTS_CONTRACT,
  grantId,
  validateEvent,
  type CommerceGrant,
  type EventAction,
  type GrantState,
  type VerifiedCommerceEvent,
} from './contracts.js';

export const EVENT_PRECEDENCE: Record<EventAction, number> = {
  grant: 10,
  renew: 10,
  'enter-grace': 20,
  expire: 30,
  revoke: 40,
  refund: 50,
};
const stateFor: Record<EventAction, GrantState> = {
  grant: 'active',
  renew: 'active',
  'enter-grace': 'grace',
  expire: 'expired',
  revoke: 'revoked',
  refund: 'refunded',
};

export function reduceCommerceGrant(
  current: CommerceGrant | null,
  event: VerifiedCommerceEvent,
): CommerceGrant {
  validateEvent(event);
  const id = grantId(event.ownerUid, event.sourceChannel, event.sourceGrantKeyHash);
  if (current) assertIdentity(current, event, id);
  const precedence = EVENT_PRECEDENCE[event.action];
  if (current && compareCursor(event.effectiveAt, precedence, event.eventKey, current) <= 0)
    return current;
  const createdAt = current?.createdAt ?? event.receivedAt;
  return {
    schemaVersion: 1,
    contractVersion: COMMERCE_GRANTS_CONTRACT,
    ownerUid: event.ownerUid,
    grantId: id,
    entitlementKey: event.entitlementKey,
    productKind: event.productKind,
    ...(event.resourceId ? { resourceId: event.resourceId } : {}),
    accessModel: event.accessModel,
    state: stateFor[event.action],
    sourceChannel: event.sourceChannel,
    sourceGrantKeyHash: event.sourceGrantKeyHash,
    validFrom: current?.validFrom ?? event.effectiveAt,
    ...(event.validUntil ? { validUntil: event.validUntil } : {}),
    lastEventAt: event.effectiveAt,
    lastEventPrecedence: precedence,
    lastEventKey: event.eventKey,
    createdAt,
    updatedAt: event.receivedAt,
  };
}

function compareCursor(at: string, precedence: number, key: string, current: CommerceGrant) {
  const time = at.localeCompare(current.lastEventAt);
  if (time) return time;
  if (precedence !== current.lastEventPrecedence) return precedence - current.lastEventPrecedence;
  return key.localeCompare(current.lastEventKey);
}
function assertIdentity(current: CommerceGrant, event: VerifiedCommerceEvent, id: string) {
  if (
    current.ownerUid !== event.ownerUid ||
    current.grantId !== id ||
    current.entitlementKey !== event.entitlementKey ||
    current.productKind !== event.productKind ||
    current.resourceId !== event.resourceId ||
    current.accessModel !== event.accessModel ||
    current.sourceChannel !== event.sourceChannel ||
    current.sourceGrantKeyHash !== event.sourceGrantKeyHash
  )
    throw new Error('grant-identity-mismatch');
}
