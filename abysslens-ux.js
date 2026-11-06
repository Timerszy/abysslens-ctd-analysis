(function () {
  'use strict';
  const workspace = document.querySelector('.analysis-page .workspace');
  const sidebar = workspace?.querySelector('.sidebar');
  const actions = document.querySelector('.topbar-actions');
  if (!workspace || !sidebar || !actions) return;

  // Only layout preferences are stored; imported instrument files stay in memory.
  function readPreference(key) { try { return localStorage.getItem('abysslens.ui.' + key); } catch { return null; } }
  function writePreference(key, value) { try { if (value === null) localStorage.removeItem('abysslens.ui.' + key); else localStorage.setItem('abysslens.ui.' + key, value); } catch { /* Layout also works with storage disabled. */ } }
  let resizeFrame;
  function redraw() { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); }

  const skip = document.createElement('a');
  skip.className = 'skip-link'; skip.href = '#chartsGrid'; skip.textContent = '跳到图表';
  document.body.prepend(skip);
  const charts = document.getElementById('chartsGrid');
  charts.tabIndex = -1;

  sidebar.id = 'dataSettings'; sidebar.setAttribute('aria-label', '数据来源和图表设置');
  const settings = document.createElement('button');
  settings.id = 'toggleSettings'; settings.className = 'button'; settings.type = 'button';
  settings.setAttribute('aria-controls', sidebar.id);
  actions.insertBefore(settings, document.getElementById('exportButton'));
  const wideScreen = matchMedia('(min-width: 1101px)');
  let savedSettings = readPreference('settings');
  function showSettings(open, remember = false) {
    sidebar.hidden = !open; workspace.classList.toggle('sidebar-collapsed', !open);
    settings.textContent = open ? '收起设置' : '数据设置'; settings.setAttribute('aria-expanded', String(open));
    if (remember) { savedSettings = open ? 'open' : 'closed'; writePreference('settings', savedSettings); }
    redraw();
  }
  showSettings(savedSettings === 'open' || (savedSettings !== 'closed' && wideScreen.matches));
  settings.addEventListener('click', () => showSettings(sidebar.hidden, true));
  wideScreen.addEventListener('change', () => { if (savedSettings !== 'open' && savedSettings !== 'closed') showSettings(wideScreen.matches); });

  const sourceActions = document.getElementById('sourceActions');
  const demo = document.getElementById('demoButton');
  if (demo && sourceActions) {
    demo.textContent = '载入示例数据'; sourceActions.append(demo);
  }

  const taskSelect = document.getElementById('taskSelect');
  const folderPanel = document.getElementById('folderPanel');
  if (taskSelect && folderPanel) {
    const context = document.getElementById('taskContext');
    const navigation = document.createElement('div'); navigation.className = 'task-navigation'; navigation.setAttribute('aria-label', '切换文件夹任务');
    const previous = document.createElement('button'), next = document.createElement('button'), position = document.createElement('output');
    previous.type = next.type = 'button'; previous.className = next.className = 'button';
    previous.id = 'previousTask'; next.id = 'nextTask'; position.id = 'taskPosition'; position.setAttribute('aria-live', 'polite');
    previous.textContent = '上一任务'; next.textContent = '下一任务'; navigation.append(previous, position, next); taskSelect.after(navigation);
    function taskOptions() { return Array.from(taskSelect.options).filter(option => !option.disabled && option.value); }
    function updateNavigation() {
      const options = taskOptions(), index = options.findIndex(option => option.value === taskSelect.value);
      previous.disabled = taskSelect.disabled || index <= 0;
      next.disabled = taskSelect.disabled || index < 0 || index >= options.length - 1;
      position.textContent = `${index + 1} / ${options.length}`;
      const selected = options[index];
      context.textContent = selected?.dataset.day || '';
      context.hidden = !context.textContent;
    }
    function stepTask(direction) {
      const options = taskOptions(), index = options.findIndex(option => option.value === taskSelect.value);
      const target = options[index + direction];
      if (!target || taskSelect.disabled) return;
      taskSelect.value = target.value;
      taskSelect.dispatchEvent(new Event('change', { bubbles: true })); updateNavigation();
    }
    previous.addEventListener('click', () => stepTask(-1)); next.addEventListener('click', () => stepTask(1));
    taskSelect.addEventListener('change', updateNavigation);
    taskSelect.addEventListener('ctd-task-selection', updateNavigation);
    new MutationObserver(updateNavigation).observe(taskSelect, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    updateNavigation();
  }

  const tabs = Array.from(document.querySelectorAll('.view-tabs .tab'));
  document.querySelector('.view-tabs')?.setAttribute('role', 'tablist');
  charts.setAttribute('role', 'tabpanel');
  function updateTabs() {
    tabs.forEach(tab => { const selected = tab.classList.contains('active'); tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; if (selected) charts.setAttribute('aria-labelledby', tab.id); });
  }
  tabs.forEach((tab, index) => {
    tab.id = 'view-' + tab.dataset.mode; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', charts.id);
    tab.addEventListener('click', updateTabs);
    tab.addEventListener('keydown', event => {
      const target = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (target < 0) return;
      event.preventDefault(); tabs[target].click(); tabs[target].focus();
    });
    new MutationObserver(updateTabs).observe(tab, { attributes: true, attributeFilter: ['class'] });
  });
  updateTabs();

  const logPane = document.getElementById('logSidePanel');
  if (logPane) {
    const widthControl = document.createElement('div'); widthControl.className = 'log-width-control';
    const label = document.createElement('label'), input = document.createElement('input'), value = document.createElement('output'), reset = document.createElement('button');
    label.htmlFor = 'logPaneWidth'; label.textContent = '日志宽度';
    input.id = 'logPaneWidth'; input.type = 'range'; input.min = '340'; input.max = '600'; input.step = '20';
    input.setAttribute('aria-describedby', 'logPaneWidthValue'); value.id = 'logPaneWidthValue';
    reset.type = 'button'; reset.className = 'button subtle'; reset.textContent = '重置'; reset.setAttribute('aria-label', '重置日志宽度');
    const stored = Number(readPreference('logWidth'));
    input.value = String(Number.isFinite(stored) && stored >= 340 && stored <= 600 ? Math.round(stored / 20) * 20 : 400);
    function applyWidth(remember = false) {
      const width = Number(input.value); workspace.style.setProperty('--log-pane-width', `${width}px`); value.textContent = `${width}px`; input.setAttribute('aria-valuetext', `${width} 像素`);
      if (remember) writePreference('logWidth', String(width)); redraw();
    }
    input.addEventListener('input', () => applyWidth(true));
    reset.addEventListener('click', () => { input.value = '400'; writePreference('logWidth', null); applyWidth(); });
    widthControl.append(label, input, value, reset); logPane.querySelector('.log-pane-head').after(widthControl); applyWidth();
  }
}());
