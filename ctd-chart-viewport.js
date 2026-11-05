(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CtdChartViewport = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function validRange(range) {
    return !!range && Number.isFinite(range.min) && Number.isFinite(range.max)
      && range.max > range.min && Number.isFinite(range.max - range.min);
  }

  function copy(range) { return { min: range.min, max: range.max }; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function minimumSpan(bounds) {
    // Absolute precision matters when small windows use epoch milliseconds.
    const span = bounds.max - bounds.min;
    return Math.min(span, Math.max(span * 1e-6,
      Math.max(Math.abs(bounds.min), Math.abs(bounds.max)) * Number.EPSILON * 4));
  }

  function constrainRange(range, bounds) {
    if (!validRange(bounds)) return null;
    if (!validRange(range)) return copy(bounds);
    const boundSpan = bounds.max - bounds.min;
    const span = Math.max(range.max - range.min, minimumSpan(bounds));
    if (span >= boundSpan) return copy(bounds);
    const centre = range.min + (range.max - range.min) / 2;
    const min = clamp(centre - span / 2, bounds.min, bounds.max - span);
    return { min, max: Math.min(bounds.max, min + span) };
  }

  function zoomRange(range, factor, anchorFraction = 0.5, bounds = range) {
    if (!validRange(bounds)) return null;
    if (!validRange(range)) return copy(bounds);
    const current = constrainRange(range, bounds);
    if (!Number.isFinite(factor) || factor <= 0) return current;
    const anchor = Number.isFinite(anchorFraction) ? clamp(anchorFraction, 0, 1) : 0.5;
    const currentSpan = current.max - current.min;
    const span = clamp(currentSpan * factor, minimumSpan(bounds), bounds.max - bounds.min);
    const value = current.min + currentSpan * anchor;
    return constrainRange({ min: value - span * anchor, max: value + span * (1 - anchor) }, bounds);
  }

  function panRange(range, delta, bounds) {
    if (!validRange(bounds)) return null;
    if (!validRange(range)) return copy(bounds);
    const current = constrainRange(range, bounds);
    if (!Number.isFinite(delta)) return current;
    const span = current.max - current.min;
    // Clamp the left edge before adding the span so even extreme drags stay finite.
    const min = clamp(current.min + delta, bounds.min, bounds.max - span);
    return { min, max: Math.min(bounds.max, min + span) };
  }

  function selectRange(range, startFraction, endFraction, bounds = range) {
    if (!validRange(range) || !validRange(bounds)
      || !Number.isFinite(startFraction) || !Number.isFinite(endFraction)) return null;
    const start = clamp(Math.min(startFraction, endFraction), 0, 1);
    const end = clamp(Math.max(startFraction, endFraction), 0, 1);
    if (end - start < 0.01) return null;
    const span = range.max - range.min;
    return constrainRange({ min: range.min + span * start, max: range.min + span * end }, bounds);
  }

  return { zoomRange, panRange, selectRange, constrainRange };
}));
