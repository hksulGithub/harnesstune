import React, { useEffect, useState, useCallback } from 'react';
import type { TopologyState } from '../../types/topology';
import type { AgentSession, AgentEvent } from '../../types/agent';
import type { HostToWebviewMessage } from '../../types/messages';
import vscode from './vscodeApi';
import { Toolbar } from './components/Toolbar';
import { GraphArea } from './components/GraphArea';
import { AgentDetailPanel } from '../shared/components/AgentDetailPanel';

interface PersistedState {
  workspaceFilter: string | null;
  selectedNodeId: string | null;
  viewTransform: { x: number; y: number; scale: number };
}

interface WorkspaceEntry {
  id: string;
  name: string;
}

const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1.0 };
const DEFAULT_TOPOLOGY: TopologyState = { nodes: [], edges: [] };

function restorePersistedState(): PersistedState {
  try {
    const raw = vscode.getState() as PersistedState | null;
    if (raw && typeof raw === 'object') {
      return raw as PersistedState;
    }
  } catch {
    // silent — show empty graph, state restore failure is not an error condition
  }
  return { workspaceFilter: null, selectedNodeId: null, viewTransform: DEFAULT_TRANSFORM };
}

export default function App(): React.ReactElement {
  const persisted = restorePersistedState();

  const [topologyState, setTopologyState] = useState<TopologyState>(DEFAULT_TOPOLOGY);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(persisted.selectedNodeId);
  const [selectedSession, setSelectedSession] = useState<AgentSession | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<AgentEvent[]>([]);
  const [viewTransform, setViewTransform] = useState<{ x: number; y: number; scale: number }>(
    persisted.viewTransform ?? DEFAULT_TRANSFORM,
  );
  const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(persisted.workspaceFilter);
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [fitToViewCounter, setFitToViewCounter] = useState(0);

  // Persist relevant state on changes
  useEffect(() => {
    const state: PersistedState = { workspaceFilter, selectedNodeId, viewTransform };
    vscode.setState(state);
  }, [workspaceFilter, selectedNodeId, viewTransform]);

  // Message listener for host → webview messages
  useEffect(() => {
    function handleMessage(event: MessageEvent): void {
      const msg = event.data as HostToWebviewMessage;
      switch (msg.type) {
        case 'schematic:topologyUpdate':
          setTopologyState(msg.state);
          break;
        case 'schematic:nodeUpdate': {
          const updated = msg.node;
          setTopologyState(prev => ({
            nodes: prev.nodes.map(n => n.sessionId === updated.sessionId ? updated : n),
            edges: prev.edges,
          }));
          break;
        }
        case 'schematic:nodeDetail':
          // Response to schematic:selectNode — carries session and event history for clicked node
          setSelectedSession(msg.session);
          setSelectedEvents(msg.events);
          break;
        case 'workspaces:update': {
          const ws = msg.workspaces.map(w => ({ id: w.id, name: w.name }));
          setWorkspaces(ws);
          break;
        }
        default:
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Request full topology state on mount
  useEffect(() => {
    vscode.postMessage({ type: 'schematic:requestState' });
  }, []);

  // When a node is selected, request its detail from the host
  const handleSelectNode = useCallback((sessionId: string | null) => {
    setSelectedNodeId(sessionId);
    if (sessionId !== null) {
      vscode.postMessage({ type: 'schematic:selectNode', sessionId });
    } else {
      // Deselected — clear detail panel
      setSelectedSession(null);
      setSelectedEvents([]);
    }
  }, []);

  const handleViewTransformChange = useCallback(
    (transform: { x: number; y: number; scale: number }) => {
      setViewTransform(transform);
    },
    [],
  );

  const handleFitToView = useCallback(() => {
    setFitToViewCounter(c => c + 1);
  }, []);

  const handleZoomIn = useCallback(() => {
    setViewTransform(t => ({ ...t, scale: Math.min(3.0, +(t.scale * 1.1).toFixed(4)) }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewTransform(t => ({ ...t, scale: Math.max(0.2, +(t.scale / 1.1).toFixed(4)) }));
  }, []);

  // Filter nodes/edges by workspace when a workspace is selected
  const filteredTopology: TopologyState = workspaceFilter
    ? {
        nodes: topologyState.nodes.filter(n => n.workspaceId === workspaceFilter),
        edges: topologyState.edges.filter(e => {
          const src = topologyState.nodes.find(n => n.sessionId === e.sourceSessionId);
          return src?.workspaceId === workspaceFilter;
        }),
      }
    : topologyState;

  return (
    <div className="schematic-root">
      <Toolbar
        scale={viewTransform.scale}
        onFitToView={handleFitToView}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        workspaceFilter={workspaceFilter}
        workspaces={workspaces}
        onWorkspaceChange={setWorkspaceFilter}
      />
      <div className="schematic-body">
        <GraphArea
          topology={filteredTopology}
          selectedNodeId={selectedNodeId}
          viewTransform={viewTransform}
          fitToViewCounter={fitToViewCounter}
          onSelectNode={handleSelectNode}
          onViewTransformChange={handleViewTransformChange}
        />
        {selectedNodeId !== null && (
          <div className="schematic-detail" role="region" aria-label="Agent details">
            <AgentDetailPanel
              session={selectedSession}
              events={selectedEvents}
              showControls={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
