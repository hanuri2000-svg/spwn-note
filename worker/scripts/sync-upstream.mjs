// The standalone relay is the sole source. Never edit mirrored files here.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const repository = 'hanuri2000-svg/spawn-note-elo-relay';
const paths = ['src/index.js', 'tests/dashboard.test.mjs', 'wrangler.jsonc'];
const get = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Upstream unavailable (${response.status}); deployment stopped.`);
  return response.text();
};
const revision = JSON.parse(await get(`https://api.github.com/repos/${repository}/commits/main`)).sha;
const files = await Promise.all(paths.map(async path => [path, await get(`https://raw.githubusercontent.com/${repository}/${revision}/${path}`)]));
const hashes = Object.fromEntries(files.map(([path, text]) => [path, createHash('sha256').update(text).digest('hex')]));
if (process.argv.includes('--write')) {
  for (const [path, text] of files) await writeFile(new URL(path, root), text);
  const packageUrl = new URL('package.json', root);
  const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));
  const upstreamPkg = JSON.parse(await get(`https://raw.githubusercontent.com/${repository}/${revision}/package.json`));
  pkg.version = upstreamPkg.version;
  await writeFile(packageUrl, JSON.stringify(pkg, null, 2) + '\n');
  await writeFile(new URL('upstream-lock.json', root), JSON.stringify({ repository, revision, hashes }, null, 2) + '\n');
  console.log(`Synced ${repository}@${revision}. Run npm test before committing.`);
} else {
  const lock = JSON.parse(await readFile(new URL('upstream-lock.json', root), 'utf8'));
  for (const [path, text] of files) {
    if (await readFile(new URL(path, root), 'utf8') !== text || lock.hashes?.[path] !== hashes[path]) {
      throw new Error(`${path} differs from canonical main. Run npm run sync:upstream, test and commit before deploying.`);
    }
  }
  console.log(`Canonical Worker, tests and deployment config match ${revision}.`);
}
