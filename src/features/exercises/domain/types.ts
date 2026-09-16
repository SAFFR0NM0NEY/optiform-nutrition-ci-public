import type { MovementPattern } from './taxonomies';
export type Exercise = {
  id: string;
  source: 'system' | 'user' | 'coach' | 'creator';
  status: 'published' | 'draft' | 'archived';
  movementPattern: MovementPattern;
};
