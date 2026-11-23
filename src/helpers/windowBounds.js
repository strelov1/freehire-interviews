function clampedBounds(bounds, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const x = Math.round(
    Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width))
  );
  const y = Math.round(
    Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height))
  );
  return { x, y, width, height };
}

module.exports = { clampedBounds };
