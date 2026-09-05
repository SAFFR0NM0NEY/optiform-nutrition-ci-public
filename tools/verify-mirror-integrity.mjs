import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = process.cwd();
const manifestPath = resolve(root, 'CI_EXPORT_MANIFEST.tsv');
const manifestHashPath = resolve(root, 'CI_EXPORT_MANIFEST_SHA256.txt');
const sourceShaPath = resolve(root, 'CI_SOURCE_SHA.txt');
const fail = (message) => {
  throw new Error(`Mirror integrity failure: ${message}`);
};
const hash = (data) => createHash('sha256').update(data).digest('hex');

if (!/^[0-9a-f]{40}\n?$/.test(readFileSync(sourceShaPath, 'utf8'))) fail('invalid CI source SHA');
const manifest = readFileSync(manifestPath);
if (readFileSync(manifestHashPath, 'utf8').trim() !== hash(manifest))
  fail('manifest digest mismatch');

const entries = manifest
  .toString('utf8')
  .trimEnd()
  .split('\n')
  .slice(1)
  .map((line) => {
    const [path, size, sha256, origin] = line.split('\t');
    if (!path || !size || !sha256 || !['direct', 'generated', 'fixture'].includes(origin))
      fail(`invalid manifest row: ${line}`);
    return { path, size: Number(size), sha256 };
  });
for (const entry of entries) {
  const data = readFileSync(resolve(root, entry.path));
  if (data.length !== entry.size || hash(data) !== entry.sha256)
    fail(`manifest mismatch: ${entry.path}`);
}

const ignored = new Set(['.git', 'node_modules', 'dist', '.firebase']);
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    if (ignored.has(item.name)) return [];
    const path = resolve(directory, item.name);
    return item.isDirectory() ? files(path) : [path];
  });
}
const paths = files(root).map((path) => relative(root, path).replaceAll('\\', '/'));
const expected = new Set([
  ...entries.map(({ path }) => path),
  'CI_EXPORT_MANIFEST.tsv',
  'CI_EXPORT_MANIFEST_SHA256.txt',
]);
for (const path of paths) if (!expected.has(path)) fail(`unmanifested file: ${path}`);

const forbiddenPaths = [
  /(^|\/)\.env/i,
  /(^|\/)android(\/|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.jks$/i,
  /\.keystore$/i,
  /(^|\/)scripts\/admin(\/|$)/i,
  /(^|\/)docs(\/|$)/i,
  /(^|\/)AGENTS\.md$/i,
  /(^|\/)\.firebaserc$/i,
];
const forbiddenText = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp_|github_pat_)[A-Za-z0-9_]+/,
  /"private_key"\s*:/,
  /"client_email"\s*:/,
  /FIREBASE_SERVICE_ACCOUNT/,
  /--project\s+optiform-nutrition/,
  /firebase(?:-tools)?\s+deploy/i,
  /pull_request_target/,
  /id-token:\s*write/,
  /contents:\s*write/,
  /play.*service.*account/i,
  /storePassword|keyPassword/,
  /sk_live_[A-Za-z0-9]+/,
];
for (const path of paths) {
  if (forbiddenPaths.some((pattern) => pattern.test(path))) fail(`forbidden path: ${path}`);
  const absolute = resolve(root, path);
  if (statSync(absolute).size > 2_000_000) fail(`unexpected large file: ${path}`);
  if (path === 'tools/verify-mirror-integrity.mjs') continue;
  const text = readFileSync(absolute, 'utf8');
  if (forbiddenText.some((pattern) => pattern.test(text))) fail(`forbidden content: ${path}`);
}
if (paths.some((path) => path.startsWith('.github/workflows/android')))
  fail('Android workflow present');
console.log(
  `Mirror integrity verified: ${entries.length} exported files, zero forbidden findings.`,
);
