type Anchor = { x: number; y: number; width: number; height: number };
type Screen = { width: number; height: number };

export function popoverLayout(anchor: Anchor, screen: Screen, contentHeight: number) {
  const margin = 8;
  const gap = 8;
  const width = Math.max(0, Math.min(288, screen.width - margin * 2));
  const above = Math.max(0, anchor.y - gap - margin);
  const below = Math.max(0, screen.height - anchor.y - anchor.height - gap - margin);
  const opensAbove = above >= contentHeight || above >= below;
  const maxHeight = Math.min(screen.height - margin * 2, opensAbove ? above : below);
  const height = Math.min(contentHeight, maxHeight);
  return {
    width,
    maxHeight,
    left: Math.max(margin, Math.min(anchor.x, screen.width - width - margin)),
    top: Math.max(margin, Math.min(opensAbove ? anchor.y - gap - height : anchor.y + anchor.height + gap, screen.height - height - margin)),
  };
}
