import { createHash } from 'node:crypto';

export const COMMERCE_FOUNDATION_CONTRACT = 'commerce-foundation-v1' as const;
export const COMMERCE_GRANTS_CONTRACT = 'commerce-entitlement-grants-v1' as const;
export const COMMERCE_EVENTS_CONTRACT = 'commerce-provider-events-v1' as const;
export const COMMERCE_ACCESS_CONTRACT = 'commerce-access-snapshot-v1' as const;

export type CommerceChannel = 'google-play' | 'stripe-web' | 'test';
export type ProductKind =
  | 'optiform-pro'
  | 'creator-program'
  | 'creator-membership'
  | 'trainer-package'
  | 'gym-business-plan';
export type AccessModel = 'perpetual' | 'time-bound';
export type GrantState = 'active' | 'grace' | 'expired' | 'revoked' | 'refunded';
export type EventAction = 'grant' | 'renew' | 'enter-grace' | 'expire' | 'revoke' | 'refund';

export type VerifiedCommerceEvent = {
  schemaVersion: 1;
  contractVersion: typeof COMMERCE_EVENTS_CONTRACT;
  eventKey: string;
  ownerUid: string;
  sourceChannel: CommerceChannel;
  sourceGrantKeyHash: string;
  entitlementKey: string;
  productKind: ProductKind;
  resourceId?: string;
  accessModel: AccessModel;
  action: EventAction;
  effectiveAt: string;
  validUntil?: string;
  receivedAt: string;
};
export type CommerceGrant = {
  schemaVersion: 1;
  contractVersion: typeof COMMERCE_GRANTS_CONTRACT;
  ownerUid: string;
  grantId: string;
  entitlementKey: string;
  productKind: ProductKind;
  resourceId?: string;
  accessModel: AccessModel;
  state: GrantState;
  sourceChannel: CommerceChannel;
  sourceGrantKeyHash: string;
  validFrom: string;
  validUntil?: string;
  lastEventAt: string;
  lastEventPrecedence: number;
  lastEventKey: string;
  createdAt: string;
  updatedAt: string;
};
export type CommerceAccessSnapshot = {
  schemaVersion: 1;
  contractVersion: typeof COMMERCE_ACCESS_CONTRACT;
  generatedAt: string;
  entitlements: Array<{
    entitlementKey: string;
    productKind: ProductKind;
    resourceId?: string;
    status: 'active' | 'grace';
    validUntil?: string;
  }>;
};

export function entitlementKey(productKind: ProductKind, resourceId?: string) {
  if (productKind === 'optiform-pro') {
    if (resourceId) throw new Error('invalid-entitlement');
    return productKind;
  }
  if (!resourceId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(resourceId))
    throw new Error('invalid-entitlement');
  return `${productKind}:${resourceId}`;
}
export const commerceHash = (namespace: string, value: string) =>
  createHash('sha256').update(`${namespace}:${value}`).digest('hex');
export const sourceGrantKeyHash = (channel: CommerceChannel, rawGrantIdentity: string) =>
  commerceHash('optiform-commerce-grant-v1', `${channel}:${rawGrantIdentity}`);
export const eventKey = (channel: CommerceChannel, rawEventIdentity: string) =>
  commerceHash('optiform-commerce-event-v1', `${channel}:${rawEventIdentity}`);
export const grantId = (ownerUid: string, channel: CommerceChannel, sourceHash: string) =>
  commerceHash('optiform-commerce-grant-id-v1', `${ownerUid}:${channel}:${sourceHash}`);

export function createVerifiedCommerceEvent(
  input: {
    ownerUid: string;
    sourceChannel: CommerceChannel;
    rawEventIdentity: string;
    rawGrantIdentity: string;
    productKind: ProductKind;
    resourceId?: string;
    accessModel: AccessModel;
    action: EventAction;
    effectiveAt: string;
    validUntil?: string;
    receivedAt: string;
  },
  allowTestSource = false,
): VerifiedCommerceEvent {
  if (input.sourceChannel === 'test' && !allowTestSource) throw new Error('test-source-denied');
  for (const value of [input.ownerUid, input.rawEventIdentity, input.rawGrantIdentity])
    if (!value || value.length > 512) throw new Error('invalid-event');
  const key = entitlementKey(input.productKind, input.resourceId);
  const event: VerifiedCommerceEvent = {
    schemaVersion: 1,
    contractVersion: COMMERCE_EVENTS_CONTRACT,
    eventKey: eventKey(input.sourceChannel, input.rawEventIdentity),
    ownerUid: input.ownerUid,
    sourceChannel: input.sourceChannel,
    sourceGrantKeyHash: sourceGrantKeyHash(input.sourceChannel, input.rawGrantIdentity),
    entitlementKey: key,
    productKind: input.productKind,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    accessModel: input.accessModel,
    action: input.action,
    effectiveAt: input.effectiveAt,
    ...(input.validUntil ? { validUntil: input.validUntil } : {}),
    receivedAt: input.receivedAt,
  };
  validateEvent(event);
  return event;
}

export function validateEvent(event: VerifiedCommerceEvent) {
  const expected = [
    'schemaVersion',
    'contractVersion',
    'eventKey',
    'ownerUid',
    'sourceChannel',
    'sourceGrantKeyHash',
    'entitlementKey',
    'productKind',
    'resourceId',
    'accessModel',
    'action',
    'effectiveAt',
    'validUntil',
    'receivedAt',
  ];
  if (Object.keys(event).some((key) => !expected.includes(key))) throw new Error('invalid-event');
  if (
    event.schemaVersion !== 1 ||
    event.contractVersion !== COMMERCE_EVENTS_CONTRACT ||
    !event.ownerUid ||
    event.ownerUid.length > 128 ||
    !(['google-play', 'stripe-web', 'test'] satisfies CommerceChannel[]).includes(
      event.sourceChannel,
    ) ||
    !(
      [
        'optiform-pro',
        'creator-program',
        'creator-membership',
        'trainer-package',
        'gym-business-plan',
      ] satisfies ProductKind[]
    ).includes(event.productKind) ||
    !(['perpetual', 'time-bound'] satisfies AccessModel[]).includes(event.accessModel) ||
    !(
      ['grant', 'renew', 'enter-grace', 'expire', 'revoke', 'refund'] satisfies EventAction[]
    ).includes(event.action)
  )
    throw new Error('invalid-event');
  if (!/^[a-f0-9]{64}$/.test(event.eventKey) || !/^[a-f0-9]{64}$/.test(event.sourceGrantKeyHash))
    throw new Error('invalid-event');
  if (event.entitlementKey !== entitlementKey(event.productKind, event.resourceId))
    throw new Error('invalid-event');
  const effective = Date.parse(event.effectiveAt);
  const received = Date.parse(event.receivedAt);
  if (
    !Number.isFinite(effective) ||
    !Number.isFinite(received) ||
    new Date(effective).toISOString() !== event.effectiveAt ||
    new Date(received).toISOString() !== event.receivedAt
  )
    throw new Error('invalid-event');
  const requiresValidity =
    event.accessModel === 'time-bound' && ['grant', 'renew', 'enter-grace'].includes(event.action);
  if (requiresValidity && (!event.validUntil || Date.parse(event.validUntil) <= effective))
    throw new Error('invalid-event');
  if (
    event.validUntil &&
    (!Number.isFinite(Date.parse(event.validUntil)) ||
      new Date(Date.parse(event.validUntil)).toISOString() !== event.validUntil)
  )
    throw new Error('invalid-event');
  if (!requiresValidity && event.validUntil) throw new Error('invalid-event');
  if (event.accessModel === 'perpetual' && event.validUntil) throw new Error('invalid-event');
}
