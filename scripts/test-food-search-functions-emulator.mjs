const project = process.env.GCLOUD_PROJECT || 'demo-optiform-nutrition';
if (project !== 'demo-optiform-nutrition')
  throw new Error('Food search integration requires the demo project.');

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const functionsHost = process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const endpoint = `http://${functionsHost}/${project}/africa-south1/searchOpenFoodFactsBeta`;
const rateDocument = `http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/systemFoodSearchGateway/rateLimit`;

const call = async (data, token) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  return { status: response.status, body: await response.json() };
};

const resetRateGate = async () => {
  const response = await fetch(rateDocument, {
    method: 'DELETE',
    headers: { authorization: 'Bearer owner' },
  });
  if (![200, 404].includes(response.status)) throw new Error('Could not reset emulator rate gate.');
};

const writeRateGate = async (fields) => {
  const response = await fetch(rateDocument, {
    method: 'PATCH',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error('Could not seed emulator rate gate.');
};

const request = (query, languageCodes = ['en']) => ({
  contractVersion: 'nutrition-food-text-search-v1',
  query,
  languageCodes,
});

const anonymous = await call(request('whole milk'));
if (anonymous.body.error?.status !== 'UNAUTHENTICATED')
  throw new Error('Anonymous food search was not denied.');

const signUp = await fetch(
  `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'p57-food-search@example.test',
      password: 'Password123!',
      returnSecureToken: true,
    }),
  },
);
const account = await signUp.json();
if (!account.idToken) throw new Error('Food-search emulator user could not authenticate.');

const malformed = await call({ ...request('whole milk'), uid: account.localId }, account.idToken);
if (malformed.body.error?.status !== 'INVALID_ARGUMENT')
  throw new Error('Extra callable payload fields were not denied.');

await resetRateGate();
const valid = await call(request('whole milk', ['en', 'fr']), account.idToken);
if (
  valid.body.result?.contractVersion !== 'nutrition-food-text-search-v1' ||
  valid.body.result?.transportContractVersion !== 'open-food-facts-search-gateway-beta-v1' ||
  valid.body.result?.results?.length !== 1 ||
  valid.body.result.results[0]?.productCode !== '12345678' ||
  valid.body.result.results[0]?.provider !== 'open-food-facts'
)
  throw new Error('Authenticated emulator search response failed.');

const cached = await call(request('whole milk', ['en', 'fr']), account.idToken);
if (cached.body.result?.results?.length !== 1)
  throw new Error('Process-memory cache did not bypass the outgoing-call rate gate.');

const limited = await call(request('different food'), account.idToken);
if (
  limited.body.error?.status !== 'RESOURCE_EXHAUSTED' ||
  !Number.isInteger(limited.body.error?.details?.retryAfterSeconds) ||
  limited.body.error.details.retryAfterSeconds < 1 ||
  limited.body.error.details.retryAfterSeconds > 8
)
  throw new Error('Global provider cadence gate did not return a bounded retry delay.');

await writeRateGate({
  schemaVersion: { integerValue: '1' },
  contractVersion: { stringValue: 'open-food-facts-search-gateway-beta-v1' },
  nextProviderRequestAt: { timestampValue: '2000-01-01T00:00:00Z' },
  updatedAt: { timestampValue: '2000-01-01T00:00:00Z' },
});
const afterInterval = await call(request('interval elapsed'), account.idToken);
if (afterInterval.body.result?.results?.length !== 1)
  throw new Error('An expired global provider cadence slot was not reusable.');

await writeRateGate({
  schemaVersion: { integerValue: '1' },
  contractVersion: { stringValue: 'open-food-facts-search-gateway-beta-v1' },
  nextProviderRequestAt: { timestampValue: '2000-01-01T00:00:00Z' },
});
const malformedGate = await call(request('malformed gate'), account.idToken);
if (malformedGate.body.error?.status !== 'UNAVAILABLE')
  throw new Error('Malformed operational rate metadata did not fail closed.');

const providerScenarios = [
  ['emulator429', 'RESOURCE_EXHAUSTED'],
  ['emulator503', 'UNAVAILABLE'],
  ['emulatorMalformed', 'UNAVAILABLE'],
  ['emulator400', 'INVALID_ARGUMENT'],
];
for (const [query, expected] of providerScenarios) {
  await resetRateGate();
  const outcome = await call(request(query), account.idToken);
  if (outcome.body.error?.status !== expected)
    throw new Error(`Provider scenario ${query} did not map to ${expected}.`);
}

await resetRateGate();
const [concurrentA, concurrentB] = await Promise.all([
  call(request('concurrent alpha'), account.idToken),
  call(request('concurrent beta'), account.idToken),
]);
const concurrentStatuses = [
  concurrentA.body.result ? 'SUCCESS' : concurrentA.body.error?.status,
  concurrentB.body.result ? 'SUCCESS' : concurrentB.body.error?.status,
].sort();
if (concurrentStatuses.join(',') !== 'RESOURCE_EXHAUSTED,SUCCESS')
  throw new Error('Concurrent global provider gate did not admit exactly one outgoing call.');

const privateRead = await fetch(rateDocument, {
  headers: { authorization: `Bearer ${account.idToken}` },
});
if (privateRead.status !== 403) throw new Error('Client could read the server-only rate gate.');
const privateList = await fetch(
  `http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/systemFoodSearchGateway?pageSize=10`,
  { headers: { authorization: `Bearer ${account.idToken}` } },
);
if (privateList.status !== 403) throw new Error('Client could list the server-only rate gate.');
for (const [method, url] of [
  ['PATCH', rateDocument],
  [
    'POST',
    `http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/systemFoodSearchGateway?documentId=forged`,
  ],
  ['DELETE', rateDocument],
]) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${account.idToken}`,
      'content-type': 'application/json',
    },
    ...(method === 'DELETE'
      ? {}
      : { body: JSON.stringify({ fields: { uid: { stringValue: account.localId } } }) }),
  });
  if (response.status !== 403)
    throw new Error(`Client ${method} reached the server-only rate gate.`);
}

const serverRead = await fetch(rateDocument, { headers: { authorization: 'Bearer owner' } });
if (!serverRead.ok) throw new Error('Server-owned rate gate document was unavailable.');
const serverDocument = await serverRead.json();
const storedFields = Object.keys(serverDocument.fields ?? {}).sort();
if (storedFields.join(',') !== 'contractVersion,nextProviderRequestAt,schemaVersion,updatedAt')
  throw new Error('Rate gate stored unapproved fields.');

console.log(
  'P57 food-search Functions emulator verified: auth, emulator App Check convention, exact payload, bounded response, memory cache, global cadence, concurrent gate, provider error mapping, and client-denied operational state passed.',
);
