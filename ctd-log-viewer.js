(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const state = { records: [], rows: [], cache: new Map(), generation: 0, page: 0, kind: '', folderName: '', day: '', scopeKey: '', failures: [], pendingSelection: null, loadingBatch: false, batchLoadToken: 0 };
  const PAGE_SIZE = 200, MAX_SCOPE_BYTES = 80 * 1024 * 1024;
  const localService = location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const quickKeywords = Array.from(document.querySelectorAll('[data-log-query]'));
  function markQuickKeyword(query) { quickKeywords.forEach(button => button.setAttribute('aria-pressed', String(query !== null && button.dataset.logQuery === query))); }
  function notice(messages) { $('loadMessage').textContent = messages.filter(Boolean).join('\n'); $('loadMessage').hidden = !messages.filter(Boolean).length; }
  function option(value, label) { const element = document.createElement('option'); element.value = value; element.textContent = label; return element; }
  function clearFilters() { $('searchInput').value = ''; markQuickKeyword(''); $('startTime').value = ''; $('endTime').value = ''; $('showDlog').checked = $('showTlog').checked = true; state.page = 0; }
  function setBusy() { $('loadStatus').textContent = '正在读取日志…'; $('logRows').replaceChildren(); $('emptyState').hidden = false; $('emptyState').textContent = '正在读取当前设备的日志，请稍候…'; $('resultCount').textContent = '正在读取'; $('sourceSummary').textContent = ''; $('prevPage').disabled = $('nextPage').disabled = true; }

  function asFileEntries(fileList) {
    return Array.from(fileList || []).map(item => {
      if (item && item.file) return { file: item.file, name: item.name || item.file.name, relativePath: item.relativePath || item.name || item.file.name };
      return { file: item, name: item.name, relativePath: item.webkitRelativePath || item.name };
    });
  }

  function sharedFileEntries(fileList) {
    return asFileEntries(fileList).filter(entry => /\.csv$/i.test(entry.name) || /_(?:dlog|tlog)_.*\.(?:txt|log|dlog|tlog)$/i.test(entry.name));
  }

  function publishImport(fileList, importMode) {
    const entries = sharedFileEntries(fileList);
    const firstPath = entries[0]?.relativePath || '';
    const folderName = firstPath.split(/[\\/]+/).filter(Boolean)[0] || (importMode === 'folder' ? '已选文件夹' : '单独选取');
    state.pendingSelection = null;
    workspace.replace(entries, { source: 'manual', importMode, folderName });
  }

  async function install(records, settings) {
    state.generation++; state.records = records; state.rows = []; state.cache.clear(); state.kind = settings.kind;
    state.folderName = settings.folderName; state.failures = settings.failures || [];
    state.day = settings.day || state.pendingSelection?.day || ''; state.scopeKey = '';
    clearFilters(); $('scopeSelect').replaceChildren(); $('dateSelect').replaceChildren();
    const groups = new Map(); records.forEach(record => {
      if (groups.has(record.scopeKey)) return;
      const parts = record.directory.split('/').filter(Boolean), device = parts.pop();
      const label = settings.kind !== 'files' && device
        ? `${device} · ${record.device}${parts.length ? ' · 来源 ' + parts.join('/') : ''}`
        : record.scopeLabel;
      groups.set(record.scopeKey, label);
    });
    const requestedScope = settings.scopeKey || state.pendingSelection?.scopeKey || '';
    if (requestedScope && !groups.has(requestedScope)) {
      groups.set(requestedScope, 'CTD 所选来源（未发现日志）');
      state.failures.push('当前 CTD 来源没有找到日志，未自动切换到其他设备。请导入相应设备的日志文件夹。');
    }
    groups.forEach((label, key) => { const item = option(key, label); item.title = label; $('scopeSelect').append(item); });
    $('scopeSelect').disabled = !groups.size; $('dateSelect').disabled = true;
    $('scopeHint').textContent = settings.kind === 'files' ? '零散文件已作为独立批次载入，不与原目录拼接。文件名不含设备 ID，请确认它们来自同一设备；跨设备请用“添加设备”选取完整设备目录。' : `来源：${settings.folderName}；“添加设备”保留已载入数据，“导入日志文件夹”替换整批数据。不同设备分开查看，同设备当天所有任务一起显示。`;
    if (!groups.size) { state.scopeKey = ''; render(); notice([...state.failures, '未找到命名包含 _dlog_ 或 _tlog_ 的日志文件。CTD、mot 等二进制 TXT 副本不会作为日志读取。']); $('loadStatus').textContent = '无日志'; return; }
    $('scopeSelect').value = groups.has(requestedScope) ? requestedScope : groups.keys().next().value;
    await loadScope();
  }

  async function applySelection(context) {
    if (!context || !context.scopeKey) return;
    state.pendingSelection = { day: context.day || '', scopeKey: context.scopeKey };
    if (!state.records.length) {
      if (!state.loadingBatch) await install([], { kind: state.kind || 'folder', folderName: state.folderName || '当前共享批次', failures: [] });
      return;
    }
    Array.from($('scopeSelect').options).filter(item => item.dataset.missing === 'true').forEach(item => item.remove());
    let target = Array.from($('scopeSelect').options).find(item => item.value === context.scopeKey);
    if (!target) {
      target = option(context.scopeKey, 'CTD 所选来源（未发现日志）');
      target.dataset.missing = 'true';
      $('scopeSelect').append(target);
    }
    state.day = context.day || '';
    $('scopeSelect').value = context.scopeKey;
    await loadScope();
  }

  async function loadScope() {
    const version = ++state.generation, key = $('scopeSelect').value;
    state.scopeKey = key; state.rows = []; state.page = 0; setBusy(); $('dateSelect').disabled = true;
    const sourceRecords = state.records.filter(record => record.scopeKey === key), errors = [...state.failures];
    if (!sourceRecords.length && key) errors.push('当前 CTD 来源没有日志，未自动切换到其他设备。');
    const cached = state.cache.get(key);
    if (cached) { state.rows = cached.rows; errors.push(...cached.errors); }
    else {
      const rows = [], readErrors = []; let total = 0;
      for (const record of sourceRecords) {
        if (version !== state.generation) return;
        try {
          if (record.size > CtdLogs.MAX_FILE_BYTES) throw new Error('超过单文件 20 MiB 上限，未读取');
          if (total + record.size > MAX_SCOPE_BYTES) throw new Error('超过当前设备 80 MiB 读取上限，请缩小导入范围');
          total += record.size;
          let decoded;
          if (record.file) decoded = CtdLogs.decode(await record.file.arrayBuffer());
          else {
            const response = await fetch('/api/log?path=' + encodeURIComponent(record.relativePath), { cache: 'no-store' });
            const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `读取失败 ${response.status}`); decoded = payload;
          }
          if (version !== state.generation) return;
          record.encoding = decoded.encoding;
          const parsed = CtdLogs.parse(decoded.text, record);
          record.rowCount = parsed.length;
          for (const row of parsed) rows.push(row);
        } catch (error) { readErrors.push(`${record.relativePath}：${error.message}`); }
      }
      if (version !== state.generation) return;
      state.rows = rows; state.cache.set(key, { rows, errors: readErrors }); errors.push(...readErrors);
    }
    if (version !== state.generation) return;
    const days = [...new Set([...sourceRecords.map(record => record.day), ...state.rows.map(row => row.day), state.day].filter(Boolean))].sort().reverse();
    const preferred = state.day || sourceRecords.map(record => record.day).sort().reverse()[0];
    $('dateSelect').replaceChildren(...days.map(day => option(day, day)));
    $('dateSelect').value = days.includes(preferred) ? preferred : days[0]; state.day = $('dateSelect').value;
    $('dateSelect').disabled = !days.length; notice(errors); $('loadStatus').textContent = `已载入 ${sourceRecords.length} 份日志 · ${state.rows.length} 条${errors.length ? '（部分未读取）' : ''}`;
    render();
  }

  function render() {
    state.day = $('dateSelect').value || '';
    const all = CtdLogs.filterRows(state.rows, { scopeKey: state.scopeKey, day: state.day });
    const types = [$('showDlog').checked ? 'dlog' : '', $('showTlog').checked ? 'tlog' : ''].filter(Boolean);
    const rows = CtdLogs.filterRows(all, { query: $('searchInput').value, types, start: $('startTime').value, end: $('endTime').value });
    const dayFiles = state.records.filter(record => record.scopeKey === state.scopeKey && (record.day === state.day || all.some(row => row.source === record.relativePath)));
    const dlog = dayFiles.filter(record => record.kind === 'dlog').length, tlog = dayFiles.filter(record => record.kind === 'tlog').length;
    $('resultCount').textContent = `${state.day || '当天'} · ${rows.length} / ${all.length} 条记录`;
    $('sourceSummary').textContent = `dlog ${dlog} 份 / tlog ${tlog} 份 · 全部任务${!dlog ? ' · 当天未载入 dlog' : ''}${!tlog ? ' · 当天未载入 tlog' : ''}`;
    const hints = [], untimed = all.filter(row => row.time === null).length;
    if (untimed) hints.push(`${untimed} 行无法识别时间，按文件名日期归组并放在末尾；启用时间筛选后不显示这些行。`);
    if ($('startTime').value && $('endTime').value && $('startTime').value > $('endTime').value) hints.push('开始时间晚于结束时间，请调整筛选；跨午夜请分别选择两天。');
    $('filterMessage').textContent = hints.join('\n'); $('filterMessage').hidden = !hints.length;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); state.page = Math.min(state.page, pages - 1);
    $('logRows').replaceChildren();
    for (const row of rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE)) {
      const tr = document.createElement('tr'); tr.dataset.kind = row.kind; tr.dataset.profile = row.profile;
      function cell(className) { const td = document.createElement('td'); td.className = className; tr.append(td); return td; }
      const timeCell = cell('time-cell time'); timeCell.textContent = row.time === null ? '时间不明' : CtdLogs.beijingTime(row.time).slice(0, 19);
      const kind = document.createElement('span'); kind.className = `badge ${row.kind}`; kind.textContent = row.kind.toUpperCase(); cell('kind-cell').append(kind);
      cell('task-cell').textContent = row.profile == null ? '任务未知' : `任务 ${row.profile}`;
      const messageCell = cell('message-cell'), message = document.createElement('div'); message.className = 'message'; message.textContent = row.message; messageCell.append(message);
      const multiline = row.lineEnd > row.line;
      const raw = document.createElement('details'); raw.className = 'raw'; const summary = document.createElement('summary'); summary.textContent = multiline ? '原始记录（含时间行）' : '原始行'; const pre = document.createElement('pre'); pre.textContent = row.text; raw.append(summary, pre); messageCell.append(raw);
      const source = cell('source-cell source'), sourcePath = document.createElement('span'); sourcePath.className = 'source-path'; sourcePath.textContent = row.source; source.append(sourcePath); const line = document.createElement('small'); line.textContent = `原行 ${row.line}${multiline ? `–${row.lineEnd} · 时间来自原行 ${row.timeLine}` : ''}${row.dayBasis === 'filename' ? ' · 日期来自文件名' : ''}`; source.append(line);
      $('logRows').append(tr);
    }
    $('emptyState').hidden = rows.length > 0;
    $('emptyState').textContent = !state.records.length ? '请导入日志文件夹或选择同一设备的多个 dlog / tlog 文件。' : !all.length ? '该设备当天没有已读取的日志记录。可选择其他日期，或导入含当天 dlog 和 tlog 的目录。' : '没有符合当前筛选条件的记录。可以重置筛选查看全天日志。';
    $('pageInfo').textContent = `第 ${state.page + 1} / ${pages} 页 · 每页 200 条 · 共 ${rows.length} 条`;
    $('prevPage').disabled = state.page === 0; $('nextPage').disabled = state.page >= pages - 1;
    $('fileListTitle').textContent = `当天来源文件（${dayFiles.length}）`;
    $('fileList').replaceChildren(); dayFiles.forEach(record => { const li = document.createElement('li'); li.textContent = `${record.relativePath} · ${record.encoding || '未读取'} · ${record.rowCount == null ? '读取未完成' : record.rowCount + ' 条记录'}`; $('fileList').append(li); });
  }

  async function importFiles(files, folder, settings = {}) {
    const records = [], skipped = [];
    for (const entry of asFileEntries(files)) {
      const meta = CtdLogs.fileMeta(entry.name, entry.relativePath);
      if (!meta) { if (!folder && !/\.csv$/i.test(entry.name)) skipped.push(`${entry.name}：不是受支持的 dlog / tlog 文件名`); continue; }
      records.push({ ...meta, size: entry.file.size, file: entry.file, scopeLabel: folder ? meta.scopeLabel : `单独选取（设备未核验） · ${meta.device}` });
    }
    await install(records, { kind: folder ? 'folder' : 'files', folderName: settings.folderName || (folder ? '已导入文件夹' : '单独选取'), failures: skipped, scopeKey: settings.scopeKey, day: settings.day });
  }

  function receiveWorkspaceBatch(batch) {
    state.pendingSelection = batch.meta?.append && state.scopeKey ? { scopeKey: state.scopeKey, day: state.day } : null;
    state.generation++;
    state.records = []; state.rows = []; state.cache.clear();
    setBusy();
    const loadToken = ++state.batchLoadToken;
    state.loadingBatch = true;
    const loading = batch.meta?.source === 'server'
      ? scanCurrent(false)
      : importFiles(batch.entries, batch.meta?.importMode !== 'files', { folderName: batch.meta?.folderName });
    Promise.resolve(loading).finally(() => { if (loadToken === state.batchLoadToken) state.loadingBatch = false; });
  }

  async function addDevice(files) {
    const entries = sharedFileEntries(files);
    if (!entries.length) { notice(['所选目录没有 CTD CSV 或 dlog / tlog 文件，原有数据已保留。']); return; }
    const button = $('addLogDevice');
    button.disabled = true;
    try {
      const result = await CtdDeviceImport.append(workspace, entries, { server: state.kind === 'server' });
      // Preserve the latest chosen device after any asynchronous server-file read.
      const selection = { scopeKey: state.scopeKey, day: state.day };
      state.pendingSelection = selection;
      await importFiles(result.batch.entries, true, { folderName: result.batch.meta.folderName, ...selection });
    } catch (error) { notice([`添加设备未完成：${error.message}。原有数据已保留。`]); }
    finally { button.disabled = false; }
  }

  async function scanCurrent(useQuery = false) {
    if (!localService) { notice(['在线页面请导入日志文件夹或选择日志文件；数据只在本机浏览器中处理。']); return; }
    const version = ++state.generation; setBusy();
    try {
      const response = await fetch('/api/logs', { cache: 'no-store' }); if (!response.ok) throw new Error('目录服务尚未支持日志扫描，请重启启动程序，或直接导入日志文件夹');
      const payload = await response.json(); if (version !== state.generation) return;
      const records = (payload.records || []).map(record => ({ ...record, scopeLabel: `${record.directory || payload.folderName} · ${record.device}` }));
      await install(records, { kind: 'server', folderName: payload.folderName, failures: (payload.errors || []).map(error => `${error.relativePath}：${error.message}`), day: useQuery ? params.get('day') : '', scopeKey: useQuery ? params.get('scope') : '' });
    } catch (error) { if (version !== state.generation) return; state.rows = []; notice([error.message]); render(); $('loadStatus').textContent = '扫描未完成'; }
  }

  $('openFiles').addEventListener('click', () => $('fileInput').click());
  $('openFolder').addEventListener('click', () => $('folderInput').click());
  $('addLogDevice').addEventListener('click', () => $('addLogDeviceInput').click());
  $('fileInput').addEventListener('change', event => { publishImport(event.target.files, 'files'); importFiles(event.target.files, false); event.target.value = ''; });
  $('folderInput').addEventListener('change', event => { publishImport(event.target.files, 'folder'); importFiles(event.target.files, true); event.target.value = ''; });
  $('addLogDeviceInput').addEventListener('change', event => { addDevice(event.target.files); event.target.value = ''; });
  $('localButton').hidden = !localService;
  $('localButton').addEventListener('click', () => scanCurrent());
  $('scopeSelect').addEventListener('change', () => { state.day = ''; clearFilters(); loadScope(); });
  $('dateSelect').addEventListener('change', () => { state.page = 0; render(); });
  quickKeywords.forEach(button => button.addEventListener('click', () => { $('searchInput').value = button.dataset.logQuery; markQuickKeyword(button.dataset.logQuery); state.page = 0; render(); }));
  $('searchInput').addEventListener('input', () => { markQuickKeyword(null); state.page = 0; render(); });
  ['startTime', 'endTime'].forEach(id => $(id).addEventListener('input', () => { state.page = 0; render(); }));
  ['showDlog', 'showTlog'].forEach(id => $(id).addEventListener('change', () => { state.page = 0; render(); }));
  $('resetFilters').addEventListener('click', () => { clearFilters(); render(); });
  $('prevPage').addEventListener('click', () => { state.page--; render(); });
  $('nextPage').addEventListener('click', () => { state.page++; render(); });
  const workspace = CtdWorkspace.createClient({
    onBatch: receiveWorkspaceBatch,
    onSelection: applySelection,
    onStatus: status => { $('workspaceStatus').textContent = status.message; }
  });

  if (localService) scanCurrent(true);
  else notice(['选择日志文件或导入文件夹即可查看。导入的数据只在本机浏览器中处理。']);
}());
