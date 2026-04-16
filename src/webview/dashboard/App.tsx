import React, { useEffect, useState } from 'react';
import type { AgentSession, AgentEvent } from '../../types/agent';
import type { HostToWebviewMessage } from '../../types/messages';
import vscode from './vscodeApi';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { SummaryBar } from './components/SummaryBar';
import { AgentCard } from './components/AgentCard';
import { AgentDetailPanel } from './components/AgentDetailPanel';

interface SummaryData {
  totalAgents: number;
  running: number;
  paused: number;
  errors: number;
  estimatedCost: number;
}

interface PersistedState {
  activeWorkspaceId: string | null;
  selectedSessionId: string | null;
}

function restoreState(): PersistedState {
  const saved = vscode.getState() as PersistedState | null;
  return {
    activeWorkspaceId: saved?.activeWorkspaceId ?? null,
    selectedSessionId: saved?.selectedSessionId ?? null,
  };
}

export default function App(): React.ReactElement {
  const initial = restoreState();
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(initial.activeWorkspaceId);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initial.selectedSessionId);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [summaries, setSummaries] = useState<Map<string, SummaryData>>(new Map());

  // Persist state on every change
  useEffect(() => {
    vscode.setState({ activeWorkspaceId, selectedSessionId } satisfies PersistedState);
  }, [activeWorkspaceId, selectedSessionId]);

  // Request initial state from host
  useEffect(() => {
    vscode.postMessage({ type: 'dashboard:requestState' });
  }, []);

  // Listen for host messages
  useEffect(() => {
    function handler(event: MessageEvent) {
      const msg = event.data as HostToWebviewMessage;
      switch (msg.type) {
        case 'dashboard:agentEvents':
          setEvents(prev => {
            // Merge new events, deduplicate by id, keep last 200
            const existing = new Map(prev.map(e => [e.id, e]));
            for (const ev of msg.events) {
              existing.set(ev.id, ev);
            }
            const merged = Array.from(existing.values());
            merged.sort((a, b) => a.timestamp - b.timestamp);
            return merged.slice(-200);
          });
          break;

        case 'dashboard:agentUpdate':
          setSessions(prev => {
            const idx = prev.findIndex(s => s.sessionId === msg.session.sessionId);
            if (idx === -1) {
              return [...prev, msg.session];
            }
            const next = [...prev];
            next[idx] = msg.session;
            return next;
          });
          break;

        case 'dashboard:summary':
          setSummaries(prev => {
            const next = new Map(prev);
            next.set(msg.workspaceId, {
              totalAgents: msg.totalAgents,
              running: msg.running,
              paused: msg.paused,
              errors: msg.errors,
              estimatedCost: msg.estimatedCost,
            });
            return next;
          });
          break;
      }
    }

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Derive workspace list from sessions
  const workspaceMap = new Map<string, number>();
  for (const s of sessions) {
    workspaceMap.set(s.workspaceId, (workspaceMap.get(s.workspaceId) ?? 0) + 1);
  }
  const workspaces = Array.from(workspaceMap.entries()).map(([id, count]) => ({
    id,
    name: id,
    agentCount: count,
  }));

  // Filter sessions by active workspace
  const filteredSessions =
    activeWorkspaceId === null
      ? sessions
      : sessions.filter(s => s.workspaceId === activeWorkspaceId);

  // Compute aggregate summary for current view
  const aggregateSummary: SummaryData = (() => {
    if (activeWorkspaceId !== null && summaries.has(activeWorkspaceId)) {
      return summaries.get(activeWorkspaceId)!;
    }
    // Aggregate across all workspaces
    let totalAgents = 0, running = 0, paused = 0, errors = 0;
    for (const s of filteredSessions) {
      totalAgents++;
      if (s.controlState === 'running') running++;
      if (s.controlState === 'paused') paused++;
    }
    // Sum errors from summaries (if available) or leave at 0
    for (const [, sd] of summaries) {
      errors += sd.errors;
    }
    return { totalAgents, running, paused, errors, estimatedCost: 0 };
  })();

  // Selected session and its events
  const selectedSession = filteredSessions.find(s => s.sessionId === selectedSessionId) ?? null;
  const selectedEvents = selectedSession
    ? events.filter(e => e.sessionId === selectedSession.sessionId)
    : [];

  const handleSelectWorkspace = (id: string | null) => {
    setActiveWorkspaceId(id);
    setSelectedSessionId(null);
  };

  return (
    <div className="dashboard">
      <WorkspaceTabs
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={handleSelectWorkspace}
      />
      <SummaryBar
        totalAgents={aggregateSummary.totalAgents}
        running={aggregateSummary.running}
        paused={aggregateSummary.paused}
        errors={aggregateSummary.errors}
      />
      <div className="master-detail">
        <div className="agent-list" role="listbox" aria-label="Agent list">
          {filteredSessions.length === 0 ? (
            <div className="empty-state">
              <h2>No agents running</h2>
              <p>Start a Claude Code session in a connected workspace to see agents here.</p>
            </div>
          ) : (
            filteredSessions.map(s => (
              <AgentCard
                key={s.sessionId}
                session={s}
                recentEvent={events.filter(e => e.sessionId === s.sessionId).at(-1)}
                isSelected={s.sessionId === selectedSessionId}
                onSelect={(id) => setSelectedSessionId(prev => prev === id ? null : id)}
              />
            ))
          )}
        </div>
        <AgentDetailPanel session={selectedSession} events={selectedEvents} />
      </div>
    </div>
  );
}
