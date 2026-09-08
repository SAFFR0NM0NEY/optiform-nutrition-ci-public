import assert from 'node:assert/strict';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!emulatorHost || !authHost) throw new Error('Run through the Auth and Firestore emulators.');
const baseUrl = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents`;
const adminHeaders = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const a = await createUser('challenge-a@example.invalid');
const b = await createUser('challenge-b@example.invalid');
const c = await createUser('challenge-c@example.invalid');
const pair = [a.localId, b.localId].sort();
const now = Date.now();

await adminWrite(`friendProfiles/${a.localId}`, friendProfile(a.localId, 'Athlete A'));
await adminWrite(`friendProfiles/${b.localId}`, friendProfile(b.localId, 'Athlete B'));
await adminWrite(`friendships/${pair.join('__')}`, acceptedFriendship(a.localId, b.localId));

const pending = challengeFields({
  id: 'pending-main',
  creator: a.localId,
  invitee: b.localId,
  created: now - 3 * 60 * 1000,
});
assert.equal((await create('challenges/pending-main', pending, a.idToken)).status, 200);
assert.equal((await get('challenges/pending-main', a.idToken)).status, 200);
assert.equal((await get('challenges/pending-main', b.idToken)).status, 200);
assert.equal((await get('challenges/pending-main', c.idToken)).status, 403);
assert.equal((await get('challenges/pending-main')).status, 403);
assert.equal(
  (
    await create(
      'challenges/nonfriend',
      challengeFields({
        id: 'nonfriend',
        creator: a.localId,
        invitee: c.localId,
        created: now - 1000,
      }),
      a.idToken,
    )
  ).status,
  403,
);

const graceStart = now - 8 * 24 * 60 * 60 * 1000;
const graceChallenge = activeFields(
  challengeFields({
    id: 'grace',
    creator: a.localId,
    invitee: b.localId,
    created: graceStart - 1000,
  }),
  graceStart,
);
await adminWrite('challenges/grace', graceChallenge);
const graceSourceAt = graceStart + 145 * 60 * 60 * 1000;
await adminWrite(
  `athletes/${a.localId}/workouts/grace-workout`,
  workoutFields(a.localId, 'grace-workout', graceSourceAt),
);
assert.equal(
  (
    await create(
      `challenges/grace/entries/${a.localId}_6`,
      entryFields({
        challengeId: 'grace',
        uid: a.localId,
        workoutId: 'grace-workout',
        completedAt: graceSourceAt,
        dayIndex: 6,
      }),
      a.idToken,
    )
  ).status,
  200,
);
const closedStart = now - 10 * 24 * 60 * 60 * 1000;
const closedChallenge = activeFields(
  challengeFields({
    id: 'closed-grace',
    creator: a.localId,
    invitee: b.localId,
    created: closedStart - 1000,
  }),
  closedStart,
);
await adminWrite('challenges/closed-grace', closedChallenge);
const closedSourceAt = closedStart + 60 * 60 * 1000;
await adminWrite(
  `athletes/${a.localId}/workouts/closed-workout`,
  workoutFields(a.localId, 'closed-workout', closedSourceAt),
);
assert.equal(
  (
    await create(
      `challenges/closed-grace/entries/${a.localId}_0`,
      entryFields({
        challengeId: 'closed-grace',
        uid: a.localId,
        workoutId: 'closed-workout',
        completedAt: closedSourceAt,
        dayIndex: 0,
      }),
      a.idToken,
    )
  ).status,
  403,
);

const acceptedAt = Date.now() - 2 * 60 * 1000;
const active = activeFields(pending, acceptedAt);
assert.equal((await update('challenges/pending-main', active, a.idToken)).status, 403);
assert.equal((await update('challenges/pending-main', active, b.idToken)).status, 200);

const completedAt = acceptedAt + 60 * 1000;
const workout = workoutFields(a.localId, 'challenge-workout', completedAt);
assert.equal(
  (await create(`athletes/${a.localId}/workouts/challenge-workout`, workout, a.idToken)).status,
  200,
);
const day0 = entryFields({
  challengeId: 'pending-main',
  uid: a.localId,
  workoutId: 'challenge-workout',
  completedAt,
  dayIndex: 0,
});
assert.equal(
  (await create(`challenges/pending-main/entries/${a.localId}_0`, day0, a.idToken)).status,
  200,
);
assert.equal(
  (await create(`challenges/pending-main/entries/${a.localId}_0`, day0, a.idToken)).status,
  409,
);
assert.equal((await get(`challenges/pending-main/entries/${a.localId}_0`, b.idToken)).status, 200);
assert.equal((await get(`challenges/pending-main/entries/${a.localId}_0`, c.idToken)).status, 403);
assert.equal(
  (await update(`challenges/pending-main/entries/${a.localId}_0`, day0, a.idToken)).status,
  403,
);
assert.equal(
  (await remove(`challenges/pending-main/entries/${a.localId}_0`, a.idToken)).status,
  403,
);

const wrongDay = { ...day0, dayIndex: integer(1) };
assert.equal(
  (await create(`challenges/pending-main/entries/${a.localId}_1`, wrongDay, a.idToken)).status,
  403,
);
assert.equal(
  (
    await create(
      `challenges/pending-main/entries/${b.localId}_0`,
      { ...day0, participantUid: string(b.localId) },
      a.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await create(
      `challenges/pending-main/entries/${a.localId}_1`,
      { ...day0, dayIndex: integer(1), sourceWorkoutId: string('missing') },
      a.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (await get(`athletes/${a.localId}/workouts/challenge-workout`, b.idToken)).status,
  403,
);

const afterEnd = acceptedAt + 168 * 60 * 60 * 1000;
await adminWrite(
  `athletes/${a.localId}/workouts/after-window`,
  workoutFields(a.localId, 'after-window', afterEnd),
);
assert.equal(
  (
    await create(
      `challenges/pending-main/entries/${a.localId}_6`,
      entryFields({
        challengeId: 'pending-main',
        uid: a.localId,
        workoutId: 'after-window',
        completedAt: afterEnd,
        dayIndex: 6,
      }),
      a.idToken,
    )
  ).status,
  403,
);

const muscle = challengeFields({
  id: 'muscle-main',
  creator: a.localId,
  invitee: b.localId,
  created: now - 3000,
  type: 'muscle-training-days',
  target: 'biceps-brachii',
});
const muscleActive = activeFields(muscle, now - 2000);
await adminWrite('challenges/muscle-main', muscleActive);
await adminWrite(
  `athletes/${a.localId}/muscleProgress/biceps-brachii/events/muscle-workout`,
  muscleEvidence(a.localId, 'biceps-brachii', 'muscle-workout', now - 1000),
);
const muscleEntry = entryFields({
  challengeId: 'muscle-main',
  uid: a.localId,
  workoutId: 'muscle-workout',
  completedAt: now - 1000,
  dayIndex: 0,
  muscleId: 'biceps-brachii',
});
assert.equal(
  (await create(`challenges/muscle-main/entries/${a.localId}_0`, muscleEntry, a.idToken)).status,
  200,
);
const wrongMuscle = { ...muscleEntry, sourceMuscleId: string('triceps-brachii') };
assert.equal(
  (
    await create(
      `challenges/muscle-main/entries/${a.localId}_1`,
      { ...wrongMuscle, dayIndex: integer(1) },
      a.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await get(
      `athletes/${a.localId}/muscleProgress/biceps-brachii/events/muscle-workout`,
      b.idToken,
    )
  ).status,
  403,
);

const decline = challengeFields({
  id: 'decline',
  creator: a.localId,
  invitee: b.localId,
  created: Date.now() - 1000,
});
assert.equal((await create('challenges/decline', decline, a.idToken)).status, 200);
assert.equal(
  (await update('challenges/decline', resolvedFields(decline, 'declined'), a.idToken)).status,
  403,
);
assert.equal(
  (await update('challenges/decline', resolvedFields(decline, 'declined'), b.idToken)).status,
  200,
);
const cancel = challengeFields({
  id: 'cancel',
  creator: a.localId,
  invitee: b.localId,
  created: Date.now() - 1000,
});
assert.equal((await create('challenges/cancel', cancel, a.idToken)).status, 200);
assert.equal(
  (await update('challenges/cancel', resolvedFields(cancel, 'cancelled'), b.idToken)).status,
  403,
);
assert.equal(
  (await update('challenges/cancel', resolvedFields(cancel, 'cancelled'), a.idToken)).status,
  200,
);

const expired = challengeFields({
  id: 'expired',
  creator: a.localId,
  invitee: b.localId,
  created: now - 80 * 60 * 60 * 1000,
});
await adminWrite('challenges/expired', expired);
assert.equal(
  (await update('challenges/expired', resolvedFields(expired, 'expired'), a.idToken)).status,
  200,
);
const prematureExpiry = challengeFields({
  id: 'premature-expiry',
  creator: a.localId,
  invitee: b.localId,
  created: Date.now() - 1000,
});
assert.equal((await create('challenges/premature-expiry', prematureExpiry, a.idToken)).status, 200);
assert.equal(
  (
    await update(
      'challenges/premature-expiry',
      resolvedFields(prematureExpiry, 'expired'),
      a.idToken,
    )
  ).status,
  403,
);

const finalizable = activeFields(
  challengeFields({
    id: 'finalizable',
    creator: a.localId,
    invitee: b.localId,
    created: now - 11 * 24 * 60 * 60 * 1000,
  }),
  now - 10 * 24 * 60 * 60 * 1000,
);
await adminWrite('challenges/finalizable', finalizable);
assert.equal(
  (await update('challenges/finalizable', completedFields(finalizable), c.idToken)).status,
  403,
);
assert.equal(
  (await update('challenges/finalizable', completedFields(finalizable), b.idToken)).status,
  200,
);
assert.equal((await remove('challenges/finalizable', a.idToken)).status, 403);

await adminWrite(`athletes/${a.localId}/blockedUsers/${b.localId}`, {
  schemaVersion: integer(1),
  contractVersion: string('friends-v1'),
  ownerUid: string(a.localId),
  blockedUid: string(b.localId),
  displayNameSnapshot: string('Athlete B'),
  createdAt: timestamp(Date.now()),
});
assert.equal(
  (
    await create(
      'challenges/blocked',
      challengeFields({
        id: 'blocked',
        creator: a.localId,
        invitee: b.localId,
        created: Date.now() - 1000,
      }),
      a.idToken,
    )
  ).status,
  403,
);

console.log(
  'Friend-challenges-v1 rules verified: friend/block gates, lifecycle, immutable evidence, exact day buckets, source ownership/privacy, and participant-only access passed.',
);

function challengeFields({ id, creator, invitee, created, type = 'training-days', target }) {
  return {
    schemaVersion: integer(1),
    contractVersion: string('friend-challenges-v1'),
    challengeId: string(id),
    participantUids: array([creator, invitee].sort()),
    creatorUid: string(creator),
    inviteeUid: string(invitee),
    creatorDisplayName: string('Athlete A'),
    inviteeDisplayName: string('Athlete B'),
    type: string(type),
    ...(target ? { targetMuscleId: string(target) } : {}),
    status: string('pending'),
    createdAt: timestamp(created),
    inviteExpiresAt: timestamp(created + 72 * 60 * 60 * 1000),
    updatedAt: timestamp(created),
  };
}
function activeFields(fields, accepted) {
  return {
    ...fields,
    status: string('active'),
    acceptedAt: timestamp(accepted),
    startsAt: timestamp(accepted),
    endsAt: timestamp(accepted + 168 * 60 * 60 * 1000),
    finalizeAfter: timestamp(accepted + 216 * 60 * 60 * 1000),
    updatedAt: timestamp(accepted),
  };
}
function resolvedFields(fields, status) {
  const time = Date.now();
  return {
    ...fields,
    status: string(status),
    resolvedAt: timestamp(time),
    updatedAt: timestamp(time),
  };
}
function completedFields(fields) {
  const time = Date.now();
  return {
    ...fields,
    status: string('completed'),
    completedAt: timestamp(time),
    updatedAt: timestamp(time),
  };
}
function entryFields({ challengeId, uid, workoutId, completedAt, dayIndex, muscleId }) {
  return {
    schemaVersion: integer(1),
    contractVersion: string('friend-challenges-v1'),
    challengeId: string(challengeId),
    participantUid: string(uid),
    dayIndex: integer(dayIndex),
    pointValue: integer(1),
    sourceKind: string(muscleId ? 'muscle-evidence' : 'completed-workout'),
    sourceWorkoutId: string(workoutId),
    sourceCompletedAt: timestamp(completedAt),
    ...(muscleId ? { sourceMuscleId: string(muscleId) } : {}),
    createdAt: timestamp(Date.now()),
  };
}
function friendProfile(uid, name) {
  return {
    schemaVersion: integer(1),
    contractVersion: string('friends-v1'),
    ownerUid: string(uid),
    displayName: string(name),
    shareOverallRank: { booleanValue: false },
    createdAt: timestamp(now - 10000),
    updatedAt: timestamp(now - 10000),
  };
}
function acceptedFriendship(uidA, uidB) {
  return {
    schemaVersion: integer(1),
    contractVersion: string('friends-v1'),
    friendshipId: string([uidA, uidB].sort().join('__')),
    participantUids: array([uidA, uidB].sort()),
    requesterUid: string(uidA),
    recipientUid: string(uidB),
    requesterDisplayName: string('Athlete A'),
    recipientDisplayName: string('Athlete B'),
    requestSource: string('friend-code'),
    friendCodeUsed: string('ABCDEFGHJKMNPQRS'),
    status: string('accepted'),
    createdAt: timestamp(now - 10000),
    updatedAt: timestamp(now - 9000),
    acceptedAt: timestamp(now - 9000),
  };
}
function workoutFields(uid, id, completed) {
  return {
    schemaVersion: integer(1),
    recordOrigin: string('athlete-client'),
    sourceSessionSchemaVersion: integer(3),
    workoutId: string(id),
    ownerUid: string(uid),
    startedAt: timestamp(completed - 3600000),
    completedAt: timestamp(completed),
    exercises: { arrayValue: { values: [{ mapValue: { fields: {} } }] } },
  };
}
function muscleEvidence(uid, muscleId, workoutId, completed) {
  return {
    schemaVersion: integer(1),
    ownerUid: string(uid),
    muscleId: string(muscleId),
    workoutId: string(workoutId),
    rulesetVersion: string('muscle-xp-v1'),
    recordOrigin: string('athlete-client-derived'),
    completedAt: timestamp(completed),
    primaryCreditedSets: integer(2),
    secondaryCreditedSets: integer(0),
    stabilizerCreditedSets: integer(0),
    creditedSetCount: integer(2),
    potentialXp: integer(20),
    sourceExerciseIds: array(['example']),
  };
}
async function createUser(email) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'EmulatorPass123!', returnSecureToken: true }),
    },
  );
  assert.ok(response.ok);
  return response.json();
}
function headers(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
async function get(path, token) {
  return fetch(`${baseUrl}/${path}`, { headers: token ? headers(token) : {} });
}
async function create(path, fields, token) {
  const parts = path.split('/');
  const id = parts.pop();
  return fetch(`${baseUrl}/${parts.join('/')}?documentId=${id}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ fields }),
  });
}
async function update(path, fields, token) {
  return fetch(`${baseUrl}/${path}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ fields }),
  });
}
async function remove(path, token) {
  return fetch(`${baseUrl}/${path}`, { method: 'DELETE', headers: headers(token) });
}
async function adminWrite(path, fields) {
  const parts = path.split('/');
  const id = parts.pop();
  const response = await fetch(`${baseUrl}/${parts.join('/')}?documentId=${id}`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ fields }),
  });
  assert.ok(response.ok, `${path}: ${response.status}`);
}
function string(value) {
  return { stringValue: value };
}
function integer(value) {
  return { integerValue: String(value) };
}
function timestamp(value) {
  return { timestampValue: new Date(value).toISOString() };
}
function array(values) {
  return { arrayValue: { values: values.map(string) } };
}
