/** Relative timestamp per UI-SPEC copywriting contract */
export function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  // Absolute: "MMM D, h:mm a"
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = months[d.getMonth()];
  const day = d.getDate();
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${month} ${day}, ${hours}:${min} ${ampm}`;
}

/** CSS class for delta value color */
export function deltaClass(value: number): string {
  if (value > 0) return 'delta-positive';
  if (value < 0) return 'delta-negative';
  return 'delta-zero';
}

/** Format delta with + prefix for positive values */
export function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}
