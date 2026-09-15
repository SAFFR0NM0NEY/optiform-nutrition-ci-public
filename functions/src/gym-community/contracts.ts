import { createHash, randomUUID } from 'node:crypto';

export const GYM_COMMUNITY_CONTRACT = 'gym-community-v1' as const;
export const GYM_GROUP_CONTRACT = 'gym-community-group-v1' as const;
export const GYM_POST_CONTRACT = 'gym-community-post-v1' as const;
export const GYM_COMMENT_CONTRACT = 'gym-community-comment-v1' as const;
export const GYM_REACTION_CONTRACT = 'gym-community-reaction-v1' as const;
export const GROUP_ACTIVE_MAX = 20;
export const GROUP_TOTAL_MAX = 50;
export const COMMENT_ACTIVE_MAX = 200;
export const PAGE_MAX = 50;

const forbidden = /<[^>]*>|javascript:|https?:\/\/|www\./i;
const controls = (value: string, multiline: boolean) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code === 127 || (code < 32 && !(multiline && (code === 10 || code === 13)));
  });
export function validCommunityText(
  value: unknown,
  minimum: number,
  maximum: number,
  multiline = false,
) {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= minimum &&
    value.length <= maximum &&
    !forbidden.test(value) &&
    !controls(value, multiline)
  );
}
export const validGroupName = (value: unknown) => validCommunityText(value, 1, 40);
export const validGroupDescription = (value: unknown) =>
  value === '' || validCommunityText(value, 1, 240);
export const validPostBody = (value: unknown) => validCommunityText(value, 1, 1500, true);
export const validCommentBody = (value: unknown) => validCommunityText(value, 1, 500, true);

export function communityId(kind: 'group' | 'post' | 'comment', uuid = randomUUID()) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid))
    throw new Error('invalid-id');
  return `gym-${kind}-${uuid.toLowerCase()}`;
}
export function reactionOwnerKey(uid: string) {
  return createHash('sha256').update(`optiform:gym-community:v1:${uid}`, 'utf8').digest('hex');
}
export type CommunityCursor = { createdAt: string; id: string };
export function encodeCommunityCursor(value: CommunityCursor) {
  if (!Number.isFinite(Date.parse(value.createdAt)) || !/^[a-z0-9-]{8,80}$/i.test(value.id))
    throw new Error('invalid-cursor');
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
export function decodeCommunityCursor(value: unknown): CommunityCursor | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 256) throw new Error('invalid-cursor');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CommunityCursor;
    if (
      !parsed ||
      Object.keys(parsed).sort().join('|') !== 'createdAt|id' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      !/^[a-z0-9-]{8,80}$/i.test(parsed.id)
    )
      throw new Error('invalid-cursor');
    return parsed;
  } catch {
    throw new Error('invalid-cursor');
  }
}
