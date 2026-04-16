import * as vscode from 'vscode';
import type { AgentSession, AgentControlState } from '../types/agent';

export class AgentControlManager implements vscode.Disposable {
  private sessions = new Map<string, AgentSession>();
  private readonly _onDidChangeSession = new vscode.EventEmitter<AgentSession>();
  public readonly onDidChangeSession = this._onDidChangeSession.event;

  registerSession(sessionId: string, workspaceId: string, model?: string, agentRole?: string): AgentSession {
    const session: AgentSession = {
      sessionId,
      workspaceId,
      controlState: 'running',
      startedAt: Date.now(),
      model,
      agentRole,
    };
    this.sessions.set(sessionId, session);
    this._onDidChangeSession.fire(session);
    return session;
  }

  unregisterSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (session) {
      const stoppedSession: AgentSession = { ...session, controlState: 'stopped' };
      this._onDidChangeSession.fire(stoppedSession);
    }
  }

  pauseAgent(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.controlState === 'paused') {
      throw new Error(`Session already paused: ${sessionId}`);
    }
    session.controlState = 'paused';
    session.pausedAt = Date.now();
    this._onDidChangeSession.fire({ ...session });
  }

  resumeAgent(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.controlState !== 'paused') {
      throw new Error(`Session is not paused: ${sessionId} (state: ${session.controlState})`);
    }
    session.controlState = 'running';
    delete session.pausedAt;
    this._onDidChangeSession.fire({ ...session });
  }

  stopAgent(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.pid && session.pid > 0) {
      try {
        process.kill(session.pid, 0); // check alive
        process.kill(session.pid, 'SIGTERM');
      } catch {
        // process already dead — that's fine
      }
    }

    session.controlState = 'stopping';
    this._onDidChangeSession.fire({ ...session });
  }

  isPaused(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.controlState === 'paused';
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  getSessionsForWorkspace(workspaceId: string): AgentSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.workspaceId === workspaceId
    );
  }

  updateSessionPid(sessionId: string, pid: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.pid = pid;
  }

  dispose(): void {
    this.sessions.clear();
    this._onDidChangeSession.dispose();
  }
}
