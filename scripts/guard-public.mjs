// Fails the build if anything private reaches this public repository or its output.
//
// A plain list of forbidden words would publish the very words it protects, so the list is stored
// as SHA-256 hashes. The guard hashes every word and word pair it finds and compares. Hashes are
// not encryption, but they don't hand anyone the list.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const TEXT = new Set([
  '.html',
  '.js',
  '.css',
  '.json',
  '.xml',
  '.txt',
  '.svg',
  '.ts',
  '.mjs',
  '.astro',
  '.yaml',
  '.yml',
  '.md',
]);
const LOCKFILES = new Set(['package-lock.json']);
const PATTERNS = [
  [
    'private IP address',
    /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/,
  ],
  ['personal mail address', /[\w.+-]+@(?:gmail|outlook|hotmail|yahoo|icloud)\.com/i],
];

const forbidden = new Set(JSON.parse(readFileSync('scripts/guard-hashes.json', 'utf8')));
const hash = (value) => createHash('sha256').update(value).digest('hex');

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((path) => path && !LOCKFILES.has(path));
const targets = [...tracked, ...walk('dist')].filter((path) => TEXT.has(extname(path)));

const failures = [];
for (const path of targets) {
  const text = readFileSync(path, 'utf8');
  for (const [label, pattern] of PATTERNS) {
    if (pattern.test(text)) failures.push(`${path}: ${label}`);
  }
  const words = text.toLowerCase().match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/g) ?? [];
  for (const [index, word] of words.entries()) {
    if (forbidden.has(hash(word)) || forbidden.has(hash(`${word} ${words[index + 1]}`))) {
      failures.push(`${path}: forbidden term near "${words[index - 1] ?? ''}"`);
    }
  }
}

if (failures.length > 0) {
  console.error([...new Set(failures)].join('\n'));
  process.exit(1);
}
console.log(`Checked ${targets.length} files. Nothing private found.`);
