import { createHash, randomUUID } from 'node:crypto';
import { type CanonicalExercise, projectCreatorDelivery } from '../creator-delivery/contracts.js';

export const GYM_PROGRAM_PUBLICATION_CONTRACT = 'gym-program-publication-v1' as const;
export const GYM_PROGRAM_DELIVERY_CONTRACT = 'gym-program-delivery-v1' as const;
export const GYM_PROGRAM_ASSIGNMENT_CONTRACT = 'gym-program-assignment-v1' as const;
export const GYM_PROGRAM_LIBRARY_CONTRACT = 'gym-program-library-v1' as const;

type Value = Record<string, unknown>;
type SourceBundle = { index: Value; version: Value; days: Value[] };

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

export const gymProgramId = (kind: 'program' | 'version' | 'assignment') =>
  `gym-program-${kind}-${randomUUID()}`;
export const gymAssignmentIndexId = (gymProgramId: string, memberId: string) =>
  createHash('sha256')
    .update(`gym-program-assignment-v1:${gymProgramId}:${memberId}`)
    .digest('hex');
export const gymPublicationRequestId = (
  uid: string,
  gymId: string,
  sourceProgramId: string,
  sourceVersionId: string,
  availability: string,
) =>
  createHash('sha256')
    .update(
      `gym-program-publication-v1:${uid}:${gymId}:${sourceProgramId}:${sourceVersionId}:${availability}`,
    )
    .digest('hex');
export const gymDeliveryHash = (value: unknown) =>
  createHash('sha256').update(stable(value)).digest('hex');

export function projectGymProgramDelivery(input: {
  gymId: string;
  gymProgramId: string;
  publicationVersionId: string;
  ownerUid: string;
  sourceProgramId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  bundle: SourceBundle;
  canonical: ReadonlyMap<string, CanonicalExercise>;
}) {
  const title = String(input.bundle.version.name);
  const description = String(input.bundle.version.description ?? '');
  const durationWeeks = Number(input.bundle.version.durationWeeks);
  // Reuse the accepted P28 validator and sanitizer. Synthetic creator identity fields are
  // removed below and never persisted in a gym delivery.
  const base = projectCreatorDelivery({
    publicationVersionId: input.publicationVersionId,
    listingId: input.gymProgramId,
    creatorId: input.gymId,
    versionNumber: input.sourceVersionNumber,
    ownerUid: input.ownerUid,
    sourceProgramId: input.sourceProgramId,
    sourceVersionId: input.sourceVersionId,
    preview: { title, description, durationWeeks },
    bundle: input.bundle,
    canonical: input.canonical,
  });
  const days = base.days.map(({ listingId, contractVersion, ...day }) => {
    void listingId;
    void contractVersion;
    return {
      ...day,
      contractVersion: GYM_PROGRAM_DELIVERY_CONTRACT,
      gymId: input.gymId,
      gymProgramId: input.gymProgramId,
    };
  });
  const hashDays = days.map(({ publicationVersionId, gymId, gymProgramId, ...day }) => {
    void publicationVersionId;
    void gymId;
    void gymProgramId;
    return day;
  });
  const hashInput = {
    title,
    description,
    durationWeeks,
    sourceVersionNumber: input.sourceVersionNumber,
    days: hashDays,
  };
  return {
    metadata: {
      schemaVersion: 1 as const,
      contractVersion: GYM_PROGRAM_DELIVERY_CONTRACT,
      gymId: input.gymId,
      gymProgramId: input.gymProgramId,
      publicationVersionId: input.publicationVersionId,
      sourceVersionNumber: input.sourceVersionNumber,
      title,
      description,
      durationWeeks,
      dayCount: days.length,
      contentHash: gymDeliveryHash(hashInput),
      status: 'sealed' as const,
    },
    days,
  };
}

export function exactPayload(value: unknown, keys: string[]) {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|')
  );
}
