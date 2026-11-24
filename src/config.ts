import { readFileSync } from 'node:fs';
import { z } from 'zod';

const BaseTargetSchema = z.object({
  name: z.string().trim().min(1).max(64),
  intervalSeconds: z.number().int().min(5).max(86_400).default(30),
  timeoutMs: z.number().int().min(100).max(30_000).default(3_000),
});

const HttpTargetSchema = BaseTargetSchema.extend({
  type: z.literal('http'),
  url: z.string().url().refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
    message: 'HTTP target must start with http:// or https://',
  }),
  expectedStatus: z.number().int().min(100).max(599).default(200),
});

const TcpTargetSchema = BaseTargetSchema.extend({
  type: z.literal('tcp'),
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65_535),
});

export const TargetConfigSchema = z.discriminatedUnion('type', [
  HttpTargetSchema,
  TcpTargetSchema,
]);

export const TargetsListSchema = z
  .array(TargetConfigSchema)
  .min(1, 'targets.json must define at least one target')
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate target name: ${item.name}`,
          path: [index, 'name'],
        });
      }
      seen.add(item.name);
    });
  });

export type TargetConfig = z.infer<typeof TargetConfigSchema>;

export function formatEndpoint(target: TargetConfig): string {
  return target.type === 'http' ? target.url : `${target.host}:${target.port}`;
}

export function loadTargets(filePath: string): TargetConfig[] {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  return TargetsListSchema.parse(raw);
}
