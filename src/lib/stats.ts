export interface ProjectStats {
  commits: number;
  pullRequests: number;
  lines: number;
  testLines: number;
}

const number = new Intl.NumberFormat('en-US');

/** 201,617 reads as 202k. Exact counts of lines imply a precision nobody has. */
export function roundThousands(value: number): string {
  return value < 1_000 ? String(value) : `${number.format(Math.round(value / 1_000))}k`;
}

function format(stats: ProjectStats, field: string): string | undefined {
  switch (field) {
    case 'commits':
      return number.format(stats.commits);
    case 'pullRequests':
      return number.format(stats.pullRequests);
    case 'lines':
      return roundThousands(stats.lines);
    case 'testLines':
      return roundThousands(stats.testLines);
    case 'productionLines':
      return roundThousands(stats.lines - stats.testLines);
    default:
      return undefined;
  }
}

/**
 * Replaces tokens like `$kestrel.commits` in case file copy with today's measured numbers. An
 * unknown token throws, so a typo fails the build instead of appearing on the page.
 */
export function fillStats(value: string, projects: Record<string, ProjectStats>): string {
  return value.replace(/\$(\w+)\.(\w+)/g, (token, project: string, field: string) => {
    const stats = projects[project];
    const filled = stats && format(stats, field);
    if (filled === undefined) throw new Error(`Unknown stat ${token}`);
    return filled;
  });
}
