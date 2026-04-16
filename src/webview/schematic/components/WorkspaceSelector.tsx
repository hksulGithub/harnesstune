import React from 'react';

interface WorkspaceEntry {
  id: string;
  name: string;
}

interface WorkspaceSelectorProps {
  workspaces: WorkspaceEntry[];
  value: string | null;
  onChange: (workspaceId: string | null) => void;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

export function WorkspaceSelector({
  workspaces,
  value,
  onChange,
}: WorkspaceSelectorProps): React.ReactElement {
  return (
    <select
      className="workspace-select"
      aria-label="Filter by workspace"
      value={value ?? ''}
      onChange={e => {
        const v = e.target.value;
        onChange(v === '' ? null : v);
      }}
    >
      <option value="">All workspaces</option>
      {workspaces.map(ws => (
        <option key={ws.id} value={ws.id}>
          {truncate(ws.name, 20)}
        </option>
      ))}
    </select>
  );
}
