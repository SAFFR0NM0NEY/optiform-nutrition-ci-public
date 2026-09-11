export const CREATOR_MEMBERSHIP_OFFER_CONTRACT = 'creator-membership-offer-v1';
export const CREATOR_MEMBERSHIP_POST_CONTRACT = 'creator-membership-post-v1';
export const CREATOR_MEMBERSHIP_ACCESS_CONTRACT = 'creator-membership-access-v1';
export const CREATOR_MEMBERSHIP_LIBRARY_CONTRACT = 'creator-membership-library-v1';

export type RecordValue = Record<string, unknown>;

export const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};

export const exactPayload = (value: unknown, keys: string[]) => {
  const record = asRecord(value);
  return Object.keys(record).sort().join('|') === [...keys].sort().join('|');
};

const unsafeText = /(?:https?:\/\/|www\.|javascript:|<\/?[a-z][^>]*>)/iu;
const hasUnsafeControl = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
  });
export const cleanText = (value: unknown, minimum: number, maximum: number) => {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error('invalid-request');
  if (
    value.length < minimum ||
    value.length > maximum ||
    unsafeText.test(value) ||
    hasUnsafeControl(value)
  )
    throw new Error('invalid-request');
  return value;
};

export function validateOfferInput(payload: unknown) {
  if (!exactPayload(payload, ['title', 'description', 'benefits', 'status']))
    throw new Error('invalid-request');
  const value = asRecord(payload);
  const title = cleanText(value.title, 1, 80);
  const description = cleanText(value.description, 0, 500);
  if (!Array.isArray(value.benefits) || value.benefits.length < 1 || value.benefits.length > 8)
    throw new Error('invalid-request');
  const benefits = value.benefits.map((item) => cleanText(item, 1, 100));
  if (new Set(benefits).size !== benefits.length) throw new Error('invalid-request');
  if (!['active', 'paused'].includes(String(value.status))) throw new Error('invalid-request');
  return { title, description, benefits, status: value.status as 'active' | 'paused' };
}

export function validatePostInput(payload: unknown) {
  if (!exactPayload(payload, ['title', 'body'])) throw new Error('invalid-request');
  const value = asRecord(payload);
  return { title: cleanText(value.title, 1, 100), body: cleanText(value.body, 1, 4000) };
}

export const membershipEntitlementKey = (creatorId: string) => `creator-membership:${creatorId}`;
