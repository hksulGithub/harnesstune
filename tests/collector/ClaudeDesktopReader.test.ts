import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readSessionFile,
  scanSessions,
} from '../../packages/harnesstune-collector/src/plugins/claude-desktop/reader';
import { resolveClaudeDesktopTranscriptPath } from '../../packages/harnesstune-collector/src/summaries/desktop-transcript';

describe('ClaudeDesktopReader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-desktop-reader-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('readSessionFile + resolveClaudeDesktopTranscriptPath', () => {
    it('attaches sessionPath and transcriptPath when transcript companion exists', () => {
      const sessionPath = path.join(tmpDir, 'local_abc.json');
      const transcriptPath = path.join(tmpDir, 'local_abc.md');
      fs.writeFileSync(
        sessionPath,
        JSON.stringify({
          sessionId: 'abc',
          scheduledTaskId: 'task-1',
          createdAt: 1,
          lastActivityAt: 2,
          isArchived: false,
          title: 'Test',
          model: 'claude-sonnet-4',
        }),
      );
      fs.writeFileSync(transcriptPath, '# transcript');

      const session = readSessionFile(sessionPath);

      expect(session).not.toBeNull();
      expect(session!.sessionPath).toBe(sessionPath);
      expect(session!.transcriptPath).toBe(transcriptPath);
    });

    it('returns transcriptPath null when no .md companion exists', () => {
      const sessionPath = path.join(tmpDir, 'local_xyz.json');
      fs.writeFileSync(
        sessionPath,
        JSON.stringify({
          sessionId: 'xyz',
          scheduledTaskId: 'task-2',
          createdAt: 1,
          lastActivityAt: 2,
          isArchived: false,
          title: 'Test',
          model: 'claude-sonnet-4',
        }),
      );

      const session = readSessionFile(sessionPath);

      expect(session).not.toBeNull();
      expect(session!.sessionPath).toBe(sessionPath);
      expect(session!.transcriptPath).toBeNull();
    });
  });

  describe('readSessionFile runtime guard', () => {
    it('returns null for an empty JSON object payload', () => {
      const sessionPath = path.join(tmpDir, 'local_bad.json');
      fs.writeFileSync(sessionPath, '{}');

      expect(readSessionFile(sessionPath)).toBeNull();
    });

    it('returns null for a truncated JSON payload', () => {
      const sessionPath = path.join(tmpDir, 'local_truncated.json');
      fs.writeFileSync(sessionPath, '{"sessionId":');

      expect(readSessionFile(sessionPath)).toBeNull();
    });

    it('returns null when sessionId is missing', () => {
      const sessionPath = path.join(tmpDir, 'local_nosid.json');
      fs.writeFileSync(
        sessionPath,
        JSON.stringify({ lastActivityAt: 5, isArchived: false, title: '', model: 'm', createdAt: 1 }),
      );

      expect(readSessionFile(sessionPath)).toBeNull();
    });

    it('returns null when lastActivityAt is not a number', () => {
      const sessionPath = path.join(tmpDir, 'local_noactivity.json');
      fs.writeFileSync(
        sessionPath,
        JSON.stringify({ sessionId: 'a', isArchived: false, title: '', model: 'm', createdAt: 1 }),
      );

      expect(readSessionFile(sessionPath)).toBeNull();
    });
  });

  describe('resolveClaudeDesktopTranscriptPath', () => {
    it('returns null for non-.json input even if a sibling .md exists', () => {
      // No transformation should occur for non-JSON inputs.
      expect(resolveClaudeDesktopTranscriptPath('/tmp/something.txt')).toBeNull();
    });
  });

  describe('scanSessions boundary semantics', () => {
    function writeSession(name: string, body: object, mtimeMs: number) {
      const p = path.join(tmpDir, name);
      fs.writeFileSync(p, JSON.stringify(body));
      fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
      return p;
    }

    it('includes a session whose mtime and lastActivityAt equal sinceMs (boundary inclusive on the data side)', () => {
      // Per the collector contract (claude-code stub uses `mtime < sinceMs`),
      // boundary items are kept. Old, non-stale (>30s ago) lastActivityAt.
      const boundaryMs = Date.now() - 60_000;
      writeSession(
        'local_boundary.json',
        {
          sessionId: 'boundary',
          scheduledTaskId: 'task-b',
          createdAt: boundaryMs - 1000,
          lastActivityAt: boundaryMs,
          isArchived: false,
          title: 'Boundary',
          model: 'claude-sonnet-4',
        },
        boundaryMs,
      );

      const results = scanSessions(tmpDir, new Date(boundaryMs));

      expect(results.map((r) => r.sessionId)).toEqual(['boundary']);
    });

    it('excludes a session whose lastActivityAt is strictly before sinceMs', () => {
      const sinceMs = Date.now() - 30_000;
      const olderMs = sinceMs - 60_000;
      writeSession(
        'local_old.json',
        {
          sessionId: 'old',
          scheduledTaskId: 'task-o',
          createdAt: olderMs - 1000,
          lastActivityAt: olderMs,
          isArchived: false,
          title: 'Old',
          model: 'claude-sonnet-4',
        },
        olderMs,
      );

      const results = scanSessions(tmpDir, new Date(sinceMs));

      expect(results).toEqual([]);
    });

    it('excludes sessions without a scheduledTaskId', () => {
      const ms = Date.now() - 60_000;
      writeSession(
        'local_unscheduled.json',
        {
          sessionId: 'unscheduled',
          createdAt: ms - 1000,
          lastActivityAt: ms,
          isArchived: false,
          title: 'Manual',
          model: 'claude-sonnet-4',
        },
        ms,
      );

      const results = scanSessions(tmpDir, new Date(0));

      expect(results).toEqual([]);
    });

    it('excludes sessions still within the staleness guard window', () => {
      const veryRecent = Date.now() - 5_000;
      writeSession(
        'local_running.json',
        {
          sessionId: 'running',
          scheduledTaskId: 'task-r',
          createdAt: veryRecent - 1000,
          lastActivityAt: veryRecent,
          isArchived: false,
          title: 'Running',
          model: 'claude-sonnet-4',
        },
        veryRecent,
      );

      const results = scanSessions(tmpDir, new Date(0));

      expect(results).toEqual([]);
    });
  });
});
