export const GYM_PROGRAM_ENROLLMENT_CONTRACT = 'gym-program-enrollment-v1' as const;
export const GYM_PROGRAM_EXECUTION_PERMIT_CONTRACT = 'gym-program-execution-permit-v1' as const;
export const GYM_WORKOUT_PROVENANCE_CONTRACT = 'workout-program-provenance-v3' as const;

export type GymProgramEnrollment = {
  enrollmentId: string;
  gymId: string;
  gymProgramId: string;
  publicationVersionId: string;
  accessKind: 'all-members' | 'assigned';
  programName: string;
  durationWeeks: number;
  startDateLocal: string;
  status: 'active' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
};

export const gymProgramOccurrenceDateLocal = (
  startDateLocal: string,
  weekNumber: number,
  dayOfWeek: number,
) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateLocal)) throw new Error('Invalid local date.');
  const [year, month, day] = startDateLocal.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error('Invalid local date.');
  date.setUTCDate(date.getUTCDate() + (weekNumber - 1) * 7 + dayOfWeek - 1);
  return date.toISOString().slice(0, 10);
};

export const gymProgramSessionKey = (weekNumber: number, dayOfWeek: number) =>
  `w${weekNumber}-d${dayOfWeek}`;

export const gymProgramTodayLocal = (now = new Date()) => {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

type ProvenanceRecord = {
  [key: string]: unknown;
  schemaVersion: number;
  programContext?: {
    [key: string]: unknown;
    contractVersion?: string;
    programSource?: string;
    enrollmentId?: string;
    sessionKey?: string;
  };
};

export function deriveGymProgramOccurrenceStatus(input: {
  enrollmentId: string;
  sessionKey: string;
  scheduledDateLocal: string;
  todayLocal: string;
  records: ProvenanceRecord[];
}): 'completed' | 'today' | 'upcoming' | 'missed' {
  if (
    input.records.some(
      (record) =>
        record.schemaVersion === 3 &&
        record.programContext?.contractVersion === GYM_WORKOUT_PROVENANCE_CONTRACT &&
        record.programContext.programSource === 'gym-program' &&
        record.programContext.enrollmentId === input.enrollmentId &&
        record.programContext.sessionKey === input.sessionKey,
    )
  )
    return 'completed';
  if (input.scheduledDateLocal === input.todayLocal) return 'today';
  return input.scheduledDateLocal > input.todayLocal ? 'upcoming' : 'missed';
}
