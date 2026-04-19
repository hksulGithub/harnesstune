import React, { useEffect, useState } from 'react';
import type { WorkspaceRecord } from '../../types/workspace';
import type { HostToWebviewMessage } from '../../types/messages';
import { WorkspaceList } from './components/WorkspaceList';
import { vscode } from './vscodeApi';

export function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);

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
          Connect Workspace
        </button>
      </div>
    );
  }

  return (
    <div>
      <WorkspaceList workspaces={workspaces} />
      <div className="connect-section">
        <button
          className="connect-button"
          onClick={() => vscode.postMessage({ type: 'workspace:connect', name: '', rootPath: '' })}
        >
          + Connect Workspace
        </button>
      </div>
    </div>
  );
}
