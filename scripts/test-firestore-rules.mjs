import assert from 'node:assert/strict';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!emulatorHost) {
  throw new Error('FIRESTORE_EMULATOR_HOST is required. Run through firebase emulators:exec.');
}
if (!authHost) throw new Error('FIREBASE_AUTH_EMULATOR_HOST is required.');

const baseUrl = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents`;
const ownerHeaders = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const userA = await createAuthUser('owner-a@example.invalid');
const userB = await createAuthUser('owner-b@example.invalid');
const userC = await createAuthUser('owner-c@example.invalid');

await writeAsOwner('exercises/published-system', {
  source: stringValue('system'),
  status: stringValue('published'),
  name: stringValue('Published exercise'),
});
await writeAsOwner('exercises/draft-system', {
  source: stringValue('system'),
  status: stringValue('draft'),
  name: stringValue('Draft exercise'),
});
await writeAsOwner('exercises/published-user', {
  source: stringValue('user'),
  status: stringValue('published'),
  name: stringValue('User exercise'),
});
await writeAsOwner('private/example', { value: stringValue('private') });

assert.equal((await fetch(`${baseUrl}/exercises/published-system`)).status, 200);
assert.equal((await fetch(`${baseUrl}/exercises/draft-system`)).status, 403);
assert.equal((await fetch(`${baseUrl}/exercises/published-user`)).status, 403);
assert.equal((await fetch(`${baseUrl}/private/example`)).status, 403);

const publicQueryResponse = await fetch(`${baseUrl}:runQuery`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: 'exercises' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [fieldFilter('source', 'system'), fieldFilter('status', 'published')],
        },
      },
    },
  }),
});
assert.equal(publicQueryResponse.status, 200);
const publicResults = await publicQueryResponse.json();
assert.equal(publicResults.filter((result) => result.document).length, 1);

const writeResponse = await fetch(`${baseUrl}/exercises?documentId=client-write`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fields: { source: stringValue('system'), status: stringValue('published') },
  }),
});
assert.equal(writeResponse.status, 403);

const updateResponse = await fetch(`${baseUrl}/exercises/published-system`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fields: {
      source: stringValue('system'),
      status: stringValue('published'),
      name: stringValue('Client edit'),
    },
  }),
});
assert.equal(updateResponse.status, 403);

const deleteResponse = await fetch(`${baseUrl}/exercises/published-system`, {
  method: 'DELETE',
});
assert.equal(deleteResponse.status, 403);

const athleteAPath = `athletes/${userA.localId}`;
const athleteBPath = `athletes/${userB.localId}`;
const validProfile = athleteFields(userA.localId);
assert.equal((await clientCreate(athleteAPath, validProfile, userA.idToken)).status, 200);
assert.equal((await clientGet(athleteAPath, userA.idToken)).status, 200);
assert.equal((await clientGet(athleteAPath)).status, 403);
assert.equal((await clientGet(athleteAPath, userB.idToken)).status, 403);
assert.equal((await clientCreate(athleteBPath, athleteFields(userB.localId))).status, 403);
const updatedProfile = athleteFields(userA.localId);
updatedProfile.updatedAt = { timestampValue: '2026-08-30T10:01:00Z' };
assert.equal((await clientUpdate(athleteAPath, updatedProfile, userA.idToken)).status, 200);
assert.equal((await clientUpdate(athleteAPath, updatedProfile)).status, 403);
assert.equal((await clientUpdate(athleteAPath, updatedProfile, userB.idToken)).status, 403);
assert.equal((await clientDelete(athleteAPath, userA.idToken)).status, 403);
assert.equal(
  (await clientCreate(athleteBPath, athleteFields(userB.localId), userA.idToken)).status,
  403,
);
assert.equal(
  (await clientGet(`athletes/${userA.localId}/workouts/missing`, userA.idToken)).status,
  404,
);
assert.equal(
  (await clientCreate('athletes/wrong-owner', athleteFields('wrong'), userA.idToken)).status,
  403,
);
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/workouts/example`,
      { value: stringValue('no') },
      userA.idToken,
    )
  ).status,
  403,
);
const invalidProfile = athleteFields(userB.localId);
invalidProfile.extra = stringValue('no');
assert.equal((await clientCreate(athleteBPath, invalidProfile, userB.idToken)).status, 403);
for (const mutate of [
  (fields) => (fields.schemaVersion = { integerValue: '2' }),
  (fields) => (fields.ownerUid = stringValue(userA.localId)),
  (fields) => (fields.createdAt = stringValue('not-a-timestamp')),
  (fields) => (fields.onboarding.mapValue.fields.goal = stringValue('invalid')),
  (fields) => (fields.onboarding.mapValue.fields.frequency = { integerValue: '8' }),
  (fields) => (fields.onboarding.mapValue.fields.limitationsNote = stringValue('private')),
]) {
  const fields = athleteFields(userB.localId);
  mutate(fields);
  assert.equal((await clientCreate(athleteBPath, fields, userB.idToken)).status, 403);
}
const listAthletes = await fetch(`${baseUrl}:runQuery`, {
  method: 'POST',
  headers: authHeaders(userA.idToken),
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'athletes' }] } }),
});
assert.equal(listAthletes.status, 403);

const athleteSettingsPath = `athletes/${userA.localId}/settings/current`;
assert.equal(
  (await clientCreate(athleteSettingsPath, athleteSettingsFields(userA.localId), userA.idToken))
    .status,
  200,
);
assert.equal((await clientGet(athleteSettingsPath, userA.idToken)).status, 200);
assert.equal((await clientGet(athleteSettingsPath, userB.idToken)).status, 403);
assert.equal((await clientGet(athleteSettingsPath)).status, 403);
assert.equal((await clientGet(`athletes/${userA.localId}/settings`, userA.idToken)).status, 403);
assert.equal((await clientDelete(athleteSettingsPath, userA.idToken)).status, 403);
const updatedAthleteSettings = athleteSettingsFields(userA.localId);
updatedAthleteSettings.units.mapValue.fields.loadUnit = stringValue('lb');
updatedAthleteSettings.updatedAt = { timestampValue: '2026-09-01T10:01:00Z' };
assert.equal(
  (await clientUpdate(athleteSettingsPath, updatedAthleteSettings, userA.idToken)).status,
  200,
);
for (const mutate of [
  (fields) => (fields.ownerUid = stringValue(userA.localId)),
  (fields) => (fields.schemaVersion = { integerValue: '2' }),
  (fields) => (fields.contractVersion = stringValue('future')),
  (fields) => (fields.trainingLocation = stringValue('unknown')),
  (fields) => (fields.equipment = { arrayValue: { values: [stringValue('unknown')] } }),
  (fields) =>
    (fields.equipment = { arrayValue: { values: [stringValue('bench'), stringValue('bench')] } }),
  (fields) => (fields.units.mapValue.fields.loadUnit = stringValue('stone')),
  (fields) =>
    (fields.rest.mapValue.fields.overridesSeconds.mapValue.fields.power = { integerValue: '31' }),
  (fields) =>
    (fields.rest.mapValue.fields.overridesSeconds.mapValue.fields.medical = { integerValue: '60' }),
]) {
  const fields = athleteSettingsFields(userB.localId);
  mutate(fields);
  assert.equal(
    (await clientCreate(`athletes/${userB.localId}/settings/current`, fields, userB.idToken))
      .status,
    403,
  );
}
assert.equal(
  (
    await clientCreate(
      `athletes/${userB.localId}/settings/wrong`,
      athleteSettingsFields(userB.localId),
      userB.idToken,
    )
  ).status,
  403,
);
const settingsCreatedAtMutation = athleteSettingsFields(userA.localId);
settingsCreatedAtMutation.createdAt = { timestampValue: '2026-09-01T10:02:00Z' };
settingsCreatedAtMutation.updatedAt = { timestampValue: '2026-09-01T10:03:00Z' };
assert.equal(
  (await clientUpdate(athleteSettingsPath, settingsCreatedAtMutation, userA.idToken)).status,
  403,
);
console.log(
  'Athlete settings rules: fixed owner document, strict fields, enums, rest bounds and immutable identity passed.',
);

const nativePreferencesPath = `athletes/${userA.localId}/nativeWorkoutPreferences/current`;
assert.equal(
  (await clientCreate(nativePreferencesPath, nativePreferenceFields(userA.localId), userA.idToken))
    .status,
  200,
);
assert.equal((await clientGet(nativePreferencesPath, userA.idToken)).status, 200);
assert.equal((await clientGet(nativePreferencesPath, userB.idToken)).status, 403);
assert.equal((await clientGet(nativePreferencesPath)).status, 403);
assert.equal(
  (await clientGet(`athletes/${userA.localId}/nativeWorkoutPreferences`, userA.idToken)).status,
  403,
);
assert.equal((await clientDelete(nativePreferencesPath, userA.idToken)).status, 403);
const updatedNativePreferences = nativePreferenceFields(userA.localId);
updatedNativePreferences.hapticsEnabled = { booleanValue: false };
updatedNativePreferences.updatedAt = { timestampValue: '2026-09-01T14:01:00Z' };
assert.equal(
  (await clientUpdate(nativePreferencesPath, updatedNativePreferences, userA.idToken)).status,
  200,
);
assert.equal(
  (await clientUpdate(nativePreferencesPath, updatedNativePreferences, userB.idToken)).status,
  403,
);
for (const mutate of [
  (fields) => (fields.ownerUid = stringValue(userA.localId)),
  (fields) => (fields.schemaVersion = { integerValue: '2' }),
  (fields) => (fields.contractVersion = stringValue('future')),
  (fields) => (fields.hapticsEnabled = stringValue('true')),
  (fields) => (fields.extra = stringValue('no')),
]) {
  const fields = nativePreferenceFields(userB.localId);
  mutate(fields);
  assert.equal(
    (
      await clientCreate(
        `athletes/${userB.localId}/nativeWorkoutPreferences/current`,
        fields,
        userB.idToken,
      )
    ).status,
    403,
  );
}
assert.equal(
  (
    await clientCreate(
      `athletes/${userB.localId}/nativeWorkoutPreferences/wrong`,
      nativePreferenceFields(userB.localId),
      userB.idToken,
    )
  ).status,
  403,
);
const nativeCreatedAtMutation = nativePreferenceFields(userA.localId);
nativeCreatedAtMutation.createdAt = { timestampValue: '2026-09-01T14:02:00Z' };
nativeCreatedAtMutation.updatedAt = { timestampValue: '2026-09-01T14:03:00Z' };
assert.equal(
  (await clientUpdate(nativePreferencesPath, nativeCreatedAtMutation, userA.idToken)).status,
  403,
);
console.log(
  'Native workout preferences rules: owner fixed document, strict booleans, privacy and immutable identity passed.',
);

const nutritionPath = `athletes/${userA.localId}/nutritionProfile/current`;
const validNutrition = nutritionFields(userA.localId);
assert.equal((await clientCreate(nutritionPath, validNutrition, userA.idToken)).status, 200);
assert.equal((await clientGet(nutritionPath, userA.idToken)).status, 200);
assert.equal((await clientGet(nutritionPath)).status, 403);
assert.equal((await clientGet(nutritionPath, userB.idToken)).status, 403);
assert.equal(
  (await clientGet(`athletes/${userA.localId}/nutritionProfile`, userA.idToken)).status,
  403,
);
assert.equal((await clientDelete(nutritionPath, userA.idToken)).status, 403);
const updatedNutrition = nutritionFields(userA.localId);
updatedNutrition.focus = stringValue('performance');
updatedNutrition.updatedAt = { timestampValue: '2026-09-01T10:01:00Z' };
assert.equal((await clientUpdate(nutritionPath, updatedNutrition, userA.idToken)).status, 200);
for (const mutate of [
  (fields) => (fields.focus = stringValue('unknown')),
  (fields) => (fields.dietaryPattern = stringValue('medical')),
  (fields) => (fields.ownerUid = stringValue(userA.localId)),
  (fields) => (fields.schemaVersion = { integerValue: '2' }),
  (fields) => (fields.contractVersion = stringValue('future')),
]) {
  const fields = nutritionFields(userB.localId);
  mutate(fields);
  assert.equal(
    (
      await clientCreate(
        `athletes/${userB.localId}/nutritionProfile/current`,
        fields,
        userB.idToken,
      )
    ).status,
    403,
  );
}
assert.equal(
  (
    await clientCreate(
      `athletes/${userB.localId}/nutritionProfile/wrong`,
      nutritionFields(userB.localId),
      userB.idToken,
    )
  ).status,
  403,
);
const mutatedCreatedAt = nutritionFields(userA.localId);
mutatedCreatedAt.focus = stringValue('maintain');
mutatedCreatedAt.createdAt = { timestampValue: '2026-09-01T10:01:00Z' };
mutatedCreatedAt.updatedAt = { timestampValue: '2026-09-01T10:02:00Z' };
assert.equal((await clientUpdate(nutritionPath, mutatedCreatedAt, userA.idToken)).status, 403);
console.log(
  'Nutrition profile rules: owner CRUD boundaries, enums, identity, and immutable fields passed.',
);

const targetsPath = `athletes/${userA.localId}/nutritionTargets/current`;
assert.equal(
  (await clientCreate(targetsPath, nutritionTargetFields(userA.localId), userA.idToken)).status,
  200,
);
assert.equal((await clientGet(targetsPath, userA.idToken)).status, 200);
assert.equal((await clientGet(targetsPath, userB.idToken)).status, 403);
assert.equal(
  (await clientGet(`athletes/${userA.localId}/nutritionTargets`, userA.idToken)).status,
  403,
);
assert.equal((await clientDelete(targetsPath, userA.idToken)).status, 403);
const emptyTargets = nutritionTargetFields(userA.localId, {});
emptyTargets.updatedAt = { timestampValue: '2026-09-01T11:00:00Z' };
assert.equal((await clientUpdate(targetsPath, emptyTargets, userA.idToken)).status, 200);
assert.equal(
  (
    await clientCreate(
      `athletes/${userB.localId}/nutritionTargets/current`,
      nutritionTargetFields(userA.localId),
      userB.idToken,
    )
  ).status,
  403,
);

const mealPath = `athletes/${userA.localId}/nutritionEntries/meal-1`;
assert.equal(
  (await clientCreate(mealPath, nutritionMealFields(userA.localId, 'meal-1', {}), userA.idToken))
    .status,
  200,
);
assert.equal((await clientGet(mealPath, userA.idToken)).status, 200);
assert.equal((await clientGet(mealPath, userB.idToken)).status, 403);
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/nutritionEntries/meal-2`,
      nutritionMealFields(userA.localId, 'meal-2', { energyKcal: { integerValue: '500' } }),
      userA.idToken,
    )
  ).status,
  200,
);
const editedMeal = nutritionMealFields(userA.localId, 'meal-1', {
  proteinG: { integerValue: '30' },
});
editedMeal.updatedAt = { timestampValue: '2026-09-01T11:00:00Z' };
assert.equal((await clientUpdate(mealPath, editedMeal, userA.idToken)).status, 200);
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/nutritionEntries/wrong`,
      nutritionMealFields(userA.localId, 'mismatch', {}),
      userA.idToken,
    )
  ).status,
  403,
);
const waterPath = `athletes/${userA.localId}/nutritionEntries/water-1`;
assert.equal(
  (
    await clientCreate(
      waterPath,
      nutritionWaterFields(userA.localId, 'water-1', 500),
      userA.idToken,
    )
  ).status,
  200,
);
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/nutritionEntries/water-zero`,
      nutritionWaterFields(userA.localId, 'water-zero', 0),
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/nutritionEntries/water-large`,
      nutritionWaterFields(userA.localId, 'water-large', 10001),
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientDelete(waterPath, userB.idToken)).status, 403);
assert.equal((await clientDelete(waterPath, userA.idToken)).status, 200);

const savedPath = `athletes/${userA.localId}/nutritionSavedMeals/saved-1`;
assert.equal(
  (await clientCreate(savedPath, nutritionSavedMealFields(userA.localId, 'saved-1'), userA.idToken))
    .status,
  200,
);
assert.equal((await clientGet(savedPath, userA.idToken)).status, 200);
assert.equal((await clientGet(savedPath, userB.idToken)).status, 403);
const editedSaved = nutritionSavedMealFields(userA.localId, 'saved-1');
editedSaved.name = stringValue('Edited lunch');
editedSaved.updatedAt = { timestampValue: '2026-09-01T11:00:00Z' };
assert.equal((await clientUpdate(savedPath, editedSaved, userA.idToken)).status, 200);
assert.equal((await clientDelete(savedPath, userA.idToken)).status, 200);
const providerMeal = nutritionMealFields(userA.localId, 'provider-meal', {
  energyKcal: { integerValue: '250' },
});
providerMeal.sourceSnapshot = nutritionSourceFields();
const providerMealPath = `athletes/${userA.localId}/nutritionEntries/provider-meal`;
assert.equal((await clientCreate(providerMealPath, providerMeal, userA.idToken)).status, 200);
assert.equal((await clientGet(providerMealPath, userB.idToken)).status, 403);
assert.equal((await clientGet(providerMealPath)).status, 403);
const invalidProviderMeal = nutritionMealFields(userA.localId, 'provider-invalid', {});
invalidProviderMeal.sourceSnapshot = nutritionSourceFields();
invalidProviderMeal.sourceSnapshot.mapValue.fields.provider = stringValue('other-provider');
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/nutritionEntries/provider-invalid`,
      invalidProviderMeal,
      userA.idToken,
    )
  ).status,
  403,
);
const recipePath = `athletes/${userA.localId}/nutritionRecipes/recipe-1`;
assert.equal(
  (await clientCreate(recipePath, nutritionRecipeFields(userA.localId, 'recipe-1'), userA.idToken))
    .status,
  200,
);
assert.equal((await clientGet(recipePath, userA.idToken)).status, 200);
assert.equal((await clientGet(recipePath, userB.idToken)).status, 403);
assert.equal((await clientGet(recipePath)).status, 403);
assert.equal(
  (
    await clientCreate(
      `athletes/${userB.localId}/nutritionRecipes/stolen`,
      nutritionRecipeFields(userB.localId, 'stolen'),
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientDelete(recipePath, userA.idToken)).status, 200);
console.log(
  'Nutrition tracking rules: targets, meal/water variants, provider provenance, saved meals, private recipes, edits/deletes, and privacy passed.',
);

const workoutPath = `athletes/${userA.localId}/workouts/workout-1`;
const validWorkout = workoutFields(userA.localId, 'workout-1');
assert.equal((await clientCreate(workoutPath, validWorkout, userA.idToken)).status, 200);
console.log('Workout rule smoke: owner create passed.');
assert.equal((await clientGet(workoutPath, userA.idToken)).status, 200);
assert.equal((await clientGet(workoutPath)).status, 403);
assert.equal((await clientGet(workoutPath, userB.idToken)).status, 403);
assert.equal((await clientUpdate(workoutPath, validWorkout, userA.idToken)).status, 200);
console.log('Workout rule smoke: read boundaries and identical retry passed.');
const mutatedWorkout = workoutFields(userA.localId, 'workout-1');
mutatedWorkout.note = stringValue('changed');
assert.equal((await clientUpdate(workoutPath, mutatedWorkout, userA.idToken)).status, 403);
assert.equal((await clientDelete(workoutPath, userA.idToken)).status, 403);
assert.equal(
  (await clientCreate(`athletes/${userA.localId}/workouts/wrong-id`, validWorkout, userA.idToken))
    .status,
  403,
);
assert.equal(
  (
    await clientCreate(
      `athletes/${userB.localId}/workouts/workout-1`,
      workoutFields(userB.localId, 'workout-1'),
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/templates/example`,
      { value: stringValue('no') },
      userA.idToken,
    )
  ).status,
  403,
);
const listWorkouts = await fetch(`${baseUrl}/athletes/${userA.localId}/workouts`, {
  headers: authHeaders(userA.idToken),
});
assert.equal(listWorkouts.status, 200);
console.log('Workout rule smoke: immutable denials and owner list passed.');

const workoutV2Path = `athletes/${userA.localId}/workouts/workout-v2`;
assert.equal(
  (await clientCreate(workoutV2Path, workoutV2Fields(userA.localId, 'workout-v2'), userA.idToken))
    .status,
  200,
);
console.log('Workout V2 rule smoke: schema-v4 source, pause duration, and groups passed.');
const workoutV3Path = `athletes/${userA.localId}/workouts/workout-v3`;
assert.equal(
  (await clientCreate(workoutV3Path, workoutV3Fields(userA.localId, 'workout-v3'), userA.idToken))
    .status,
  200,
);
assert.equal((await clientGet(workoutV3Path, userB.idToken)).status, 403);
console.log(
  'Workout V3 rule smoke: schema-v5 programme provenance and immutable owner boundary passed.',
);

const customPath = `athletes/${userA.localId}/customExercises/custom-rule-test`;
const custom = customExerciseFields(userA.localId, 'custom-rule-test');
assert.equal((await clientCreate(customPath, custom, userA.idToken)).status, 200);
assert.equal((await clientGet(customPath, userA.idToken)).status, 200);
assert.equal((await clientGet(customPath, userB.idToken)).status, 403);
assert.equal((await clientGet(customPath)).status, 403);
const editedCustom = structuredClone(custom);
editedCustom.name = stringValue('Edited private exercise');
editedCustom.updatedAt = { timestampValue: '2026-09-01T11:00:00Z' };
assert.equal((await clientUpdate(customPath, editedCustom, userA.idToken)).status, 200);
const stolenCustom = customExerciseFields(userB.localId, 'custom-stolen');
assert.equal(
  (
    await clientCreate(
      `athletes/${userB.localId}/customExercises/custom-stolen`,
      stolenCustom,
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientDelete(customPath, userA.idToken)).status, 200);
console.log('Custom exercise rules: owner CRUD and cross-user/unauthenticated denials passed.');

const programId = 'program-security';
const programPath = `${athleteAPath}/programs/${programId}`;
assert.equal(
  (await clientCreate(programPath, programIndexFields(userA.localId, programId), userA.idToken))
    .status,
  200,
);
assert.equal((await clientGet(programPath, userA.idToken)).status, 200);
assert.equal((await clientGet(programPath, userB.idToken)).status, 403);
assert.equal((await clientGet(programPath)).status, 403);
assert.equal((await clientDelete(programPath, userA.idToken)).status, 403);
const programV1Path = `${programPath}/versions/v1`;
assert.equal(
  (
    await clientCreate(
      programV1Path,
      programVersionFields(userA.localId, programId, 'v1', 1),
      userA.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientGet(programV1Path, userA.idToken)).status, 200);
assert.equal(
  (
    await clientUpdate(
      programV1Path,
      programVersionFields(userA.localId, programId, 'v1', 1),
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientDelete(programV1Path, userA.idToken)).status, 403);
const programDayPath = `${programV1Path}/days/w1-d1`;
assert.equal(
  (
    await clientCreate(
      programDayPath,
      programDayFields(userA.localId, programId, 'v1', 1, 1),
      userA.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientGet(programDayPath, userA.idToken)).status, 200);
assert.equal(
  (
    await clientUpdate(
      programDayPath,
      programDayFields(userA.localId, programId, 'v1', 1, 1),
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientDelete(programDayPath, userA.idToken)).status, 403);
const enrollmentId = 'enrollment-security';
const enrollmentPath = `${athleteAPath}/programEnrollments/${enrollmentId}`;
assert.equal(
  (
    await clientCreate(
      enrollmentPath,
      programEnrollmentFields(userA.localId, enrollmentId, programId),
      userA.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientGet(enrollmentPath, userB.idToken)).status, 403);
assert.equal((await clientDelete(enrollmentPath, userA.idToken)).status, 403);
const programStatePath = `${athleteAPath}/programState/current`;
assert.equal(
  (
    await clientCreate(
      programStatePath,
      programStateFields(userA.localId, enrollmentId),
      userA.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientGet(programStatePath, userA.idToken)).status, 200);
assert.equal((await clientGet(`${athleteAPath}/programState/wrong`, userA.idToken)).status, 403);
assert.equal((await clientDelete(programStatePath, userA.idToken)).status, 403);
const skipPath = `${enrollmentPath}/exceptions/w1-d1`;
assert.equal(
  (
    await clientCreate(
      skipPath,
      programSkipFields(userA.localId, enrollmentId, programId),
      userA.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientGet(skipPath, userB.idToken)).status, 403);
assert.equal(
  (
    await clientUpdate(
      skipPath,
      programSkipFields(userA.localId, enrollmentId, programId),
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientDelete(skipPath, userA.idToken)).status, 200);
console.log(
  'Training programme rules: owner indexes/enrollments, immutable versions/days, fixed state, skips, and privacy passed.',
);

const awardPath = `${athleteAPath}/achievementAwards/first-workout`;
const award = achievementAwardFields(userA.localId, 'first-workout');
assert.equal((await clientCreate(awardPath, award, userA.idToken)).status, 200);
assert.equal((await clientGet(awardPath, userA.idToken)).status, 200);
assert.equal((await clientList(`${athleteAPath}/achievementAwards`, userA.idToken)).status, 200);
assert.equal((await clientList(`${athleteAPath}/achievementAwards`, userB.idToken)).status, 403);
assert.equal((await clientGet(awardPath, userB.idToken)).status, 403);
assert.equal((await clientGet(awardPath)).status, 403);
assert.equal((await clientUpdate(awardPath, award, userA.idToken)).status, 403);
assert.equal((await clientDelete(awardPath, userA.idToken)).status, 403);
assert.equal(
  (
    await clientCreate(
      `${athleteAPath}/achievementAwards/not-approved`,
      achievementAwardFields(userA.localId, 'not-approved'),
      userA.idToken,
    )
  ).status,
  403,
);
const wrongAward = structuredClone(award);
wrongAward.ownerUid = stringValue(userB.localId);
assert.equal(
  (await clientCreate(`${athleteAPath}/achievementAwards/workouts-10`, wrongAward, userA.idToken))
    .status,
  403,
);
for (const [id, mutate] of [
  ['workouts-10', (value) => (value.contractVersion = stringValue('wrong'))],
  ['workouts-50', (value) => (value.schemaVersion = { integerValue: '2' })],
  ['schedule-streak-3', (value) => (value.family = stringValue('unknown'))],
  ['schedule-streak-10', (value) => (value.recordOrigin = stringValue('server'))],
  ['first-perfect-program-week', (value) => (value.triggerKind = stringValue('unknown'))],
  ['perfect-program-weeks-8', (value) => (value.unknown = stringValue('blocked'))],
]) {
  const invalid = achievementAwardFields(userA.localId, id);
  mutate(invalid);
  assert.equal(
    (await clientCreate(`${athleteAPath}/achievementAwards/${id}`, invalid, userA.idToken)).status,
    403,
  );
}

const motivationSeasonPath = `${athleteAPath}/motivationSeasons/season-security`;
const season = motivationSeasonFields(userA.localId, 'season-security');
assert.equal((await clientCreate(motivationSeasonPath, season, userA.idToken)).status, 200);
assert.equal((await clientGet(motivationSeasonPath, userA.idToken)).status, 200);
assert.equal((await clientList(`${athleteAPath}/motivationSeasons`, userA.idToken)).status, 200);
assert.equal((await clientGet(motivationSeasonPath, userB.idToken)).status, 403);
assert.equal((await clientGet(motivationSeasonPath)).status, 403);
const invalidSeason = motivationSeasonFields(userA.localId, 'season-invalid');
invalidSeason.weekCount = { integerValue: '6' };
assert.equal(
  (
    await clientCreate(
      `${athleteAPath}/motivationSeasons/season-invalid`,
      invalidSeason,
      userA.idToken,
    )
  ).status,
  403,
);
const completedSeason = structuredClone(season);
completedSeason.status = stringValue('completed');
completedSeason.endedAtLocal = stringValue('2026-10-04');
completedSeason.completedAt = { timestampValue: '2026-10-05T00:00:00Z' };
completedSeason.updatedAt = { timestampValue: '2026-10-05T00:00:00Z' };
assert.equal(
  (await clientUpdate(motivationSeasonPath, completedSeason, userA.idToken)).status,
  200,
);
assert.equal((await clientUpdate(motivationSeasonPath, season, userA.idToken)).status, 403);
assert.equal((await clientDelete(motivationSeasonPath, userA.idToken)).status, 403);
const motivationStatePath = `${athleteAPath}/motivationState/current`;
const motivationState = motivationStateFields(userA.localId, 'season-security');
assert.equal((await clientCreate(motivationStatePath, motivationState, userA.idToken)).status, 200);
assert.equal((await clientGet(motivationStatePath, userA.idToken)).status, 200);
assert.equal((await clientGet(motivationStatePath, userB.idToken)).status, 403);
assert.equal((await clientGet(motivationStatePath)).status, 403);
assert.equal((await clientList(`${athleteAPath}/motivationState`, userA.idToken)).status, 403);
assert.equal((await clientGet(`${athleteAPath}/motivationState/wrong`, userA.idToken)).status, 403);
assert.equal((await clientDelete(motivationStatePath, userA.idToken)).status, 403);
console.log(
  'Motivation rules: immutable owner awards, controlled personal seasons, fixed state, and privacy passed.',
);

const muscleSummaryPath = `athletes/${userA.localId}/muscleProgress/pectoralis-major`;
const muscleEventPath = `${muscleSummaryPath}/events/workout-1`;
const evidenceFields = muscleEvidenceFields(userA.localId, 'pectoralis-major', 'workout-1');
assert.equal((await clientCreate(muscleEventPath, evidenceFields, userA.idToken)).status, 200);
assert.equal((await clientGet(muscleEventPath, userA.idToken)).status, 200);
assert.equal((await clientGet(muscleEventPath, userB.idToken)).status, 403);
assert.equal((await clientGet(muscleEventPath)).status, 403);
assert.equal((await clientUpdate(muscleEventPath, evidenceFields, userA.idToken)).status, 200);
const changedEvidence = structuredClone(evidenceFields);
changedEvidence.potentialXp = { integerValue: '21' };
assert.equal((await clientUpdate(muscleEventPath, changedEvidence, userA.idToken)).status, 403);
assert.equal((await clientDelete(muscleEventPath, userA.idToken)).status, 403);
assert.equal(
  (
    await clientCreate(
      `${muscleSummaryPath}/events/missing-workout`,
      muscleEvidenceFields(userA.localId, 'pectoralis-major', 'missing-workout'),
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await clientCreate(
      `athletes/${userB.localId}/muscleProgress/pectoralis-major/events/workout-1`,
      muscleEvidenceFields(userB.localId, 'pectoralis-major', 'workout-1'),
      userA.idToken,
    )
  ).status,
  403,
);
const summaryFields = muscleSummaryFields(userA.localId, 'pectoralis-major');
assert.equal((await clientCreate(muscleSummaryPath, summaryFields, userA.idToken)).status, 200);
assert.equal((await clientGet(muscleSummaryPath, userA.idToken)).status, 200);
assert.equal((await clientGet(muscleSummaryPath, userB.idToken)).status, 403);
assert.equal((await clientGet(muscleSummaryPath)).status, 403);
const correctedSummary = structuredClone(summaryFields);
correctedSummary.totalXp = { integerValue: '14' };
correctedSummary.updatedAt = { timestampValue: '2026-08-30T12:00:00Z' };
assert.equal((await clientUpdate(muscleSummaryPath, correctedSummary, userA.idToken)).status, 200);
const badSummary = structuredClone(summaryFields);
badSummary.rankIndex = { integerValue: '16' };
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/muscleProgress/pectoralis-major-clavicular`,
      badSummary,
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientDelete(muscleSummaryPath, userA.idToken)).status, 403);
const statePath = `athletes/${userA.localId}/progressionState/p11`;
const stateFields = {
  schemaVersion: { integerValue: '1' },
  ownerUid: stringValue(userA.localId),
  rulesetVersion: stringValue('muscle-xp-v1'),
  backfillComplete: { booleanValue: true },
  updatedAt: { timestampValue: '2026-08-30T11:00:00Z' },
};
assert.equal((await clientCreate(statePath, stateFields, userA.idToken)).status, 200);
assert.equal((await clientGet(statePath, userA.idToken)).status, 200);
assert.equal((await clientGet(statePath, userB.idToken)).status, 403);
assert.equal((await clientDelete(statePath, userA.idToken)).status, 403);
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/progressionState/other`,
      stateFields,
      userA.idToken,
    )
  ).status,
  403,
);

const overallPath = `athletes/${userA.localId}/overallProgress/current`;
const overallFields = overallSummaryFields(userA.localId);
assert.equal((await clientCreate(overallPath, overallFields, userA.idToken)).status, 200);
assert.equal((await clientGet(overallPath, userA.idToken)).status, 200);
assert.equal((await clientGet(overallPath, userB.idToken)).status, 403);
assert.equal((await clientGet(overallPath)).status, 403);
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/overallProgress/other`,
      overallFields,
      userA.idToken,
    )
  ).status,
  403,
);
const advancedOverall = structuredClone(overallFields);
advancedOverall.overallRank = stringValue('Bronze III');
advancedOverall.overallRankIndex = { integerValue: '1' };
advancedOverall.groupRankIndices.mapValue.fields.chest = { integerValue: '4' };
advancedOverall.groupRankIndices.mapValue.fields.back = { integerValue: '4' };
advancedOverall.groupRankIndices.mapValue.fields.shoulders = { integerValue: '4' };
advancedOverall.coveredGroupCount = { integerValue: '3' };
advancedOverall.meanGroupRankIndex = { doubleValue: 1 };
advancedOverall.rankHistory = {
  arrayValue: {
    values: [
      {
        mapValue: {
          fields: {
            rank: stringValue('Bronze III'),
            rankIndex: { integerValue: '1' },
            achievedAt: { timestampValue: '2026-08-30T11:30:00Z' },
            triggerWorkoutId: stringValue('workout-1'),
            meanGroupRankIndexAtAchievement: { doubleValue: 1 },
            coveredGroupCountAtAchievement: { integerValue: '3' },
          },
        },
      },
    ],
  },
};
advancedOverall.updatedAt = { timestampValue: '2026-08-30T12:00:00Z' };
assert.equal((await clientUpdate(overallPath, advancedOverall, userA.idToken)).status, 200);
const demotedOverall = structuredClone(advancedOverall);
demotedOverall.overallRank = stringValue('Unranked');
demotedOverall.overallRankIndex = { integerValue: '0' };
demotedOverall.updatedAt = { timestampValue: '2026-08-30T13:00:00Z' };
assert.equal((await clientUpdate(overallPath, demotedOverall, userA.idToken)).status, 403);
assert.equal((await clientDelete(overallPath, userA.idToken)).status, 403);

const codeA = '0123456789ABCDEF';
const codeB = 'ABCDEFGHJKMNPQRS';
const settingsAPath = `athletes/${userA.localId}/socialSettings/current`;
const settingsBPath = `athletes/${userB.localId}/socialSettings/current`;
const profileAPath = `friendProfiles/${userA.localId}`;
const profileBPath = `friendProfiles/${userB.localId}`;
assert.equal(
  (
    await clientCommit(
      [
        updateWrite(settingsAPath, socialSettingsFields(userA.localId, 'Athlete A', codeA), false),
        updateWrite(profileAPath, friendProfileFields(userA.localId, 'Athlete A'), false),
        updateWrite(
          `friendCodes/${codeA}`,
          friendCodeFields(userA.localId, 'Athlete A', codeA),
          false,
        ),
      ],
      userA.idToken,
    )
  ).status,
  200,
);
assert.equal(
  (
    await clientCommit(
      [
        updateWrite(settingsBPath, socialSettingsFields(userB.localId, 'Athlete B', codeB), false),
        updateWrite(profileBPath, friendProfileFields(userB.localId, 'Athlete B'), false),
        updateWrite(
          `friendCodes/${codeB}`,
          friendCodeFields(userB.localId, 'Athlete B', codeB),
          false,
        ),
      ],
      userB.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientGet(settingsAPath, userA.idToken)).status, 200);
assert.equal((await clientGet(settingsAPath, userB.idToken)).status, 403);
assert.equal((await clientGet(settingsAPath)).status, 403);
assert.equal(
  (
    await fetch(`${baseUrl}/athletes/${userA.localId}/socialSettings`, {
      headers: authHeaders(userA.idToken),
    })
  ).status,
  403,
);
assert.equal((await clientGet(`friendCodes/${codeB}`, userA.idToken)).status, 200);
assert.equal((await clientGet(`friendCodes/${codeB}`)).status, 403);
assert.equal(
  (await fetch(`${baseUrl}/friendCodes`, { headers: authHeaders(userA.idToken) })).status,
  403,
);
assert.equal(
  (
    await clientUpdate(
      `friendCodes/${codeB}`,
      friendCodeFields(userB.localId, 'Spoofed Name', codeB),
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await clientCreate(
      'friendCodes/IIIIIIIIIIIIIIII',
      friendCodeFields(userA.localId, 'Athlete A', 'IIIIIIIIIIIIIIII'),
      userA.idToken,
    )
  ).status,
  403,
);

const friendshipId = [userA.localId, userB.localId].sort().join('__');
const friendshipPath = `friendships/${friendshipId}`;
const pairSecurityPath = `socialPairSecurity/${friendshipId}`;
const pendingFields = friendshipFields(userA.localId, userB.localId, codeB, 'pending');
assert.equal((await clientCreate(friendshipPath, pendingFields, userA.idToken)).status, 200);
assert.equal((await clientGet(friendshipPath, userA.idToken)).status, 200);
assert.equal((await clientGet(friendshipPath, userB.idToken)).status, 200);
assert.equal((await clientGet(friendshipPath, userC.idToken)).status, 403);
assert.equal((await clientGet(profileAPath, userB.idToken)).status, 403);
assert.equal((await clientGet(profileAPath, userC.idToken)).status, 403);
assert.equal((await clientGet(profileAPath)).status, 403);
assert.equal(
  (await fetch(`${baseUrl}/friendProfiles`, { headers: authHeaders(userA.idToken) })).status,
  403,
);
assert.equal(
  (
    await clientCreate(
      friendshipPath,
      friendshipFields(userB.localId, userA.localId, codeA, 'pending'),
      userB.idToken,
    )
  ).status,
  409,
);
const selfId = `${userA.localId}__${userA.localId}`;
assert.equal(
  (
    await clientCreate(
      `friendships/${selfId}`,
      friendshipFields(userA.localId, userA.localId, codeA, 'pending'),
      userA.idToken,
    )
  ).status,
  403,
);
const acceptedFields = friendshipFields(userA.localId, userB.localId, codeB, 'accepted');
assert.equal(
  (
    await clientCreate(
      pairSecurityPath,
      pairSecurityFields(userA.localId, userB.localId, true),
      userB.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientUpdate(friendshipPath, acceptedFields, userA.idToken)).status, 403);
assert.equal((await clientUpdate(friendshipPath, acceptedFields, userC.idToken)).status, 403);
assert.equal((await clientUpdate(friendshipPath, acceptedFields, userB.idToken)).status, 403);
assert.equal(
  (
    await clientCommit(
      [
        updateWrite(friendshipPath, acceptedFields, true),
        updateWrite(
          pairSecurityPath,
          pairSecurityFields(userA.localId, userB.localId, true),
          false,
        ),
      ],
      userB.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientGet(pairSecurityPath, userA.idToken)).status, 403);
assert.equal((await clientGet(pairSecurityPath, userB.idToken)).status, 403);
assert.equal((await clientGet(pairSecurityPath, userC.idToken)).status, 403);
assert.equal((await clientGet(pairSecurityPath)).status, 403);
assert.equal(
  (await fetch(`${baseUrl}/socialPairSecurity`, { headers: authHeaders(userA.idToken) })).status,
  403,
);
assert.equal(
  (
    await clientUpdate(
      pairSecurityPath,
      pairSecurityFields(userA.localId, userB.localId, true, false, true),
      userB.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientGet(profileAPath, userB.idToken)).status, 200);
assert.equal((await clientGet(nutritionPath, userB.idToken)).status, 403);
console.log('Nutrition privacy regression: accepted friend remains denied.');
const sharedProfile = friendProfileFields(userA.localId, 'Athlete A', true);
assert.equal((await clientUpdate(profileAPath, sharedProfile, userA.idToken)).status, 200);
assert.equal((await clientGet(profileAPath, userB.idToken)).status, 200);
const tamperedProfile = structuredClone(sharedProfile);
tamperedProfile.sharedOverallRank = stringValue('Apex');
tamperedProfile.sharedOverallRankIndex = { integerValue: '16' };
tamperedProfile.updatedAt = { timestampValue: '2026-08-30T14:00:00Z' };
assert.equal((await clientUpdate(profileAPath, tamperedProfile, userA.idToken)).status, 403);
const blockPath = `athletes/${userB.localId}/blockedUsers/${userA.localId}`;
assert.equal(
  (
    await clientCommit(
      [
        updateWrite(blockPath, blockedUserFields(userB.localId, userA.localId, 'Athlete A'), false),
        deleteWrite(friendshipPath),
        updateWrite(
          pairSecurityPath,
          pairSecurityFields(userA.localId, userB.localId, false, false, true),
          true,
        ),
      ],
      userB.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientGet(blockPath, userB.idToken)).status, 200);
assert.equal((await clientGet(blockPath, userA.idToken)).status, 403);
assert.equal((await clientGet(`friendCodes/${codeA}`, userB.idToken)).status, 403);
assert.equal((await clientGet(profileAPath, userB.idToken)).status, 403);
assert.equal((await clientCreate(friendshipPath, pendingFields, userA.idToken)).status, 403);
assert.equal((await clientDelete(blockPath, userB.idToken)).status, 403);
assert.equal(
  (
    await clientCommit(
      [
        deleteWrite(blockPath),
        updateWrite(
          pairSecurityPath,
          pairSecurityFields(userA.localId, userB.localId, false),
          true,
        ),
      ],
      userB.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientGet(friendshipPath, userA.idToken)).status, 403);
assert.equal((await clientCreate(friendshipPath, pendingFields, userA.idToken)).status, 200);
assert.equal((await clientDelete(friendshipPath, userA.idToken)).status, 200);
assert.equal((await clientCreate(friendshipPath, pendingFields, userA.idToken)).status, 200);
assert.equal((await clientDelete(friendshipPath, userB.idToken)).status, 200);
assert.equal((await clientCreate(friendshipPath, pendingFields, userA.idToken)).status, 200);
assert.equal(
  (
    await clientCommit(
      [
        updateWrite(friendshipPath, acceptedFields, true),
        updateWrite(pairSecurityPath, pairSecurityFields(userA.localId, userB.localId, true), true),
      ],
      userB.idToken,
    )
  ).status,
  200,
);
const mutatedAccepted = structuredClone(acceptedFields);
mutatedAccepted.recipientDisplayName = stringValue('Changed Identity');
mutatedAccepted.updatedAt = { timestampValue: '2026-08-30T13:00:00Z' };
assert.equal((await clientUpdate(friendshipPath, mutatedAccepted, userA.idToken)).status, 403);
assert.equal((await clientDelete(friendshipPath, userC.idToken)).status, 403);
assert.equal((await clientDelete(friendshipPath, userA.idToken)).status, 403);
assert.equal(
  (
    await clientCommit(
      [
        deleteWrite(friendshipPath),
        updateWrite(
          pairSecurityPath,
          pairSecurityFields(userA.localId, userB.localId, false),
          true,
        ),
      ],
      userA.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientCreate(friendshipPath, pendingFields, userA.idToken)).status, 200);
assert.equal(
  (
    await clientCreate(
      blockPath,
      blockedUserFields(userB.localId, userA.localId, 'Athlete A'),
      userB.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await clientCommit(
      [
        updateWrite(blockPath, blockedUserFields(userB.localId, userA.localId, 'Athlete A'), false),
        deleteWrite(friendshipPath),
        updateWrite(
          pairSecurityPath,
          pairSecurityFields(userA.localId, userB.localId, false, false, true),
          true,
        ),
      ],
      userB.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientUpdate(friendshipPath, acceptedFields, userB.idToken)).status, 403);
assert.equal((await clientDelete(friendshipPath, userB.idToken)).status, 403);
assert.equal((await clientDelete(blockPath, userB.idToken)).status, 403);
assert.equal(
  (
    await clientCommit(
      [
        deleteWrite(blockPath),
        updateWrite(
          pairSecurityPath,
          pairSecurityFields(userA.localId, userB.localId, false),
          true,
        ),
      ],
      userB.idToken,
    )
  ).status,
  200,
);
const disabledSettingsB = socialSettingsFields(userB.localId, 'Athlete B');
disabledSettingsB.updatedAt = { timestampValue: '2026-08-30T15:00:00Z' };
assert.equal(
  (
    await clientCommit(
      [updateWrite(settingsBPath, disabledSettingsB, true), deleteWrite(`friendCodes/${codeB}`)],
      userB.idToken,
    )
  ).status,
  200,
);
assert.equal((await clientGet(`friendCodes/${codeB}`, userA.idToken)).status, 403);
assert.equal((await clientDelete(profileAPath, userA.idToken)).status, 403);
console.log(
  'Friends-v1 rules verified: capability discovery, canonical transitions, rank privacy, blocks, and private data boundaries passed.',
);
console.log(
  'Muscle progression rules verified: immutable linked evidence, rebuildable owner summary, and P11 state boundaries passed.',
);

const analyticsPath = `athletes/${userA.localId}/exerciseAnalytics/bench-press`;
const analyticsFields = {
  schemaVersion: { integerValue: '1' },
  ownerUid: stringValue(userA.localId),
  exerciseId: stringValue('bench-press'),
  exerciseName: stringValue('Bench Press'),
  trackingProfile: {
    mapValue: {
      fields: {
        primaryMetric: stringValue('reps'),
        supportedMetrics: { arrayValue: { values: [stringValue('load'), stringValue('reps')] } },
      },
    },
  },
  recordOrigin: stringValue('athlete-client-derived'),
  updatedAt: { timestampValue: '2026-08-30T11:00:00Z' },
  lastPerformedAt: { timestampValue: '2026-08-30T11:00:00Z' },
  workoutCount: { integerValue: '1' },
  completedWorkingSetCount: { integerValue: '2' },
};
assert.equal((await clientCreate(analyticsPath, analyticsFields, userA.idToken)).status, 200);
assert.equal((await clientGet(analyticsPath, userA.idToken)).status, 200);
assert.equal((await clientGet(analyticsPath, userB.idToken)).status, 403);
assert.equal((await clientGet(analyticsPath)).status, 403);
const pointPath = `${analyticsPath}/points/workout-1`;
const pointFields = {
  schemaVersion: { integerValue: '1' },
  ownerUid: stringValue(userA.localId),
  exerciseId: stringValue('bench-press'),
  workoutId: stringValue('workout-1'),
  exerciseName: stringValue('Bench Press'),
  trackingProfile: analyticsFields.trackingProfile,
  recordOrigin: stringValue('athlete-client-derived'),
  completedAt: { timestampValue: '2026-08-30T11:00:00Z' },
  workingSetCount: { integerValue: '2' },
  bestLoadKg: { doubleValue: 100 },
};
assert.equal((await clientCreate(pointPath, pointFields, userA.idToken)).status, 200);
assert.equal((await clientUpdate(pointPath, pointFields, userA.idToken)).status, 200);
const changedPoint = structuredClone(pointFields);
changedPoint.bestLoadKg = { doubleValue: 101 };
assert.equal((await clientUpdate(pointPath, changedPoint, userA.idToken)).status, 403);
assert.equal((await clientDelete(pointPath, userA.idToken)).status, 403);
assert.equal((await clientGet(pointPath, userB.idToken)).status, 403);

const goalPath = `athletes/${userA.localId}/strengthGoals/bench--load`;
const goalFields = {
  schemaVersion: { integerValue: '1' },
  ownerUid: stringValue(userA.localId),
  goalId: stringValue('bench--load'),
  exerciseId: stringValue('bench'),
  kind: stringValue('load'),
  targetKg: { doubleValue: 120 },
  createdAt: { timestampValue: '2026-08-30T10:00:00Z' },
  updatedAt: { timestampValue: '2026-08-30T10:00:00Z' },
};
assert.equal((await clientCreate(goalPath, goalFields, userA.idToken)).status, 200);
assert.equal((await clientGet(goalPath, userB.idToken)).status, 403);
const badGoal = structuredClone(goalFields);
badGoal.targetKg = { doubleValue: -1 };
assert.equal(
  (await clientCreate(`athletes/${userA.localId}/strengthGoals/bad`, badGoal, userA.idToken))
    .status,
  403,
);
const updatedGoal = structuredClone(goalFields);
updatedGoal.targetKg = { doubleValue: 125 };
updatedGoal.updatedAt = { timestampValue: '2026-08-30T10:01:00Z' };
assert.equal((await clientUpdate(goalPath, updatedGoal, userA.idToken)).status, 200);
assert.equal((await clientDelete(goalPath, userA.idToken)).status, 200);

const measurementPath = `athletes/${userA.localId}/measurements/m1`;
const measurementFields = {
  schemaVersion: { integerValue: '1' },
  ownerUid: stringValue(userA.localId),
  measurementId: stringValue('m1'),
  source: stringValue('manual'),
  recordedAt: { timestampValue: '2026-08-30T10:00:00Z' },
  createdAt: { timestampValue: '2026-08-30T10:00:00Z' },
  updatedAt: { timestampValue: '2026-08-30T10:00:00Z' },
  values: { mapValue: { fields: { weightKg: { doubleValue: 80 } } } },
};
assert.equal((await clientCreate(measurementPath, measurementFields, userA.idToken)).status, 200);
assert.equal((await clientGet(measurementPath, userB.idToken)).status, 403);
const badMeasurement = structuredClone(measurementFields);
badMeasurement.values.mapValue.fields.weightKg = { doubleValue: 10 };
assert.equal(
  (await clientCreate(`athletes/${userA.localId}/measurements/bad`, badMeasurement, userA.idToken))
    .status,
  403,
);
assert.equal((await clientDelete(measurementPath, userA.idToken)).status, 200);

const photoPath = `athletes/${userA.localId}/progressPhotos/p1`;
const photoFields = {
  schemaVersion: { integerValue: '1' },
  ownerUid: stringValue(userA.localId),
  photoId: stringValue('p1'),
  storagePath: stringValue(`athletes/${userA.localId}/progress-photos/p1.jpg`),
  capturedAt: { timestampValue: '2026-08-30T10:00:00Z' },
  createdAt: { timestampValue: '2026-08-30T10:00:00Z' },
  updatedAt: { timestampValue: '2026-08-30T10:00:00Z' },
  contentType: stringValue('image/jpeg'),
  sizeBytes: { integerValue: '1000' },
};
assert.equal((await clientCreate(photoPath, photoFields, userA.idToken)).status, 200);
assert.equal((await clientGet(photoPath, userB.idToken)).status, 403);
assert.equal((await clientDelete(photoPath, userA.idToken)).status, 200);

const habitPath = `athletes/${userA.localId}/habits/habit-security`;
const habitFields = wellnessHabitFields(userA.localId, 'habit-security');
assert.equal((await clientCreate(habitPath, habitFields, userA.idToken)).status, 200);
assert.equal((await clientGet(habitPath, userA.idToken)).status, 200);
assert.equal((await clientGet(habitPath, userB.idToken)).status, 403);
assert.equal((await clientGet(habitPath)).status, 403);
assert.equal((await clientDelete(habitPath, userA.idToken)).status, 403);
const badHabit = structuredClone(habitFields);
badHabit.scheduleDays.arrayValue.values.push({ integerValue: '1' });
assert.equal(
  (await clientCreate(`athletes/${userA.localId}/habits/habit-bad`, badHabit, userA.idToken))
    .status,
  403,
);
for (const [suffix, mutate] of [
  ['owner', (x) => (x.ownerUid = stringValue(userB.localId))],
  ['contract', (x) => (x.contractVersion = stringValue('future'))],
  ['schema', (x) => (x.schemaVersion = { integerValue: '2' })],
  ['kind', (x) => (x.kind = stringValue('medical'))],
  ['unknown', (x) => (x.secret = stringValue('no'))],
]) {
  const fields = wellnessHabitFields(userA.localId, `habit-${suffix}`);
  mutate(fields);
  assert.equal(
    (await clientCreate(`athletes/${userA.localId}/habits/habit-${suffix}`, fields, userA.idToken))
      .status,
    403,
  );
}
const archivedHabit = structuredClone(habitFields);
archivedHabit.status = stringValue('archived');
archivedHabit.updatedAt = { timestampValue: '2026-09-02T10:01:00Z' };
assert.equal((await clientUpdate(habitPath, archivedHabit, userA.idToken)).status, 200);
const mutatedIdentity = structuredClone(archivedHabit);
mutatedIdentity.habitId = stringValue('habit-other');
assert.equal((await clientUpdate(habitPath, mutatedIdentity, userA.idToken)).status, 403);
archivedHabit.status = stringValue('active');
archivedHabit.updatedAt = { timestampValue: '2026-09-02T10:02:00Z' };
assert.equal((await clientUpdate(habitPath, archivedHabit, userA.idToken)).status, 200);
const logPath = `athletes/${userA.localId}/habitLogs/habit-security--2026-09-02`;
const logFields = wellnessHabitLogFields(userA.localId, 'habit-security', '2026-09-02');
assert.equal((await clientCreate(logPath, logFields, userA.idToken)).status, 200);
assert.equal((await clientGet(logPath, userB.idToken)).status, 403);
assert.equal((await clientGet(logPath)).status, 403);
const wrongLog = structuredClone(logFields);
wrongLog.ownerUid = stringValue(userB.localId);
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/habitLogs/habit-security--2026-09-03`,
      wrongLog,
      userA.idToken,
    )
  ).status,
  403,
);
const unknownLog = structuredClone(logFields);
unknownLog.extra = stringValue('no');
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/habitLogs/habit-security--2026-09-04`,
      unknownLog,
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientDelete(logPath, userA.idToken)).status, 200);
const recoveryPath = `athletes/${userA.localId}/recoveryCheckins/2026-09-02`;
const recoveryFields = wellnessRecoveryFields(userA.localId, '2026-09-02');
assert.equal((await clientCreate(recoveryPath, recoveryFields, userA.idToken)).status, 200);
assert.equal((await clientGet(recoveryPath, userB.idToken)).status, 403);
assert.equal((await clientGet(recoveryPath)).status, 403);
const badRecovery = structuredClone(recoveryFields);
badRecovery.energy = { doubleValue: 2.5 };
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/recoveryCheckins/2026-09-03`,
      badRecovery,
      userA.idToken,
    )
  ).status,
  403,
);
const badBoolean = wellnessRecoveryFields(userA.localId, '2026-09-04');
badBoolean.painOrInjuryConcern = stringValue('false');
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/recoveryCheckins/2026-09-04`,
      badBoolean,
      userA.idToken,
    )
  ).status,
  403,
);
const unknownRecovery = wellnessRecoveryFields(userA.localId, '2026-09-05');
unknownRecovery.diagnosis = stringValue('no');
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/recoveryCheckins/2026-09-05`,
      unknownRecovery,
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientDelete(recoveryPath, userA.idToken)).status, 200);
const observationPath = `athletes/${userA.localId}/wellnessObservations/observation-security`;
const observationFields = wellnessObservationFields(userA.localId, 'observation-security');
assert.equal((await clientCreate(observationPath, observationFields, userA.idToken)).status, 200);
assert.equal((await clientGet(observationPath, userB.idToken)).status, 403);
assert.equal((await clientGet(observationPath)).status, 403);
const secretObservation = structuredClone(observationFields);
secretObservation.accessToken = stringValue('forbidden');
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/wellnessObservations/observation-secret`,
      secretObservation,
      userA.idToken,
    )
  ).status,
  403,
);
const badMetric = wellnessObservationFields(userA.localId, 'observation-metric');
badMetric.metric = stringValue('weight');
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/wellnessObservations/observation-metric`,
      badMetric,
      userA.idToken,
    )
  ).status,
  403,
);
const badProvenance = wellnessObservationFields(userA.localId, 'observation-provenance');
badProvenance.source = stringValue('imported');
badProvenance.provenance = {
  mapValue: {
    fields: {
      kind: stringValue('imported'),
      provider: stringValue('fitbit'),
      externalRecordKeyHash: stringValue('raw-id'),
      importedAt: { timestampValue: '2026-09-02T10:00:00Z' },
    },
  },
};
assert.equal(
  (
    await clientCreate(
      `athletes/${userA.localId}/wellnessObservations/observation-provenance`,
      badProvenance,
      userA.idToken,
    )
  ).status,
  403,
);
assert.equal((await clientDelete(observationPath, userA.idToken)).status, 200);

console.log(
  'Firestore rules verified: exercise, athlete, immutable workout, analytics, goal, measurement, and private photo owner boundaries passed.',
);

async function createAuthUser(email) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test-password-123', returnSecureToken: true }),
    },
  );
  assert.ok(response.ok);
  return response.json();
}
function authHeaders(token) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json',
  };
}
async function clientGet(path, token) {
  return fetch(`${baseUrl}/${path}`, { headers: authHeaders(token) });
}
async function clientCreate(path, fields, token) {
  const parts = path.split('/');
  const id = parts.pop();
  return fetch(`${baseUrl}/${parts.join('/')}?documentId=${id}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ fields }),
  });
}
async function clientUpdate(path, fields, token) {
  return fetch(`${baseUrl}/${path}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ fields }),
  });
}
async function clientDelete(path, token) {
  return fetch(`${baseUrl}/${path}`, { method: 'DELETE', headers: authHeaders(token) });
}
async function clientList(path, token) {
  const parts = path.split('/');
  const collectionId = parts.pop();
  return fetch(`${baseUrl}/${parts.join('/')}:runQuery`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }] } }),
  });
}
async function clientCommit(writes, token) {
  return fetch(`${baseUrl}:commit`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ writes }),
  });
}
function updateWrite(path, fields, exists) {
  return {
    update: { name: `projects/${projectId}/databases/(default)/documents/${path}`, fields },
    currentDocument: { exists },
  };
}
function deleteWrite(path) {
  return { delete: `projects/${projectId}/databases/(default)/documents/${path}` };
}
function athleteFields(uid) {
  return {
    schemaVersion: { integerValue: '1' },
    ownerUid: stringValue(uid),
    onboarding: {
      mapValue: {
        fields: {
          completedAt: stringValue('2026-08-30T10:00:00Z'),
          goal: stringValue('strength'),
          experience: stringValue('intermediate'),
          trainingLocation: stringValue('commercial-gym'),
          equipment: { arrayValue: { values: [stringValue('barbell')] } },
          frequency: { integerValue: '4' },
          sessionLength: stringValue('60-min'),
          majorLifts: { arrayValue: { values: [stringValue('squat')] } },
          movementPreferences: { arrayValue: { values: [] } },
          starterPath: stringValue('starter-plan'),
        },
      },
    },
    createdAt: { timestampValue: '2026-08-30T10:00:00Z' },
    updatedAt: { timestampValue: '2026-08-30T10:00:00Z' },
  };
}
function athleteSettingsFields(uid) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('athlete-settings-v1'),
    ownerUid: stringValue(uid),
    trainingLocation: stringValue('home-gym'),
    equipment: { arrayValue: { values: [stringValue('dumbbells'), stringValue('bench')] } },
    units: {
      mapValue: { fields: { loadUnit: stringValue('kg'), distanceSystem: stringValue('metric') } },
    },
    rest: {
      mapValue: {
        fields: {
          autoStart: { booleanValue: true },
          overridesSeconds: { mapValue: { fields: { resistance: { integerValue: '90' } } } },
        },
      },
    },
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function nativePreferenceFields(uid) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('native-workout-integrations-v1'),
    ownerUid: stringValue(uid),
    hapticsEnabled: { booleanValue: true },
    keepAwakeEnabled: { booleanValue: true },
    restNotificationsEnabled: { booleanValue: false },
    createdAt: { timestampValue: '2026-09-01T14:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T14:00:00Z' },
  };
}

function workoutFields(uid, workoutId) {
  return {
    schemaVersion: { integerValue: '1' },
    recordOrigin: stringValue('athlete-client'),
    sourceSessionSchemaVersion: { integerValue: '3' },
    workoutId: stringValue(workoutId),
    ownerUid: stringValue(uid),
    startedAt: { timestampValue: '2026-08-30T10:00:00Z' },
    completedAt: { timestampValue: '2026-08-30T11:00:00Z' },
    exercises: {
      arrayValue: {
        values: [
          {
            mapValue: {
              fields: {
                id: stringValue('entry-1'),
                order: { integerValue: '1' },
                exercise: {
                  mapValue: {
                    fields: {
                      exerciseId: stringValue('barbell-back-squat'),
                      name: stringValue('Barbell Back Squat'),
                    },
                  },
                },
                sets: { arrayValue: { values: [] } },
                createdAt: stringValue('2026-08-30T10:00:00.000Z'),
              },
            },
          },
        ],
      },
    },
  };
}

function workoutV2Fields(uid, workoutId) {
  return {
    ...workoutFields(uid, workoutId),
    schemaVersion: { integerValue: '2' },
    sourceSessionSchemaVersion: { integerValue: '4' },
    pausedDurationSeconds: { integerValue: '60' },
    groups: { arrayValue: { values: [] } },
  };
}

function workoutV3Fields(uid, workoutId) {
  return {
    ...workoutFields(uid, workoutId),
    schemaVersion: { integerValue: '3' },
    sourceSessionSchemaVersion: { integerValue: '5' },
    pausedDurationSeconds: { integerValue: '60' },
    groups: { arrayValue: { values: [] } },
    programContext: {
      mapValue: {
        fields: {
          contractVersion: stringValue('workout-program-provenance-v1'),
          enrollmentId: stringValue('enrollment-security'),
          programSource: stringValue('athlete'),
          programId: stringValue('program-security'),
          programVersionId: stringValue('v1'),
          programName: stringValue('Security programme'),
          sessionLabel: stringValue('Lower'),
          weekNumber: { integerValue: '1' },
          dayOfWeek: { integerValue: '1' },
          sessionKey: stringValue('w1-d1'),
          scheduledDateLocal: stringValue('2026-09-07'),
        },
      },
    },
  };
}

function customExerciseFields(uid, exerciseId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('athlete-custom-exercise-v1'),
    ownerUid: stringValue(uid),
    exerciseId: stringValue(exerciseId),
    name: stringValue('Private cable movement'),
    trackingProfile: {
      mapValue: {
        fields: {
          primaryMetric: stringValue('reps'),
          supportedMetrics: { arrayValue: { values: [stringValue('reps'), stringValue('load')] } },
        },
      },
    },
    trainingClassification: stringValue('resistance'),
    equipment: { arrayValue: { values: [stringValue('cable')] } },
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}

function programIndexFields(uid, programId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('training-programs-v1'),
    ownerUid: stringValue(uid),
    programId: stringValue(programId),
    source: stringValue('athlete'),
    name: stringValue('Security programme'),
    currentVersionId: stringValue('v1'),
    currentVersionNumber: { integerValue: '1' },
    status: stringValue('active'),
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function programVersionFields(uid, programId, versionId, versionNumber) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('training-programs-v1'),
    ownerUid: stringValue(uid),
    programId: stringValue(programId),
    versionId: stringValue(versionId),
    versionNumber: { integerValue: String(versionNumber) },
    name: stringValue('Security programme'),
    durationWeeks: { integerValue: '1' },
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function programDayFields(uid, programId, versionId, weekNumber, dayOfWeek) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('training-programs-v1'),
    ownerUid: stringValue(uid),
    programId: stringValue(programId),
    versionId: stringValue(versionId),
    dayId: stringValue(`w${weekNumber}-d${dayOfWeek}`),
    weekNumber: { integerValue: String(weekNumber) },
    dayOfWeek: { integerValue: String(dayOfWeek) },
    weekKind: stringValue('standard'),
    label: stringValue('Lower'),
    exercises: { arrayValue: {} },
    groups: { arrayValue: {} },
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function programEnrollmentFields(uid, enrollmentId, programId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('program-enrollment-v1'),
    ownerUid: stringValue(uid),
    enrollmentId: stringValue(enrollmentId),
    programSource: stringValue('athlete'),
    programId: stringValue(programId),
    startDateLocal: stringValue('2026-09-07'),
    status: stringValue('active'),
    versionAssignments: {
      arrayValue: {
        values: [
          {
            mapValue: {
              fields: { versionId: stringValue('v1'), effectiveWeek: { integerValue: '1' } },
            },
          },
        ],
      },
    },
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function programStateFields(uid, enrollmentId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('program-enrollment-v1'),
    ownerUid: stringValue(uid),
    activeEnrollmentId: stringValue(enrollmentId),
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function programSkipFields(uid, enrollmentId, programId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('program-enrollment-v1'),
    ownerUid: stringValue(uid),
    enrollmentId: stringValue(enrollmentId),
    sessionKey: stringValue('w1-d1'),
    kind: stringValue('skipped'),
    programId: stringValue(programId),
    versionId: stringValue('v1'),
    weekNumber: { integerValue: '1' },
    dayOfWeek: { integerValue: '1' },
    scheduledDateLocal: stringValue('2026-09-07'),
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}

function muscleEvidenceFields(uid, muscleId, workoutId) {
  return {
    schemaVersion: { integerValue: '1' },
    ownerUid: stringValue(uid),
    muscleId: stringValue(muscleId),
    workoutId: stringValue(workoutId),
    rulesetVersion: stringValue('muscle-xp-v1'),
    recordOrigin: stringValue('athlete-client-derived'),
    completedAt: { timestampValue: '2026-08-30T11:00:00Z' },
    primaryCreditedSets: { integerValue: '2' },
    secondaryCreditedSets: { integerValue: '0' },
    stabilizerCreditedSets: { integerValue: '0' },
    creditedSetCount: { integerValue: '2' },
    potentialXp: { integerValue: '20' },
    sourceExerciseIds: { arrayValue: { values: [stringValue('barbell-bench-press')] } },
  };
}

function muscleSummaryFields(uid, muscleId) {
  return {
    schemaVersion: { integerValue: '1' },
    ownerUid: stringValue(uid),
    muscleId: stringValue(muscleId),
    rulesetVersion: stringValue('muscle-xp-v1'),
    recordOrigin: stringValue('athlete-client-derived'),
    totalXp: { integerValue: '20' },
    rank: stringValue('Bronze III'),
    rankIndex: { integerValue: '0' },
    creditedSessionCount: { integerValue: '1' },
    firstCreditedAt: { timestampValue: '2026-08-30T11:00:00Z' },
    lastCreditedAt: { timestampValue: '2026-08-30T11:00:00Z' },
    latestEvidenceAt: { timestampValue: '2026-08-30T11:00:00Z' },
    rankHistory: {
      arrayValue: {
        values: [
          {
            mapValue: {
              fields: {
                rank: stringValue('Bronze III'),
                rankIndex: { integerValue: '0' },
                achievedAt: { timestampValue: '2026-08-30T11:00:00Z' },
                triggerWorkoutId: stringValue('workout-1'),
                totalXpAtAchievement: { integerValue: '20' },
              },
            },
          },
        ],
      },
    },
    recentCredits: {
      arrayValue: {
        values: [
          {
            mapValue: {
              fields: {
                workoutId: stringValue('workout-1'),
                completedAt: { timestampValue: '2026-08-30T11:00:00Z' },
                xpAwarded: { integerValue: '20' },
                totalXpAfter: { integerValue: '20' },
                rankAfter: stringValue('Bronze III'),
              },
            },
          },
        ],
      },
    },
    updatedAt: { timestampValue: '2026-08-30T11:00:00Z' },
  };
}

function overallSummaryFields(uid) {
  const groups = Object.fromEntries(
    [
      'chest',
      'back',
      'shoulders',
      'biceps',
      'triceps',
      'forearms',
      'quadriceps',
      'hamstrings',
      'glutes',
      'calves',
      'core',
      'traps',
    ].map((group) => [group, { integerValue: '0' }]),
  );
  return {
    schemaVersion: { integerValue: '1' },
    ownerUid: stringValue(uid),
    rulesetVersion: stringValue('overall-rank-v1'),
    recordOrigin: stringValue('athlete-client-derived'),
    groupRankIndices: { mapValue: { fields: groups } },
    overallRank: stringValue('Unranked'),
    overallRankIndex: { integerValue: '0' },
    meanGroupRankIndex: { integerValue: '0' },
    coveredGroupCount: { integerValue: '0' },
    rankHistory: { arrayValue: { values: [] } },
    updatedAt: { timestampValue: '2026-08-30T11:00:00Z' },
  };
}
function socialSettingsFields(uid, displayName, code) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('friends-v1'),
    ownerUid: stringValue(uid),
    displayName: stringValue(displayName),
    friendInvitesEnabled: { booleanValue: Boolean(code) },
    ...(code ? { currentFriendCode: stringValue(code) } : {}),
    shareOverallRank: { booleanValue: false },
    createdAt: { timestampValue: '2026-08-30T11:00:00Z' },
    updatedAt: { timestampValue: '2026-08-30T11:00:00Z' },
  };
}
function friendProfileFields(uid, displayName, share = false) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('friends-v1'),
    ownerUid: stringValue(uid),
    displayName: stringValue(displayName),
    shareOverallRank: { booleanValue: share },
    ...(share
      ? {
          sharedOverallRank: stringValue('Bronze III'),
          sharedOverallRankIndex: { integerValue: '1' },
          rankSourceRulesetVersion: stringValue('overall-rank-v1'),
        }
      : {}),
    createdAt: { timestampValue: '2026-08-30T11:00:00Z' },
    updatedAt: { timestampValue: share ? '2026-08-30T13:00:00Z' : '2026-08-30T11:00:00Z' },
  };
}
function friendCodeFields(uid, displayName, code) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('friends-v1'),
    code: stringValue(code),
    ownerUid: stringValue(uid),
    displayName: stringValue(displayName),
    createdAt: { timestampValue: '2026-08-30T11:00:00Z' },
    updatedAt: { timestampValue: '2026-08-30T11:00:00Z' },
  };
}
function friendshipFields(requesterUid, recipientUid, code, status) {
  const participantUids = [requesterUid, recipientUid].sort();
  const updatedAt = status === 'accepted' ? '2026-08-30T12:00:00Z' : '2026-08-30T11:00:00Z';
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('friends-v1'),
    friendshipId: stringValue(participantUids.join('__')),
    participantUids: { arrayValue: { values: participantUids.map(stringValue) } },
    requesterUid: stringValue(requesterUid),
    recipientUid: stringValue(recipientUid),
    requesterDisplayName: stringValue(requesterUid === userA.localId ? 'Athlete A' : 'Athlete B'),
    recipientDisplayName: stringValue(recipientUid === userB.localId ? 'Athlete B' : 'Athlete A'),
    requestSource: stringValue('friend-code'),
    friendCodeUsed: stringValue(code),
    status: stringValue(status),
    createdAt: { timestampValue: '2026-08-30T11:00:00Z' },
    updatedAt: { timestampValue: updatedAt },
    ...(status === 'accepted' ? { acceptedAt: { timestampValue: updatedAt } } : {}),
  };
}
function blockedUserFields(ownerUid, blockedUid, displayName) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('friends-v1'),
    ownerUid: stringValue(ownerUid),
    blockedUid: stringValue(blockedUid),
    displayNameSnapshot: stringValue(displayName),
    createdAt: { timestampValue: '2026-08-30T13:00:00Z' },
  };
}
function pairSecurityFields(
  uidA,
  uidB,
  friendshipAccepted,
  uidABlocksUidB = false,
  uidBBlocksUidA = false,
) {
  const participants = [uidA, uidB].sort();
  const aIsLow = uidA === participants[0];
  return {
    schemaVersion: { integerValue: '1' },
    projectionVersion: stringValue('social-pair-security-v1'),
    pairId: stringValue(participants.join('__')),
    participantUids: { arrayValue: { values: participants.map(stringValue) } },
    friendshipAccepted: { booleanValue: friendshipAccepted },
    lowBlocksHigh: { booleanValue: aIsLow ? uidABlocksUidB : uidBBlocksUidA },
    highBlocksLow: { booleanValue: aIsLow ? uidBBlocksUidA : uidABlocksUidB },
    updatedAt: { timestampValue: new Date().toISOString() },
  };
}
function nutritionFields(uid) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('nutrition-guidance-v1'),
    ownerUid: stringValue(uid),
    focus: stringValue('build-muscle'),
    dietaryPattern: stringValue('no-preference'),
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function nutritionTargetFields(
  uid,
  targets = { energyKcal: { integerValue: '2000' }, waterMl: { integerValue: '2500' } },
) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('nutrition-tracking-v1'),
    ownerUid: stringValue(uid),
    targets: { mapValue: { fields: targets } },
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function nutritionMealFields(uid, entryId, nutrients) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('nutrition-tracking-v1'),
    entryId: stringValue(entryId),
    ownerUid: stringValue(uid),
    kind: stringValue('meal'),
    name: stringValue('Manual lunch'),
    mealCategory: stringValue('lunch'),
    nutrients: { mapValue: { fields: nutrients } },
    loggedAt: { timestampValue: '2026-09-01T10:00:00Z' },
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function nutritionWaterFields(uid, entryId, amountMl) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('nutrition-tracking-v1'),
    entryId: stringValue(entryId),
    ownerUid: stringValue(uid),
    kind: stringValue('water'),
    amountMl: { integerValue: String(amountMl) },
    loggedAt: { timestampValue: '2026-09-01T10:00:00Z' },
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function nutritionSavedMealFields(uid, savedMealId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('nutrition-tracking-v1'),
    savedMealId: stringValue(savedMealId),
    ownerUid: stringValue(uid),
    name: stringValue('Saved lunch'),
    mealCategory: stringValue('lunch'),
    nutrients: { mapValue: { fields: { proteinG: { integerValue: '30' } } } },
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function nutritionSourceFields() {
  return {
    mapValue: {
      fields: {
        contractVersion: stringValue('third-party-food-provenance-v1'),
        kind: stringValue('open-food-facts'),
        provider: stringValue('open-food-facts'),
        productCode: stringValue('12345678'),
        sourceUrl: stringValue('https://world.openfoodfacts.org/product/12345678'),
        retrievedAt: stringValue('2026-09-04T00:00:00Z'),
        basis: stringValue('per-100g'),
        quantity: { integerValue: '100' },
        unit: stringValue('g'),
      },
    },
  };
}
function nutritionRecipeFields(uid, recipeId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('nutrition-recipe-v1'),
    recipeId: stringValue(recipeId),
    ownerUid: stringValue(uid),
    name: stringValue('Private recipe'),
    servingCount: { integerValue: '2' },
    ingredients: {
      arrayValue: { values: [{ mapValue: { fields: { private: stringValue('owner only') } } }] },
    },
    status: stringValue('active'),
    createdAt: { timestampValue: '2026-09-04T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-04T10:00:00Z' },
  };
}
function achievementAwardFields(uid, achievementId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('motivation-achievements-v1'),
    ownerUid: stringValue(uid),
    achievementId: stringValue(achievementId),
    family: stringValue('workout'),
    recordOrigin: stringValue('athlete-client-derived'),
    earnedAt: { timestampValue: '2026-09-01T10:00:00Z' },
    triggerKind: stringValue('workout'),
    triggerId: stringValue('workout-1'),
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function motivationSeasonFields(uid, seasonId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('personal-season-progression-v1'),
    ownerUid: stringValue(uid),
    seasonId: stringValue(seasonId),
    enrollmentId: stringValue('enrollment-security'),
    programSource: stringValue('athlete'),
    programId: stringValue('program-security'),
    startProgramWeek: { integerValue: '1' },
    weekCount: { integerValue: '4' },
    endProgramWeek: { integerValue: '4' },
    status: stringValue('active'),
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function motivationStateFields(uid, activeSeasonId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('personal-season-progression-v1'),
    ownerUid: stringValue(uid),
    activeSeasonId: stringValue(activeSeasonId),
    createdAt: { timestampValue: '2026-09-01T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-01T10:00:00Z' },
  };
}
function wellnessHabitFields(uid, habitId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('wellness-habits-v1'),
    ownerUid: stringValue(uid),
    habitId: stringValue(habitId),
    source: stringValue('athlete'),
    name: stringValue('Water log'),
    kind: stringValue('water'),
    trackingMode: stringValue('numeric'),
    scheduleDays: {
      arrayValue: { values: [1, 3, 5].map((value) => ({ integerValue: String(value) })) },
    },
    status: stringValue('active'),
    target: { integerValue: '2000' },
    unit: stringValue('ml'),
    createdAt: { timestampValue: '2026-09-02T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-02T10:00:00Z' },
  };
}
function wellnessHabitLogFields(uid, habitId, dateLocal) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('wellness-habits-v1'),
    ownerUid: stringValue(uid),
    habitId: stringValue(habitId),
    dateLocal: stringValue(dateLocal),
    trackingMode: stringValue('numeric'),
    value: { integerValue: '1500' },
    createdAt: { timestampValue: '2026-09-02T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-02T10:00:00Z' },
  };
}
function wellnessRecoveryFields(uid, dateLocal) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('recovery-checkin-v1'),
    ownerUid: stringValue(uid),
    dateLocal: stringValue(dateLocal),
    source: stringValue('manual'),
    energy: { integerValue: '3' },
    soreness: { integerValue: '3' },
    sleepQuality: { integerValue: '3' },
    stress: { integerValue: '3' },
    painOrInjuryConcern: { booleanValue: false },
    createdAt: { timestampValue: '2026-09-02T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-02T10:00:00Z' },
  };
}
function wellnessObservationFields(uid, observationId) {
  return {
    schemaVersion: { integerValue: '1' },
    contractVersion: stringValue('wellness-observation-v1'),
    ownerUid: stringValue(uid),
    observationId: stringValue(observationId),
    metric: stringValue('steps'),
    dateLocal: stringValue('2026-09-02'),
    value: { integerValue: '5000' },
    source: stringValue('manual'),
    provenance: { mapValue: { fields: { kind: stringValue('manual') } } },
    createdAt: { timestampValue: '2026-09-02T10:00:00Z' },
    updatedAt: { timestampValue: '2026-09-02T10:00:00Z' },
  };
}

async function writeAsOwner(path, fields) {
  const segments = path.split('/');
  const documentId = segments.pop();
  const collectionPath = segments.join('/');
  const response = await fetch(`${baseUrl}/${collectionPath}?documentId=${documentId}`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ fields }),
  });
  assert.ok(response.ok, `Emulator owner write failed for ${path}: ${response.status}`);
}

function fieldFilter(fieldPath, value) {
  return {
    fieldFilter: {
      field: { fieldPath },
      op: 'EQUAL',
      value: stringValue(value),
    },
  };
}

function stringValue(value) {
  return { stringValue: value };
}
