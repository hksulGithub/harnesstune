import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

export class HookServer extends EventEmitter {
  private server: http.Server;
  private token: string;
  private port: number | undefined;
  private pauseChecker: ((sessionId: string) => boolean) | undefined;

  constructor(private readonly storageUri: { fsPath: string }) {
    super();
    this.token = crypto.randomBytes(16).toString('hex');
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address();
        if (!addr || typeof addr === 'string') {
          return reject(new Error('Failed to get server address'));
        }
        this.port = addr.port;
        // Write port file for discovery
        const portFile = path.join(this.storageUri.fsPath, 'hook-server.port');
        fs.writeFileSync(portFile, String(this.port), 'utf8');
        resolve(this.port);
      });
      this.server.on('error', reject);
    });
  }

  get hookUrl(): string {
    return `http://127.0.0.1:${this.port}/hook?token=${this.token}`;
  }

  setPauseChecker(fn: (sessionId: string) => boolean): void {
    this.pauseChecker = fn;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Validate token
    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.searchParams.get('token') !== this.token) {
      res.writeHead(401).end();
      return;
    }

    // Buffer full body first — body is <10KB, sub-millisecond
    // Must read before responding so PreToolUse pause gate can inspect event type
    let body = '';
    req.on('data', (chunk: Buffer | string) => { body += chunk; });
    req.on('end', () => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        // Ignore malformed payloads — do not crash
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ continue: true }));
        return;
      }

      // PreToolUse pause gate (CTRL-01/CTRL-02 critical path)
      if (payload.event === 'PreToolUse' && this.pauseChecker) {
        const sessionId = payload.session_id as string;
        if (this.pauseChecker(sessionId)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: 'Agent paused by HarnessTune operator',
            },
          }));
          // Do NOT emit hookEvent for denied PreToolUse
          return;
        }
      }

      // All other events (or PreToolUse when NOT paused): respond 200 {"continue": true}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ continue: true }));

      // Emit hookEvent with parsed payload for downstream processing
      this.emit('hookEvent', payload);
    });
  }

  dispose(): void {
    this.server.close();
  }
}
