import type { FleetWorkspaceSummary, FleetWorkspaceDetail, FleetAgentDetail } from '../types/fleet.js';

export interface FleetDataProvider {
  getWorkspaceSummaries(days: number): Promise<FleetWorkspaceSummary[]>;
  getWorkspaceDetail(workspaceId: string, days: number): Promise<FleetWorkspaceDetail>;
  getAgentDetail(workspaceId: string, agentId: string, days: number): Promise<FleetAgentDetail>;
}
