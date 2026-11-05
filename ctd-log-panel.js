(function () {
  'use strict';
  const workspace = document.querySelector('.workspace');
  const link = document.getElementById('logsLink');
  const actions = document.querySelector('.topbar-actions');
  if (!workspace || !link || !actions) return;

  const toggle = document.createElement('button');
  toggle.id = 'toggleLogPane'; toggle.type = 'button'; toggle.className = 'button';
  toggle.setAttribute('aria-controls', 'logSidePanel');
  actions.insertBefore(toggle, link);

  const pane = document.createElement('aside');
  pane.id = 'logSidePanel'; pane.className = 'log-side-panel';
  pane.setAttribute('aria-label', '与 CTD 同屏的日志');
  const header = document.createElement('div'); header.className = 'log-pane-head';
  const title = document.createElement('div');
  const heading = document.createElement('strong'); heading.textContent = '日志对照';
  const hint = document.createElement('small'); hint.textContent = '跟随 CTD 设备与日期 · 当天全部任务';
  title.append(heading, hint);
  const controls = document.createElement('div'); controls.className = 'log-pane-actions';
  link.textContent = '单独打开 ↗';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'button';
  close.textContent = '收起'; close.setAttribute('aria-label', '收起右侧日志');
  controls.append(link, close); header.append(title, controls);

  const frame = document.createElement('iframe');
  frame.id = 'logPaneFrame'; frame.title = '当天 dlog 和 tlog 日志对照';
  const initialUrl = new URL(link.href, location.href); initialUrl.searchParams.set('embedded', '1');
  frame.src = initialUrl.href;
  pane.append(header, frame); workspace.append(pane);

  function setOpen(open) {
    pane.hidden = !open;
    workspace.classList.toggle('with-log-panel', open);
    toggle.textContent = open ? '收起日志' : '显示日志';
    toggle.setAttribute('aria-expanded', String(open));
    // The iframe stays mounted: collapsing never drops files, filters or its scroll position.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  toggle.addEventListener('click', () => setOpen(pane.hidden));
  close.addEventListener('click', () => { setOpen(false); toggle.focus(); });
  const topbar = document.querySelector('.topbar');
  function sizeHeader() {
    if (topbar) document.documentElement.style.setProperty('--ctd-topbar-height', `${Math.ceil(topbar.getBoundingClientRect().height)}px`);
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(sizeHeader).observe(topbar);
  window.addEventListener('resize', sizeHeader); sizeHeader(); setOpen(true);
}());
