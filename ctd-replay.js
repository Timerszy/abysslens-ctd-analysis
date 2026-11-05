(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CtdReplay = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const labels = { descent1: '一次下潜', descent2: '二次下潜', drift: '漂浮', ascent: '上浮', unknown: '阶段不明' };
  const valid = row => !!row && Number.isFinite(row.time) && Number.isFinite(row.depth) && row.depth >= 0;

  function build(rows, timeline = []) {
    const source = Array.isArray(rows) ? rows : [];
    const samples = [];
    const timeCounts = new Map();
    const finiteTimeCounts = new Map();
    const timeConflicts = [];
    let lastFiniteTime = null, conflictCount = 0;
    const steps = [];
    source.forEach((row, sourceIndex) => {
      if (Number.isFinite(row?.time)) {
        finiteTimeCounts.set(row.time, (finiteTimeCounts.get(row.time) || 0) + 1);
        if (lastFiniteTime !== null && row.time <= lastFiniteTime) conflictCount++;
        lastFiniteTime = row.time;
      }
      timeConflicts[sourceIndex] = conflictCount;
      if (!valid(row)) return;
      samples.push({ ...row, sourceIndex });
      timeCounts.set(row.time, (timeCounts.get(row.time) || 0) + 1);
      const previous = source[sourceIndex - 1];
      const delta = valid(previous) ? row.time - previous.time : null;
      if (Number.isFinite(delta) && delta > 0) steps.push(delta);
    });
    steps.sort((a, b) => a - b);
    const middle = Math.floor(steps.length / 2);
    const median = !steps.length ? 0 : steps.length % 2 ? steps[middle] : steps[middle - 1] + (steps[middle] - steps[middle - 1]) / 2;
    const scaledMedian = median * 5;
    const gapThresholdMs = Math.max(60000, Number.isFinite(scaledMedian) ? scaledMedian : Number.MAX_VALUE);
    const incoming = [];
    for (let index = 1; index < source.length; index++) {
      const previous = source[index - 1], current = source[index];
      if (!valid(previous) || !valid(current)) continue;
      const delta = current.time - previous.time;
      if (!Number.isFinite(delta) || delta <= 0 || delta > gapThresholdMs
        || timeCounts.get(previous.time) > 1 || timeCounts.get(current.time) > 1
        || !Number.isFinite(current.velocity)) continue;
      incoming[index] = { fromSourceIndex: index - 1, fromTime: previous.time, toTime: current.time, velocity: current.velocity };
    }
    // Sorting is only for time navigation. Connectivity still comes from original adjacent rows.
    samples.sort((a, b) => a.time - b.time || a.sourceIndex - b.sourceIndex);
    const intervals = samples.slice(0, -1).map((previous, index) => {
      const current = samples[index + 1], edge = incoming[current.sourceIndex];
      const connected = !!edge && edge.fromSourceIndex === previous.sourceIndex;
      const delta = current.time - previous.time;
      // Missing values may be estimated; contradictory original timestamps may not.
      // Prefix counts check every finite timestamp between anchors without rescanning gaps.
      const canEstimate = previous.sourceIndex < current.sourceIndex && Number.isFinite(delta) && delta > 0
        && finiteTimeCounts.get(previous.time) === 1 && finiteTimeCounts.get(current.time) === 1
        && timeConflicts[previous.sourceIndex] === timeConflicts[current.sourceIndex]
        && Number.isFinite((current.depth - previous.depth) / (delta / 1000));
      let reason = '';
      if (!connected) {
        if (timeCounts.get(previous.time) > 1 || timeCounts.get(current.time) > 1) reason = '采样时间重复，位置不能可靠连续';
        else if (delta > gapThresholdMs) reason = '采样间隔过长';
        else if (current.sourceIndex === previous.sourceIndex + 1 && !Number.isFinite(current.velocity)) reason = '区间速度缺测';
        else reason = '记录缺测或时间不连续';
      }
      return { valid: connected, canEstimate, fromTime: previous.time, toTime: current.time, velocity: connected ? edge.velocity : null, reason };
    });
    let events = (Array.isArray(timeline) ? timeline : []).filter(event => event && Number.isFinite(event.time)).map(event => ({ ...event }));
    if (events.some((event, index) => index > 0 && event.time < events[index - 1].time)) events = [];
    const start = samples.length ? samples[0].time : null;
    const end = samples.length ? samples[samples.length - 1].time : null;
    const duration = samples.length && Number.isFinite(end - start) ? end - start : 0;
    return {
      samples, start, end, duration,
      maxDepth: samples.length ? samples.reduce((maximum, row) => Math.max(maximum, row.depth), 0) : null,
      gapCount: intervals.filter(interval => !interval.valid && interval.toTime > interval.fromTime).length,
      gapThresholdMs, timeline: events, intervals, incoming
    };
  }

  function upperBound(samples, time) {
    let left = 0, right = samples.length;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (samples[middle].time <= time) left = middle + 1;
      else right = middle;
    }
    return left;
  }

  function phaseAt(model, time) {
    let phase = 'unknown', phaseLabel = labels.unknown;
    for (const event of model.timeline) {
      if (event.time > time) break;
      phase = Object.prototype.hasOwnProperty.call(labels, event.phase) ? event.phase : 'unknown';
      phaseLabel = phase === 'unknown' && event.label === '剖面结束' ? event.label : labels[phase];
    }
    return { phase, phaseLabel };
  }

  function frameAt(model, requestedTime, options = {}) {
    if (!model || !model.samples?.length || !Number.isFinite(requestedTime)) return null;
    const time = Math.max(model.start, Math.min(model.end, requestedTime));
    const index = Math.max(0, upperBound(model.samples, time) - 1);
    const sample = model.samples[index], next = model.samples[index + 1];
    const exact = sample.time === time;
    const interval = model.intervals[index];
    const incoming = model.incoming[sample.sourceIndex];
    let depth = sample.depth, velocity = null, estimatedVelocity = null, mode = 'sample', reason = '';
    let fromTime = sample.time, toTime = sample.time;
    if (exact) {
      if (incoming) { velocity = incoming.velocity; fromTime = incoming.fromTime; }
    } else if (next && interval?.valid) {
      const fraction = (time - sample.time) / (next.time - sample.time);
      depth = sample.depth + (next.depth - sample.depth) * fraction;
      velocity = interval.velocity; mode = 'interpolated'; fromTime = sample.time; toTime = next.time;
    } else if (next && options?.interpolateGaps === true && interval?.canEstimate) {
      const fraction = (time - sample.time) / (next.time - sample.time);
      depth = sample.depth + (next.depth - sample.depth) * fraction;
      estimatedVelocity = (next.depth - sample.depth) / ((next.time - sample.time) / 1000);
      mode = 'estimated'; reason = interval.reason; fromTime = sample.time; toTime = next.time;
    } else if (next) {
      mode = 'gap'; reason = interval?.reason || '记录不连续';
      fromTime = sample.time; toTime = next.time;
    }
    const movement = velocity === null ? 'unknown' : velocity > 0 ? 'down' : velocity < 0 ? 'up' : 'still';
    const estimatedMovement = estimatedVelocity === null ? 'unknown' : estimatedVelocity > 0 ? 'down' : estimatedVelocity < 0 ? 'up' : 'still';
    return {
      time, depth, velocity, movement, estimatedVelocity, estimatedMovement, ...phaseAt(model, time), mode, reason,
      sampleIndex: index, sampleTime: sample.time, fromTime, toTime
    };
  }

  function stepTime(model, time, direction) {
    if (!model || !model.samples?.length || !Number.isFinite(time) || !Number.isFinite(direction) || direction === 0) return null;
    const samples = model.samples;
    if (time < model.start) return model.start;
    if (time > model.end) return model.end;
    const next = upperBound(samples, time);
    if (direction > 0) return samples[Math.min(samples.length - 1, next)].time;
    let previous = next - 1;
    if (previous >= 0 && samples[previous].time === time) {
      // Duplicate timestamps have only one position on the playback slider.
      while (previous >= 0 && samples[previous].time === time) previous--;
    }
    return samples[Math.max(0, previous)].time;
  }

  return { build, frameAt, stepTime };
}));
