/* Diagnostic display keeps raw instrument units and source filenames visible. */
(function () {
  'use strict';
  const number = value => CtdData.number(value);
  const fmt = (value, digits = 3) => Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '—';
  const field = (fields, prefix) => Object.entries(fields).find(([key]) => key === prefix || key.startsWith(prefix + '(') || key.startsWith(prefix + '（')) || [prefix, ''];
  const raw = (fields, prefix) => field(fields, prefix)[1];
  const value = (fields, prefix, unit = '') => { const text = raw(fields, prefix); return text === '' || text == null ? '—' : `${text}${unit ? ' ' + unit : ''}`; };
  const timestampText = timestamp => {
    if (!Number.isFinite(timestamp)) return '未记录';
    return new Date(timestamp + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  };
  const timeText = value => timestampText(CtdData.parseTime(value));
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function grid(parent, entries) {
    const list = el('dl', undefined, 'facts-grid');
    entries.forEach(([label, text, note, alert]) => {
      const item = el('div', undefined, `fact${alert ? ' alert' : ''}`);
      const description = el('dd', text);
      if (note) description.append(el('small', note));
      item.append(el('dt', label), description);
      list.append(item);
    });
    parent.append(list);
  }
  function table(parent, headers, rows) {
    const wrap = el('div', undefined, 'table-scroll');
    wrap.tabIndex = 0;
    const table = el('table');
    const head = el('thead'), tr = el('tr');
    headers.forEach(label => tr.append(el('th', label)));
    head.append(tr);
    const body = el('tbody');
    rows.forEach(cells => {
      const row = el('tr');
      cells.forEach(cell => row.append(el('td', String(cell ?? ''))));
      body.append(row);
    });
    table.append(head, body); wrap.append(table); parent.append(wrap);
  }
  function latitude(fields) {
    for (const [prefix, status] of [['当前上浮', '定位有效性'], ['最后剖面起始', '最后剖面起始GPS有效性'], ['最后剖面结束', '最后剖面结束GPS有效性']]) {
      if (number(raw(fields, status)) !== 0) continue;
      const lat = number(raw(fields, prefix + '纬度'));
      const lon = number(raw(fields, prefix + '经度'));
      if (lat === null || lon === null || (lat === 0 && lon === 0)) continue;
      const degrees = Math.floor(Math.abs(lat) / 100), minutes = Math.abs(lat) % 100;
      if (minutes >= 60 || degrees > 90 || (degrees === 90 && minutes !== 0)) continue;
      const lonDegrees = Math.floor(Math.abs(lon) / 100), lonMinutes = Math.abs(lon) % 100;
      if (lonMinutes >= 60 || lonDegrees > 180 || (lonDegrees === 180 && lonMinutes !== 0)) continue;
      return Math.sign(lat) * (degrees + minutes / 60);
    }
    return null;
  }
  function renderKey(record, fields) {
    const container = document.getElementById('keydataContent'); container.replaceChildren();
    document.getElementById('keydataSource').textContent = record ? record.relativePath : '';
    document.getElementById('keydataStatus').textContent = record ? '已关联' : '缺少数据';
    if (!record) {
      container.append(el('p', '未找到同日期、同剖面的 keydata。请导入含配套文件的完整文件夹。', 'diagnostic-empty'));
      return;
    }
    const errRaw = String(raw(fields, '错误码') ?? '').trim();
    // Error bitmaps may exceed Number's exact integer range. Parse the original text.
    const err = /^(?:\d+|0x[\da-f]+)$/i.test(errRaw) ? BigInt(errRaw) : null;
    const errText = err === null ? (errRaw ? `${errRaw} · 格式无效` : '—') : err === 0n ? '0 · 未报告错误' : `${errRaw} · 0x${err.toString(16).toUpperCase()}`;
    const start = CtdData.parseTime(raw(fields, '最后剖面开始时间')), end = CtdData.parseTime(raw(fields, '最后剖面结束时间'));
    const minutes = start !== null && end !== null && end >= start ? (end - start) / 60000 : null;
    grid(container, [
      ['设备 / 剖面编号', `${value(fields, '设备ID')} / ${value(fields, '最后剖面编号')}`],
      ['任务号 / 模式代码', `${value(fields, '任务号')} / ${value(fields, '任务模式')}`, '任务号与文件名剖面编号分别保留'],
      ['错误码', errText, errRaw && err === null ? '应为非负十进制或 0x 十六进制整数，保留原文，未换算' : err ? '非零错误码；具体含义需对照对应固件版本的设备协议' : '', Boolean(errRaw) && (err === null || err !== 0n)],
      ['剖面历时', minutes === null ? '—' : `${fmt(minutes, 1)} min`, `${timeText(raw(fields, '最后剖面开始时间'))} → ${timeText(raw(fields, '最后剖面结束时间'))}`],
      ['一次下潜：记录最大 / 设定', `${value(fields, '第一次下潜最大深度', 'm')} / ${value(fields, '设置一次下潜深度', 'm')}`],
      ['二次下潜：记录最大 / 设定', `${value(fields, '第二次下潜最大深度', 'm')} / ${value(fields, '设置二次下潜深度', 'm')}`],
      ['系统电压：当前 / 最低', `${value(fields, '当前系统电压', 'V')} / ${value(fields, '系统最低电压', 'V')}`, '显示 CSV 数值，不重复缩放'],
      [field(fields, '当前舱压')[0], value(fields, '当前舱压'), field(fields, '当前舱压')[0].includes('(V)') ? '旧表头单位为 V，保留原值，未转换为 hPa' : '沿用原始单位']
    ]);
    const sent = number(raw(fields, '发送数据成功总条数')), failed = number(raw(fields, '发送数据失败总条数'));
    const ratio = sent !== null && failed !== null && sent >= 0 && failed >= 0 && sent + failed > 0 ? `${fmt(100 * sent / (sent + failed), 1)}%` : '—';
    grid(container, [
      ['通信：发送成功 / 失败 / 接收', `${value(fields, '发送数据成功总条数')} / ${value(fields, '发送数据失败总条数')} / ${value(fields, '接收到数据的总条数')}`, `发送成功率 ${ratio}（成功 / 总发送）`, failed > 0],
      ['信号 / 睡眠', `${value(fields, '当前信号值')} / ${value(fields, '睡眠时长', 'min')}`, '信号值沿用原始数值'],
      [field(fields, '电机总功率')[0], value(fields, '电机总功率'), `电机位置最大值 ${value(fields, '电机位置最大值')}`],
      ['设定漂流时间', value(fields, '设置漂流时间'), 'CSV 未标注单位，显示原值']
    ]);
    if (Object.keys(fields).some(key => key.startsWith('触底深度'))) {
      grid(container, [
        ['运行一次 / 二次下潜深度', `${value(fields, '当前运行一次下潜深度', 'm')} / ${value(fields, '当前运行二次下潜深度', 'm')}`],
        ['触底深度', value(fields, '触底深度', 'm')],
        ['触底模式', value(fields, '触底模式'), '0 关闭 / 1 报错 / 2 只上浮 / 3 上浮改深度'],
        ['漂浮最小深度', value(fields, '漂浮最小深度', 'm')]
      ]);
    }
    container.append(el('h3', '阶段时间 · 北京时间'));
    const phases = el('ol', undefined, 'phase-list');
    ['最后剖面开始时间', '进入漂浮时间', '进入二次下潜时间', '开始上浮时间', '最后剖面结束时间', '首次定位有效的时间'].forEach(name => {
      const item = el('li', name); item.append(el('time', timeText(raw(fields, name)))); phases.append(item);
    });
    container.append(phases);
    const details = el('details'); details.append(el('summary', '定位与全部 keydata 字段'));
    details.append(el('p', '经纬度保留度分格式（DDMM.MMMM）；有效性代码：0 有效、1 无数据、2 无效。1970 年时间视为未记录。', 'source-note'));
    table(details, ['原始字段', '值'], Object.entries(fields).map(([key, val]) => [key, /时间/.test(key) && /^\d{4}[-/]/.test(val) ? timeText(val) : val === '' ? '—' : val]));
    container.append(details);
  }
  function renderLevel(records, rows) {
    const container = document.getElementById('levelContent'); container.replaceChildren();
    document.getElementById('levelSource').textContent = records.map(r => r.relativePath).join(' · ');
    document.getElementById('levelStatus').textContent = rows.length ? `${rows.length} 条记录` : '缺少数据';
    if (!rows.length) {
      container.append(el('p', '未找到同日期、同剖面的 level 记录。', 'diagnostic-empty')); return;
    }
    const timed = rows.filter(row => Number.isFinite(row.time));
    const latest = timed.at(-1) || rows.at(-1);
    const tagged = timed.filter(row => row.label && row.label !== '未标记').at(-1);
    const pressure = rows.map(row => row.pressure).filter(Number.isFinite);
    grid(container, [
      ['最后一条状态标记', tagged ? tagged.label : '未标记', tagged ? timestampText(tagged.time) : '保留记录标签，不推断当前设备状态'],
      ['最大 level 压力', pressure.length ? `${fmt(Math.max(...pressure), 2)} dbar` : '—'],
      ['末次测量：温度 / 盐度', `${fmt(latest.temperature)} °C / ${fmt(latest.salinity, 4)} psu`, timestampText(latest.time)],
      ['末次测量压力', `${fmt(latest.pressure, 2)} dbar`, '所给 GD470 v0408-2 源码中 level 压力单位为 dbar；历史数据需核对版本']
    ]);
    container.append(el('p', 'level 保留漂浮、上浮、最大深度等原始记录标签与测量值；未标记或时间无效的记录仍可在明细中查看。', 'source-note'));
    const details = el('details'); details.open = true;
    details.append(el('summary', 'level 状态与测量明细（全部记录）'));
    table(details, ['时间（北京）', '数据标记', '压力 (dbar)', '温度 (°C)', '盐度 (psu)', '来源'], rows.map(row => [
      timestampText(row.time), row.label, fmt(row.pressure, 3), fmt(row.temperature, 4), fmt(row.salinity, 4), row.source
    ]));
    container.append(details);
  }
  window.CtdDiagnostics = { field, latitude, renderKey, renderLevel };
})();
