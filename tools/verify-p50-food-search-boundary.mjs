import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const sourceRoot = join(root, 'functions-p50-food-search', 'src');
const sourceFiles = readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => relative(sourceRoot, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  .sort();
assert.deepEqual(sourceFiles, [
  'food-search/contracts.test.ts',
  'food-search/contracts.ts',
  'food-search/gateway.test.ts',
  'food-search/gateway.ts',
  'food-search/gatewayCore.ts',
  'index.ts',
]);
const source = sourceFiles.map((path) => read('functions-p50-food-search/src/' + path)).join('\n');
const index = read('functions-p50-food-search/src/index.ts');
const gateway =
  read('functions-p50-food-search/src/food-search/gateway.ts') +
  read('functions-p50-food-search/src/food-search/gatewayCore.ts');
const pkg = JSON.parse(read('functions-p50-food-search/package.json'));
const firebase = JSON.parse(read('firebase.json'));
assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['firebase-admin', 'firebase-functions']);
assert.equal(pkg.engines.node, '22');
assert.deepEqual(
  [...index.matchAll(/export const\s+([A-Za-z0-9_]+)\s*=/g)].map((match) => match[1]),
  ['searchOpenFoodFactsBeta'],
);
assert.equal(source.includes('defineSecret'), false);
assert.equal(source.includes('OPENAI_API_KEY'), false);
for (const forbidden of [
  '/commerce/',
  '/creator-',
  '/gym-',
  '/notifications/',
  '/workout-import/',
  '/analytics/',
  '/handler.js',
  '/provider.js',
])
  assert.equal(source.includes(forbidden), false);
assert.ok(index.includes("defineString('OPEN_FOOD_FACTS_USER_AGENT'"));
for (const expected of [
  "region: 'africa-south1'",
  'timeoutSeconds: 15',
  "memory: '256MiB'",
  'minInstances: 0',
  'maxInstances: 1',
  'enforceAppCheck: !emulator',
  'request.auth?.uid ?? null',
])
  assert.ok(index.includes(expected));
assert.ok(gateway.includes("'systemFoodSearchGateway/rateLimit'"));
assert.ok(gateway.includes("'https://search.openfoodfacts.org/search'"));
assert.ok(gateway.includes('FOOD_SEARCH_CACHE_MAXIMUM = 50'));
assert.ok(gateway.includes('FOOD_SEARCH_CACHE_TTL_MS = 60_000'));
assert.deepEqual(firebase.functions.map((entry) => entry.codebase).sort(), [
  'p26-auth',
  'p50-food-search',
]);
assert.equal(
  firebase.functions.find((entry) => entry.codebase === 'p50-food-search')?.source,
  'functions-p50-food-search',
);
console.log(
  'Public P50 boundary verified: one isolated callable, fixed runtime/Auth/App Check contract, non-secret parameter, Firestore cadence gate, process-only cache, and zero OpenAI or unrelated service dependencies.',
);
