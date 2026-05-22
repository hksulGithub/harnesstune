import * as vscode from 'vscode';
import { StatusBarManager } from '../../src/statusbar/StatusBarManager';

type WorkspaceShape = {
  runningAgentCount: number;
  errorCount: number;
};

function createRegistry(workspaces: WorkspaceShape[]) {
  return {
    getAll: jest.fn(() => workspaces),
    onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
  };
}

describe('StatusBarManager', () => {
  beforeEach(() => {
    (vscode as unknown as { __resetStatusBarItems: () => void }).__resetStatusBarItems();
  });

  function getItem() {
    const items = (vscode as unknown as { __getStatusBarItems: () => unknown[] }).__getStatusBarItems();
    expect(items).toHaveLength(1);
    return items[0] as {
      text: string;
      command: string;
      tooltip: string;
      backgroundColor?: { id: string };
      show: jest.Mock;
      dispose: jest.Mock;
    };
  }

  it('shows running agents without warning background when there are no issues', () => {
    const manager = new StatusBarManager(createRegistry([
      { runningAgentCount: 2, errorCount: 0 },
      { runningAgentCount: 1, errorCount: 0 },
    ]) as any);

    const item = getItem();
    expect(item.text).toBe('$(pulse) HT: 3 running');
    expect(item.command).toBe('harnesstune.showDashboard');
    expect(item.backgroundColor).toBeUndefined();
    expect(item.show).toHaveBeenCalledTimes(1);

    manager.dispose();
    expect(item.dispose).toHaveBeenCalledTimes(1);
  });

  it('adds warning background for workspace errors', () => {
    new StatusBarManager(createRegistry([
      { runningAgentCount: 0, errorCount: 2 },
    ]) as any);

    const item = getItem();
    expect(item.text).toBe('$(pulse) HT: 0 running $(error) 2');
    expect(item.backgroundColor?.id).toBe('statusBarItem.warningBackground');
  });

  it('shows and clears the alert badge', () => {
    const manager = new StatusBarManager(createRegistry([
      { runningAgentCount: 1, errorCount: 0 },
    ]) as any);

    const item = getItem();
    manager.setAlertCount(3);

    expect(item.text).toBe('$(pulse) HT: 1 running $(bell) 3');
    expect(item.backgroundColor?.id).toBe('statusBarItem.warningBackground');

    manager.clearAlertBadge();

    expect(item.text).toBe('$(pulse) HT: 1 running');
    expect(item.backgroundColor).toBeUndefined();
  });
});
