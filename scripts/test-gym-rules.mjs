import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth as clientAuthFor,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore as clientDbFor,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
if (
  projectId !== 'demo-optiform-nutrition' ||
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error('Demo emulators required.');
setLogLevel('silent');
const app = getApps()[0] ?? initializeApp({ projectId }),
  auth = getAuth(app),
  admin = getFirestore(app),
  password = 'Test-password-123';
const owner = await principal('gym-owner@example.invalid'),
  member = await principal('gym-member@example.invalid'),
  other = await principal('gym-other@example.invalid'),
  moderator = await principal('gym-moderator@example.invalid', ['moderator']),
  support = await principal('gym-support@example.invalid', ['support']);
const ownerDb = await client('gym-owner', owner.email),
  memberDb = await client('gym-member', member.email),
  otherDb = await client('gym-other', other.email),
  moderatorDb = await client('gym-moderator', moderator.email),
  supportDb = await client('gym-support', support.email);
const gymId = '1111111111111111',
  inviteCode = '2222222222222222',
  memberId = '3333333333333333',
  stationId = '4444444444444444',
  now = new Date(),
  expires = new Date(now.getTime() + 30 * 86400000);
const creation = writeBatch(ownerDb);
creation.set(doc(ownerDb, 'gymBusinessControls', gymId), control(owner.uid));
creation.set(doc(ownerDb, 'gymBusinessProfiles', gymId), profile());
creation.set(doc(ownerDb, 'gymInvites', inviteCode), invite());
await allow(creation.commit(), 'atomic gym creation');
await deny(getDoc(doc(memberDb, 'gymBusinessControls', gymId)), 'member private control');
await deny(
  setDoc(doc(otherDb, 'gymBusinessControls', gymId), control(other.uid)),
  'duplicate gym claim',
);
await deny(
  updateDoc(doc(ownerDb, 'gymBusinessProfiles', gymId), {
    platformStatus: 'suspended',
    updatedAt: serverTimestamp(),
  }),
  'owner moderation',
);
await allow(
  updateDoc(doc(moderatorDb, 'gymBusinessProfiles', gymId), {
    platformStatus: 'suspended',
    updatedAt: serverTimestamp(),
  }),
  'moderator suspension',
);
await deny(
  updateDoc(doc(supportDb, 'gymBusinessProfiles', gymId), {
    platformStatus: 'active',
    updatedAt: serverTimestamp(),
  }),
  'support moderation',
);
await allow(
  updateDoc(doc(moderatorDb, 'gymBusinessProfiles', gymId), {
    platformStatus: 'active',
    updatedAt: serverTimestamp(),
  }),
  'moderator activation',
);
await allow(getDoc(doc(memberDb, 'gymInvites', inviteCode)), 'exact invite');
await deny(getDocs(query(collection(memberDb, 'gymInvites'))), 'invite list');
const membershipPath = `gymMemberships/${gymId}/members/${member.uid}`,
  join = writeBatch(memberDb);
join.set(doc(memberDb, membershipPath), membership());
join.set(doc(memberDb, 'gymMemberDirectory', gymId, 'members', memberId), directory());
join.set(doc(memberDb, 'gymMemberDirectoryControls', gymId, 'entries', memberId), {
  schemaVersion: 1,
  contractVersion: 'gym-membership-v1',
  gymId,
  memberId,
  memberUid: member.uid,
});
join.set(
  doc(memberDb, 'gymMembershipIndexes', member.uid, 'items', gymId),
  membershipIndex(member.uid),
);
await allow(join.commit(), 'valid join');
assert.equal(
  (await getDocs(query(collection(memberDb, 'gymMembershipIndexes', member.uid, 'items')))).size,
  1,
);
await deny(getDoc(doc(otherDb, membershipPath)), 'other membership read');
await deny(
  setDoc(doc(otherDb, membershipPath), { ...membership(), memberId: '5555555555555555' }),
  'forged member UID',
);
const publicMember = (
  await getDoc(doc(memberDb, 'gymMemberDirectory', gymId, 'members', memberId))
).data();
assert.equal('memberUid' in publicMember, false);
assert.equal('ownerUid' in publicMember, false);
for (const path of [
  `athletes/${member.uid}`,
  `athletes/${member.uid}/completedWorkouts/w1`,
  `athletes/${member.uid}/programEnrollments/p1`,
  `athletes/${member.uid}/nutritionEntries/n1`,
  `athletes/${member.uid}/wellnessEntries/r1`,
  `athletes/${member.uid}/measurements/m1`,
  `athletes/${member.uid}/progressPhotos/p1`,
  `athletes/${member.uid}/notifications/n1`,
]) {
  await admin.doc(path).set({ ownerUid: member.uid, secret: true });
  await deny(getDoc(doc(ownerDb, path)), `athlete isolation ${path}`);
}
await allow(
  setDoc(doc(ownerDb, 'gymAnnouncements', gymId, 'items', 'a1'), announcement()),
  'owner announcement',
);
await allow(getDoc(doc(memberDb, 'gymAnnouncements', gymId, 'items', 'a1')), 'member announcement');
await deny(
  getDoc(doc(otherDb, 'gymAnnouncements', gymId, 'items', 'a1')),
  'non-member announcement',
);
await deny(
  setDoc(doc(memberDb, 'gymAnnouncements', gymId, 'items', 'a2'), announcement('a2')),
  'member announcement write',
);
await deny(
  setDoc(doc(ownerDb, 'gymAnnouncements', gymId, 'items', 'a3'), announcement('a3', '<b>bad</b>')),
  'HTML announcement',
);
await admin.doc('exercises/back-squat').set({ source: 'system', status: 'published' });
await admin.doc('exercises/draft').set({ source: 'system', status: 'draft' });
await admin.doc('exercises/custom').set({ source: 'athlete', status: 'published' });
await allow(
  setDoc(doc(ownerDb, 'gymStations', stationId), station('back-squat')),
  'canonical station',
);
await deny(
  setDoc(doc(ownerDb, 'gymStations', '5555555555555555'), station('unknown', '5555555555555555')),
  'unknown exercise',
);
await deny(
  setDoc(doc(ownerDb, 'gymStations', '6666666666666666'), station('draft', '6666666666666666')),
  'unpublished exercise',
);
await deny(
  setDoc(doc(ownerDb, 'gymStations', '7777777777777777'), station('custom', '7777777777777777')),
  'custom exercise',
);
await allow(getDoc(doc(otherDb, 'gymStations', stationId)), 'exact non-member station');
await deny(
  updateDoc(doc(memberDb, 'gymStations', stationId), {
    label: 'Stolen',
    updatedAt: serverTimestamp(),
  }),
  'member station write',
);
await allow(
  updateDoc(doc(ownerDb, 'gymStations', stationId), {
    status: 'paused',
    updatedAt: serverTimestamp(),
  }),
  'owner pause station',
);
await deny(getDoc(doc(otherDb, 'gymStations', stationId)), 'paused station');
const leave = writeBatch(memberDb);
leave.update(doc(memberDb, membershipPath), {
  status: 'left',
  endedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});
leave.update(doc(memberDb, 'gymMemberDirectory', gymId, 'members', memberId), {
  status: 'left',
  endedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});
leave.set(doc(memberDb, membershipPath, 'history', '1'), {
  ...membership(),
  status: 'left',
  endedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});
leave.update(doc(memberDb, 'gymMembershipIndexes', member.uid, 'items', gymId), {
  status: 'left',
  updatedAt: serverTimestamp(),
});
await allow(leave.commit(), 'leave with terminal history');
await deny(
  getDoc(doc(memberDb, 'gymAnnouncements', gymId, 'items', 'a1')),
  'terminal member access',
);
const nextMemberId = '8888888888888888',
  rejoin = writeBatch(memberDb),
  second = {
    ...membership(),
    memberId: nextMemberId,
    cycle: 2,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
delete second.endedAt;
rejoin.set(doc(memberDb, membershipPath), second);
rejoin.set(doc(memberDb, 'gymMemberDirectory', gymId, 'members', nextMemberId), {
  ...directory(),
  memberId: nextMemberId,
  joinedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});
rejoin.set(doc(memberDb, 'gymMemberDirectoryControls', gymId, 'entries', nextMemberId), {
  schemaVersion: 1,
  contractVersion: 'gym-membership-v1',
  gymId,
  memberId: nextMemberId,
  memberUid: member.uid,
});
rejoin.update(doc(memberDb, 'gymMembershipIndexes', member.uid, 'items', gymId), {
  status: 'active',
  updatedAt: serverTimestamp(),
});
await allow(rejoin.commit(), 'valid rejoin with new cycle and identity');
assert.equal((await getDoc(doc(memberDb, membershipPath))).data().cycle, 2);
assert.equal(
  (await getDoc(doc(ownerDb, 'gymMemberDirectory', gymId, 'members', memberId))).data().status,
  'left',
);
const expiredCode = 'BBBBBBBBBBBBBBBB';
await admin
  .doc(`gymInvites/${expiredCode}`)
  .set({ ...invite(), code: expiredCode, expiresAt: new Date(Date.now() - 1000) });
await admin.doc(`gymBusinessControls/${gymId}`).update({ currentInviteCode: expiredCode });
await deny(attemptJoin(otherDb, other.uid, expiredCode, 'AAAAAAAAAAAAAAAA'), 'expired invite join');
await admin.doc(`gymBusinessControls/${gymId}`).update({ currentInviteCode: inviteCode });
const rotatedCode = 'CCCCCCCCCCCCCCCC',
  rotate = writeBatch(ownerDb);
rotate.update(doc(ownerDb, 'gymInvites', inviteCode), { status: 'revoked' });
rotate.set(doc(ownerDb, 'gymInvites', rotatedCode), {
  ...invite(),
  code: rotatedCode,
  createdAt: serverTimestamp(),
  expiresAt: new Date(Date.now() + 30 * 86400000),
});
rotate.update(doc(ownerDb, 'gymBusinessControls', gymId), {
  currentInviteCode: rotatedCode,
  updatedAt: serverTimestamp(),
});
await allow(rotate.commit(), 'invite rotation');
await deny(
  attemptJoin(otherDb, other.uid, inviteCode, 'AAAAAAAAAAAAAAAA'),
  'revoked rotated invite join',
);
console.log(
  'P38 gym rules verified: identity, roles, invites, memberships, athlete isolation, announcements and stations passed.',
);
process.exit(0);
function control(uid) {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-business-v1',
    gymId,
    ownerUid: uid,
    currentInviteCode: inviteCode,
    createdAt: now,
    updatedAt: now,
  };
}
function profile() {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-business-v1',
    gymId,
    displayName: 'Synthetic Gym',
    description: 'Private community.',
    status: 'active',
    platformStatus: 'active',
    createdAt: now,
    updatedAt: now,
  };
}
function invite() {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-invite-v1',
    gymId,
    code: inviteCode,
    status: 'active',
    createdAt: now,
    expiresAt: expires,
  };
}
function membership() {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-membership-v1',
    gymId,
    memberUid: member.uid,
    memberId,
    displayNameSnapshot: 'Synthetic Member',
    inviteCodeUsed: inviteCode,
    cycle: 1,
    status: 'active',
    joinedAt: now,
    updatedAt: now,
  };
}
function directory() {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-membership-v1',
    gymId,
    memberId,
    displayName: 'Synthetic Member',
    status: 'active',
    joinedAt: now,
    updatedAt: now,
  };
}
function membershipIndex(uid) {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-membership-v1',
    ownerUid: uid,
    gymId,
    status: 'active',
    updatedAt: now,
  };
}
function announcement(id = 'a1', body = 'Welcome members.') {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-announcement-v1',
    gymId,
    announcementId: id,
    title: 'Welcome',
    body,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}
function station(exerciseId, id = stationId) {
  return {
    schemaVersion: 1,
    contractVersion: 'gym-station-qr-v1',
    stationId: id,
    gymId,
    label: 'Rack 1',
    exerciseId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}
async function principal(email, roles = []) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, password });
  }
  if (roles.length) await auth.setCustomUserClaims(user.uid, { optiformRoles: roles });
  return { uid: user.uid, email };
}
async function client(name, email) {
  const app = initializeClientApp({ projectId, apiKey: 'fake' }, name),
    auth = clientAuthFor(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
    disableWarnings: true,
  });
  await signInWithEmailAndPassword(auth, email, password);
  const db = clientDbFor(app),
    [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  return db;
}
async function allow(promise, label) {
  await promise.catch((error) => {
    throw new Error(`${label} denied: ${error.message}`);
  });
}
async function deny(promise, label) {
  await assert.rejects(promise, undefined, `${label} allowed`);
}
function attemptJoin(db, uid, code, id) {
  const batch = writeBatch(db),
    value = { ...membership(), memberUid: uid, memberId: id, inviteCodeUsed: code };
  batch.set(doc(db, 'gymMemberships', gymId, 'members', uid), value);
  batch.set(doc(db, 'gymMemberDirectory', gymId, 'members', id), { ...directory(), memberId: id });
  batch.set(doc(db, 'gymMemberDirectoryControls', gymId, 'entries', id), {
    schemaVersion: 1,
    contractVersion: 'gym-membership-v1',
    gymId,
    memberId: id,
    memberUid: uid,
  });
  batch.set(doc(db, 'gymMembershipIndexes', uid, 'items', gymId), membershipIndex(uid));
  return batch.commit();
}
