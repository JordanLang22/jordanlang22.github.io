// Measures my work across GitHub and writes the aggregate numbers the site displays.
// Runs daily in CI. Everything it prints goes to public logs, so repository names never leave
// this script: not in the output file, not in logs, not in errors.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const OUTPUT = 'src/data/activity.json';
const OWNERS = new Set(['JordanLang22', 'North-Construct']);
// Repositories on the guard's private list stay out of the totals, without being named here.
const PRIVATE_NAMES = new Set(JSON.parse(readFileSync('scripts/guard-hashes.json', 'utf8')));
const isPrivateName = (name) =>
  PRIVATE_NAMES.has(createHash('sha256').update(name.toLowerCase()).digest('hex'));
const PROJECTS = { Dendrition: 'dendrition', KestrelTrader: 'kestrel', ShieldHome: 'shieldhome' };
const CODE = new Set(
  'ts tsx js jsx mjs cjs cs py kt kts swift svelte astro vue css scss html sql sh bash ps1 tf hcl pine gs'
    .split(' ')
    .map((extension) => `.${extension}`),
);
const SKIPPED_PATH =
  /(^|\/)(node_modules|dist|build|bin|obj|vendor|third_party|generated|__generated__|coverage|fixtures|__snapshots__|artifacts|public)(\/|$)|\.min\.|\.d\.ts$/;
const TEST_PATH =
  /(^|\/)(tests?|__tests__|specs?)(\/|$)|\.(test|spec)\.|Tests?\.[a-z]+$|\.Tests?\//;
const MAX_FILE_BYTES = 2_000_000;
const SHRINK_LIMIT = 0.8;

const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 27, stdio: 'pipe', ...options });
const gh = (...args) => JSON.parse(run('gh', args));

const COMMITS_QUERY = `query($owner: String!, $name: String!, $author: ID!, $after: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { target { ... on Commit { history(author: { id: $author }) { totalCount } } } }
    pullRequests(states: MERGED, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        author { login }
        commits { totalCount }
        mergeCommit { parents { totalCount } }
      }
    }
  }
}`;

/**
 * GitHub counts one commit for a squash-merged pull request, however many went into it. Real
 * commits are the default branch history plus whatever each squash folded away.
 */
function countCommits(owner, name, viewer) {
  let onDefaultBranch = 0;
  let squashed = 0;
  let pullRequests = 0;
  let after;
  do {
    const args = ['api', 'graphql', '-f', `query=${COMMITS_QUERY}`];
    args.push('-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `author=${viewer.id}`);
    if (after) args.push('-f', `after=${after}`);
    const { repository } = gh(...args).data;
    onDefaultBranch = repository.defaultBranchRef?.target?.history?.totalCount ?? 0;
    for (const request of repository.pullRequests.nodes) {
      if (request.author?.login !== viewer.login) continue;
      pullRequests += 1;
      if (request.mergeCommit?.parents.totalCount !== 2) {
        squashed += Math.max(0, request.commits.totalCount - 1);
      }
    }
    const { hasNextPage, endCursor } = repository.pullRequests.pageInfo;
    after = hasNextPage ? endCursor : undefined;
  } while (after);
  return { commits: onDefaultBranch + squashed, pullRequests };
}

/** Non-blank lines of source at the tip of the default branch, with test code counted apart. */
function countLines(owner, name) {
  const directory = mkdtempSync(join(tmpdir(), 'snapshot-'));
  try {
    run('git', [
      'clone',
      '--quiet',
      '--depth',
      '1',
      `https://github.com/${owner}/${name}.git`,
      directory,
    ]);
    let lines = 0;
    let testLines = 0;
    for (const path of run('git', ['ls-files'], { cwd: directory }).split('\n')) {
      if (!CODE.has(extname(path)) || SKIPPED_PATH.test(path)) continue;
      const file = join(directory, path);
      if (!existsSync(file) || statSync(file).size > MAX_FILE_BYTES) continue;
      const count = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim()).length;
      lines += count;
      if (TEST_PATH.test(path)) testLines += count;
    }
    return { lines, testLines };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function readContributions(viewerFrom, viewerTo) {
  const query = `query($from: DateTime!, $to: DateTime!) {
    viewer {
      contributionsCollection(from: $from, to: $to) {
        restrictedContributionsCount
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }`;
  return gh(
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `from=${viewerFrom.toISOString()}`,
    '-f',
    `to=${viewerTo.toISOString()}`,
  ).data.viewer.contributionsCollection;
}

function assertPlausible(next) {
  if (!existsSync(OUTPUT)) return;
  const previous = JSON.parse(readFileSync(OUTPUT, 'utf8')).totals;
  if (!previous) return;
  for (const key of ['commits', 'lines', 'repositories']) {
    if (next[key] < previous[key] * SHRINK_LIMIT) {
      throw new Error(`Refusing a suspicious drop in ${key}. A token probably lost access.`);
    }
  }
}

function main() {
  const viewer = gh('api', 'graphql', '-f', 'query={ viewer { id login } }').data.viewer;
  const repos = gh(
    'api',
    '--paginate',
    '--slurp',
    'user/repos?per_page=100&affiliation=owner,collaborator,organization_member',
  )
    .flat()
    .filter(({ owner, name, fork }) => OWNERS.has(owner.login) && !isPrivateName(name) && !fork);

  const totals = {
    commits: 0,
    pullRequests: 0,
    lines: 0,
    testLines: 0,
    repositories: repos.length,
  };
  const projects = {};
  const bytes = new Map();
  for (const { owner, name, full_name: fullName } of repos) {
    const measured = {
      ...countCommits(owner.login, name, viewer),
      ...countLines(owner.login, name),
    };
    for (const key of ['commits', 'pullRequests', 'lines', 'testLines'])
      totals[key] += measured[key];
    if (PROJECTS[name]) projects[PROJECTS[name]] = measured;
    for (const [language, size] of Object.entries(gh('api', `repos/${fullName}/languages`))) {
      bytes.set(language, (bytes.get(language) ?? 0) + size);
    }
  }
  assertPlausible(totals);

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 364);
  const collection = readContributions(from, to);
  const calendar = collection.contributionCalendar;
  const totalBytes = [...bytes.values()].reduce((sum, size) => sum + size, 0);

  const snapshot = {
    generated: to.toISOString().slice(0, 10),
    totals,
    projects,
    total: calendar.totalContributions,
    private: collection.restrictedContributionsCount,
    activeDays: calendar.weeks
      .flatMap((week) => week.contributionDays)
      .filter((day) => day.contributionCount > 0).length,
    weeks: calendar.weeks.map((week) => ({
      start: week.contributionDays[0].date,
      firstWeekday: new Date(`${week.contributionDays[0].date}T00:00:00Z`).getUTCDay(),
      counts: week.contributionDays.map((day) => day.contributionCount),
    })),
    languages: [...bytes.entries()]
      .map(([name, size]) => ({ name, share: Math.round((size / totalBytes) * 1000) / 10 }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 8),
  };

  writeFileSync(OUTPUT, `${JSON.stringify(snapshot)}\n`);
  console.log(`Measured ${totals.repositories} repositories.`);
}

try {
  main();
} catch (error) {
  // Command errors quote their arguments, which include repository names. Keep the logs clean.
  console.error(error.message?.startsWith('Refusing') ? error.message : 'Snapshot failed.');
  process.exit(1);
}
