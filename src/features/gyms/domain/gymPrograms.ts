export const GYM_PROGRAM_PUBLICATION_CONTRACT = 'gym-program-publication-v1';
export const GYM_PROGRAM_DELIVERY_CONTRACT = 'gym-program-delivery-v1';
export const GYM_PROGRAM_ASSIGNMENT_CONTRACT = 'gym-program-assignment-v1';
export const GYM_PROGRAM_LIBRARY_CONTRACT = 'gym-program-library-v1';

export type GymProgramItem = {
  gymId: string;
  gymProgramId: string;
  title: string;
  description: string;
  durationWeeks: number;
  publicationVersionId: string;
  sourceVersionNumber: number;
  accessKind?: 'all-members' | 'assigned';
  assignmentId?: string | null;
  assignedAt?: unknown;
  status?: 'active' | 'archived';
  availability?: 'all-members' | 'assigned-members';
  sourceProgramId?: string;
  currentSourceVersionId?: string;
};
export type GymProgramDetail = GymProgramItem & { days: Array<Record<string, unknown>> };
