import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PluginCursors } from './scheduler.js';

export function loadCursors(path: string): PluginCursors {
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    const cursors: PluginCursors = {};

    for (const [pluginId, value] of Object.entries(parsed)) {
      const cursor = new Date(value);
      if (!Number.isNaN(cursor.getTime())) {
        cursors[pluginId] = cursor;
      }
    }

    return cursors;
  } catch {
    return {};
  }
}

export function saveCursors(path: string, cursors: PluginCursors): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const serialized = Object.fromEntries(
      Object.entries(cursors).map(([pluginId, cursor]) => [pluginId, cursor.toISOString()]),
    );
    writeFileSync(path, JSON.stringify(serialized, null, 2));
  } catch (error) {
    console.warn('Failed to save cursors:', error);
  }
}
