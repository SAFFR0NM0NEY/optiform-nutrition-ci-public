import assert from 'node:assert/strict';
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!firestoreHost || !authHost) throw new Error('Run through firebase emulators:exec.');
const baseUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
const a = await user('social-a@example.invalid');
const b = await user('social-b@example.invalid');
const c = await user('social-c@example.invalid');
const time = '2026-09-02T10:00:00Z';
await adminWrite(`friendProfiles/${a.localId}`, friendProfile(a.localId, 'Athlete A'));
await adminWrite(`friendProfiles/${b.localId}`, friendProfile(b.localId, 'Athlete B'));
await adminWrite(`friendProfiles/${c.localId}`, friendProfile(c.localId, 'Athlete C'));
await adminWrite(
  `socialPairSecurity/${pair(a.localId, b.localId)}`,
  pairProjection(a.localId, b.localId, true, false, false),
);
await adminWrite(
  `socialPairSecurity/${pair(a.localId, c.localId)}`,
  pairProjection(a.localId, c.localId, false, false, false),
);
await adminWrite(
  `athletes/${a.localId}/policyConsents/community-guidelines--2026.09-beta.1`,
  communityConsent(a.localId),
);
await adminWrite(
  `athletes/${b.localId}/policyConsents/community-guidelines--2026.09-beta.1`,
  communityConsent(b.localId),
);

const profilePath = `socialProfiles/${a.localId}`;
const profile = socialProfile(a.localId, 'Athlete A');
assert.equal((await create(profilePath, profile, a.idToken)).status, 200);
assert.equal((await get(profilePath, a.idToken)).status, 200);
assert.equal((await get(profilePath, b.idToken)).status, 200);
assert.equal((await get(profilePath, c.idToken)).status, 403);
assert.equal((await update(profilePath, profile, b.idToken)).status, 403);
assert.equal((await get(profilePath)).status, 403);

const postId = 'post-00000000-0000-4000-8000-000000000001';
const postPath = `athletes/${a.localId}/socialPosts/${postId}`;
const post = socialPost(a.localId, postId);
assert.equal((await create(postPath, post, a.idToken)).status, 200);
assert.equal((await get(postPath, b.idToken)).status, 200);
assert.equal((await get(postPath, c.idToken)).status, 403);
assert.equal((await update(postPath, post, a.idToken)).status, 403);
assert.equal(
  (
    await create(
      `athletes/${b.localId}/socialPosts/${postId}`,
      socialPost(a.localId, postId),
      b.idToken,
    )
  ).status,
  403,
);

const reactionPath = `${postPath}/reactions/${b.localId}`;
const reaction = reactionFields(a.localId, postId, b.localId, 'like');
assert.equal((await create(reactionPath, reaction, b.idToken)).status, 200);
assert.equal(
  (
    await create(
      `${postPath}/reactions/${a.localId}`,
      reactionFields(a.localId, postId, a.localId, 'like'),
      a.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await update(
      reactionPath,
      reactionFields(a.localId, postId, b.localId, 'clap', '2026-09-02T10:01:00Z'),
      b.idToken,
    )
  ).status,
  200,
);
assert.equal(
  (await update(reactionPath, reactionFields(a.localId, postId, c.localId, 'strong'), c.idToken))
    .status,
  403,
);

const commentId = 'comment-00000000-0000-4000-8000-000000000001';
const commentPath = `${postPath}/comments/${commentId}`;
assert.equal(
  (
    await create(
      commentPath,
      commentFields(a.localId, postId, commentId, b.localId, 'Athlete B', 'x'),
      b.idToken,
    )
  ).status,
  200,
);
assert.equal(
  (
    await update(
      commentPath,
      commentFields(a.localId, postId, commentId, b.localId, 'Athlete B', 'edited'),
      b.idToken,
    )
  ).status,
  403,
);
const otherCommentId = 'comment-00000000-0000-4000-8000-000000000002';
const otherCommentPath = `${postPath}/comments/${otherCommentId}`;
assert.equal(
  (
    await create(
      otherCommentPath,
      commentFields(a.localId, postId, otherCommentId, a.localId, 'Athlete A', 'owner'),
      a.idToken,
    )
  ).status,
  200,
);
assert.equal((await remove(otherCommentPath, b.idToken)).status, 403);
assert.equal((await remove(commentPath, a.idToken)).status, 200);
assert.equal(
  (
    await create(
      `${postPath}/comments/comment-00000000-0000-4000-8000-000000000003`,
      commentFields(
        a.localId,
        postId,
        'comment-00000000-0000-4000-8000-000000000003',
        c.localId,
        'Athlete C',
        'no',
      ),
      c.idToken,
    )
  ).status,
  403,
);

const mutePath = `athletes/${a.localId}/mutedUsers/${b.localId}`;
assert.equal((await create(mutePath, muteFields(a.localId, b.localId), a.idToken)).status, 200);
assert.equal((await get(mutePath, b.idToken)).status, 403);
const partnerPath = `athletes/${a.localId}/trainingPartners/${b.localId}`;
assert.equal(
  (await create(partnerPath, partnerFields(a.localId, b.localId), a.idToken)).status,
  200,
);
assert.equal(
  (
    await create(
      `athletes/${a.localId}/trainingPartners/${c.localId}`,
      partnerFields(a.localId, c.localId),
      a.idToken,
    )
  ).status,
  403,
);
const reportId = 'report-00000000-0000-4000-8000-000000000001';
const reportPath = `socialReports/${reportId}`;
assert.equal(
  (await create(reportPath, reportFields(reportId, b.localId, a.localId), b.idToken)).status,
  200,
);
assert.equal((await get(reportPath, b.idToken)).status, 403);
assert.equal(
  (await update(reportPath, reportFields(reportId, b.localId, a.localId), b.idToken)).status,
  403,
);
assert.equal((await remove(reportPath, b.idToken)).status, 403);
const noConsentReportId = 'report-00000000-0000-4000-8000-000000000002';
assert.equal(
  (
    await create(
      `socialReports/${noConsentReportId}`,
      reportFields(noConsentReportId, c.localId, a.localId),
      c.idToken,
    )
  ).status,
  200,
);
assert.equal(
  (await create(`socialProfiles/${c.localId}`, socialProfile(c.localId, 'Athlete C'), c.idToken))
    .status,
  403,
);

// P40 restrictions block publishing but preserve athlete safety actions and own deletions.
const restrictedCommentId = 'comment-00000000-0000-4000-8000-000000000004';
const restrictedCommentPath = `${postPath}/comments/${restrictedCommentId}`;
assert.equal(
  (
    await create(
      restrictedCommentPath,
      commentFields(a.localId, postId, restrictedCommentId, b.localId, 'Athlete B', 'before'),
      b.idToken,
    )
  ).status,
  200,
);
await adminWrite(`socialPublishingRestrictions/${b.localId}`, {
  schemaVersion: i(1),
  contractVersion: s('platform-enforcement-v1'),
  ownerUid: s(b.localId),
  status: s('restricted'),
  reasonCode: s('spam'),
  imposedByUid: s('operator'),
  createdAt: ts(),
  updatedAt: ts(),
});
assert.equal(
  (await create(`socialProfiles/${b.localId}`, socialProfile(b.localId, 'Athlete B'), b.idToken))
    .status,
  403,
);
const restrictedPostId = 'post-00000000-0000-4000-8000-000000000005';
assert.equal(
  (
    await create(
      `athletes/${b.localId}/socialPosts/${restrictedPostId}`,
      socialPost(b.localId, restrictedPostId),
      b.idToken,
    )
  ).status,
  403,
);
assert.equal(
  (
    await update(
      reactionPath,
      reactionFields(a.localId, postId, b.localId, 'strong', '2026-09-02T10:02:00Z'),
      b.idToken,
    )
  ).status,
  403,
);
const deniedCommentId = 'comment-00000000-0000-4000-8000-000000000006';
assert.equal(
  (
    await create(
      `${postPath}/comments/${deniedCommentId}`,
      commentFields(a.localId, postId, deniedCommentId, b.localId, 'Athlete B', 'denied'),
      b.idToken,
    )
  ).status,
  403,
);
assert.equal((await remove(reactionPath, b.idToken)).status, 200);
assert.equal((await remove(restrictedCommentPath, b.idToken)).status, 200);
assert.equal(
  (
    await create(
      `athletes/${b.localId}/mutedUsers/${a.localId}`,
      muteFields(b.localId, a.localId),
      b.idToken,
    )
  ).status,
  200,
);
const restrictedReportId = 'report-00000000-0000-4000-8000-000000000007';
assert.equal(
  (
    await create(
      `socialReports/${restrictedReportId}`,
      reportFields(restrictedReportId, b.localId, a.localId),
      b.idToken,
    )
  ).status,
  200,
);

await adminWrite(
  `socialPairSecurity/${pair(a.localId, b.localId)}`,
  pairProjection(a.localId, b.localId, true, true, false),
);
assert.equal((await get(profilePath, b.idToken)).status, 403);
assert.equal((await get(postPath, b.idToken)).status, 403);
console.log(
  'Private social rules verified: profiles, immutable posts, reactions, comments, restrictions with safety-action exceptions, mute, training partners, reports, and block projection passed.',
);

function s(value) {
  return { stringValue: value };
}
function i(value) {
  return { integerValue: String(value) };
}
function ts(value = time) {
  return { timestampValue: value };
}
function arr(values) {
  return { arrayValue: { values } };
}
function map(fields) {
  return { mapValue: { fields } };
}
function friendProfile(uid, name) {
  return {
    schemaVersion: i(1),
    contractVersion: s('friends-v1'),
    ownerUid: s(uid),
    displayName: s(name),
    shareOverallRank: { booleanValue: false },
    createdAt: ts(),
    updatedAt: ts(),
  };
}
function socialProfile(uid, name) {
  return {
    schemaVersion: i(1),
    contractVersion: s('social-profile-v1'),
    ownerUid: s(uid),
    displayName: s(name),
    bio: s('Private friend profile'),
    avatarKind: s('initials'),
    sharedPrs: arr([]),
    sharedAchievementIds: arr([]),
    createdAt: ts(),
    updatedAt: ts(),
  };
}
function communityConsent(uid) {
  return {
    schemaVersion: i(1),
    contractVersion: s('policy-consent-v1'),
    ownerUid: s(uid),
    policyId: s('community-guidelines'),
    policyVersion: s('2026.09-beta.1'),
    policyStatusAtAcceptance: s('beta-draft'),
    acceptedAt: ts(),
    acceptanceSource: s('in-app'),
  };
}
function pair(x, y) {
  return [x, y].sort().join('__');
}
function pairProjection(x, y, accepted, lowBlock, highBlock) {
  const ids = [x, y].sort();
  return {
    schemaVersion: i(1),
    projectionVersion: s('social-pair-security-v1'),
    pairId: s(ids.join('__')),
    participantUids: arr(ids.map(s)),
    friendshipAccepted: { booleanValue: accepted },
    lowBlocksHigh: { booleanValue: lowBlock },
    highBlocksLow: { booleanValue: highBlock },
    updatedAt: ts(),
  };
}
function socialPost(uid, id) {
  return {
    schemaVersion: i(1),
    contractVersion: s('friend-activity-v1'),
    ownerUid: s(uid),
    postId: s(id),
    visibility: s('friends'),
    kind: s('pr'),
    snapshot: map({
      kind: s('pr'),
      pr: map({
        exerciseId: s('bench-press'),
        exerciseName: s('Bench Press'),
        kind: s('best-load'),
        value: i(100),
        canonicalUnit: s('kg'),
        achievedAt: ts(),
      }),
    }),
    createdAt: ts(),
  };
}
function reactionFields(owner, id, reactor, reaction, updated = time) {
  return {
    schemaVersion: i(1),
    contractVersion: s('social-interactions-v1'),
    postOwnerUid: s(owner),
    postId: s(id),
    reactorUid: s(reactor),
    reaction: s(reaction),
    createdAt: ts(),
    updatedAt: ts(updated),
  };
}
function commentFields(owner, id, commentId, author, name, body) {
  return {
    schemaVersion: i(1),
    contractVersion: s('social-interactions-v1'),
    postOwnerUid: s(owner),
    postId: s(id),
    commentId: s(commentId),
    authorUid: s(author),
    authorDisplayName: s(name),
    body: s(body),
    createdAt: ts(),
  };
}
function muteFields(owner, muted) {
  return {
    schemaVersion: i(1),
    contractVersion: s('social-interactions-v1'),
    ownerUid: s(owner),
    mutedUid: s(muted),
    createdAt: ts(),
  };
}
function partnerFields(owner, friend) {
  return {
    schemaVersion: i(1),
    contractVersion: s('social-interactions-v1'),
    ownerUid: s(owner),
    friendUid: s(friend),
    createdAt: ts(),
  };
}
function reportFields(id, reporter, target) {
  return {
    schemaVersion: i(1),
    contractVersion: s('social-interactions-v1'),
    reportId: s(id),
    reporterUid: s(reporter),
    targetType: s('profile'),
    targetOwnerUid: s(target),
    targetId: s(target),
    reason: s('privacy'),
    createdAt: ts(),
  };
}
async function user(email) {
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
function headers(token) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json',
  };
}
async function get(path, token) {
  return fetch(`${baseUrl}/${path}`, { headers: headers(token) });
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
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (response.status === 409) {
    const replaced = await fetch(`${baseUrl}/${path}`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    assert.ok(replaced.ok);
  } else assert.ok(response.ok);
}
