import assert from 'node:assert/strict';
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!emulatorHost || !authHost) throw new Error('Run through Auth and Firestore emulators.');
const baseUrl = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents`;
const adminHeaders = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const users = await Promise.all(
  ['a', 'b', 'c', 'd', 'x'].map((name) => createUser(`p15-${name}@example.invalid`)),
);
const [a, b, c, d, x] = users;
const now = Date.now();
for (const [index, user] of users.entries())
  await adminWrite(`friendProfiles/${user.localId}`, profile(user.localId, `Athlete ${index + 1}`));
for (const [left, right] of [
  [a, b],
  [a, c],
  [a, d],
])
  await adminWrite(
    `friendships/${pair(left.localId, right.localId)}`,
    friendship(left.localId, right.localId),
  );
await adminWrite('systemMigrations/social-pair-security-v1', {
  projectionVersion: string('social-pair-security-v1'),
  status: string('complete'),
  completedAt: timestamp(now),
});
for (const [left, right] of [
  [a, b],
  [a, c],
  [a, d],
  [b, c],
  [b, d],
  [c, d],
]) {
  const accepted = [
    [a, b],
    [a, c],
    [a, d],
    [c, d],
  ].some(([x, y]) => pair(x.localId, y.localId) === pair(left.localId, right.localId));
  await adminWrite(
    `socialPairSecurity/${pair(left.localId, right.localId)}`,
    pairSecurity(left.localId, right.localId, accepted),
  );
}

const pendingTeam = team('team-a', a.localId, b.localId, now - 1000);
assert.equal((await create('competitionTeams/team-a', pendingTeam, a.idToken)).status, 200);
assert.equal((await get('competitionTeams/team-a', a.idToken)).status, 200);
assert.equal((await get('competitionTeams/team-a', b.idToken)).status, 200);
assert.equal((await get('competitionTeams/team-a', x.idToken)).status, 403);
assert.equal(
  (await create('competitionTeams/self', team('self', a.localId, a.localId, now - 1000), a.idToken))
    .status,
  403,
);
assert.equal(
  (
    await create(
      'competitionTeams/nonfriend',
      team('nonfriend', a.localId, x.localId, now - 1000),
      a.idToken,
    )
  ).status,
  403,
);
const activeTeam = {
  ...pendingTeam,
  status: string('active'),
  acceptedAt: timestamp(now),
  updatedAt: timestamp(now),
};
assert.equal((await update('competitionTeams/team-a', activeTeam, a.idToken)).status, 403);
assert.equal((await update('competitionTeams/team-a', activeTeam, b.idToken)).status, 200);
const mutated = { ...activeTeam, teammateUid: string(x.localId) };
assert.equal((await update('competitionTeams/team-a', mutated, b.idToken)).status, 403);

await adminWrite(`friendships/${pair(c.localId, d.localId)}`, friendship(c.localId, d.localId));
const teamB = activeTeamFields(team('team-b', c.localId, d.localId, now - 10000), now - 9000);
await adminWrite('competitionTeams/team-b', teamB);
const pendingChallenge = challenge('duel', activeTeam, c.localId, now - 1000);
assert.equal((await create('teamChallenges/duel', pendingChallenge, a.idToken)).status, 200);
assert.equal((await get('teamChallenges/duel', x.idToken)).status, 403);
const accepted = acceptedChallenge(pendingChallenge, teamB, now);
assert.equal((await update('teamChallenges/duel', accepted, a.idToken)).status, 403);
const acceptedResponse = await update('teamChallenges/duel', accepted, c.idToken);
if (acceptedResponse.status !== 200)
  console.error('2v2 acceptance response:', acceptedResponse.status, await acceptedResponse.text());
assert.equal(acceptedResponse.status, 200);
const completedAt = now + 1000;
await adminWrite(
  `athletes/${a.localId}/workouts/p15-workout`,
  workout(a.localId, 'p15-workout', completedAt),
);
const evidence = teamEvidence('duel', a.localId, 'p15-workout', completedAt, 0);
assert.equal(
  (await create(`teamChallenges/duel/entries/${a.localId}_0`, evidence, a.idToken)).status,
  200,
);
assert.equal(
  (
    await create(
      `teamChallenges/duel/entries/${b.localId}_0`,
      { ...evidence, participantUid: string(b.localId) },
      a.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await create(
      `teamChallenges/duel/entries/${a.localId}_1`,
      { ...evidence, dayIndex: integer(1) },
      a.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (await update(`teamChallenges/duel/entries/${a.localId}_0`, evidence, a.idToken)).status,
  403,
);
assert.equal((await get(`athletes/${a.localId}/workouts/p15-workout`, c.idToken)).status, 403);

const season = seasonFields('season', a.localId, [b.localId, c.localId, d.localId], now - 1000);
assert.equal((await create('competitionSeasons/season', season, a.idToken)).status, 200);
assert.equal((await get('competitionSeasons/season', x.idToken)).status, 403);
for (const user of [b, c, d]) {
  const response = seasonResponse('season', user.localId);
  assert.equal(
    (await create(`competitionSeasons/season/responses/${user.localId}`, response, user.idToken))
      .status,
    200,
  );
}
assert.equal(
  (
    await create(
      `competitionSeasons/season/responses/${b.localId}-fake`,
      seasonResponse('season', b.localId),
      c.idToken,
    )
  ).status,
  403,
);
const activeSeason = activateSeasonFields(season, now);
assert.equal((await update('competitionSeasons/season', activeSeason, b.idToken)).status, 403);
assert.equal((await update('competitionSeasons/season', activeSeason, a.idToken)).status, 200);
const seasonEvidenceFields = seasonEvidence('season', a.localId, 'p15-workout', completedAt, 0, 0);
const seasonEvidenceResponse = await create(
  `competitionSeasons/season/entries/${a.localId}_r0_d0`,
  seasonEvidenceFields,
  a.idToken,
);
if (seasonEvidenceResponse.status !== 200)
  console.error(
    'Season evidence response:',
    seasonEvidenceResponse.status,
    await seasonEvidenceResponse.text(),
  );
assert.equal(seasonEvidenceResponse.status, 200);
assert.equal(
  (
    await create(
      `competitionSeasons/season/entries/${a.localId}_r1_d0`,
      { ...seasonEvidenceFields, roundIndex: integer(1) },
      a.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await create(
      `competitionSeasons/season/entries/${b.localId}_r0_d0`,
      { ...seasonEvidenceFields, participantUid: string(b.localId) },
      a.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (await get(`competitionSeasons/season/entries/${a.localId}_r0_d0`, x.idToken)).status,
  403,
);

const pairCases = [
  [a, b],
  [a, c],
  [a, d],
  [b, c],
  [b, d],
  [c, d],
];
for (const [index, [left, right]] of pairCases.entries()) {
  const pairId = pair(left.localId, right.localId);
  const low = [left.localId, right.localId].sort()[0];
  await adminWrite(
    `athletes/${low}/blockedUsers/${[left.localId, right.localId].find((uid) => uid !== low)}`,
    block(
      low,
      [left.localId, right.localId].find((uid) => uid !== low),
    ),
  );
  await adminSet(
    `socialPairSecurity/${pairId}`,
    pairSecurity(left.localId, right.localId, false, true, false),
  );
  const blockedPending = challenge(`blocked-duel-${index}`, activeTeam, c.localId, now - 1000);
  await adminWrite(`teamChallenges/blocked-duel-${index}`, blockedPending);
  assert.equal(
    (
      await update(
        `teamChallenges/blocked-duel-${index}`,
        acceptedChallenge(blockedPending, teamB, now),
        c.idToken,
      )
    ).status,
    403,
  );
  const blockedSeason = seasonFields(
    `blocked-season-${index}`,
    a.localId,
    [b.localId, c.localId, d.localId],
    now - 1000,
  );
  await adminWrite(`competitionSeasons/blocked-season-${index}`, blockedSeason);
  for (const user of [b, c, d])
    await adminWrite(
      `competitionSeasons/blocked-season-${index}/responses/${user.localId}`,
      seasonResponse(`blocked-season-${index}`, user.localId),
    );
  assert.equal(
    (
      await update(
        `competitionSeasons/blocked-season-${index}`,
        activateSeasonFields(blockedSeason, now),
        a.idToken,
      )
    ).status,
    403,
  );
  await adminDelete(
    `athletes/${low}/blockedUsers/${[left.localId, right.localId].find((uid) => uid !== low)}`,
  );
  const friendshipAccepted = [
    [a, b],
    [a, c],
    [a, d],
    [c, d],
  ].some(([u, v]) => pair(u.localId, v.localId) === pairId);
  await adminSet(
    `socialPairSecurity/${pairId}`,
    pairSecurity(left.localId, right.localId, friendshipAccepted),
  );
}
await adminSet(
  `socialPairSecurity/${pair(a.localId, c.localId)}`,
  pairSecurity(a.localId, c.localId, false),
);
const missingFriendSeason = seasonFields(
  'missing-friend-season',
  a.localId,
  [b.localId, c.localId, d.localId],
  now - 1000,
);
assert.equal(
  (await create('competitionSeasons/missing-friend-season', missingFriendSeason, a.idToken)).status,
  403,
);
await adminSet(
  `socialPairSecurity/${pair(a.localId, c.localId)}`,
  pairSecurity(a.localId, c.localId, true),
);

// Leave a deliberate pre-migration state for the privileged idempotent backfill test that follows.
await adminSet('systemMigrations/social-pair-security-v1', {
  projectionVersion: string('social-pair-security-v1'),
  status: string('preparing'),
  completedAt: timestamp(now),
});
await adminDelete(`socialPairSecurity/${pair(a.localId, c.localId)}`);

console.log(
  'Advanced-competition-v1 rules verified: private duo lifecycle, frozen 2v2 ownership/evidence, four-athlete acceptance/activation, exact buckets, immutable entries, and third-party privacy passed.',
);

function team(id, owner, teammate, created) {
  return {
    schemaVersion: integer(1),
    contractVersion: string('advanced-competition-v1'),
    teamId: string(id),
    teamName: string('Quiet Force'),
    participantUids: array([owner, teammate].sort()),
    ownerUid: string(owner),
    teammateUid: string(teammate),
    ownerDisplayName: string('Athlete 1'),
    teammateDisplayName: string('Athlete 2'),
    status: string('pending'),
    createdAt: timestamp(created),
    inviteExpiresAt: timestamp(created + 72 * 3600000),
    updatedAt: timestamp(created),
  };
}
function activeTeamFields(value, at) {
  return {
    ...value,
    status: string('active'),
    acceptedAt: timestamp(at),
    updatedAt: timestamp(at),
  };
}
function challenge(id, creatorTeam, captain, created) {
  const creatorIds = values(creatorTeam.creatorTeamParticipantUids ?? creatorTeam.participantUids);
  return {
    schemaVersion: integer(1),
    contractVersion: string('advanced-competition-v1'),
    challengeId: string(id),
    creatorTeamId: creatorTeam.teamId,
    creatorTeamName: creatorTeam.teamName,
    creatorTeamParticipantUids: array(creatorIds),
    creatorTeamOwnerUid: creatorTeam.ownerUid,
    creatorTeamDisplayNames: array(['Athlete 1', 'Athlete 2']),
    opponentCaptainUid: string(captain),
    opponentCaptainDisplayName: string('Athlete 3'),
    participantUids: array([...creatorIds, captain].sort()),
    status: string('pending'),
    createdAt: timestamp(created),
    inviteExpiresAt: timestamp(created + 72 * 3600000),
    updatedAt: timestamp(created),
  };
}
function acceptedChallenge(value, opponent, at) {
  const participants = [
    ...values(value.creatorTeamParticipantUids),
    ...values(opponent.participantUids),
  ].sort();
  return {
    ...value,
    opponentTeamId: opponent.teamId,
    opponentTeamName: opponent.teamName,
    opponentTeamParticipantUids: opponent.participantUids,
    opponentTeamOwnerUid: opponent.ownerUid,
    opponentTeamDisplayNames: array(['Athlete 3', 'Athlete 4']),
    participantUids: array(participants),
    status: string('active'),
    acceptedAt: timestamp(at),
    startsAt: timestamp(at),
    endsAt: timestamp(at + 168 * 3600000),
    finalizeAfter: timestamp(at + 216 * 3600000),
    updatedAt: timestamp(at),
  };
}
function seasonFields(id, creator, invitees, created) {
  return {
    schemaVersion: integer(1),
    contractVersion: string('advanced-competition-v1'),
    seasonId: string(id),
    creatorUid: string(creator),
    inviteeUids: array(invitees),
    participantUids: array([creator, ...invitees].sort()),
    creatorDisplayName: string('Athlete 1'),
    inviteeDisplayNames: array(['Athlete 2', 'Athlete 3', 'Athlete 4']),
    status: string('pending'),
    createdAt: timestamp(created),
    inviteExpiresAt: timestamp(created + 72 * 3600000),
    updatedAt: timestamp(created),
  };
}
function seasonResponse(id, uid) {
  return {
    schemaVersion: integer(1),
    contractVersion: string('advanced-competition-v1'),
    seasonId: string(id),
    participantUid: string(uid),
    status: string('accepted'),
    createdAt: timestamp(Date.now()),
  };
}
function activateSeasonFields(value, at) {
  return {
    ...value,
    status: string('active'),
    startsAt: timestamp(at),
    endsAt: timestamp(at + 504 * 3600000),
    finalizeAfter: timestamp(at + 552 * 3600000),
    updatedAt: timestamp(at),
  };
}
function teamEvidence(id, uid, workoutId, completed, day) {
  return {
    schemaVersion: integer(1),
    contractVersion: string('advanced-competition-v1'),
    challengeId: string(id),
    participantUid: string(uid),
    dayIndex: integer(day),
    pointValue: integer(1),
    sourceWorkoutId: string(workoutId),
    sourceCompletedAt: timestamp(completed),
    createdAt: timestamp(Date.now()),
  };
}
function seasonEvidence(id, uid, workoutId, completed, round, day) {
  return {
    schemaVersion: integer(1),
    contractVersion: string('advanced-competition-v1'),
    seasonId: string(id),
    participantUid: string(uid),
    roundIndex: integer(round),
    dayIndex: integer(day),
    pointValue: integer(1),
    sourceWorkoutId: string(workoutId),
    sourceCompletedAt: timestamp(completed),
    createdAt: timestamp(Date.now()),
  };
}
function workout(uid, id, completed) {
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
function profile(uid, name) {
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
function friendship(left, right) {
  return {
    schemaVersion: integer(1),
    contractVersion: string('friends-v1'),
    friendshipId: string(pair(left, right)),
    participantUids: array([left, right].sort()),
    requesterUid: string(left),
    recipientUid: string(right),
    requesterDisplayName: string('Athlete 1'),
    recipientDisplayName: string('Athlete 2'),
    requestSource: string('friend-code'),
    friendCodeUsed: string('ABCDEFGHJKMNPQRS'),
    status: string('accepted'),
    createdAt: timestamp(now - 10000),
    updatedAt: timestamp(now - 9000),
    acceptedAt: timestamp(now - 9000),
  };
}
function pairSecurity(left, right, accepted, lowBlocksHigh = false, highBlocksLow = false) {
  const participants = [left, right].sort();
  return {
    schemaVersion: integer(1),
    projectionVersion: string('social-pair-security-v1'),
    pairId: string(participants.join('__')),
    participantUids: array(participants),
    friendshipAccepted: { booleanValue: accepted },
    lowBlocksHigh: { booleanValue: lowBlocksHigh },
    highBlocksLow: { booleanValue: highBlocksLow },
    updatedAt: timestamp(now),
  };
}
function block(owner, blocked) {
  return {
    schemaVersion: integer(1),
    contractVersion: string('friends-v1'),
    ownerUid: string(owner),
    blockedUid: string(blocked),
    displayNameSnapshot: string('Private athlete'),
    createdAt: timestamp(now),
  };
}
function pair(a, b) {
  return [a, b].sort().join('__');
}
function values(field) {
  return field.arrayValue.values.map((item) => item.stringValue);
}
async function createUser(email) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
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
async function adminSet(path, fields) {
  const response = await fetch(`${baseUrl}/${path}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ fields }),
  });
  assert.ok(response.ok, `${path}: ${response.status}`);
}
async function adminDelete(path) {
  const response = await fetch(`${baseUrl}/${path}`, { method: 'DELETE', headers: adminHeaders });
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
function array(items) {
  return { arrayValue: { values: items.map(string) } };
}
