(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ctd-data.js'));
  else root.CtdMot = factory(root.CtdData);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (data) {
  'use strict';

  function range(values) {
    return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function analyze(records) {
    const rows = [];
    const sourceStats = [];
    let observedTargetChanges = 0;

    for (const record of records || []) {
      const dataset = record && record.dataset;
      if (!dataset || !Array.isArray(dataset.headers) || !Array.isArray(dataset.rows)) continue;
      const headers = dataset.headers;
      const timeIndex = headers.indexOf('北京时间');
      const positionIndex = headers.indexOf('浮力电机当前位置');
      const targetIndex = headers.indexOf('浮力电机目标位置');
      const source = record.relativePath || record.name || '';
      const sourceRows = dataset.rows.map((values, index) => {
        const raw = timeIndex >= 0 && values[timeIndex] != null ? String(values[timeIndex]) : '';
        const position = positionIndex >= 0 ? data.number(values[positionIndex]) : null;
        const target = targetIndex >= 0 ? data.number(values[targetIndex]) : null;
        return {
          source,
          index,
          time: data.parseTime(raw),
          timeRaw: raw,
          position,
          target,
          error: position !== null && target !== null ? position - target : null,
          gapBefore: false,
          gapSeconds: null
        };
      });

      const positiveSteps = [];
      let maxGapSeconds = null;
      for (let index = 1; index < sourceRows.length; index++) {
        const previous = sourceRows[index - 1];
        const current = sourceRows[index];
        if (previous.target !== null && current.target !== null && previous.target !== current.target) {
          observedTargetChanges++;
        }
        if (previous.time === null || current.time === null) continue;
        const seconds = (current.time - previous.time) / 1000;
        if (!Number.isFinite(seconds) || seconds <= 0) continue;
        positiveSteps.push(seconds);
        if (maxGapSeconds === null || seconds > maxGapSeconds) maxGapSeconds = seconds;
      }
      const medianStepSeconds = median(positiveSteps);
      const gapThresholdSeconds = Math.max(60, medianStepSeconds === null ? 60 : medianStepSeconds * 5);
      let gapCount = 0;
      for (let index = 1; index < sourceRows.length; index++) {
        const previous = sourceRows[index - 1];
        const current = sourceRows[index];
        if (previous.time === null || current.time === null) continue;
        const seconds = (current.time - previous.time) / 1000;
        if (Number.isFinite(seconds) && seconds > gapThresholdSeconds) {
          current.gapBefore = true;
          current.gapSeconds = seconds;
          gapCount++;
        }
      }
      rows.push(...sourceRows);
      sourceStats.push({
        source,
        rowCount: sourceRows.length,
        medianStepSeconds,
        gapThresholdSeconds,
        maxGapSeconds,
        gapCount
      });
    }

    const currentValues = rows.filter(row => row.position !== null).map(row => row.position);
    const targetValues = rows.filter(row => row.target !== null).map(row => row.target);
    const errors = rows.filter(row => row.error !== null).map(row => Math.abs(row.error));
    const lastUsableRow = rows.reduce((last, row) => row.position !== null || row.target !== null ? row : last, null);
    const positiveGaps = sourceStats.filter(source => source.maxGapSeconds !== null).map(source => source.maxGapSeconds);
    const stats = {
      rowCount: rows.length,
      timedCount: rows.filter(row => row.time !== null).length,
      currentRange: range(currentValues),
      targetRange: range(targetValues),
      maxAbsError: errors.length ? Math.max(...errors) : null,
      lastUsableRow,
      observedTargetChanges,
      maxGapSeconds: positiveGaps.length ? Math.max(...positiveGaps) : null,
      gapCount: sourceStats.reduce((total, source) => total + source.gapCount, 0)
    };
    return { rows, stats, sourceStats };
  }

  function inspect(rows, options = {}) {
    const references = Array.isArray(options.referencePositions)
      ? options.referencePositions.filter(Number.isFinite) : [0, 94];
    const jumpThreshold = Number.isFinite(options.positionJumpThreshold) && options.positionJumpThreshold > 0
      ? options.positionJumpThreshold : 10;
    const inspected = [];
    const events = [];
    const stats = {
      targetChangeCount: 0,
      positionIncreaseCount: 0,
      positionDecreaseCount: 0,
      observedReversals: 0,
      maxAbsError: null,
      breakCount: 0,
      suspectedResetCount: 0
    };
    let previous = null;
    let lastPositionDirection = null;

    function event(kind, row, from, to) {
      return {
        kind,
        time: row.time,
        previousTime: previous.time,
        index: row.index,
        source: row.source,
        from,
        to,
        delta: to - from,
        position: row.position,
        error: row.error,
        requestedDirection: row.requestedDirection
      };
    }

    for (const original of rows || []) {
      const hasPosition = Number.isFinite(original.position);
      const hasTarget = Number.isFinite(original.target);
      const targetDifference = hasPosition && hasTarget ? original.target - original.position : null;
      const row = {
        ...original,
        breakBefore: false,
        breakReason: null,
        positionDelta: null,
        positionDirection: 'unknown',
        // This is a recorded target relationship, not evidence of motor power.
        requestedDirection: targetDifference === null ? 'unknown'
          : targetDifference > 0 ? 'down' : targetDifference < 0 ? 'up' : 'matched'
      };
      if (Number.isFinite(row.error)) {
        const magnitude = Math.abs(row.error);
        if (stats.maxAbsError === null || magnitude > stats.maxAbsError) stats.maxAbsError = magnitude;
      }

      if (!previous) row.breakReason = 'first-row';
      else if (row.source !== previous.source) row.breakReason = 'source-change';
      else if (!Number.isInteger(row.index) || !Number.isInteger(previous.index) || row.index !== previous.index + 1) {
        row.breakReason = 'index-gap';
      } else if (!Number.isFinite(row.time) || !Number.isFinite(previous.time)) row.breakReason = 'invalid-time';
      else if (row.time <= previous.time) row.breakReason = 'non-increasing-time';
      else if (row.gapBefore) row.breakReason = 'gap';
      else if (!hasPosition || !Number.isFinite(previous.position)) row.breakReason = 'missing-position';

      if (!row.breakReason) {
        const difference = row.position - previous.position;
        // Reference endpoints are firmware clues. A large jump can be a reset
        // or reference update; this heuristic never establishes a hard limit.
        if (references.includes(row.position) && Math.abs(difference) >= jumpThreshold) {
          row.breakReason = 'position-jump';
          events.push(event('position-jump', row, previous.position, row.position));
          stats.suspectedResetCount++;
        } else {
          row.positionDelta = difference;
          row.positionDirection = difference > 0 ? 'down' : difference < 0 ? 'up' : 'steady';
          if (difference > 0) stats.positionIncreaseCount++;
          else if (difference < 0) stats.positionDecreaseCount++;
          if (difference !== 0) {
            if (lastPositionDirection !== null && lastPositionDirection !== row.positionDirection) stats.observedReversals++;
            lastPositionDirection = row.positionDirection;
          }
        }
      }

      row.breakBefore = row.breakReason !== null;
      if (row.breakBefore) {
        stats.breakCount++;
        lastPositionDirection = null;
      } else if (hasTarget && Number.isFinite(previous.target) && row.target !== previous.target) {
        events.push(event('target-change', row, previous.target, row.target));
        stats.targetChangeCount++;
      }
      inspected.push(row);
      previous = row;
    }
    return { rows: inspected, events, stats };
  }

  return { analyze, inspect };
}));
