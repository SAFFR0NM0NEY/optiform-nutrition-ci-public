export const CREATOR_MEMBERSHIP_OFFER_CONTRACT = 'creator-membership-offer-v1';
export const CREATOR_MEMBERSHIP_POST_CONTRACT = 'creator-membership-post-v1';
export const CREATOR_MEMBERSHIP_ACCESS_CONTRACT = 'creator-membership-access-v1';
export const CREATOR_MEMBERSHIP_LIBRARY_CONTRACT = 'creator-membership-library-v1';
export const creatorMembershipsEnabled = () =>
  import.meta.env.VITE_ENABLE_CREATOR_MEMBERSHIPS === 'true';

export type CreatorMembershipOffer = {
  creatorId: string;
  creatorDisplayName: string;
  title: string;
  description: string;
  benefits: string[];
  status: 'active';
};
export type CreatorMembershipPost = {
  creatorId: string;
  postId: string;
  title: string;
  body: string;
  status: 'active' | 'removed';
  createdAt: string;
};
export type CreatorMembershipLibraryItem = {
  creatorId: string;
  creatorDisplayName: string;
  offerTitle: string;
  accessStatus: 'active' | 'grace';
  validUntil?: string;
  availability: 'available' | 'unavailable';
};
