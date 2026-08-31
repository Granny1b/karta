/**
 * Loads every compiled function entry point the way the Functions host loads
 * them, and fails the build if any of them throws.
 *
 * `tsc` cannot catch this on its own: it checks specifiers against its own
 * resolver, it never runs Node's resolver over the emitted JavaScript. A module
 * setting that emits a specifier Node cannot resolve — an extensionless
 * relative import, a directory import, a `paths` alias that is never rewritten —
 * type-checks clean and then registers zero functions on the deployed host,
 * where it shows up as every route 404ing. So the build proves the output
 * imports before it ships.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(await readFile(join(apiRoot, 'package.json'), 'utf8'));
const main = typeof pkg.main === 'string' ? pkg.main : '';
const glob = /^(.+)\/\*(\.[a-z]+)$/.exec(main);
if (!glob) {
  fail(`package.json "main" is ${JSON.stringify(main)}; expected a "<dir>/*.js" glob.`);
}

const [, relativeDir, extension] = glob;
const directory = join(apiRoot, relativeDir);

let names;
try {
  names = (await readdir(directory)).filter((n) => n.endsWith(extension)).sort();
} catch {
  fail(`Nothing was emitted at ${relativeDir} — did the build run?`);
}

if (names.length === 0) {
  fail(`No ${extension} files at ${relativeDir}, so the host would register no functions.`);
}

const failures = [];
for (const name of names) {
  try {
    await import(pathToFileURL(join(directory, name)).href);
  } catch (err) {
    failures.push(`${relativeDir}/${name}: ${err.code ?? 'Error'} — ${err.message}`);
  }
}

if (failures.length > 0) {
  fail(
    [`${failures.length} of ${names.length} function entry points failed to load:`, ...failures].join(
      '\n  ',
    ),
  );
}

console.log(`smoke-load: ${names.length} function entry points load.`);

function fail(message) {
  console.error(`smoke-load: ${message}`);
  process.exit(1);
}
