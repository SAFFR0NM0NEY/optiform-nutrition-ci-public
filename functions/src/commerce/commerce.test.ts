import { describe, expect, it } from 'vitest';
import { deriveCommerceAccess } from './access.js';
import {
  createVerifiedCommerceEvent,
  grantId,
  sameVerifiedCommerceEvent,
  type AccessModel,
  type CommerceChannel,
  type EventAction,
} from './contracts.js';
import { reduceCommerceGrant } from './reducer.js';

const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`;
function event(
  action: EventAction,
  day: number,
  options: {
    channel?: CommerceChannel;
    grant?: string;
    access?: AccessModel;
    until?: string;
    resourceId?: string;
  } = {},
) {
  return createVerifiedCommerceEvent(
    {
      ownerUid: 'athlete-a',
      sourceChannel: options.channel ?? 'test',
      rawEventIdentity: `${options.grant ?? 'one'}-${action}-${day}`,
      rawGrantIdentity: options.grant ?? 'one',
      productKind: options.resourceId ? 'creator-program' : 'optiform-pro',
      ...(options.resourceId ? { resourceId: options.resourceId } : {}),
      accessModel: options.access ?? 'time-bound',
      action,
      effectiveAt: at(day),
      ...((options.access ?? 'time-bound') === 'time-bound' &&
      ['grant', 'renew', 'enter-grace'].includes(action)
        ? { validUntil: options.until ?? at(day + 10) }
        : {}),
      receivedAt: at(Math.max(day, 20)),
    },
    true,
  );
}

describe('commerce contracts and grant reducer', () => {
  it('compares semantic event fields independent of key order and local receipt time', () => {
    const original = event('grant', 1);
    const reordered = {
      receivedAt: at(22),
      validUntil: original.validUntil,
      effectiveAt: original.effectiveAt,
      action: original.action,
      accessModel: original.accessModel,
      productKind: original.productKind,
      entitlementKey: original.entitlementKey,
      sourceGrantKeyHash: original.sourceGrantKeyHash,
      sourceChannel: original.sourceChannel,
      ownerUid: original.ownerUid,
      eventKey: original.eventKey,
      contractVersion: original.contractVersion,
      schemaVersion: original.schemaVersion,
    };
    expect(Object.keys(reordered)).not.toEqual(Object.keys(original));
    expect(sameVerifiedCommerceEvent(original, reordered)).toBe(true);
    expect(sameVerifiedCommerceEvent(original, { ...original, resourceId: undefined })).toBe(false);
  });

  it.each([
    ['action', 'renew'],
    ['effectiveAt', at(2)],
    ['sourceGrantKeyHash', 'a'.repeat(64)],
    ['ownerUid', 'athlete-b'],
    ['entitlementKey', 'creator-program:other'],
    ['accessModel', 'perpetual'],
  ] as const)('rejects a semantic collision in %s', (field, value) => {
    const original = event('grant', 1);
    expect(sameVerifiedCommerceEvent(original, { ...original, [field]: value })).toBe(false);
  });

  it('hashes provider identities and never retains raw provider data', () => {
    const result = createVerifiedCommerceEvent({
      ownerUid: 'athlete-a',
      sourceChannel: 'google-play',
      rawEventIdentity: 'purchase-token-sentinel',
      rawGrantIdentity: 'customer-card-webhook-sentinel',
      productKind: 'optiform-pro',
      accessModel: 'perpetual',
      action: 'grant',
      effectiveAt: at(1),
      receivedAt: at(1),
    });
    const stored = JSON.stringify(result);
    expect(result.eventKey).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toMatch(/purchase-token|customer-card|webhook-sentinel/);
    expect(() =>
      createVerifiedCommerceEvent({
        ownerUid: 'a',
        sourceChannel: 'test',
        rawEventIdentity: 'e',
        rawGrantIdentity: 'g',
        productKind: 'optiform-pro',
        accessModel: 'perpetual',
        action: 'grant',
        effectiveAt: at(1),
        receivedAt: at(1),
      }),
    ).toThrow('test-source-denied');
    expect(() =>
      reduceCommerceGrant(null, { ...result, sourceChannel: 'unknown' as never }),
    ).toThrow('invalid-event');
  });

  it('maps lifecycle actions and ignores older delivery', () => {
    let grant = reduceCommerceGrant(null, event('grant', 1));
    expect(grant.state).toBe('active');
    grant = reduceCommerceGrant(grant, event('enter-grace', 3));
    expect(grant.state).toBe('grace');
    grant = reduceCommerceGrant(grant, event('expire', 5));
    expect(grant.state).toBe('expired');
    expect(reduceCommerceGrant(grant, event('renew', 4))).toBe(grant);
    grant = reduceCommerceGrant(grant, event('renew', 6));
    expect(grant.state).toBe('active');
    grant = reduceCommerceGrant(grant, event('revoke', 7));
    expect(grant.state).toBe('revoked');
    grant = reduceCommerceGrant(grant, event('refund', 8));
    expect(grant.state).toBe('refunded');
  });

  it('uses terminal-negative same-time precedence and immutable identity', () => {
    const revoke = event('revoke', 5);
    let grant = reduceCommerceGrant(null, event('grant', 1));
    grant = reduceCommerceGrant(grant, revoke);
    const refund = event('refund', 5);
    expect(reduceCommerceGrant(grant, refund).state).toBe('refunded');
    expect(
      reduceCommerceGrant(reduceCommerceGrant(null, event('grant', 1)), event('refund', 5)).state,
    ).toBe('refunded');
    expect(() =>
      reduceCommerceGrant(grant, event('renew', 6, { resourceId: 'different' })),
    ).toThrow('grant-identity-mismatch');
  });

  it('supports perpetual grants without auto-expiry and validates time-bound validity', () => {
    const perpetual = reduceCommerceGrant(null, event('grant', 1, { access: 'perpetual' }));
    expect(perpetual.validUntil).toBeUndefined();
    expect(deriveCommerceAccess([perpetual], new Date(at(30))).entitlements).toHaveLength(1);
    expect(() => event('grant', 1, { until: at(1) })).toThrow('invalid-event');
  });
});

describe('effective access union', () => {
  const grant = (action: EventAction, day: number, options = {}) =>
    reduceCommerceGrant(null, event(action, day, options));
  it('returns empty and excludes terminal or elapsed grants', () => {
    expect(deriveCommerceAccess([], new Date(at(5))).entitlements).toEqual([]);
    for (const action of ['expire', 'revoke', 'refund'] as const)
      expect(deriveCommerceAccess([grant(action, 1)], new Date(at(5))).entitlements).toEqual([]);
    expect(
      deriveCommerceAccess([grant('grant', 1, { until: at(2) })], new Date(at(5))).entitlements,
    ).toEqual([]);
  });
  it('unions independent channels and preserves access when one source ends', () => {
    const play = grant('grant', 1, { channel: 'google-play', grant: 'play', until: at(10) });
    const web = grant('grant', 1, { channel: 'stripe-web', grant: 'web', until: at(20) });
    expect(deriveCommerceAccess([play, web], new Date(at(5))).entitlements[0]).toMatchObject({
      status: 'active',
      validUntil: at(20),
    });
    const expiredPlay = reduceCommerceGrant(
      play,
      event('expire', 6, { channel: 'google-play', grant: 'play' }),
    );
    expect(deriveCommerceAccess([expiredPlay, web], new Date(at(7))).entitlements[0].status).toBe(
      'active',
    );
    const revokedWeb = reduceCommerceGrant(
      web,
      event('revoke', 8, { channel: 'stripe-web', grant: 'web' }),
    );
    const gracePlay = grant('enter-grace', 7, {
      channel: 'google-play',
      grant: 'grace',
      until: at(12),
    });
    expect(
      deriveCommerceAccess([revokedWeb, gracePlay], new Date(at(9))).entitlements[0].status,
    ).toBe('grace');
  });
  it('lets an active perpetual grant remove effective expiry and sorts deterministically', () => {
    const perpetual = grant('grant', 1, {
      access: 'perpetual',
      channel: 'google-play',
      grant: 'forever',
    });
    const timed = grant('grant', 1, { channel: 'stripe-web', grant: 'timed', until: at(20) });
    const snapshot = deriveCommerceAccess([timed, perpetual], new Date(at(5)));
    expect(snapshot.entitlements[0].validUntil).toBeUndefined();
    expect(perpetual.grantId).toBe(
      grantId(perpetual.ownerUid, perpetual.sourceChannel, perpetual.sourceGrantKeyHash),
    );
  });
});
