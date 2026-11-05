(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CtdGradient = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function finiteNumber(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function resolveLatitude(value) {
    const latitude = finiteNumber(value);
    return latitude !== null && Math.abs(latitude) <= 90
      ? { latitude, assumedLatitude: false }
      : { latitude: 45, assumedLatitude: true };
  }

  // UNESCO Technical Papers in Marine Science 44 (1983), pressure-to-depth.
  // Input is sea (gauge) pressure in dbar; output is metres, positive down.
  function pressureToDepth(pressure, latitude) {
    const p = finiteNumber(pressure);
    if (p === null || p < 0) return null;
    const lat = resolveLatitude(latitude).latitude;
    const sinLatitude = Math.sin(lat * Math.PI / 180);
    const x = sinLatitude * sinLatitude;
    const gravity = 9.780318 * (1 + (5.2788e-3 + 2.36e-5 * x) * x) + 1.092e-6 * p;
    const depth = (((-1.82e-15 * p + 2.279e-10) * p - 2.2512e-5) * p + 9.72659) * p / gravity;
    return Number.isFinite(depth) && depth >= 0 ? depth : null;
  }

  function compute(rows, options = {}) {
    const { depthUnit = 'dbar' } = options;
    const latitudeInfo = resolveLatitude(options.latitude);
    const requestedThreshold = finiteNumber(options.threshold);
    const threshold = requestedThreshold !== null && requestedThreshold > 0 ? requestedThreshold : 0.05;
    const augmented = rows.map(row => {
      const pressure = finiteNumber(row.pressure);
      let depth = null;
      if (pressure !== null && pressure >= 0) {
        if (depthUnit === 'm') depth = pressure;
        else if (depthUnit === 'dbar') depth = pressureToDepth(pressure, latitudeInfo.latitude);
      }
      return { ...row, depth, gradient: null, flagged: false };
    });
    const flagged = [];
    let evaluatedCount = 0;
    let skippedCount = 0;
    // Preserve acquisition/time order: sorting by depth would join separate casts.
    for (let index = 1; index < augmented.length; index++) {
      const previous = augmented[index - 1];
      const current = augmented[index];
      const previousSalinity = finiteNumber(previous.salinity);
      const salinity = finiteNumber(current.salinity);
      if (previous.depth === null || current.depth === null || previousSalinity === null || salinity === null) {
        skippedCount++;
        continue;
      }
      const deltaDepth = current.depth - previous.depth;
      if (Math.abs(deltaDepth) <= 1e-9) {
        skippedCount++;
        continue;
      }
      const deltaSalinity = salinity - previousSalinity;
      const gradient = deltaSalinity / deltaDepth;
      if (!Number.isFinite(gradient)) {
        skippedCount++;
        continue;
      }
      current.gradient = gradient;
      // Avoid marking exact-threshold pairs due solely to subtraction roundoff.
      // This is a floating-point allowance, not a measurement/noise tolerance.
      const roundingAllowance = 8 * Number.EPSILON * (
        Math.abs(salinity) + Math.abs(previousSalinity) +
        threshold * (Math.abs(current.depth) + Math.abs(previous.depth))
      );
      current.flagged = Math.abs(deltaSalinity) > threshold * Math.abs(deltaDepth) + roundingAllowance;
      if (current.flagged) flagged.push(current);
      evaluatedCount++;
    }
    // Counts describe adjacent pairs; the initial point has no preceding pair.
    return { rows: augmented, flagged, evaluatedCount, skippedCount, ...latitudeInfo, threshold };
  }

  function computeLevel(rows, options = {}) {
    const result = compute(rows, options);
    // Level files mix acquisition states with a separately saved peak summary.
    // Keep excluded rows in place so no gradient spans a barrier.
    for (let index = 1; index < result.rows.length; index++) {
      const previous = result.rows[index - 1];
      const current = result.rows[index];
      const knownState = current.label === '漂浮数据' || current.label === '上浮数据';
      if (!knownState || previous.label !== current.label ||
          !Number.isFinite(previous.time) || !Number.isFinite(current.time) ||
          current.time <= previous.time) {
        if (current.gradient !== null) {
          result.evaluatedCount--;
          result.skippedCount++;
        }
        current.gradient = null;
        current.flagged = false;
      }
    }
    result.flagged = result.rows.filter(row => row.flagged);
    return result;
  }

  return { compute, computeLevel, pressureToDepth };
}));
