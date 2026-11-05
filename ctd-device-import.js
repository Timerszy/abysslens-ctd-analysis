(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./ctd-workspace.js') : root.CtdWorkspace);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CtdDeviceImport = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (CtdWorkspace) {
  'use strict';

  async function append(workspace, entries, options = {}) {
    const before = workspace.getSnapshot().batch;
    const server = options.server === true || before?.meta?.source === 'server';
    const incoming = Array.from(entries || []);
    const retained = [];
    if (server) {
      const request = options.fetch || fetch;
      const read = async url => {
        const response = await request(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`保留当前目录失败（${response.status}），原数据未更改`);
        const payload = await response.json();
        if (payload.errors?.length) throw new Error('当前目录含未读取文件，原数据未更改；请用“导入文件夹”重新选择完整目录');
        return payload;
      };
      const [catalog, logs] = await Promise.all([read('/api/catalog'), read('/api/logs')]);
      const keep = (record, text) => {
        if (typeof text !== 'string') throw new Error('当前目录内容无效，原数据未更改');
        retained.push({ name: record.name, relativePath: record.relativePath, file: new File([text], record.name) });
      };
      for (const record of catalog.records || []) keep(record, record.text);
      const sizes = new Map();
      for (const record of logs.records || []) {
        const size = record.size, scope = record.scopeKey || record.directory || '';
        const total = (sizes.get(scope) || 0) + size;
        if (!Number.isFinite(size) || size < 0 || size > 20 * 1024 * 1024 || total > 80 * 1024 * 1024) {
          throw new Error('当前目录日志过大，原数据未更改；请用“导入文件夹”选择所需设备');
        }
        sizes.set(scope, total);
      }
      for (const record of logs.records || []) {
        const payload = await read('/api/log?path=' + encodeURIComponent(record.relativePath));
        keep(record, payload.text);
      }
    }
    if (workspace.getSnapshot().batch?.id !== before?.id) throw new Error('当前数据已改变，请重新添加设备');
    const meta = { source: 'manual', importMode: 'folder', folderName: '多设备数据', append: true };
    return server ? workspace.replace(CtdWorkspace.mergeEntries(retained, incoming), meta) : workspace.append(incoming, meta);
  }

  return { append };
}));
