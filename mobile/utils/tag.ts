export function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#6C5CE7', '#A8E6CF', '#FF8A5C', '#3DC1D3', '#E77F67', '#786FA6', '#F19066'];
  return colors[Math.abs(hash) % colors.length];
}
