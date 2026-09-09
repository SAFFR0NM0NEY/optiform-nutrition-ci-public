export type CreatorDeliveryDay = {
  dayId: string;
  weekNumber: number;
  dayOfWeek: number;
  weekKind: string;
  label: string;
  exercises: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
};
