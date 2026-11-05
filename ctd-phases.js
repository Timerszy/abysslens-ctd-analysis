(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ctd-data.js'));
  else root.CtdPhases = factory(root.CtdData);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (data) {
  'use strict';

  const events = [
    ['最后剖面开始时间', 'descent1', '一次下潜'],
    ['进入漂浮时间', 'drift', '漂浮'],
    ['进入二次下潜时间', 'descent2', '二次下潜'],
    ['开始上浮时间', 'ascent', '上浮'],
    ['最后剖面结束时间', 'unknown', '剖面结束']
  ];

  function annotate(rows, fields) {
    const source = fields || {};
    const missing = [];
    let timeline = [];
    for (const [field, phase, label] of events) {
      const time = data.parseTime(source[field]);
      if (time === null) missing.push(field);
      else timeline.push({ time, phase, label });
    }
    const conflict = timeline.some((event, index) => index > 0 && event.time < timeline[index - 1].time);
    let hasStages = !conflict && timeline.some(event => event.phase !== 'unknown');
    let note;
    if (conflict) {
      timeline = [];
      note = 'keydata 阶段时间存在倒序冲突，无法可靠区分阶段，全部显示为未分类；不按速度正负推断。';
    } else if (!hasStages) {
      note = '未找到有效 keydata 阶段起始时间，全部显示为未分类；不按速度正负推断。';
    } else if (missing.length) {
      note = `阶段来源：keydata 时间记录（不完整，缺少${missing.join('、')}）。已有阶段维持到下一有效事件；最早事件之前未分类。`;
    } else {
      note = '阶段来源：keydata 时间记录；相邻采样区间按任务阶段归类，跨阶段区间单独标记，不按速度正负推断。';
    }
    const augmented = rows.map((row, index) => {
      let phase = 'unknown';
      if (hasStages && index > 0 && Number.isFinite(row.velocity)) {
        const previousTime = rows[index - 1].time;
        const time = row.time;
        if (Number.isFinite(previousTime) && Number.isFinite(time) && time > previousTime) {
          // Velocity averages the preceding interval. An event exactly at its
          // end belongs to the next interval; one at its start already applies.
          const crossesBoundary = timeline.some(event => event.time > previousTime && event.time < time);
          if (crossesBoundary) phase = 'transition';
          else {
            for (const event of timeline) {
              if (event.time > previousTime) break;
              phase = event.phase;
            }
          }
        }
      }
      return { ...row, phase };
    });
    return {
      rows: augmented,
      points: augmented.filter(row => Number.isFinite(row.velocity)),
      hasStages,
      note,
      timeline
    };
  }

  return { annotate };
}));
