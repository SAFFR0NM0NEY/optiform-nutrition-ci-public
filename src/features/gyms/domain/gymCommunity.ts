export const GYM_COMMUNITY_CONTRACT = 'gym-community-v1' as const;
export const GYM_GROUP_CONTRACT = 'gym-community-group-v1' as const;
export const GYM_POST_CONTRACT = 'gym-community-post-v1' as const;
export const GYM_COMMENT_CONTRACT = 'gym-community-comment-v1' as const;
export const GYM_REACTION_CONTRACT = 'gym-community-reaction-v1' as const;
export const GYM_COMMUNITY_PAGE_SIZE = 20;
const unsafe = /<[^>]*>|javascript:|https?:\/\/|www\./i;
const controls = (value: string, multiline: boolean) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code === 127 || (code < 32 && !(multiline && (code === 10 || code === 13)));
  });
export function validGymCommunityText(
  value: string,
  minimum: number,
  maximum: number,
  multiline = false,
) {
  return (
    value === value.trim() &&
    value.length >= minimum &&
    value.length <= maximum &&
    !unsafe.test(value) &&
    !controls(value, multiline)
  );
}
export const validCommunityGroupName = (value: string) => validGymCommunityText(value, 1, 40);
export const validCommunityDescription = (value: string) =>
  value === '' || validGymCommunityText(value, 1, 240);
export const validCommunityPost = (value: string) => validGymCommunityText(value, 1, 1500, true);
export const validCommunityComment = (value: string) => validGymCommunityText(value, 1, 500, true);

export type GymCommunityGroup = {
  schemaVersion: 1;
  contractVersion: typeof GYM_GROUP_CONTRACT;
  gymId: string;
  groupId: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
};
export type GymCommunityAuthor = {
  authorType: 'member' | 'gym';
  authorId: string;
  authorDisplayName: string;
};
export type GymCommunityPost = GymCommunityAuthor & {
  schemaVersion: 1;
  contractVersion: typeof GYM_POST_CONTRACT;
  gymId: string;
  groupId: string;
  postId: string;
  body: string;
  status: 'active' | 'removed';
  commentCount: number;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
};
export type GymCommunityComment = GymCommunityAuthor & {
  schemaVersion: 1;
  contractVersion: typeof GYM_COMMENT_CONTRACT;
  gymId: string;
  groupId: string;
  postId: string;
  commentId: string;
  body: string;
  status: 'active' | 'removed';
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
};
export type GymCommunityOverview = {
  contractVersion: typeof GYM_COMMUNITY_CONTRACT;
  gymId: string;
  gymDisplayName: string;
  gymStatus: 'active' | 'paused';
  isOwner: boolean;
  member: { memberId: string; displayName: string } | null;
  canManageGroups: boolean;
  canPostAsGym: boolean;
  groups: GymCommunityGroup[];
};
export type GymCommunityPage<T> = { items: T[]; cursor: string | null };
