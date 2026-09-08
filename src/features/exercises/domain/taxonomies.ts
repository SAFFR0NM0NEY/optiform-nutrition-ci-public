export const muscleGroups = [
  { value: 'chest', label: 'Chest' },
  { value: 'back', label: 'Back' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'biceps', label: 'Biceps' },
  { value: 'triceps', label: 'Triceps' },
  { value: 'forearms', label: 'Forearms' },
  { value: 'quadriceps', label: 'Quadriceps' },
  { value: 'hamstrings', label: 'Hamstrings' },
  { value: 'glutes', label: 'Glutes' },
  { value: 'calves', label: 'Calves' },
  { value: 'core', label: 'Core' },
  { value: 'traps', label: 'Traps' },
  { value: 'full-body', label: 'Full Body' },
  { value: 'cardio-conditioning', label: 'Cardio / Conditioning' },
] as const;

export const muscles = [
  {
    id: 'pectoralis-major',
    label: 'Pectoralis Major',
    group: 'chest',
    bodyMapRegion: 'chest-front',
  },
  {
    id: 'pectoralis-major-clavicular',
    label: 'Pectoralis Major — Clavicular Fibers',
    group: 'chest',
    bodyMapRegion: 'chest-front',
    anatomicalGroup: 'pectoralis-major',
  },
  {
    id: 'pectoralis-major-sternocostal',
    label: 'Pectoralis Major — Sternocostal Fibers',
    group: 'chest',
    bodyMapRegion: 'chest-front',
    anatomicalGroup: 'pectoralis-major',
  },
  {
    id: 'serratus-anterior',
    label: 'Serratus Anterior',
    group: 'chest',
    bodyMapRegion: 'ribcage-side',
  },
  {
    id: 'anterior-deltoid',
    label: 'Anterior Deltoid',
    group: 'shoulders',
    bodyMapRegion: 'shoulder-front',
  },
  {
    id: 'lateral-deltoid',
    label: 'Lateral Deltoid',
    group: 'shoulders',
    bodyMapRegion: 'shoulder-side',
  },
  {
    id: 'posterior-deltoid',
    label: 'Posterior Deltoid',
    group: 'shoulders',
    bodyMapRegion: 'shoulder-back',
  },
  { id: 'latissimus-dorsi', label: 'Latissimus Dorsi', group: 'back', bodyMapRegion: 'back-lats' },
  { id: 'trapezius', label: 'Trapezius', group: 'traps', bodyMapRegion: 'upper-back' },
  { id: 'rhomboids', label: 'Rhomboids', group: 'back', bodyMapRegion: 'upper-back' },
  { id: 'spinal-erectors', label: 'Spinal Erectors', group: 'back', bodyMapRegion: 'lower-back' },
  {
    id: 'biceps-brachii',
    label: 'Biceps Brachii',
    group: 'biceps',
    bodyMapRegion: 'upper-arm-front',
    anatomicalGroup: 'elbow-flexors',
  },
  {
    id: 'brachialis',
    label: 'Brachialis',
    group: 'biceps',
    bodyMapRegion: 'upper-arm-front',
    anatomicalGroup: 'elbow-flexors',
  },
  {
    id: 'brachioradialis',
    label: 'Brachioradialis',
    group: 'forearms',
    bodyMapRegion: 'forearm-front',
    anatomicalGroup: 'elbow-flexors',
  },
  {
    id: 'triceps-brachii',
    label: 'Triceps Brachii',
    group: 'triceps',
    bodyMapRegion: 'upper-arm-back',
  },
  {
    id: 'triceps-brachii-long-head',
    label: 'Triceps Brachii — Long Head',
    group: 'triceps',
    bodyMapRegion: 'upper-arm-back',
    anatomicalGroup: 'triceps-brachii',
  },
  {
    id: 'triceps-brachii-lateral-head',
    label: 'Triceps Brachii — Lateral Head',
    group: 'triceps',
    bodyMapRegion: 'upper-arm-back',
    anatomicalGroup: 'triceps-brachii',
  },
  {
    id: 'triceps-brachii-medial-head',
    label: 'Triceps Brachii — Medial Head',
    group: 'triceps',
    bodyMapRegion: 'upper-arm-back',
    anatomicalGroup: 'triceps-brachii',
  },
  {
    id: 'forearm-flexors',
    label: 'Forearm Flexors',
    group: 'forearms',
    bodyMapRegion: 'forearm-front',
  },
  {
    id: 'forearm-extensors',
    label: 'Forearm Extensors',
    group: 'forearms',
    bodyMapRegion: 'forearm-back',
  },
  { id: 'quadriceps', label: 'Quadriceps', group: 'quadriceps', bodyMapRegion: 'thigh-front' },
  { id: 'hamstrings', label: 'Hamstrings', group: 'hamstrings', bodyMapRegion: 'thigh-back' },
  {
    id: 'gluteus-maximus',
    label: 'Gluteus Maximus',
    group: 'glutes',
    bodyMapRegion: 'glutes-back',
  },
  {
    id: 'gluteus-medius',
    label: 'Gluteus Medius',
    group: 'glutes',
    bodyMapRegion: 'glutes-side',
    anatomicalGroup: 'gluteal-muscles',
  },
  { id: 'hip-adductors', label: 'Hip Adductors', group: 'glutes', bodyMapRegion: 'thigh-inner' },
  { id: 'gastrocnemius', label: 'Gastrocnemius', group: 'calves', bodyMapRegion: 'calf-back' },
  { id: 'soleus', label: 'Soleus', group: 'calves', bodyMapRegion: 'calf-back' },
  {
    id: 'hip-flexors',
    label: 'Hip Flexors',
    group: 'core',
    bodyMapRegion: 'hip-front',
    anatomicalGroup: 'hip-flexors',
  },
  {
    id: 'rectus-abdominis',
    label: 'Rectus Abdominis',
    group: 'core',
    bodyMapRegion: 'abdomen-front',
  },
  { id: 'obliques', label: 'Obliques', group: 'core', bodyMapRegion: 'abdomen-side' },
  { id: 'deep-core', label: 'Deep Core Stabilizers', group: 'core', bodyMapRegion: 'abdomen-core' },
] as const;

export const movementPatterns = [
  { value: 'horizontal-push', label: 'Horizontal Push' },
  { value: 'vertical-push', label: 'Vertical Push' },
  { value: 'horizontal-pull', label: 'Horizontal Pull' },
  { value: 'vertical-pull', label: 'Vertical Pull' },
  { value: 'squat', label: 'Squat' },
  { value: 'hinge', label: 'Hinge' },
  { value: 'lunge', label: 'Lunge' },
  { value: 'carry', label: 'Carry' },
  { value: 'integrated', label: 'Integrated / Multi-Stage' },
  { value: 'rotation', label: 'Rotation' },
  { value: 'anti-rotation', label: 'Anti-Rotation' },
  { value: 'flexion-extension', label: 'Flexion / Extension' },
  { value: 'isolation', label: 'Isolation' },
  { value: 'locomotion-conditioning', label: 'Locomotion / Conditioning' },
] as const;

export const equipmentTypes = [
  { value: 'barbell', label: 'Barbell', modality: 'free-weight' },
  { value: 'barbell-rack', label: 'Barbell Rack / Stands', modality: 'other' },
  { value: 'ez-bar', label: 'EZ-Bar', modality: 'free-weight' },
  { value: 'dumbbell', label: 'Dumbbell', modality: 'free-weight' },
  { value: 'kettlebell', label: 'Kettlebell', modality: 'kettlebell' },
  { value: 'machine', label: 'Machine', modality: 'machine' },
  { value: 'plate-loaded-machine', label: 'Plate-Loaded Machine', modality: 'machine' },
  { value: 'assisted-machine', label: 'Assisted Machine', modality: 'machine' },
  { value: 'cable', label: 'Cable', modality: 'cable' },
  { value: 'bodyweight', label: 'Bodyweight', modality: 'bodyweight' },
  { value: 'resistance-band', label: 'Resistance Band', modality: 'resistance-band' },
  { value: 'smith-machine', label: 'Smith Machine', modality: 'machine' },
  { value: 'bench', label: 'Bench', modality: 'other' },
  { value: 'preacher-bench', label: 'Preacher Bench', modality: 'other' },
  { value: 'pull-up-bar', label: 'Pull-up Bar', modality: 'bodyweight' },
  { value: 'cardio-machine', label: 'Cardio Machine', modality: 'cardio' },
  { value: 'other', label: 'Other', modality: 'other' },
  { value: 'ab-wheel', label: 'Ab Wheel', modality: 'other' },
  { value: 'treadmill', label: 'Treadmill', modality: 'cardio' },
  { value: 'stationary-bike', label: 'Stationary Bike', modality: 'cardio' },
  { value: 'air-bike', label: 'Air Bike', modality: 'cardio' },
  { value: 'rowing-ergometer', label: 'Rowing Ergometer', modality: 'cardio' },
  { value: 'ski-ergometer', label: 'Ski Ergometer', modality: 'cardio' },
  { value: 'elliptical', label: 'Elliptical Trainer', modality: 'cardio' },
  { value: 'stair-climber', label: 'Stair Climber', modality: 'cardio' },
  { value: 'sled', label: 'Sled', modality: 'other' },
  { value: 'jump-rope', label: 'Jump Rope', modality: 'other' },
  { value: 'battle-rope', label: 'Battle Rope', modality: 'other' },
  { value: 'medicine-ball', label: 'Medicine Ball', modality: 'other' },
  { value: 'box-platform', label: 'Box / Platform', modality: 'other' },
  { value: 'nordic-anchor', label: 'Nordic Anchor / Ankle Support', modality: 'other' },
  { value: 'glute-ham-developer', label: 'Glute-Ham Developer', modality: 'other' },
  { value: 'slider', label: 'Slider Discs / Sliding Surface', modality: 'other' },
  { value: 'stability-ball', label: 'Stability Ball', modality: 'other' },
  { value: 'farmers-carry-handles', label: 'Farmer Carry Handles', modality: 'other' },
  { value: 'recumbent-bike', label: 'Recumbent Bike', modality: 'cardio' },
  { value: 'landmine', label: 'Landmine Base', modality: 'other' },
  { value: 'back-extension-station', label: 'Back Extension Station', modality: 'other' },
  { value: 'reverse-hyper-machine', label: 'Reverse Hyper Machine', modality: 'machine' },
  { value: 'dip-station', label: 'Dip Station', modality: 'bodyweight' },
  { value: 'weight-plate', label: 'Weight Plate', modality: 'free-weight' },
] as const;

export const equipmentModalities = [
  { value: 'free-weight', label: 'Free Weight' },
  { value: 'machine', label: 'Machine' },
  { value: 'cable', label: 'Cable' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'resistance-band', label: 'Resistance Band' },
  { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'other', label: 'Other' },
] as const;
export const exerciseFamilies = [
  { value: 'standing-curl', label: 'Standing Curl' },
  { value: 'hammer-curl', label: 'Hammer Curl' },
  { value: 'preacher-curl', label: 'Preacher Curl' },
  { value: 'spider-curl', label: 'Spider Curl' },
  { value: 'incline-curl', label: 'Incline Curl' },
  { value: 'cable-curl', label: 'Cable Curl' },
  { value: 'machine-curl', label: 'Machine Curl' },
  { value: 'reverse-curl', label: 'Reverse Curl' },
  { value: 'concentration-curl', label: 'Concentration Curl' },
  { value: 'drag-curl', label: 'Drag Curl' },
  { value: 'squat', label: 'Squat' },
  { value: 'flat-chest-press', label: 'Flat Chest Press' },
  { value: 'incline-chest-press', label: 'Incline Chest Press' },
  { value: 'decline-chest-press', label: 'Decline Chest Press' },
  { value: 'chest-fly', label: 'Chest Fly' },
  { value: 'push-up', label: 'Push-Up' },
  { value: 'chest-dip', label: 'Chest Dip' },
  { value: 'squeeze-press', label: 'Squeeze Press' },
  { value: 'triceps-pushdown', label: 'Triceps Pushdown' },
  { value: 'overhead-triceps-extension', label: 'Overhead Triceps Extension' },
  { value: 'lying-triceps-extension', label: 'Lying Triceps Extension' },
  { value: 'close-grip-press', label: 'Close-Grip Press' },
  { value: 'triceps-dip', label: 'Triceps Dip' },
  { value: 'triceps-kickback', label: 'Triceps Kickback' },
  { value: 'overhead-press', label: 'Overhead Press' },
  { value: 'lateral-raise', label: 'Lateral Raise' },
  { value: 'front-raise', label: 'Front Raise' },
  { value: 'rear-delt-fly', label: 'Rear Delt Fly' },
  { value: 'rear-delt-row', label: 'Rear Delt Row' },
  { value: 'upright-row', label: 'Upright Row' },
  { value: 'bodyweight-shoulder-press', label: 'Bodyweight Shoulder Press' },
  { value: 'vertical-pulldown', label: 'Vertical Pulldown' },
  { value: 'pull-up-chin-up', label: 'Pull-Up / Chin-Up' },
  { value: 'seated-row', label: 'Seated Row' },
  { value: 'chest-supported-row', label: 'Chest-Supported Row' },
  { value: 'free-weight-row', label: 'Free-Weight Row' },
  { value: 't-bar-landmine-row', label: 'T-Bar / Landmine Row' },
  { value: 'upper-back-row', label: 'Upper-Back Row' },
  { value: 'pullover-straight-arm-pull', label: 'Pullover / Straight-Arm Pull' },
  { value: 'shrug', label: 'Shrug' },
  { value: 'back-extension', label: 'Back Extension' },
  { value: 'deadlift', label: 'Deadlift' },
  { value: 'machine-squat', label: 'Machine Squat' },
  { value: 'leg-press', label: 'Leg Press' },
  { value: 'leg-extension', label: 'Leg Extension' },
  { value: 'split-squat', label: 'Split Squat' },
  { value: 'lunge', label: 'Lunge' },
  { value: 'step-up', label: 'Step-Up' },
  { value: 'sissy-squat', label: 'Sissy Squat' },
  { value: 'romanian-stiff-leg-hinge', label: 'Romanian / Stiff-Leg Hinge' },
  { value: 'good-morning', label: 'Good Morning' },
  { value: 'hip-thrust', label: 'Hip Thrust' },
  { value: 'glute-bridge', label: 'Glute Bridge' },
  { value: 'leg-curl', label: 'Leg Curl' },
  { value: 'nordic-glute-ham', label: 'Nordic / Glute-Ham Curl' },
  { value: 'glute-kickback', label: 'Glute Kickback' },
  { value: 'hip-abduction', label: 'Hip Abduction' },
  { value: 'reverse-hyperextension', label: 'Reverse Hyperextension' },
  { value: 'standing-calf-raise', label: 'Standing Calf Raise' },
  { value: 'seated-calf-raise', label: 'Seated Calf Raise' },
  { value: 'leg-press-calf-raise', label: 'Leg Press Calf Raise' },
  { value: 'donkey-calf-raise', label: 'Donkey Calf Raise' },
  { value: 'crunch', label: 'Crunch' },
  { value: 'reverse-crunch', label: 'Reverse Crunch' },
  { value: 'hanging-raise', label: 'Hanging Raise' },
  { value: 'lying-leg-raise', label: 'Lying Leg Raise' },
  { value: 'plank-anti-extension', label: 'Plank / Anti-Extension' },
  { value: 'rollout-anti-extension', label: 'Rollout / Anti-Extension' },
  { value: 'anti-rotation-press', label: 'Anti-Rotation Press' },
  { value: 'core-rotation', label: 'Core Rotation' },
  { value: 'side-plank', label: 'Side Plank' },
  { value: 'lateral-flexion', label: 'Lateral Flexion' },
  { value: 'controlled-core-stability', label: 'Controlled Core Stability' },
  { value: 'walking-running', label: 'Walking / Running' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'rowing-ergometer', label: 'Rowing Ergometer' },
  { value: 'ski-ergometer', label: 'Ski Ergometer' },
  { value: 'cardio-machine', label: 'Cardio Machine' },
  { value: 'loaded-carry', label: 'Loaded Carry' },
  { value: 'sled', label: 'Sled' },
  { value: 'jump-rope', label: 'Jump Rope' },
  { value: 'battle-rope', label: 'Battle Rope' },
  { value: 'kettlebell-ballistic', label: 'Kettlebell Ballistic' },
  { value: 'turkish-get-up', label: 'Turkish Get-Up' },
  { value: 'medicine-ball-power', label: 'Medicine Ball Power' },
  { value: 'bodyweight-conditioning', label: 'Bodyweight Conditioning' },
  { value: 'plyometric-jump', label: 'Plyometric / Jump' },
  { value: 'clean', label: 'Clean' },
  { value: 'jerk', label: 'Jerk' },
  { value: 'snatch', label: 'Snatch' },
  { value: 'thruster', label: 'Thruster' },
] as const;
export const gripStyles = [
  { value: 'supinated', label: 'Palms Up' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'pronated', label: 'Palms Down' },
  { value: 'rotating', label: 'Rotating' },
] as const;
export const exerciseGripWidths = [
  { value: 'close', label: 'Close' },
  { value: 'wide', label: 'Wide' },
] as const;
export const exerciseResistanceOrigins = [
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
  { value: 'high', label: 'High' },
] as const;
export const exerciseSupportTypes = [{ value: 'chest', label: 'Chest' }] as const;
export const exerciseApparatusTypes = [{ value: 't-bar', label: 'T-Bar' }] as const;
export const exerciseRowPaths = [{ value: 'upper', label: 'Upper' }] as const;
export const exerciseTravelPaths = [
  { value: 'lateral', label: 'Lateral' },
  { value: 'forward-backward', label: 'Forward / Backward' },
] as const;
export const exercisePositions = [
  { value: 'standing', label: 'Standing' },
  { value: 'kneeling', label: 'Kneeling' },
  { value: 'half-kneeling', label: 'Half-Kneeling' },
  { value: 'seated', label: 'Seated' },
  { value: 'incline', label: 'Incline' },
  { value: 'decline', label: 'Decline' },
  { value: 'preacher', label: 'Preacher' },
  { value: 'prone', label: 'Face Down' },
  { value: 'lying', label: 'Lying' },
  { value: 'supported', label: 'Supported' },
  { value: 'multi-position', label: 'Multi-Position' },
] as const;
export const exerciseDifficulties = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
] as const;
export const exerciseCategories = [
  { value: 'compound', label: 'Compound' },
  { value: 'isolation', label: 'Isolation' },
  { value: 'core', label: 'Core' },
  { value: 'carry', label: 'Carry' },
  { value: 'conditioning', label: 'Conditioning' },
] as const;

export type MuscleGroup = (typeof muscleGroups)[number]['value'];
export type MuscleId = (typeof muscles)[number]['id'];
export type MovementPattern = (typeof movementPatterns)[number]['value'];
export type EquipmentType = (typeof equipmentTypes)[number]['value'];
export type EquipmentModality = (typeof equipmentModalities)[number]['value'];
export type ExerciseFamilyId = (typeof exerciseFamilies)[number]['value'];
export type GripStyle = (typeof gripStyles)[number]['value'];
export type ExerciseGripWidth = (typeof exerciseGripWidths)[number]['value'];
export type ExerciseResistanceOrigin = (typeof exerciseResistanceOrigins)[number]['value'];
export type ExerciseSupportType = (typeof exerciseSupportTypes)[number]['value'];
export type ExerciseApparatusType = (typeof exerciseApparatusTypes)[number]['value'];
export type ExerciseRowPath = (typeof exerciseRowPaths)[number]['value'];
export type ExerciseTravelPath = (typeof exerciseTravelPaths)[number]['value'];
export type ExercisePosition = (typeof exercisePositions)[number]['value'];
export type ExerciseDifficulty = (typeof exerciseDifficulties)[number]['value'];
export type ExerciseCategory = (typeof exerciseCategories)[number]['value'];

export function getTaxonomyLabel<T extends readonly { value: string; label: string }[]>(
  taxonomy: T,
  value: T[number]['value'],
): string {
  return taxonomy.find((item) => item.value === value)?.label ?? value;
}
export function getMuscle(muscleId: MuscleId) {
  return muscles.find((muscle) => muscle.id === muscleId);
}
export function getEquipmentModality(equipment: EquipmentType): EquipmentModality {
  return equipmentTypes.find((item) => item.value === equipment)?.modality ?? 'other';
}
