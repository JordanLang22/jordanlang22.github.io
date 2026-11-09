import { defineConfig } from 'vitest/config';

// The property tests run hundreds of schedules each. On a slow CI runner that passes five seconds.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], testTimeout: 60_000 } });
