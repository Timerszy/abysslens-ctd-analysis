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

  return { analyze };
}));
