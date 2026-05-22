import type { AlertCycleSummary } from '../types/alerts.js';

export function formatAlertWarningMessage(summary: AlertCycleSummary): string | null {
  if (summary.problems.length === 0) {
    return null;
  }

  const failingCount = summary.problems.filter(t => t.currentState === 'failing').length;
  const staleCount = summary.problems.filter(t => t.currentState === 'stale').length;
  const degradedCount = summary.problems.filter(t => t.currentState === 'degraded').length;

  const parts: string[] = [];
  if (failingCount > 0) { parts.push(`${failingCount} failing`); }
  if (staleCount > 0) { parts.push(`${staleCount} stale`); }
  if (degradedCount > 0) { parts.push(`${degradedCount} degraded`); }

  const total = summary.problems.length;
  return `${total} agent${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} attention: ${parts.join(', ')}`;
}
