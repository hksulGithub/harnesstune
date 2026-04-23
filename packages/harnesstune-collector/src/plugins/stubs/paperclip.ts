import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
import type { AgentIdentity } from '../../types.js';
import { PaperclipClient } from '../paperclip/client.js';
import { mapAgent, mapTaskSession, enrichWithCosts, mapActivitiesToEvents } from '../paperclip/mappers.js';

/**
 * Paperclip platform plugin.
 *
 * detect(): checks for common Paperclip installation markers.
 * setup(): prompts for serverUrl + apiKey, validates credentials via getCompanies(),
 *          auto-selects or prompts for companyId (D-02).
 * discover(): calls getAgents(companyId) and maps to AgentIdentity[] (PCLP-02).
 * collectRuns(): calls getTaskSessions + getCostsByAgent + getActivity, maps to RunReport[] (PCLP-03, PCLP-04, PCLP-05).
 */
export class PaperclipPlugin implements PlatformPlugin {
  readonly id = 'paperclip';
  readonly displayName = 'Paperclip';

  private client?: PaperclipClient;
  private companyId?: string;

  constructor(private readonly platformConfig?: PlatformConfig) {
    if (platformConfig?.['serverUrl'] && platformConfig?.['apiKey']) {
      this.client = new PaperclipClient(
        platformConfig['serverUrl'] as string,
        platformConfig['apiKey'] as string,
      );
      this.companyId = (platformConfig['companyId'] as string) || undefined;
    }
  }

  async detect(): Promise<boolean> {
    const markers = [
      join(homedir(), '.paperclip'),
      join(homedir(), 'Library', 'Application Support', 'Paperclip'),
      '/usr/local/bin/paperclip',
      '/opt/homebrew/bin/paperclip',
    ];
    return markers.some(p => existsSync(p));
  }

  async setup(existing?: PlatformConfig): Promise<PlatformConfig> {
    const rl = createInterface({ input, output });
    try {
      // Step 1: prompt for server URL and API key
      const defaultUrl = (existing?.['serverUrl'] as string | undefined) ?? '';
      const serverUrl = (
        await rl.question(`Paperclip server URL${defaultUrl ? ` [${defaultUrl}]` : ''}: `)
      ).trim() || defaultUrl;

      const apiKey = (await rl.question('Paperclip Board API Key: ')).trim();

      if (!serverUrl || !apiKey) {
        throw new Error('Server URL and API key are required.');
      }

      // Step 2: validate credentials by fetching companies (D-02)
      const client = new PaperclipClient(serverUrl, apiKey);
      console.log('\nValidating credentials...');
      const companies = await client.getCompanies();

      if (companies.length === 0) {
        throw new Error('No companies found. Check your API key permissions.');
      }

      // Step 3: select companyId (D-02)
      let companyId: string;
      if (companies.length === 1) {
        companyId = companies[0].id;
        console.log(`Company: ${companies[0].name} (${companyId})`);
      } else {
        console.log('\nMultiple companies found:');
        companies.forEach((c, i) => console.log(`  ${i + 1}. ${c.name} (${c.id})`));
        const choice = await rl.question(`Select company [1-${companies.length}]: `);
        const idx = parseInt(choice.trim(), 10) - 1;
        if (idx < 0 || idx >= companies.length) {
          throw new Error('Invalid selection.');
        }
        companyId = companies[idx].id;
        console.log(`Selected: ${companies[idx].name}`);
      }

      return { serverUrl, apiKey, companyId };
    } finally {
      rl.close();
    }
  }

  async discover(): Promise<AgentIdentity[]> {
    if (!this.client || !this.companyId) {
      return [];
    }
    const agents = await this.client.getAgents(this.companyId);
    return agents.map(mapAgent);
  }

  async collectRuns(since: Date): Promise<RunReport[]> {
    if (!this.client || !this.companyId) {
      return [];
    }

    // Step 1: discover agents to iterate (PCLP-02)
    const agents = await this.client.getAgents(this.companyId);

    // Step 2: collect task sessions for each agent (PCLP-03)
    let allRuns: RunReport[] = [];
    for (const agent of agents) {
      const sessions = await this.client.getTaskSessions(agent.id, since);
      const runs = sessions.map(mapTaskSession);
      allRuns.push(...runs);
    }

    // Step 3: fallback cost enrichment for runs missing costCents (PCLP-04, D-03)
    const runsWithoutCost = allRuns.filter(r => r.costCents == null);
    if (runsWithoutCost.length > 0) {
      try {
        const now = new Date();
        const costs = await this.client.getCostsByAgent(this.companyId, since, now);
        allRuns = enrichWithCosts(allRuns, costs);
      } catch (err) {
        // Cost enrichment is best-effort; don't fail the whole collection
        console.error('Paperclip cost enrichment failed:', (err as Error).message);
      }
    }

    // Step 4: collect activity/audit events (PCLP-05)
    try {
      for (const agent of agents) {
        const activities = await this.client.getActivity(this.companyId, agent.id, since);
        if (activities.length > 0) {
          const activityRuns = mapActivitiesToEvents(activities);
          allRuns.push(...activityRuns);
        }
      }
    } catch (err) {
      // Activity collection is best-effort; don't fail the whole collection
      console.error('Paperclip activity collection failed:', (err as Error).message);
    }

    return allRuns;
  }
}
