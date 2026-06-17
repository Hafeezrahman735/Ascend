// tagColor uses the original hash algorithm so existing tag color assignments are preserved.
// Do NOT delegate to getTagColor — it uses a different algorithm that produces different indices.
const COLOR_PALETTE = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#6C5CE7', '#A8E6CF', '#FF8A5C', '#3DC1D3', '#E77F67', '#786FA6', '#F19066'];

function originalHash(tag: string): number {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export function tagColor(tag: string): string {
  return COLOR_PALETTE[originalHash(tag) % COLOR_PALETTE.length];
}
