// Writes the public, aggregate activity snapshot used by the site.
// Needs a signed-in `gh` CLI, because private contributions are only visible to their owner.
// Only totals leave this script: no repository names reach the output.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Comma-separated repo names to leave out of the language totals. Kept out of this public file.
const EXCLUDED_REPOS = new Set((process.env.SNAPSHOT_EXCLUDE ?? '').split(','));
const OMITTED_LANGUAGES = new Set([
  'Dockerfile',
  'Makefile',
  'Batchfile',
  'PowerShell',
  'Procfile',
]);

const gh = (...args) =>
  JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 }));

const to = new Date();
const from = new Date(to);
from.setUTCDate(from.getUTCDate() - 364);

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

const { contributionsCollection: collection } = gh(
  'api',
  'graphql',
  '-f',
  `query=${query}`,
  '-f',
  `from=${from.toISOString()}`,
  '-f',
  `to=${to.toISOString()}`,
).data.viewer;

const calendar = collection.contributionCalendar;
const days = calendar.weeks.flatMap((week) => week.contributionDays);

const repos = gh(
  'api',
  '--paginate',
  '--slurp',
  'user/repos?per_page=100&affiliation=owner,collaborator,organization_member',
)
  .flat()
  .filter((repo) => !EXCLUDED_REPOS.has(repo.name));

const bytes = new Map();
for (const repo of repos) {
  for (const [language, size] of Object.entries(gh('api', `repos/${repo.full_name}/languages`))) {
    if (!OMITTED_LANGUAGES.has(language)) bytes.set(language, (bytes.get(language) ?? 0) + size);
  }
}
const totalBytes = [...bytes.values()].reduce((sum, size) => sum + size, 0);

const snapshot = {
  generated: to.toISOString().slice(0, 10),
  total: calendar.totalContributions,
  private: collection.restrictedContributionsCount,
  activeDays: days.filter((day) => day.contributionCount > 0).length,
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

writeFileSync('src/data/activity.json', `${JSON.stringify(snapshot)}\n`);
console.log(`${snapshot.total} contributions, ${snapshot.languages.length} languages`);
