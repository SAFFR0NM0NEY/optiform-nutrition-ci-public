import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { creatorDeliveryHash, creatorDeliveryHashInput, type DeliveryDay } from './contracts.js';
import {
  crossCheckCreatorProgramRecords,
  validateCreatorProgramBinding,
  validateCreatorProgramDelivery,
  verifyCreatorProgramDeliveryHash,
} from './integrity.js';

const listingId = 'listing-1';
const deliveryDay: DeliveryDay = {
  schemaVersion: 1,
  contractVersion: 'creator-program-delivery-v1',
  publicationVersionId: 'publication-1',
  listingId,
  dayId: 'day-1',
  weekNumber: 1,
  dayOfWeek: 1,
  weekKind: 'standard',
  label: 'Day one',
  exercises: [],
  groups: [],
};
const baseMetadata = {
  publicationVersionId: 'publication-1',
  listingId,
  creatorId: 'creator-1',
  versionNumber: 1,
  title: 'Plan',
  description: 'Description',
  durationWeeks: 1,
};
const contentHash = creatorDeliveryHash(creatorDeliveryHashInput(baseMetadata, [deliveryDay]));
const binding = () => ({
  schemaVersion: 1,
  contractVersion: 'creator-program-access-binding-v1',
  ownerUid: 'athlete-1',
  listingId,
  creatorId: 'creator-1',
  publicationVersionId: 'publication-1',
  contentHash,
  entitlementKey: `creator-program:${listingId}`,
  boundAt: Timestamp.now(),
});
const delivery = () => ({
  schemaVersion: 1,
  contractVersion: 'creator-program-delivery-v1',
  ...baseMetadata,
  dayCount: 1,
  contentHash,
  status: 'sealed',
  rightsAttestedAt: Timestamp.now(),
  sealedAt: Timestamp.now(),
});

describe('creator delivery server integrity', () => {
  it('accepts exact binding/delivery records, cross-checks identity, and verifies content hash', () => {
    const bound = binding();
    const sealed = delivery();
    expect(() => validateCreatorProgramBinding(bound, 'athlete-1', listingId)).not.toThrow();
    expect(() => validateCreatorProgramDelivery(sealed)).not.toThrow();
    expect(() =>
      crossCheckCreatorProgramRecords(bound, { creatorId: 'creator-1' }, sealed),
    ).not.toThrow();
    expect(() => verifyCreatorProgramDeliveryHash(sealed, [deliveryDay])).not.toThrow();
  });

  it.each([
    [
      'binding contract',
      (value: Record<string, unknown>) => {
        value.contractVersion = 'wrong';
      },
    ],
    [
      'binding owner',
      (value: Record<string, unknown>) => {
        value.ownerUid = 'other';
      },
    ],
    [
      'binding hash',
      (value: Record<string, unknown>) => {
        value.contentHash = 'bad';
      },
    ],
    [
      'binding entitlement',
      (value: Record<string, unknown>) => {
        value.entitlementKey = 'wrong';
      },
    ],
    [
      'binding timestamp',
      (value: Record<string, unknown>) => {
        value.boundAt = 'invalid';
      },
    ],
  ])('rejects malformed %s', (_name, mutate) => {
    const value = binding();
    mutate(value);
    expect(() => validateCreatorProgramBinding(value, 'athlete-1', listingId)).toThrow(
      'binding-invalid',
    );
  });

  it.each([
    [
      'delivery contract',
      (value: Record<string, unknown>) => {
        value.contractVersion = 'wrong';
      },
    ],
    [
      'delivery state',
      (value: Record<string, unknown>) => {
        value.status = 'draft';
      },
    ],
    [
      'delivery duration',
      (value: Record<string, unknown>) => {
        value.durationWeeks = 53;
      },
    ],
    [
      'delivery day bound',
      (value: Record<string, unknown>) => {
        value.dayCount = 365;
      },
    ],
    [
      'delivery hash',
      (value: Record<string, unknown>) => {
        value.contentHash = 'bad';
      },
    ],
  ])('rejects malformed %s', (_name, mutate) => {
    const value = delivery();
    mutate(value);
    expect(() => validateCreatorProgramDelivery(value)).toThrow('delivery-invalid');
  });

  it('rejects identity mismatches and tampered delivered days', () => {
    expect(() =>
      crossCheckCreatorProgramRecords(binding(), { creatorId: 'other' }, delivery()),
    ).toThrow('delivery-invalid');
    expect(() =>
      verifyCreatorProgramDeliveryHash(delivery(), [{ ...deliveryDay, label: 'Tampered' }]),
    ).toThrow('delivery-invalid');
  });
});
