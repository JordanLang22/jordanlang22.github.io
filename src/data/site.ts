export const LINKS = {
  linkedin: 'https://www.linkedin.com/in/jordanlang2/',
  github: 'https://github.com/JordanLang22',
  email: 'mailto:jordan@northconstruct.com',
  source: 'https://github.com/JordanLang22/jordanlang22.github.io',
  invariants:
    'https://github.com/JordanLang22/jordanlang22.github.io/blob/main/src/sim/engine.test.ts',
} as const;

export const ALSO_ON_FILE = [
  {
    name: 'Avenue',
    detail: 'Vertical tab manager for Chrome that reconciles its tree against live tabs.',
    stack: 'JavaScript, Manifest V3, Playwright',
    status: 'Public',
    href: 'https://github.com/JordanLang22/avenue',
  },
  {
    name: 'LaunchDial',
    detail: 'Apple Watch paramotor weather. It says STALE before it invents a number.',
    stack: 'Swift, WidgetKit, HealthKit',
    status: 'Prototype',
  },
  {
    name: 'GovBid Copilot',
    detail: 'Solicitation analysis for small contractors. Every provider fails closed by default.',
    stack: 'Next.js, Terraform, GCP, pgvector',
    status: 'Pre-launch',
  },
  {
    name: 'Core Caller AI',
    detail: 'Multi-tenant AI calling triggered by Salesforce and HubSpot events.',
    stack: 'Make, Airtable, Bland.ai, RAG',
    status: 'Silicore',
  },
  {
    name: 'Agent tooling',
    detail: 'MCP servers and skills, with hash-verified syncing and rollback.',
    stack: 'TypeScript, Python, MCP',
    status: 'Daily use',
  },
] as const;

export const STANDING_ORDERS = [
  {
    order: 'Never assume it worked',
    detail: 'A returned request is a claim, not a fact. Ask the system of record.',
    evidence: 'KestrelTrader, ShieldHome',
  },
  {
    order: 'Write it down first',
    detail: 'Record the intent durably, then act. A crash should leave a to-do, not a mystery.',
    evidence: 'Integration platform, Dendrition',
  },
  {
    order: 'Twice means once',
    detail: 'Everything gets delivered twice eventually. The second copy has to change nothing.',
    evidence: 'Integration platform, ShieldHome',
  },
  {
    order: 'When unsure, stop safely',
    detail: 'Ambiguity is a failure state. Pick the outcome you can explain the next morning.',
    evidence: 'KestrelTrader, GovBid Copilot',
  },
  {
    order: 'Never invent a value',
    detail: 'Stale data labeled stale is useful. Fresh-looking data that is wrong is dangerous.',
    evidence: 'LaunchDial',
  },
  {
    order: 'Someone supports this at 3 a.m.',
    detail:
      "Ship the runbook, the rollback, and the logs. That person might be you, and I've been that person.",
    evidence: 'Dendrition, the outage',
  },
] as const;

export const CAREER_LOG = [
  {
    date: '2013-02',
    role: 'IT, web, and design',
    org: 'Beachcombers / Prowatercraft Racing',
    detail: 'Ran all infrastructure, and built the web front end in HTML, CSS, and jQuery.',
  },
  {
    date: '2016-03',
    role: 'Police officer',
    org: 'Law enforcement agencies, Arizona',
    detail:
      'Nearly seven years in public safety, and the de facto field IT liaison for in-vehicle hardware, networks, and software.',
  },
  {
    date: '2022-12',
    role: 'Master schedule analyst',
    org: 'Proactive Management',
    detail:
      'Integrated master schedules for government projects, DCMA 14-point compliance, and Monte Carlo risk analysis.',
  },
  {
    date: '2023-01',
    role: 'Technical support SME',
    org: 'Axon',
    detail:
      'Integrated products into secure agency networks worldwide, and built a Python tool that cut one queue’s resolution time by 90%.',
  },
  {
    date: '2024-05',
    role: 'IT operations and solutions architect',
    org: 'NxEdge',
    detail: 'Sole IT operations for five semiconductor sites and 200+ users.',
  },
  {
    date: '2025-07',
    role: 'Principal solutions architect',
    org: 'Silicore',
    detail: 'Designed and built Core Caller AI, a multi-tenant AI calling platform.',
  },
  {
    date: '2025-12',
    role: 'Technical implementation consultant',
    org: 'GovWorx',
    detail: 'Built the agency onboarding application that became the company standard.',
  },
  {
    date: '2026-02',
    role: 'Full stack software engineer',
    org: 'GovWorx',
    detail: 'Primary engineer and technical owner of the integration platform.',
  },
  {
    date: '2026-06',
    role: 'Co-founder, product and technology',
    org: 'North Construct',
    detail: 'First commit on Dendrition.',
  },
] as const;
