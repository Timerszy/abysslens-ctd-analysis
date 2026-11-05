(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ctd-data.js'));
  else root.CtdLogs = factory(root.CtdData);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (data) {
  'use strict';
  const MAX_FILE_BYTES = 20 * 1024 * 1024;

  function beijingTime(time) {
    return Number.isFinite(time) ? new Date(time + 480 * 60000).toISOString().replace('T', ' ').slice(0, 23) : '';
  }

  function fileMeta(name, relativePath = name) {
    const source = String(relativePath || name).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    const base = String(name).replace(/\\/g, '/').split('/').pop();
    const match = base.match(/^(.+)_(\d{6})_(\d+)_(dlog|tlog)_.*?interval(\d+)[^/]*\.(txt|log|dlog|tlog)$/i);
    if (!match) return null;
    const date = match[2], day = `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)}`;
    if (data.parseTime(day) === null) return null;
    const parts = source.split('/'); parts.pop();
    if (parts[parts.length - 1] === date || parts[parts.length - 1] === day) parts.pop();
    const directory = parts.join('/'), device = match[1];
    return { id: source, name: base, relativePath: source, date, day, profile: String(Number(match[3])),
      kind: match[4].toLowerCase(), interval: Number(match[5]), device, directory,
      scopeKey: JSON.stringify([directory, device.toLowerCase()]), scopeLabel: `${directory || '当前目录'} · ${device}` };
  }

  function decode(bytes) {
    const decoded = data.decodeBytes(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f]/.test(decoded.text)) {
      throw new Error('不是可读取的文本日志，可能是二进制文件');
    }
    return decoded;
  }

  function parse(text, source) {
    const rows = [];
    // Capture separators so a two-line record keeps its exact original text.
    const parts = String(text).replace(/^\ufeff/, '').split(/(\r\n|\n|\r)/);
    let pending = null;
    for (let index = 0; index < parts.length; index += 2) {
      const raw = parts[index], line = index / 2 + 1;
      if (!raw.trim()) { pending = null; continue; }
      const match = raw.match(/^\s*\[?(\d{4}[-/]\d{2}[-/]\d{2}[T_ ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)\]?\s*/i);
      // Only a timestamp-only header can timestamp its immediate next line.
      // Consume it once; never inherit across blanks, new timestamps or files.
      if (pending && !match) {
        pending.text += parts[index - 1] + raw;
        pending.message = raw;
        pending.lineEnd = line;
        pending = null;
        continue;
      }
      pending = null;
      const timeRaw = match ? match[1] : '', time = data.parseTime(timeRaw);
      const local = beijingTime(time);
      const row = { id: `${source.id}:${line}`, kind: source.kind, scopeKey: source.scopeKey,
        source: source.relativePath || source.name, profile: source.profile, line, lineEnd: line, timeLine: time === null ? null : line,
        time, timeRaw, day: local ? local.slice(0, 10) : source.day, dayBasis: local ? 'timestamp' : 'filename',
        text: raw, message: match && time !== null ? raw.slice(match[0].length) : raw };
      rows.push(row);
      if (time !== null && !row.message.trim()) pending = row;
    }
    return rows;
  }

  function filterRows(rows, options = {}) {
    const query = String(options.query || '').trim().toLocaleLowerCase();
    const start = options.start ? options.start.length === 5 ? `${options.start}:00` : options.start : '';
    const end = options.end ? options.end.length === 5 ? `${options.end}:59` : options.end : '';
    if (start && end && start > end) return [];
    return rows.filter(row => {
      if (options.scopeKey && row.scopeKey !== options.scopeKey) return false;
      if (options.day && row.day !== options.day) return false;
      if (options.types && !options.types.includes(row.kind)) return false;
      if (query && !`${row.text}\n${row.source}\n${row.profile}`.toLocaleLowerCase().includes(query)) return false;
      if (start || end) {
        if (row.time === null) return false;
        const clock = beijingTime(row.time).slice(11, 19);
        if ((start && clock < start) || (end && clock > end)) return false;
      }
      return true;
    }).sort((a, b) => (a.time === null) - (b.time === null) || (a.time === null ? 0 : a.time - b.time) || a.source.localeCompare(b.source) || a.line - b.line);
  }

  return { MAX_FILE_BYTES, fileMeta, decode, parse, filterRows, beijingTime };
}));
