const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export type UserStorageArea =
  | 'onboarding-profile'
  | 'active-workout'
  | 'workout-templates'
  | 'my-exercises'
  | 'recent-exercises'
  | 'completed-workouts'
  | 'custom-exercises'
  | 'nutrition-profile'
  | 'nutrition-tracking-draft'
  | 'nutrition-food-cache'
  | 'nutrition-food-disclosure'
  | 'programs'
  | 'program-builder'
  | 'motivation'
  | 'wellness-habit-logs'
  | 'wellness-recovery'
  | 'policy-consents'
  | 'notifications'
  | 'notification-preferences'
  | 'notification-watermarks';
export function userStorageKey(uid: string, area: UserStorageArea) {
  if (!UID_PATTERN.test(uid)) throw new Error('Invalid authenticated user namespace.');
  return `optiform:user:${uid}:${area}:v1`;
}
