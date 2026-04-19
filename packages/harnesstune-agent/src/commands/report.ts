import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../config.js';
import { createClient } from '../client.js';

export async function report(args: string[], opts?: { dryRun?: boolean }): Promise<void> {
  const config = readConfig();

  let raw: string;
  const filePath = args[0];

  if (filePath && filePath !== '-') {
    raw = readFileSync(filePath, 'utf-8');
  } else {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    raw = Buffer.concat(chunks).toString('utf-8');
  }

  let payload: { type: string; body: Record<string, unknown> };
  try {
    payload = JSON.parse(raw);
  } catch {
    console.error('Invalid JSON in report');
    process.exit(1);
  }

  if (!payload.type || !payload.body) {
    console.error('Report must have "type" and "body" fields');
    process.exit(1);
  }

  // Add envelope metadata (BRFG-03: generatedAt + reportId)
  const envelope = {
    ...payload,
    generatedAt: new Date().toISOString(),
    reportId: randomUUID(),
  };

  if (opts?.dryRun) {
    console.log('Dry run: report JSON is valid');
    console.log(`  Type: ${envelope.type}`);
    console.log(`  Report ID: ${envelope.reportId}`);
    console.log(`  Generated at: ${envelope.generatedAt}`);
    console.log(`  Body keys: ${Object.keys(payload.body).join(', ')}`);
    return;
  }

  const client = createClient(config.relayUrl, config.token);
  const res = await client.post(`/api/channels/${config.channelId}/reports`, envelope);

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    console.error('Upload failed:', err.error ?? res.statusText);
    process.exit(1);
  }

  const data = await res.json() as { id: string };
  console.log(`Report uploaded: ${data.id}`);
}
