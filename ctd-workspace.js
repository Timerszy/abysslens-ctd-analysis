(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CtdWorkspace = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const APP = 'ctd-workspace';
  const VERSION = 1;
  const DEFAULT_CHANNEL = 'ctd-studio-workspace-v1';

  function randomId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function compareRevision(left, right) {
    if (!left) return right ? -1 : 0;
    if (!right) return 1;
    const counter = Number(left.counter) - Number(right.counter);
    return counter || String(left.clientId).localeCompare(String(right.clientId));
  }

  function validRevision(value) {
    return value && Number.isSafeInteger(value.counter) && value.counter > 0 && typeof value.clientId === 'string';
  }

  function normalizeEntries(entries) {
    return Array.from(entries || []).map(entry => {
      const file = entry && entry.file;
      if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('Each workspace entry must contain a File or Blob');
      const name = String(entry.name || file.name || '').trim();
      if (!name) throw new TypeError('Each workspace entry must have a name');
      return { file, name, relativePath: String(entry.relativePath || name) };
    });
  }

  function mergeEntries(existing, incoming) {
    const merged = new Map();
    for (const entry of [...normalizeEntries(existing), ...normalizeEntries(incoming)]) {
      const relativePath = entry.relativePath.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
      merged.set(relativePath, { ...entry, relativePath });
    }
    return Array.from(merged.values());
  }

  function createClient(options = {}) {
    const protocol = options.protocol || (typeof location !== 'undefined' ? location.protocol : '');
    const clientId = options.clientId || randomId();
    const onBatch = typeof options.onBatch === 'function' ? options.onBatch : function () {};
    const onSelection = typeof options.onSelection === 'function' ? options.onSelection : function () {};
    const onStatus = typeof options.onStatus === 'function' ? options.onStatus : function () {};
    const channelFactory = options.channelFactory || (typeof BroadcastChannel === 'function' ? name => new BroadcastChannel(name) : null);
    let channel = null;
    let closed = false;
    let counter = 0;
    let batch = null;
    let selection = null;

    function status(kind, message) {
      onStatus({ kind, message });
    }

    const supported = /^https?:$/.test(protocol) && Boolean(channelFactory);
    if (!supported) {
      status('unsupported', protocol === 'file:'
        ? '离线 file:// 页面各自独立导入；使用本地服务可在页面间共享。'
        : '当前浏览器不支持页面间共享；各页面仍可独立导入。');
    }

    function observe(revision) {
      if (validRevision(revision)) counter = Math.max(counter, revision.counter);
    }

    function nextRevision() {
      counter += 1;
      return { counter, clientId };
    }

    function message(kind, payload) {
      return { app: APP, version: VERSION, kind, sender: clientId, ...payload };
    }

    function post(kind, payload, successMessage) {
      if (!channel || closed) return false;
      try {
        channel.postMessage(message(kind, payload));
        if (successMessage) status('shared', successMessage);
        return true;
      } catch (error) {
        status('error', `页面间共享失败：${error && error.message ? error.message : error}`);
        return false;
      }
    }

    function acceptBatch(candidate) {
      if (!candidate || typeof candidate.id !== 'string' || !validRevision(candidate.revision) || !Array.isArray(candidate.entries)) return false;
      observe(candidate.revision);
      if (batch && compareRevision(candidate.revision, batch.revision) <= 0) return false;
      let entries;
      try { entries = normalizeEntries(candidate.entries); }
      catch (error) { status('error', `收到的共享批次无效：${error.message}`); return false; }
      batch = { id: candidate.id, revision: candidate.revision, entries, meta: candidate.meta || {} };
      selection = null;
      onBatch(batch);
      status('received', '已接收另一页面导入的数据批次。');
      return true;
    }

    function acceptSelection(candidate) {
      if (!batch || !candidate || candidate.batchId !== batch.id || !validRevision(candidate.revision)) return false;
      observe(candidate.revision);
      if (selection && compareRevision(candidate.revision, selection.revision) <= 0) return false;
      selection = { batchId: candidate.batchId, revision: candidate.revision, context: candidate.context || {} };
      onSelection(selection.context);
      return true;
    }

    function handle(event) {
      const data = event && event.data;
      if (!data || data.app !== APP || data.version !== VERSION || data.sender === clientId) return;
      if (data.kind === 'request') {
        if (batch) post('snapshot', { to: data.sender, batch, selection });
        return;
      }
      if (data.kind === 'snapshot') {
        if (data.to !== clientId) return;
        acceptBatch(data.batch);
        acceptSelection(data.selection);
        return;
      }
      if (data.kind === 'batch') acceptBatch(data.batch);
      else if (data.kind === 'selection') acceptSelection(data.selection);
    }

    if (supported) {
      try {
        channel = channelFactory(options.channelName || DEFAULT_CHANNEL);
        channel.onmessage = handle;
        channel.onmessageerror = () => status('error', '收到的共享数据无法读取；本页可继续独立导入。');
        status('ready', '页面间共享已就绪；导入会替换所有已打开页面的数据。');
        post('request', {});
      } catch (error) {
        channel = null;
        status('error', `页面间共享不可用：${error && error.message ? error.message : error}`);
      }
    }

    function replace(entries, meta = {}) {
      const normalized = normalizeEntries(entries);
      const revision = nextRevision();
      batch = { id: randomId(), revision, entries: normalized, meta };
      selection = null;
      const shared = post('batch', { batch }, '本次导入已发送到其他已打开页面。');
      return { batch, shared };
    }

    function append(entries, meta = {}) {
      return replace(mergeEntries(batch?.entries, entries), { ...(batch?.meta || {}), ...meta });
    }

    function select(context) {
      if (!batch) return false;
      selection = { batchId: batch.id, revision: nextRevision(), context: { ...(context || {}) } };
      return post('selection', { selection });
    }

    function getSnapshot() {
      return { batch, selection };
    }

    function close() {
      if (closed) return;
      closed = true;
      if (channel) channel.close();
      channel = null;
    }

    return { replace, append, select, getSnapshot, isSupported: () => supported && Boolean(channel), close };
  }

  return { createClient, mergeEntries };
}));
