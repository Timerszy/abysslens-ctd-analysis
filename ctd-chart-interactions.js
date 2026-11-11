(function (root) {
  'use strict';
  const V = root.CtdChartViewport;

  function create(options = {}) {
    const instances = new Map();
    const ranges = new Map();
    const interactionModes = new Map();
    let timeRange = null;
    let frame = 0;
    let cursorFrame = 0;
    let inspectedTime = null;
    let pendingInspection = false;
    const copy = range => ({ min: range.min, max: range.max });
    const span = range => range.max - range.min;
    const same = (a, b) => Math.abs(a.min - b.min) <= span(b) * 1e-8 && Math.abs(a.max - b.max) <= span(b) * 1e-8;
    const key = config => config.title;
    const validRange = range => !!range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.max > range.min && Number.isFinite(span(range));
    const linked = instance => instance.context.config.linkedCursor === true && instance.context.config.xType === 'time';

    function timeBounds() {
      let bounds = null;
      instances.forEach(instance => {
        const { config, full } = instance.context;
        if (config.xType !== 'time' || !validRange(full.x)) return;
        if (!bounds) bounds = copy(full.x);
        else { bounds.min = Math.min(bounds.min, full.x.min); bounds.max = Math.max(bounds.max, full.x.max); }
      });
      return bounds;
    }

    function updateCursor(instance) {
      if (!linked(instance)) { instance.cursor?.remove(); instance.cursor = null; return; }
      if (!instance.cursor) {
        instance.cursor = document.createElement('div');
        instance.cursor.className = 'chart-time-cursor';
        instance.cursor.setAttribute('aria-hidden', 'true');
        instance.cursor.style.pointerEvents = 'none';
        instance.canvas.parentElement.append(instance.cursor);
      }
      const { view, plot } = instance.context;
      const visible = Number.isFinite(inspectedTime) && validRange(view.x) && plot.width > 0 && plot.height > 0
        && inspectedTime >= view.x.min && inspectedTime <= view.x.max;
      instance.cursor.hidden = !visible;
      if (!visible) return;
      Object.assign(instance.cursor.style, {
        left: `${instance.canvas.offsetLeft + plot.left + (inspectedTime - view.x.min) / span(view.x) * plot.width}px`,
        top: `${instance.canvas.offsetTop + plot.top}px`, height: `${plot.height}px`
      });
      instance.cursor.dataset.time = String(inspectedTime);
    }

    function scheduleCursor(time, notify = true) {
      inspectedTime = Number.isFinite(time) ? time : null;
      pendingInspection = notify && inspectedTime !== null;
      if (cursorFrame) return;
      cursorFrame = requestAnimationFrame(() => {
        cursorFrame = 0;
        instances.forEach(updateCursor);
        const shouldNotify = pendingInspection;
        pendingInspection = false;
        if (shouldNotify && inspectedTime !== null && typeof options.onTimeInspect === 'function') options.onTimeInspect(inspectedTime);
      });
    }

    function inspectTime(time) {
      const bounds = timeBounds();
      if (!Number.isFinite(time) || !bounds) return null;
      const next = Math.max(bounds.min, Math.min(bounds.max, time));
      scheduleCursor(next);
      return next;
    }

    function setTimeRange(range) {
      const bounds = timeBounds();
      if (!bounds || (range !== null && !validRange(range))) return null;
      timeRange = range === null ? null : V.constrainRange(range, bounds);
      instances.forEach(instance => {
        const { config, full, view } = instance.context;
        if (config.xType !== 'time') return;
        ranges.set(key(config), { x: V.constrainRange(timeRange || full.x, full.x), y: copy(view.y), time: true });
      });
      repaint();
      return copy(timeRange || bounds);
    }

    function focusTime(time, halfWindowMs = 60000) {
      const bounds = timeBounds();
      if (!Number.isFinite(time) || !bounds || !Number.isFinite(halfWindowMs) || halfWindowMs <= 0) return null;
      const next = Math.max(bounds.min, Math.min(bounds.max, time));
      const halfWindow = Math.min(halfWindowMs, span(bounds));
      const range = setTimeRange({ min: next - halfWindow, max: next + halfWindow });
      inspectTime(next);
      return range;
    }

    function hoverTime(instance, event) {
      if (!linked(instance)) return;
      const point = localPoint(instance, event), { plot, view } = instance.context;
      if (!point.inside || !validRange(view.x) || plot.width <= 0) { scheduleCursor(null, false); return; }
      scheduleCursor(view.x.min + (point.x - plot.left) / plot.width * span(view.x));
    }

    function getView(config, full) {
      const saved = ranges.get(key(config));
      return {
        x: V.constrainRange(config.xType === 'time' ? timeRange || full.x : saved?.x || full.x, full.x),
        y: V.constrainRange(saved?.y || full.y, full.y)
      };
    }

    function repaint() {
      instances.forEach(instance => instance.context.hideTooltip());
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        instances.forEach(instance => instance.context.redraw());
      });
    }

    function commit(instance, view) {
      const { config, full } = instance.context;
      const next = { x: V.constrainRange(view.x, full.x), y: V.constrainRange(view.y, full.y) };
      if (config.xType === 'time') timeRange = copy(next.x);
      ranges.set(key(config), { ...next, time: config.xType === 'time' });
      repaint();
    }

    function cancelDrag(instance) {
      const drag = instance.drag;
      instance.drag = null;
      instance.selection.hidden = true;
      instance.canvas.classList.remove('is-dragging');
      if (drag && instance.canvas.hasPointerCapture(drag.id)) instance.canvas.releasePointerCapture(drag.id);
    }

    function beginRender() {
      cancelAnimationFrame(frame); frame = 0;
      cancelAnimationFrame(cursorFrame); cursorFrame = 0;
      pendingInspection = false;
      instances.forEach(instance => {
        cancelDrag(instance);
        instance.cursor?.remove();
        instance.selection.remove(); instance.tools.remove(); instance.status.remove();
        instance.canvas.removeEventListener('wheel', instance.onWheel);
        for (const [name, handler] of Object.entries(instance.handlers)) {
          if (instance.canvas[name] === handler) instance.canvas[name] = null;
        }
      });
      instances.clear();
    }

    function reset() {
      beginRender(); ranges.clear(); interactionModes.clear(); timeRange = null; inspectedTime = null;
    }

    function resetView(instance) {
      const { config } = instance.context;
      if (config.xType === 'time') {
        timeRange = null;
        instances.forEach(other => { if (other.context.config.xType === 'time') ranges.delete(key(other.context.config)); });
        // Also clear time-chart vertical windows in other tabs.
        for (const [name, range] of ranges) if (range.time) ranges.delete(name);
      } else ranges.delete(key(config));
      repaint();
    }

    function localPoint(instance, event) {
      const rect = instance.canvas.getBoundingClientRect(), plot = instance.context.plot;
      return { x: event.clientX - rect.left, y: event.clientY - rect.top,
        inside: event.clientX >= rect.left + plot.left && event.clientX <= rect.left + plot.left + plot.width && event.clientY >= rect.top + plot.top && event.clientY <= rect.top + plot.top + plot.height };
    }

    function fractions(instance, point) {
      const { plot, config } = instance.context;
      return { x: Math.max(0, Math.min(1, (point.x - plot.left) / plot.width)), y: Math.max(0, Math.min(1, config.invertY ? (point.y - plot.top) / plot.height : 1 - (point.y - plot.top) / plot.height)) };
    }

    function zoom(instance, factor, anchor = { x: .5, y: .5 }) {
      const { view, full } = instance.context;
      commit(instance, { x: V.zoomRange(view.x, factor, anchor.x, full.x), y: V.zoomRange(view.y, factor, anchor.y, full.y) });
    }

    function setMode(instance, mode) {
      cancelDrag(instance);
      instance.mode = mode;
      interactionModes.set(key(instance.context.config), mode);
      instance.canvas.dataset.interaction = mode;
      instance.tools.querySelectorAll('[data-action]').forEach(button => {
        if (['inspect', 'select', 'pan'].includes(button.dataset.action)) button.setAttribute('aria-pressed', String(button.dataset.action === mode));
      });
      updateStatus(instance);
    }

    function number(value, range) {
      const digits = Math.min(12, Math.max(3, 1 - Math.floor(Math.log10(span(range) / 4))));
      return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value);
    }
    function rangeLabel(range, time) {
      return time ? `${options.formatTime(range.min, span(range) < 10000)} — ${options.formatTime(range.max, span(range) < 10000)}` : `${number(range.min, range)} — ${number(range.max, range)}`;
    }

    function updateStatus(instance) {
      const { config, view, full } = instance.context;
      const partial = !same(view.x, full.x) || !same(view.y, full.y);
      instance.canvas.closest('.chart-card').classList.toggle('is-zoomed', partial);
      const hint = instance.mode === 'select' ? '拖出矩形放大，双击还原' : instance.mode === 'pan' ? '按住图面拖动，双击还原' : '移到曲线读数；选择框选或平移开始操作';
      const label = `${config.xLabel}：${rangeLabel(view.x, config.xType === 'time')}；${config.yLabel}：${rangeLabel(view.y, false)}`;
      instance.status.textContent = `${partial ? '局部视图' : '全程'} · ${hint}${config.xType === 'time' ? ' · 时间轴联动' : ''}`;
      instance.status.title = label;
      instance.status.classList.toggle('is-zoomed', partial);
      instance.canvas.dataset.viewport = JSON.stringify(view);
      instance.canvas.dataset.fullViewport = JSON.stringify(full);
      instance.canvas.dataset.plot = JSON.stringify(instance.context.plot);
      instance.canvas.dataset.zoomed = String(partial);
      instance.canvas.dataset.viewRangeLabel = partial ? label : '';
      instance.canvas.setAttribute('aria-label', `${instance.baseLabel}；${partial ? '局部视图；' + label : '全程'}；可用加减键缩放、方向键平移、Home还原`);
      instance.tools.querySelector('[data-action="reset"]').disabled = !partial && !(config.xType === 'time' && timeRange);
    }

    function attach(context) {
      const { canvas } = context;
      let instance = instances.get(canvas);
      if (instance) { instance.context = context; updateStatus(instance); updateCursor(instance); return; }
      const tools = document.createElement('div'); tools.className = 'chart-tools'; tools.setAttribute('aria-label', `${context.config.title}图表操作`);
      const modes = document.createElement('div'); modes.className = 'chart-tool-modes'; modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '图表操作方式');
      const actions = document.createElement('div'); actions.className = 'chart-tool-actions';
      const button = (action, label, title, parent, mode = false) => {
        const control = document.createElement('button'); control.type = 'button'; control.className = 'button ' + (mode ? 'chart-tool-mode' : 'chart-tool-icon'); control.dataset.action = action; control.textContent = label; control.title = title; control.setAttribute('aria-label', title); parent.append(control); return control;
      };
      button('inspect', '查看', '查看采样点', modes, true);
      button('select', '框选放大', '框选放大', modes, true);
      button('pan', '拖动平移', '拖动平移', modes, true);
      button('zoom-in', '＋', '放大图表', actions);
      button('zoom-out', '−', '缩小图表', actions);
      button('reset', '还原', '还原全程', actions);
      tools.append(modes, actions);
      const status = document.createElement('p'); status.className = 'chart-viewport-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const selection = document.createElement('div'); selection.className = 'chart-selection'; selection.hidden = true;
      const wrap = canvas.parentElement; wrap.before(tools, status); wrap.append(selection);
      canvas.tabIndex = 0;
      instance = { canvas, tools, status, selection, context, drag: null, baseLabel: canvas.getAttribute('aria-label'), mode: 'inspect' };
      instances.set(canvas, instance);
      // Mouse users can select immediately; touch users keep normal page scrolling until choosing a tool.
      setMode(instance, interactionModes.get(key(context.config)) || (matchMedia('(pointer: fine)').matches ? 'select' : 'inspect'));

      tools.addEventListener('click', event => {
        const action = event.target.closest('button')?.dataset.action;
        if (['inspect', 'select', 'pan'].includes(action)) setMode(instance, action);
        else if (action === 'zoom-in') zoom(instance, .5);
        else if (action === 'zoom-out') zoom(instance, 2);
        else if (action === 'reset') resetView(instance);
      });
      canvas.onpointerdown = event => {
        if (event.button !== 0 || instance.drag) return;
        const point = localPoint(instance, event);
        if (!point.inside || instance.mode === 'inspect') { instance.context.showTooltip(event); return; }
        if (linked(instance)) scheduleCursor(null, false);
        event.preventDefault(); canvas.focus({ preventScroll: true });
        instance.drag = { id: event.pointerId, start: point, last: point, view: { x: copy(instance.context.view.x), y: copy(instance.context.view.y) }, moved: false };
        canvas.setPointerCapture(event.pointerId);
        instance.context.hideTooltip();
      };
      canvas.onpointermove = event => {
        const drag = instance.drag;
        if (!drag || drag.id !== event.pointerId) { if (!drag) { instance.context.showTooltip(event); hoverTime(instance, event); } return; }
        event.preventDefault();
        const point = localPoint(instance, event), { plot, config, full } = instance.context;
        drag.last = point;
        if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 5 && !drag.moved) return;
        drag.moved = true; instance.context.hideTooltip();
        if (instance.mode === 'select') {
          const x = Math.max(plot.left, Math.min(plot.left + plot.width, point.x));
          const y = Math.max(plot.top, Math.min(plot.top + plot.height, point.y));
          Object.assign(selection.style, { left: `${Math.min(drag.start.x, x)}px`, top: `${Math.min(drag.start.y, y)}px`, width: `${Math.abs(x - drag.start.x)}px`, height: `${Math.abs(y - drag.start.y)}px` }); selection.hidden = false;
        } else {
          canvas.classList.add('is-dragging');
          const dx = -(point.x - drag.start.x) / plot.width * span(drag.view.x);
          const dy = (config.invertY ? -1 : 1) * (point.y - drag.start.y) / plot.height * span(drag.view.y);
          commit(instance, { x: V.panRange(drag.view.x, dx, full.x), y: V.panRange(drag.view.y, dy, full.y) });
        }
      };
      canvas.onpointerup = event => {
        const drag = instance.drag;
        if (!drag || drag.id !== event.pointerId) return;
        const point = localPoint(instance, event);
        if (drag.moved && instance.mode === 'select') {
          const start = fractions(instance, drag.start), end = fractions(instance, point), { full } = instance.context;
          const x = Math.abs(point.x - drag.start.x) >= 6 ? V.selectRange(drag.view.x, start.x, end.x, full.x) : null;
          const y = Math.abs(point.y - drag.start.y) >= 6 ? V.selectRange(drag.view.y, start.y, end.y, full.y) : null;
          if (x || y) commit(instance, { x: x || drag.view.x, y: y || drag.view.y });
        } else if (!drag.moved) instance.context.showTooltip(event);
        cancelDrag(instance);
        hoverTime(instance, event);
      };
      canvas.onpointercancel = () => cancelDrag(instance);
      canvas.onlostpointercapture = () => { if (instance.drag) cancelDrag(instance); };
      canvas.onpointerleave = () => { if (!instance.drag) { instance.context.hideTooltip(); if (linked(instance)) scheduleCursor(null, false); } };
      canvas.ondblclick = event => { if (localPoint(instance, event).inside) { event.preventDefault(); cancelDrag(instance); resetView(instance); } };
      instance.onWheel = event => {
        if (!event.ctrlKey || !localPoint(instance, event).inside) return;
        event.preventDefault(); cancelDrag(instance);
        zoom(instance, Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * .006), fractions(instance, localPoint(instance, event)));
      };
      canvas.addEventListener('wheel', instance.onWheel, { passive: false });
      canvas.onkeydown = event => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const { view, full, config } = instance.context;
        if (event.key === 'Escape') { cancelDrag(instance); setMode(instance, 'inspect'); }
        else if (event.key === 'Home') { cancelDrag(instance); resetView(instance); }
        else if (['+', '='].includes(event.key)) zoom(instance, .5);
        else if (['-', '_'].includes(event.key)) zoom(instance, 2);
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') commit(instance, { x: V.panRange(view.x, span(view.x) * (event.key === 'ArrowLeft' ? -.2 : .2), full.x), y: view.y });
        else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') commit(instance, { x: view.x, y: V.panRange(view.y, span(view.y) * (event.key === 'ArrowUp' ? -1 : 1) * (config.invertY ? 1 : -1) * .2, full.y) });
        else return;
        event.preventDefault();
      };
      instance.handlers = Object.fromEntries(['onpointerdown', 'onpointermove', 'onpointerup', 'onpointercancel', 'onlostpointercapture', 'onpointerleave', 'ondblclick', 'onkeydown'].map(name => [name, canvas[name]]));
      updateStatus(instance);
      updateCursor(instance);
    }

    return { attach, getView, beginRender, reset, setTimeRange, focusTime, inspectTime };
  }

  root.CtdChartInteractions = { create };
}(typeof globalThis !== 'undefined' ? globalThis : this));
