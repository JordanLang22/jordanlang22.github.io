import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const files = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/files' }),
  schema: z.object({
    order: z.number().int().positive(),
    subject: z.string(),
    organisation: z.string(),
    kicker: z.string(),
    stamp: z.string().max(16),
    link: z.object({ label: z.string(), href: z.url() }).optional(),
    meta: z.array(z.object({ label: z.string(), value: z.string() })).min(3),
    stack: z.string(),
    summary: z.string(),
    findings: z.array(z.object({ title: z.string(), body: z.string() })).min(2),
  }),
});

export const collections = { files };
