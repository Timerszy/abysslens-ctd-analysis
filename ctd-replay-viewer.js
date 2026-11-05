(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const motionLabels = { down: '↓ 向深处运动', up: '↑ 向浅处运动', still: '— 区间深度未变', unknown: '运动方向未知' };
  const phaseColors = { descent1: '#2563a6', descent2: '#8055aa', ascent: '#c26919', drift: '#77858b', unknown: '#697780' };
  const formatters = new Map();
  const number = (value, digits = 3) => {
    if (!Number.isFinite(value)) return '—';
    if (!formatters.has(digits)) formatters.set(digits, new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }));
    return formatters.get(digits).format(value);
  };
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  const timeText = time => Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : '—';
  function svg(tag, attributes = {}, text = '') {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text) node.textContent = text;
    return node;
  }

  function create(container, options = {}) {
    let model = root.CtdReplay.build([]), dataRows = null, dataTimeline = null;
    let currentTime = null, playing = false, animation = 0, lastTick = null, frame = null, mounted = false;
    let speed = 60, interpolateGaps = true, controls = {}, nodes = {};
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const depthScale = () => Math.max(1, model.maxDepth || 0);
    const yAt = depth => 64 + depth / depthScale() * 312;
    const xAt = time => 22 + (model.duration ? (time - model.start) / model.duration : 0) * 616;

    function pause(message = '') {
      playing = false; cancelAnimationFrame(animation); animation = 0; lastTick = null;
      if (controls.play) { controls.play.textContent = '播放'; controls.play.setAttribute('aria-pressed', 'false'); }
      if (message && nodes.status) nodes.status.textContent = message;
    }
    function unmount() { pause(); mounted = false; controls = {}; nodes = {}; }
    function setData(rows, timeline = []) {
      if (rows === dataRows && timeline === dataTimeline) return;
      pause(); dataRows = rows; dataTimeline = timeline;
      model = root.CtdReplay.build(rows, timeline); currentTime = model.start; frame = null;
      if (mounted) mount(true);
    }
    function showTime(time) {
      if (!model.samples.length || !Number.isFinite(time)) return;
      currentTime = Math.max(model.start, Math.min(model.end, time));
      renderFrame();
    }
    function tick(timestamp) {
      if (!playing || !mounted || document.hidden || !container.isConnected) { pause(); return; }
      if (lastTick === null) lastTick = timestamp;
      const delta = Math.max(0, Math.min(250, timestamp - lastTick)); lastTick = timestamp;
      showTime(currentTime + delta * speed);
      if (currentTime >= model.end) { pause('回放已结束'); return; }
      animation = requestAnimationFrame(tick);
    }
    function play() {
      if (!model.duration || !mounted || document.hidden) return;
      if (playing) { pause('已暂停，可拖动时间轴逐点检查'); return; }
      if (currentTime >= model.end) showTime(model.start);
      playing = true; lastTick = null; controls.play.textContent = '暂停'; controls.play.setAttribute('aria-pressed', 'true');
      nodes.status.textContent = `正在按 ${speed} 倍速回放`;
      animation = requestAnimationFrame(tick);
    }

    function renderScene(scene) {
      const water = svg('svg', { class: 'replay-water-svg', viewBox: '0 0 660 440', role: 'img', 'aria-label': '浮标在水柱中的深度示意，深度向下增加，外形不按真实比例' });
      water.append(svg('title', {}, '浮标实测深度回放'));
      water.append(svg('text', { x: 26, y: 29, class: 'replay-axis-text' }, '深度 / m'));
      water.append(svg('text', { x: 632, y: 29, 'text-anchor': 'end', class: 'replay-axis-text' }, '外形示意'));
      water.append(svg('path', { d: 'M90 64 H635', class: 'replay-surface' }));
      for (let index = 0; index <= 4; index++) {
        const value = depthScale() * index / 4, y = yAt(value);
        water.append(svg('path', { d: `M90 ${y} H635`, class: 'replay-grid' }));
        water.append(svg('text', { x: 78, y: y + 5, 'text-anchor': 'end', class: 'replay-axis-text' }, number(value, depthScale() < 10 ? 2 : 1)));
      }
      water.append(svg('text', { x: 110, y: 54, class: 'replay-axis-text' }, '水面 0 m'));
      nodes.guide = svg('path', { class: 'replay-guide' });
      nodes.marker = svg('g', { id: 'replayFloat' });
      // The marker's centre encodes depth. Its drawn height is schematic, not a depth span.
      nodes.marker.append(svg('path', { d: 'M0 -37 V-62 M-8 -62 H8', class: 'replay-float-body' }));
      nodes.marker.append(svg('rect', { x: -20, y: -34, width: 40, height: 70, rx: 17, class: 'replay-float-body' }));
      nodes.marker.append(svg('path', { d: 'M-20 -14 H20 V8 H-20 Z', class: 'replay-float-cap' }));
      nodes.marker.append(svg('path', { d: 'M-18 26 L-29 38 H29 L18 26', class: 'replay-float-body' }));
      nodes.marker.append(svg('circle', { cx: 0, cy: 0, r: 4, fill: '#087c80' }));
      nodes.arrow = svg('path', { class: 'replay-arrow' });
      nodes.sceneLabel = svg('text', { x: 632, y: 411, 'text-anchor': 'end', class: 'replay-axis-text' });
      water.append(nodes.guide, nodes.marker, nodes.arrow, nodes.sceneLabel); scene.append(water); nodes.scene = scene;
    }

    function renderOverview(host) {
      const overview = svg('svg', { class: 'replay-overview', viewBox: '0 0 660 86', preserveAspectRatio: 'none', role: 'img', 'aria-label': '全任务深度轨迹，竖线标出当前回放时间；实线为连续观测，虚线为缺测估计' });
      let path = '', estimatedPath = '';
      model.samples.forEach((sample, index) => {
        const x = xAt(sample.time), y = 12 + sample.depth / depthScale() * 60;
        path += `${index > 0 && model.intervals[index - 1]?.valid ? 'L' : 'M'}${x.toFixed(3)},${y.toFixed(3)} `;
        const interval = model.intervals[index - 1];
        if (interval && !interval.valid && interval.canEstimate) {
          const from = model.samples[index - 1];
          estimatedPath += `M${xAt(from.time).toFixed(3)},${(12 + from.depth / depthScale() * 60).toFixed(3)} L${x.toFixed(3)},${y.toFixed(3)} `;
        }
      });
      nodes.estimatedTrace = svg('path', { d: estimatedPath, class: 'replay-estimated-trace' });
      overview.append(nodes.estimatedTrace);
      overview.append(svg('path', { d: path, class: 'replay-trace' }));
      nodes.overviewCursor = svg('path', { class: 'replay-cursor' });
      nodes.overviewPoint = svg('circle', { r: 4, fill: '#087c80' });
      overview.append(nodes.overviewCursor, nodes.overviewPoint); host.append(overview);
    }

    function renderFrame() {
      frame = root.CtdReplay.frameAt(model, currentTime, { interpolateGaps });
      if (!frame || !nodes.depth) return;
      const gap = frame.mode === 'gap', estimated = frame.mode === 'estimated', y = yAt(frame.depth);
      const displayMovement = estimated ? frame.estimatedMovement : frame.movement;
      setText(nodes.depth, number(frame.depth, 3));
      setText(nodes.depthBasis, gap ? '保持上一实测位置 · 当前深度未知' : estimated ? '缺测区间 · 两端实测位置之间线性估计' : frame.mode === 'interpolated' ? '位置来自相邻实测点线性插帧' : '实测深度');
      setText(nodes.velocity, frame.velocity === null ? '—' : `${frame.velocity > 0 ? '+' : ''}${number(frame.velocity, 5)} m/s`);
      setText(nodes.motion, motionLabels[frame.movement]); nodes.motion.dataset.movement = frame.movement;
      nodes.estimateRow.hidden = !estimated;
      setText(nodes.estimate, estimated ? `${frame.estimatedVelocity > 0 ? '+' : ''}${number(frame.estimatedVelocity, 5)} m/s · ${motionLabels[displayMovement]}（估计）` : '');
      setText(nodes.phase, frame.phaseLabel); nodes.phase.dataset.phase = frame.phase;
      setText(nodes.sample, `${timeText(frame.sampleTime)}（北京）`);
      setText(nodes.interval, frame.fromTime === frame.toTime ? '无有效前一区间' : `${timeText(frame.fromTime)} — ${timeText(frame.toTime)} · ${number((frame.toTime - frame.fromTime) / 1000, 1)} s`);
      nodes.gap.hidden = !gap && !estimated;
      setText(nodes.gap, estimated ? `${frame.reason}。已按两端实测位置连续插帧；虚线位置与动画速度均为估计，区间内的实际运动未知。` : `${frame.reason}。保持上一实测位置，当前实际位置与速度未知。`);
      setText(nodes.mode, gap ? '断档 · 位置保留' : estimated ? '缺测估计 · 连续插帧' : frame.mode === 'interpolated' ? '连续插帧' : '实测采样点');
      nodes.mode.dataset.estimated = String(estimated);
      setText(nodes.time, timeText(frame.time));
      controls.seek.value = String(frame.time - model.start);
      const ariaText = `${timeText(frame.time)}，${gap ? '位置未知，保留' : estimated ? '估计深度' : '深度'}${number(frame.depth)}米，${estimated ? '估计' : ''}${motionLabels[displayMovement]}`;
      if (controls.seek.getAttribute('aria-valuetext') !== ariaText) controls.seek.setAttribute('aria-valuetext', ariaText);
      controls.previous.disabled = currentTime <= model.start; controls.next.disabled = currentTime >= model.end;
      nodes.guide.setAttribute('d', `M90 ${y} H635`);
      nodes.marker.setAttribute('transform', `translate(350 ${y})`);
      nodes.marker.dataset.depth = String(frame.depth); nodes.marker.dataset.mode = frame.mode;
      nodes.scene.classList.toggle('is-gap', gap);
      nodes.scene.classList.toggle('is-estimated', estimated);
      const arrowDirection = displayMovement === 'down' ? 1 : -1;
      nodes.arrow.setAttribute('d', displayMovement === 'down' || displayMovement === 'up' ? `M414 ${y - arrowDirection * 20} V${y + arrowDirection * 22} M404 ${y + arrowDirection * 12} L414 ${y + arrowDirection * 22} L424 ${y + arrowDirection * 12}` : '');
      nodes.arrow.style.color = estimated ? '#94651d' : displayMovement === 'down' ? '#2563a6' : '#a65b1a';
      setText(nodes.sceneLabel, gap ? '当前无连续观测' : estimated ? `缺测估计 · ${motionLabels[displayMovement]}` : `${frame.phaseLabel} · ${motionLabels[frame.movement]}`);
      const x = xAt(frame.time); nodes.overviewCursor.setAttribute('d', `M${x} 0 V86`);
      nodes.overviewPoint.setAttribute('cx', String(x)); nodes.overviewPoint.setAttribute('cy', String(12 + frame.depth / depthScale() * 60));
      nodes.panel.dataset.time = String(frame.time); nodes.panel.dataset.mode = frame.mode;
      nodes.panel.dataset.movement = frame.movement; nodes.panel.dataset.phase = frame.phase;
      nodes.panel.dataset.estimatedMovement = estimated ? frame.estimatedMovement : '';
      nodes.estimatedTrace.style.display = interpolateGaps ? '' : 'none';
    }

    function mount(force = false) {
      if (mounted && nodes.panel?.isConnected && !force) { renderFrame(); return; }
      pause(); container.replaceChildren(); mounted = true;
      const panel = document.createElement('article'); panel.id = 'replayPanel'; panel.className = 'replay-panel'; nodes = { panel }; controls = {};
      container.append(panel);
      if (!model.samples.length) {
        const empty = document.createElement('div'); empty.className = 'replay-empty';
        const title = document.createElement('strong'); title.textContent = '当前数据无法回放浮标';
        const text = document.createElement('span'); text.textContent = '需要带有效采样时间与米深度的 CTD 数据。可导入完整任务文件夹；未知单位、缺测深度和单独 MOT 不能推算浮标位置。'; empty.append(title, text); panel.append(empty); return;
      }
      if (currentTime === null) currentTime = model.start;
      const heading = document.createElement('div'); heading.className = 'replay-heading';
      const title = document.createElement('div'); title.innerHTML = '<h2>浮标状态回放</h2><p>沿实测时间查看深度与升沉，任务阶段独立显示</p>';
      nodes.mode = document.createElement('span'); nodes.mode.className = 'replay-badge'; heading.append(title, nodes.mode); panel.append(heading);
      const layout = document.createElement('div'); layout.className = 'replay-layout';
      const scene = document.createElement('div'); scene.className = 'replay-scene'; renderScene(scene);
      const readouts = document.createElement('div'); readouts.className = 'replay-readouts';
      const primary = document.createElement('div'); primary.className = 'replay-primary'; primary.innerHTML = '<span>深度位置</span><strong id="replayDepth"></strong><em>m</em><small></small>'; nodes.depth = primary.querySelector('strong'); nodes.depthBasis = primary.querySelector('small');
      const facts = document.createElement('dl'); facts.className = 'replay-facts';
      const fact = (label, id, className = '') => { const item = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.id = id; dd.className = className; item.append(dt, dd); facts.append(item); return dd; };
      nodes.velocity = fact('垂向速度 · 相邻区间平均', 'replayVelocity');
      nodes.motion = fact('升沉方向 · 区间平均', 'replayMovement', 'replay-motion');
      nodes.estimate = fact('动画速度与方向 · 缺测估计', 'replayEstimate', 'replay-estimate');
      nodes.estimateRow = nodes.estimate.parentElement; nodes.estimateRow.hidden = true;
      nodes.phase = fact('任务阶段 · keydata 时间', 'replayPhase', 'replay-phase');
      nodes.sample = fact('位置参考的实测时间', 'replaySampleTime');
      nodes.interval = fact('位置 / 速度参考区间（北京）', 'replayInterval');
      readouts.append(primary, facts); layout.append(scene, readouts); panel.append(layout);
      nodes.gap = document.createElement('p'); nodes.gap.className = 'replay-gap'; nodes.gap.id = 'replayGap'; panel.append(nodes.gap);
      const timing = document.createElement('div'); timing.className = 'replay-timing';
      const timeLabel = document.createElement('span'); timeLabel.textContent = '回放时间（北京） '; nodes.time = document.createElement('time'); nodes.time.id = 'replayTime'; timeLabel.append(nodes.time);
      nodes.status = document.createElement('span'); nodes.status.id = 'replayPlaybackStatus'; nodes.status.setAttribute('role', 'status'); nodes.status.textContent = model.duration ? '已暂停，点击播放或拖动时间轴' : '仅一个有效时间点，显示实测位置'; timing.append(timeLabel, nodes.status); panel.append(timing);
      const controlBar = document.createElement('div'); controlBar.className = 'replay-controls';
      const button = (id, text, callback, primary = false) => { const element = document.createElement('button'); element.id = id; element.type = 'button'; element.className = 'button' + (primary ? ' primary' : ''); element.textContent = text; element.addEventListener('click', callback); controlBar.append(element); return element; };
      controls.play = button('replayPlay', '播放', play, true); controls.play.setAttribute('aria-pressed', 'false'); controls.play.disabled = !model.duration;
      button('replayRestart', '回到起点', () => { pause('已回到起点'); showTime(model.start); });
      controls.previous = button('replayPrevious', '上一点', () => { pause('已暂停 · 实测采样点'); showTime(root.CtdReplay.stepTime(model, currentTime, -1)); });
      controls.next = button('replayNext', '下一点', () => { pause('已暂停 · 实测采样点'); showTime(root.CtdReplay.stepTime(model, currentTime, 1)); });
      const speedLabel = document.createElement('label'); speedLabel.className = 'replay-speed'; speedLabel.htmlFor = 'replaySpeed'; speedLabel.textContent = '回放倍速';
      const speedSelect = document.createElement('select'); speedSelect.id = 'replaySpeed';
      [1, 10, 60, 300, 1000].forEach(rate => { const option = document.createElement('option'); option.value = String(rate); option.textContent = `${rate}×`; speedSelect.append(option); }); speedSelect.value = String(speed);
      speedSelect.addEventListener('change', () => { speed = Number(speedSelect.value); lastTick = null; if (playing) nodes.status.textContent = `正在按 ${speed} 倍速回放`; }); speedLabel.append(speedSelect); controlBar.append(speedLabel); panel.append(controlBar);
      const smoothLabel = document.createElement('label'); smoothLabel.className = 'replay-smoothing';
      controls.smooth = document.createElement('input'); controls.smooth.id = 'replaySmoothGaps'; controls.smooth.type = 'checkbox'; controls.smooth.checked = interpolateGaps;
      const smoothText = document.createElement('span'); smoothText.textContent = '缺测区间也插帧（估计）';
      smoothLabel.append(controls.smooth, smoothText);
      controls.smooth.addEventListener('change', () => { interpolateGaps = controls.smooth.checked; renderFrame(); });
      const seekLabel = document.createElement('label'); seekLabel.htmlFor = 'replaySeek'; seekLabel.className = 'replay-seek-label'; seekLabel.textContent = '拖动时间轴定位'; panel.append(seekLabel);
      controls.seek = document.createElement('input'); controls.seek.type = 'range'; controls.seek.id = 'replaySeek'; controls.seek.className = 'replay-seek'; controls.seek.min = '0'; controls.seek.max = String(Math.max(1, model.duration)); controls.seek.step = '1'; controls.seek.disabled = !model.duration;
      controls.seek.addEventListener('pointerdown', () => pause('定位中 · 已暂停'));
      controls.seek.addEventListener('input', () => { pause('已暂停 · 时间轴定位'); showTime(model.start + Number(controls.seek.value)); });
      panel.append(controls.seek);
      const labels = document.createElement('div'); labels.className = 'replay-range-labels';
      [model.start, model.end].forEach(time => { const label = document.createElement('span'); label.textContent = timeText(time); labels.append(label); }); panel.append(labels);
      const transport = document.createElement('div'); transport.className = 'replay-transport';
      transport.append(timing, controlBar, smoothLabel, seekLabel, controls.seek, labels); layout.before(transport);
      renderOverview(panel);
      const legend = document.createElement('div'); legend.className = 'replay-legend';
      ['实线：连续观测', '虚线：缺测估计', `${model.samples.length} 个有效位置 · ${model.gapCount} 处不连续区间`].forEach((text, index) => { const label = document.createElement('span'); label.textContent = text; if (index < 2) label.className = index ? 'replay-legend-estimated' : 'replay-legend-measured'; legend.append(label); }); panel.append(legend);
      const note = document.createElement('p'); note.className = 'replay-note';
      note.textContent = `沿时间连续插帧，采样点保持实测位置。超过 ${number(model.gapThresholdMs / 1000, 1)} s 或有缺测的区间，可按两端位置线性估计；用虚线标记，可关闭“缺测区间也插帧”。重复或倒序时间冲突不跨越估计。垂向速度为连续观测区间平均，缺测动画速度另标为估计；正值向深处、负值向浅处。任务阶段按 keydata 时间显示，可与运动方向相反。外形不按比例，未推算姿态、海流或后续运动。${options.depthNote?.() || ''}${reducedMotion.matches ? '已启用减少动态效果；默认暂停，可逐点查看。' : ''}`; panel.append(note);
      renderFrame();
    }

    function exportPng(fileName) {
      if (!frame || !model.samples.length || !mounted || !nodes.depth) return false;
      pause('已暂停 · 导出当前回放状态');
      const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1400;
      const ctx = canvas.getContext('2d'); ctx.scale(2, 2); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 700);
      const drawText = (text, x, y, font = '15px', color = '#172e43') => { ctx.fillStyle = color; ctx.font = `${font} Segoe UI, Microsoft YaHei, sans-serif`; ctx.fillText(text, x, y, 820); };
      drawText('渊鉴 · 浮标状态回放', 36, 40, 'bold 23px'); drawText(fileName, 36, 68, '13px', '#52677b');
      drawText(`${timeText(frame.time)}（北京） · ${nodes.mode.textContent}`, 36, 99);
      ctx.fillStyle = '#f0f7fb'; ctx.fillRect(36, 124, 500, 390); ctx.strokeStyle = '#cadde7';
      for (let i = 0; i <= 4; i++) { const y = 152 + i * 78; ctx.beginPath(); ctx.moveTo(104, y); ctx.lineTo(512, y); ctx.stroke(); drawText(`${number(depthScale() * i / 4, 2)} m`, 43, y + 5, '12px', '#52677b'); }
      const y = 152 + frame.depth / depthScale() * 312; ctx.strokeStyle = '#087c80'; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(104, y); ctx.lineTo(512, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#e8f1f6'; ctx.strokeStyle = frame.mode === 'estimated' ? '#94651d' : '#20485d'; ctx.setLineDash(frame.mode === 'estimated' || frame.mode === 'gap' ? [5, 3] : []); ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(284, y - 30, 32, 60, 13); ctx.fill(); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#dda24a'; ctx.fillRect(285, y - 12, 30, 18);
      drawText(`${number(frame.depth)} m`, 568, 166, 'bold 30px'); drawText(nodes.depthBasis.textContent, 568, 196, '12px'); drawText(nodes.velocity.textContent, 568, 241, 'bold 20px'); drawText(motionLabels[frame.movement], 568, 276); drawText(frame.phaseLabel, 568, 315, 'bold 17px', phaseColors[frame.phase] || phaseColors.unknown);
      drawText(`位置参考 ${timeText(frame.sampleTime)}`, 568, 354, '12px');
      if (frame.mode === 'estimated') {
        drawText(`动画估计速度 ${frame.estimatedVelocity > 0 ? '+' : ''}${number(frame.estimatedVelocity, 5)} m/s`, 568, 388, '12px', '#78551b');
        drawText(`估计方向 ${motionLabels[frame.estimatedMovement]}`, 568, 414, '12px', '#78551b');
      }
      const lines = [frame.mode === 'gap' ? `断档：${frame.reason}，当前实际位置及速度未知。` : frame.mode === 'estimated' ? `缺测估计：${frame.reason}。位置按两端实测点线性插帧，实际运动未知。` : frame.mode === 'sample' ? '当前为实测采样点。' : '实测点之间线性插帧，仅表示回放位置。', `参考区间：${nodes.interval.textContent}`, '速度为相邻连续观测区间平均；缺测动画速度为估计。任务阶段独立于速度正负。', '浮标外形示意，不按比例；未推算姿态、海流或未来运动。', options.depthNote?.() || ''];
      lines.forEach((line, index) => drawText(line, 36, 555 + index * 26, '13px', '#52677b'));
      const link = document.createElement('a'); link.download = `${fileName.replace(/\.[^.]+$/, '') || 'ctd'}-replay.png`; link.href = canvas.toDataURL('image/png'); link.click(); return true;
    }

    document.addEventListener('visibilitychange', () => { if (document.hidden) pause('窗口已隐藏，回放暂停'); });
    reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) pause('已启用减少动态效果，回放暂停'); });
    return { setData, mount, unmount, exportPng };
  }
  root.CtdReplayViewer = { create };
}(typeof globalThis !== 'undefined' ? globalThis : this));
