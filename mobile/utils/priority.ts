const PRIORITY_COLORS: Record<string, string> = {
  low: '#888',
  medium: '#7B6EF6',
  high: '#FFA500',
  urgent: '#FF4444',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export function priorityColor(p: string): string {
  return PRIORITY_COLORS[p] ?? '#888';
}

export function priorityLabel(p: string): string {
  return PRIORITY_LABELS[p] ?? 'Medium';
}
