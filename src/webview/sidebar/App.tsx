import React, { useEffect, useState } from 'react';
import type { WorkspaceRecord } from '../../types/workspace';
import type { HostToWebviewMessage } from '../../types/messages';
import { WorkspaceList } from './components/WorkspaceList';
import { vscode } from './vscodeApi';

export function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostToWebviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'workspaces:update':
          setWorkspaces(msg.workspaces);
          break;
        case 'workspace:added':
          setWorkspaces(prev => [...prev, msg.workspace]);
          break;
        case 'workspace:removed':
          setWorkspaces(prev => prev.filter(ws => ws.id !== msg.workspaceId));
          if (activeWorkspaceId === msg.workspaceId) setActiveWorkspaceId(null);
          break;
        case 'workspace:statusChanged':
          setWorkspaces(prev =>
            prev.map(ws =>
              ws.id === msg.workspaceId
                ? { ...ws, status: msg.status, runningAgentCount: msg.runningAgentCount, errorCount: msg.errorCount }
                : ws
            )
          );
          break;
        case 'workspace:setActive':
          setActiveWorkspaceId(msg.workspaceId);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (workspaces.length === 0) {
    return (
      <div className="empty-state">
        <p>No workspaces connected</p>
        <button
          className="connect-button"
          onClick={() => vscode.postMessage({ type: 'workspace:connect', name: '', rootPath: '' })}
        >
          Connect Local Workspace
        </button>
        <button
          className="connect-button connect-button-remote"
          onClick={() => vscode.postMessage({ type: 'workspace:addRemote', relayUrl: '', token: '' })}
        >
          Add Remote Workspace
        </button>
      </div>
    );
  }

  return (
    <div>
      <WorkspaceList workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} />
      <div className="connect-section">
        <button
          className="connect-button"
          onClick={() => vscode.postMessage({ type: 'workspace:connect', name: '', rootPath: '' })}
        >
          + Connect Local Workspace
        </button>
        <button
          className="connect-button connect-button-remote"
          onClick={() => vscode.postMessage({ type: 'workspace:addRemote', relayUrl: '', token: '' })}
        >
          + Add Remote Workspace
        </button>
      </div>
    </div>
  );
}
