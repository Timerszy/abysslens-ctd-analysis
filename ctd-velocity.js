(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ctd-gradient.js'));
  else root.CtdVelocity = factory(root.CtdGradient);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (gradient) {
  'use strict';

  function finiteNumber(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function compute(rows, options = {}) {
    const { depthUnit = 'dbar' } = options;
    const requestedLatitude = finiteNumber(options.latitude);
    const assumedLatitude = requestedLatitude === null || Math.abs(requestedLatitude) > 90;
    const latitude = assumedLatitude ? 45 : requestedLatitude;
    const augmented = rows.map(row => {
      const pressure = finiteNumber(row.pressure);
      let depth = null;
      if (pressure !== null && pressure >= 0) {
        if (depthUnit === 'm') depth = pressure;
        else if (depthUnit === 'dbar') depth = gradient.pressureToDepth(pressure, latitude);
      }
      return { ...row, depth, velocity: null, deltaTime: null };
    });
    const points = [];
    let evaluatedCount = 0;
    let skippedCount = 0;
    // Adjacent samples only: dz/dt is interval-average vertical velocity.
    // Depth is positive down; the velocity belongs to the later sample.
    for (let index = 1; index < augmented.length; index++) {
      const previous = augmented[index - 1];
      const current = augmented[index];
      const previousTime = finiteNumber(previous.time);
      const time = finiteNumber(current.time);
      if (previous.depth === null || current.depth === null || previousTime === null || time === null) {
        skippedCount++;
        continue;
      }
      const deltaTime = (time - previousTime) / 1000;
      if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
        skippedCount++;
        continue;
      }
      const velocity = (current.depth - previous.depth) / deltaTime;
      if (!Number.isFinite(velocity)) {
        skippedCount++;
        continue;
      }
      current.velocity = velocity;
      current.deltaTime = deltaTime;
      points.push(current);
      evaluatedCount++;
    }
    // Counts describe adjacent pairs; the first sample has no preceding pair.
    return { rows: augmented, points, evaluatedCount, skippedCount, latitude, assumedLatitude };
  }

  return { compute };
}));
