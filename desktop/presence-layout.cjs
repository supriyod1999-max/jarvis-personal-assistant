// Dimensions include the small transparent shoulder and shadow margins.
const islandSizes = { compact: [252, 56], peek: [368, 112], expanded: [552, 218] };
function presenceBounds(display, mode, presentation, detail = 'regular', panel = 'assistant') {
  const area = mode === 'island' ? display.bounds : display.workArea;
  const size = mode === 'island' ? presentation === 'expanded' ? [552, panel === 'coding' ? 390 : panel === 'unlock' ? 300 : { short: 174, regular: 218, long: 286 }[detail] || 218] : islandSizes[presentation] || islandSizes.compact : [560, 610];
  const width = Math.min(size[0], area.width), height = Math.min(size[1], area.height);
  return { x: Math.round(area.x + (area.width - width) / 2), y: mode === 'island' ? area.y : Math.round(area.y + (area.height - height) / 2), width, height };
}
function springStep(position, velocity, target, seconds) {
  // Substeps keep a delayed native frame stable. Retargeting preserves momentum.
  const steps = Math.max(1, Math.ceil(seconds / .008)), dt = Math.min(seconds, .064) / steps;
  for (let i = 0; i < steps; i++) {
    velocity += ((target - position) * 460 - velocity * 39) * dt;
    position += velocity * dt;
  }
  return { position, velocity };
}
module.exports = { presenceBounds, springStep };
