(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ctd-mot.js'));
  else root.CtdMotorView = factory(root.CtdMot);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (mot) {
  'use strict';

  const stages = [
    { id: 'descent1', label: '一次下潜', color: '#3976a9' },
    { id: 'drift', label: '定深漂流', color: '#0b817b' },
    { id: 'descent2', label: '二次下潜', color: '#a87321' },
    { id: 'ascent', label: '上浮', color: '#9561a8' }
  ];
  const relation = { up: '目标在较小位置侧 · 上浮调节方向', down: '目标在较大位置侧 · 下潜调节方向', matched: '记录位置相等 · 不等于已确认停机', unknown: '目标关系未知' };
  const movement = { up: '位置减小 · 上浮调节方向', down: '位置增大 · 下潜调节方向', steady: '记录位置未变化', unknown: '相邻变化无法判断' };
  const velocityStyles = [
    { id: 'descent1', label: '一次下潜', color: '#3976a9', dash: [] },
    { id: 'drift', label: '定深漂流', color: '#0b817b', dash: [2, 4] },
    { id: 'descent2', label: '二次下潜', color: '#a87321', dash: [7, 3, 2, 3] },
    { id: 'ascent', label: '上浮', color: '#9561a8', dash: [7, 4] },
    { id: 'transition', label: '阶段交界区间', color: '#6d7781', dash: [], connect: false },
    { id: 'unknown', label: '阶段未确认', color: '#6d7781', dash: [3, 4] }
  ];

  function ctdGapLimit(rows) {
    const steps = (rows || []).slice(1).map((row, i) => Number.isFinite(row.time) && Number.isFinite(rows[i].time) ? row.time - rows[i].time : null).filter(delta => Number.isFinite(delta) && delta > 0).sort((a, b) => a - b);
    return Math.max(60000, steps.length ? 5 * steps[Math.floor(steps.length / 2)] : 60000);
  }

  function validVelocityRows(rows, maxGapMs) {
    return (rows || []).filter(row => Number.isFinite(row.time) && Number.isFinite(row.velocity) && Number.isFinite(row.deltaTime) && row.deltaTime > 0 && row.deltaTime * 1000 <= maxGapMs);
  }

  function phaseBands(timeline) {
    const events = timeline || [];
    if (events.some((event, i) => !Number.isFinite(event.time) || (i && event.time < events[i - 1].time))) return [];
    return stages.flatMap((stage, index) => {
      const start = events.find(event => event.phase === stage.id);
      const end = events.find(event => event.phase === (stages[index + 1]?.id || 'unknown'));
      return start && end && end.time > start.time ? [{ ...stage, min: start.time, max: end.time }] : [];
    });
  }

  // A real neighbouring sample is returned with its own time. Never interpolate
  // a motor position or silently carry an event value into an unobserved period.
  function nearest(rows, time, key) {
    if (!Number.isFinite(time)) return null;
    let found = null, distance = Infinity;
    for (const row of rows || []) {
      if (!Number.isFinite(row.time) || (key && !Number.isFinite(row[key]))) continue;
      const delta = Math.abs(row.time - time);
      if (delta < distance) { found = row; distance = delta; }
    }
    return found;
  }

  function create(elements, options) {
    const { formatNumber: number, formatTime: date, interactions, chart } = options;
    let data = null, inspection = null, bands = [], velocityRows = [], maxGapMs = 60000, showReferences = false;
    let readout = null;
    const node = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text != null) element.textContent = text;
      return element;
    };
    const phaseAt = time => bands.find(band => time >= band.min && time < band.max)?.label || '阶段未确认';
    const draw = () => options.render();

    function setData(next) {
      data = next;
      inspection = mot.inspect(data.mot?.rows || []);
      bands = data.singleMot ? [] : phaseBands(data.phases?.timeline);
      maxGapMs = ctdGapLimit(data.rows);
      velocityRows = data.singleMot ? [] : validVelocityRows(data.phases?.points, maxGapMs);
      renderPanel();
    }

    function inspectAt(time) {
      if (!readout || !data) return;
      const point = nearest(inspection.rows, time, 'position');
      const depth = data.singleMot ? null : nearest(data.rows, time, 'depth');
      const velocity = data.singleMot ? null : nearest(velocityRows, time, 'velocity');
      readout.replaceChildren();
      readout.append(node('div', 'motor-readout-time', `${date(time)}（北京） · ${phaseAt(time)}`));
      const values = node('div', 'motor-readout-values');
      const add = (title, value, sample) => {
        const item = node('div', 'motor-reading');
        item.append(node('span', '', title), node('strong', '', value));
        const sampleLabel = sample ? `记录 ${date(sample.time).slice(5)} · 相距 ${number(Math.abs(sample.time - time) / 1000, 1)} s` : '无配套记录';
        const timestamp = node('small', '', sampleLabel); timestamp.title = sample ? `${date(sample.time)}（北京），非光标时刻插值值` : '无配套记录'; item.append(timestamp);
        values.append(item);
      };
      add('邻近电机记录 · 当前 / 目标', point ? `${number(point.position, 3)} / ${number(point.target, 3)}` : '—', point);
      add('邻近 CTD 深度', depth ? `${number(depth.depth, 3)} m` : '—', depth);
      add('邻近 CTD 区间平均垂向速度', velocity ? `${number(velocity.velocity, 4)} m/s` : '—', velocity);
      readout.append(values);
    }

    function renderPanel() {
      const container = elements.content, details = elements.details;
      container.replaceChildren(); details.replaceChildren();
      if (!inspection.rows.length) {
        container.append(node('p', 'source-note', '未找到同设备、同日期、同任务的 MOT 记录。导入完整目录可同时对照 CTD；也可单独导入 MOT CSV。'));
        return;
      }
      const stats = inspection.stats;
      const grid = node('dl', 'facts-grid motor-facts');
      [
        ['有效相邻目标变更', `${stats.targetChangeCount} 次`],
        ['已观察位置增大 / 减小', `${stats.positionIncreaseCount} / ${stats.positionDecreaseCount} 段`],
        ['已观察位置换向', `${stats.observedReversals} 次`],
        ['最大记录位置偏差', `${number(stats.maxAbsError, 3)} 原始值`]
      ].forEach(([title, value]) => {
        const box = node('div', 'fact'); box.append(node('dt', '', title), node('dd', '', value)); grid.append(box);
      });
      container.append(grid);
      const toolbar = node('div', 'motor-focus-toolbar');
      const group = node('div', 'motor-phase-controls'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', '定位任务阶段');
      const full = node('button', 'button', '定位全程'); full.type = 'button';
      full.addEventListener('click', () => {
        interactions.setTimeRange(null);
      }); group.append(full);
      bands.forEach(band => {
        const button = node('button', 'button', band.label); button.type = 'button'; button.style.setProperty('--stage-color', band.color); button.title = `定位 ${date(band.min)} 至 ${date(band.max)}`;
        button.addEventListener('click', () => {
          interactions.setTimeRange({ min: band.min, max: band.max });
        }); group.append(button);
      });
      const label = node('label', 'motor-reference-toggle');
      const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.id = 'motorReferenceToggle'; checkbox.checked = showReferences;
      checkbox.addEventListener('change', () => { showReferences = checkbox.checked; draw(); });
      label.append(checkbox, document.createTextNode('显示源码位置参考 0 / 94'));
      toolbar.append(group, label); container.append(toolbar);
      readout = node('div', 'motor-readout'); readout.id = 'motorReadout'; readout.setAttribute('aria-label', '电机与 CTD 同时刻对照');
      readout.append(node('p', '', '移到任一图上联动读数。各来源保留自己的实测时间。'));
      renderDetails();
    }

    function renderDetails() {
      const table = node('table'), head = node('thead'), tr = node('tr'), body = node('tbody');
      ['CSV 行号', '时间（北京）', '当前位置', '目标位置', '偏差（当前−目标）', '目标关系（非通电状态）', '相邻位置变化', '连接情况'].forEach(text => tr.append(node('th', '', text)));
      head.append(tr);
      const reasons = { 'first-row': '首条', 'source-change': '来源变化', 'index-gap': '中间缺行', 'invalid-time': '时间无效', 'non-increasing-time': '时间不递增', gap: '长间隔', 'missing-position': '位置缺失', 'position-jump': '参考端点大跳变' };
      inspection.rows.forEach(point => {
        const row = node('tr');
        [point.index + 2, date(point.time) || point.timeRaw || '未记录', number(point.position, 3), number(point.target, 3), number(point.error, 3), relation[point.requestedDirection], Number.isFinite(point.positionDelta) ? `${number(point.positionDelta, 3)} · ${movement[point.positionDirection]}` : '—', reasons[point.breakReason] || '相邻记录'].forEach(text => row.append(node('td', '', text)));
        body.append(row);
      }); table.append(head, body);
      const wrap = node('div', 'table-scroll'); wrap.tabIndex = 0; wrap.append(table); elements.details.append(wrap);
    }

    function renderCharts(timeDomain, invertDepth) {
      if (!inspection?.rows.length) return false;
      const motRows = inspection.rows, ctdRows = data.singleMot ? [] : data.rows;
      const times = [...motRows, ...ctdRows].map(row => row.time).filter(Number.isFinite);
      if (!times.length) return false;
      elements.chartsGrid.append(readout);
      const min = Math.min(...times), max = Math.max(...times), pad = Math.max(1000, (max - min) * .03);
      const xDomain = timeDomain || { min: min - pad, max: max + pad };
      const common = { xDomain, xType: 'time', yType: 'number', xLabel: '记录时间（北京）', xUnit: '', wide: true, motor: true, forcePoints: true, breakGaps: true, invertY: false, linkedCursor: true, phaseBands: bands, legend: '' };
      const points = (key, label) => motRows.filter(row => Number.isFinite(row.time) && Number.isFinite(row[key])).map(row => ({ ...row, x: row.time, y: row[key], label, phaseLabel: phaseAt(row.time), motorRelation: relation[row.requestedDirection], motorMovement: movement[row.positionDirection] }));
      const current = points('position', '当前位置'), target = points('target', '目标位置'), error = points('error', '位置偏差');
      const changes = inspection.events.filter(event => event.kind === 'target-change').map(event => ({ ...event, target: event.to, x: event.time, y: event.to, label: `目标变化 ${number(event.from, 3)} → ${number(event.to, 3)}`, color: '#a85d16', shape: 'diamond' }));
      const jumps = inspection.events.filter(event => event.kind === 'position-jump').map(event => ({ ...event, x: event.time, y: event.to, label: '参考端点大跳变 · 需核对重置或限位', color: '#a44e56', shape: 'cross' }));
      chart({ ...common, title: '浮力电机位置', subtitle: '实线：记录位置 · 虚线：目标 · ◆：目标变化 · ×：位置跳变待核对', points: [...current, ...target], yLabel: '位置（原始值）', yUnit: '原始值', color: '#267ca3', eventMarkers: [...changes, ...jumps], horizontalLines: showReferences ? [{ value: 0, label: '源码位置参考 0' }, { value: 94, label: '源码位置参考 94' }] : [], series: [
        { id: 'mot-position', label: '当前位置', points: current, color: '#267ca3', dash: [] },
        { id: 'mot-target', label: '目标位置', points: target, color: '#a85d16', dash: [7, 4], step: true }
      ], method: '位置增大对应下潜调节方向，减小对应上浮调节方向；实际升沉看下方 CTD。◆ 位于首次记录新目标的时刻，实际变化发生在前后记录之间。长间隔、倒序、缺值及可疑位置重置前后不连线。' });
      chart({ ...common, title: '电机位置偏差', subtitle: '当前 − 目标；正偏差：目标在较小位置侧，负偏差：目标在较大位置侧', points: error, yLabel: '位置偏差（原始值）', yUnit: '原始值', color: '#8055aa', zeroY: true, legend: `${error.length} 个有效偏差点`, stat: `最大绝对值 ${number(inspection.stats.maxAbsError, 3)}`, method: '按参考源码，正偏差对应上浮调节请求关系，负偏差对应下潜调节请求关系；零仅表示整数记录相等，不证明停机。' });
      const ctdDepth = ctdRows.filter(row => Number.isFinite(row.time) && Number.isFinite(row.depth)).map(row => ({ ...row, source: 'CTD', x: row.time, y: row.depth, phaseLabel: phaseAt(row.time) }));
      const depthNote = data.depthUnit === 'dbar' ? `压力换算深度；纬度 ${number(data.velocity.latitude, 4)}°${data.velocity.assumedLatitude ? '（假设值）' : '（keydata）'}` : data.depthUnit === 'm' ? '按表头识别的米深度绘制' : '深度单位未知，无法绘制米深度';
      chart({ ...common, title: 'CTD 深度对照', subtitle: data.singleMot ? '单独导入 MOT，未关联 CTD' : depthNote, points: ctdDepth, maxGapMs, yLabel: '深度 (m)', yUnit: 'm', color: '#1b8978', invertY: invertDepth, legend: `CTD ${ctdDepth.length} 点`, emptyText: '没有配套 CTD 米深度数据', method: `共用时间轴和阶段色带；超过 ${number(maxGapMs / 1000, 1)} s 的 CTD 间隔断线。未用 MOT 补出深度或拟合动作效果。` });
      const velocities = velocityRows.map(row => ({ ...row, x: row.time, y: row.velocity, source: 'CTD', phaseLabel: velocityStyles.find(style => style.id === row.phase)?.label || '阶段未确认', intervalStart: row.time - row.deltaTime * 1000 }));
      const series = velocityStyles.map(style => ({ ...style, points: velocities.filter(row => (row.phase || 'unknown') === style.id) })).filter(item => item.points.length);
      chart({ ...common, title: 'CTD 垂向速度对照', subtitle: '正值向深处，负值向浅处 · 线型与颜色区分阶段，交界区间仅画点', points: velocities, series, maxGapMs, zeroY: true, yLabel: '垂向速度 (m/s)', yUnit: 'm/s', color: '#526c85', legend: `${velocities.length} 个有效速度点 · `, emptyText: '没有配套 CTD 速度数据', method: `速度为相邻 CTD 区间平均值，不是电机转速。超过 ${number(maxGapMs / 1000, 1)} s 的采样区间不显示速度，跨阶段区间单列；时间上相邻不代表电机动作造成该速度变化。` });
      return true;
    }

    return { setData, renderCharts, inspectAt };
  }
  return { create, phaseBands, nearest, validVelocityRows };
}));
