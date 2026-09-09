import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  CREATOR_PROGRAM_ACCESS_BINDING_CONTRACT,
  CREATOR_PROGRAM_DELIVERY_CONTRACT,
  creatorDeliveryHash,
  creatorDeliveryHashInput,
  type DeliveryDay,
  type DeliveryProjection,
} from './contracts.js';

export type RecordValue = Record<string, unknown>;

const exact = (value: RecordValue, keys: string[]) =>
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown) => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      return Number.isFinite((value as { toDate(): Date }).toDate().getTime());
    } catch {
      return false;
    }
  }
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
};
const boundedText = (value: unknown, maximum: number, allowEmpty = false) =>
  typeof value === 'string' &&
  value.length <= maximum &&
  (allowEmpty ? !value.length || !!value.trim() : !!value.trim());

export function validateCreatorProgramBinding(value: RecordValue, uid: string, listingId: string) {
  if (
    !exact(value, [
      'schemaVersion',
      'contractVersion',
      'ownerUid',
      'listingId',
      'creatorId',
      'publicationVersionId',
      'contentHash',
      'entitlementKey',
      'boundAt',
    ]) ||
    value.schemaVersion !== 1 ||
    value.contractVersion !== CREATOR_PROGRAM_ACCESS_BINDING_CONTRACT ||
    value.ownerUid !== uid ||
    value.listingId !== listingId ||
    !identifier(value.creatorId) ||
    !identifier(value.publicationVersionId) ||
    !hash(value.contentHash) ||
    value.entitlementKey !== `creator-program:${listingId}` ||
    !timestamp(value.boundAt)
  )
    throw new Error('binding-invalid');
}

export function validateCreatorProgramDelivery(value: RecordValue) {
  if (
    !exact(value, [
      'schemaVersion',
      'contractVersion',
      'publicationVersionId',
      'listingId',
      'creatorId',
      'versionNumber',
      'title',
      'description',
      'durationWeeks',
      'dayCount',
      'contentHash',
      'status',
      'rightsAttestedAt',
      'sealedAt',
    ]) ||
    value.schemaVersion !== 1 ||
    value.contractVersion !== CREATOR_PROGRAM_DELIVERY_CONTRACT ||
    value.status !== 'sealed' ||
    !identifier(value.publicationVersionId) ||
    !identifier(value.listingId) ||
    !identifier(value.creatorId) ||
    !Number.isInteger(value.versionNumber) ||
    Number(value.versionNumber) < 1 ||
    !boundedText(value.title, 80) ||
    !boundedText(value.description, 1000, true) ||
    !Number.isInteger(value.durationWeeks) ||
    Number(value.durationWeeks) < 1 ||
    Number(value.durationWeeks) > 52 ||
    !Number.isInteger(value.dayCount) ||
    Number(value.dayCount) < 0 ||
    Number(value.dayCount) > 364 ||
    !hash(value.contentHash) ||
    !timestamp(value.rightsAttestedAt) ||
    !timestamp(value.sealedAt)
  )
    throw new Error('delivery-invalid');
}

export function crossCheckCreatorProgramRecords(
  binding: RecordValue,
  listing: RecordValue,
  delivery: RecordValue,
) {
  if (
    binding.listingId !== delivery.listingId ||
    binding.creatorId !== delivery.creatorId ||
    binding.publicationVersionId !== delivery.publicationVersionId ||
    binding.contentHash !== delivery.contentHash ||
    listing.creatorId !== binding.creatorId
  )
    throw new Error('delivery-invalid');
}

export function verifyCreatorProgramDeliveryHash(delivery: RecordValue, days: DeliveryDay[]) {
  const metadata = delivery as unknown as DeliveryProjection['metadata'];
  const calculated = creatorDeliveryHash(
    creatorDeliveryHashInput(
      {
        publicationVersionId: metadata.publicationVersionId,
        listingId: metadata.listingId,
        creatorId: metadata.creatorId,
        versionNumber: metadata.versionNumber,
        title: metadata.title,
        description: metadata.description,
        durationWeeks: metadata.durationWeeks,
      },
      days,
    ),
  );
  if (calculated !== delivery.contentHash) throw new Error('delivery-invalid');
}

export async function getActivePerpetualCreatorProgramAccess(
  db: Firestore,
  uid: string,
  transaction?: Transaction,
) {
  const query = db
    .collection(`commerceEntitlementGrants/${uid}/grants`)
    .where('state', '==', 'active')
    .limit(101);
  const snapshot = transaction ? await transaction.get(query) : await query.get();
  if (snapshot.size > 100) throw new Error('commerce-grant-bound-exceeded');
  return new Set(
    snapshot.docs
      .map((item) => item.data() as RecordValue)
      .filter(
        (grant) =>
          grant.state === 'active' &&
          grant.productKind === 'creator-program' &&
          grant.accessModel === 'perpetual' &&
          grant.entitlementKey === `creator-program:${grant.resourceId}`,
      )
      .map((grant) => String(grant.entitlementKey)),
  );
}
