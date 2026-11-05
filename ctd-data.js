(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CtdData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function decodeBytes(buffer) {
    let bytes;
    if (ArrayBuffer.isView(buffer)) {
      bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      bytes = new Uint8Array(buffer);
    }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
    } catch (_) {
      return { text: new TextDecoder('gb18030', { fatal: true }).decode(bytes), encoding: 'GB18030' };
    }
  }

  function delimiterOf(text) {
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (character === '"') {
        if (quoted && text[index + 1] === '"') index++;
        else quoted = !quoted;
      } else if (!quoted) {
        if (character === '\n' || character === '\r') break;
        if (Object.prototype.hasOwnProperty.call(counts, character)) counts[character]++;
      }
    }
    return Object.keys(counts).reduce((best, candidate) => counts[candidate] > counts[best] ? candidate : best, ',');
  }

  function parseDelimited(value) {
    const text = String(value == null ? '' : value).replace(/^\ufeff/, '');
    const delimiter = delimiterOf(text);
    const table = [];
    let row = [], cell = '', quoted = false;
    function pushRow() {
      row.push(cell);
      if (row.some(value => value.trim() !== '')) table.push(row);
      row = [];
      cell = '';
    }
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (character === '"') {
        if (quoted && text[index + 1] === '"') {
          cell += '"';
          index++;
        } else if (quoted || cell === '') {
          quoted = !quoted;
        } else {
          cell += character;
        }
      } else if (!quoted && character === delimiter) {
        row.push(cell);
        cell = '';
      } else if (!quoted && (character === '\r' || character === '\n')) {
        pushRow();
        if (character === '\r' && text[index + 1] === '\n') index++;
      } else {
        cell += character;
      }
    }
    if (quoted) throw new Error('CSV 引号未闭合，请检查原始文件。');
    if (cell !== '' || row.length) pushRow();
    if (!table.length) return { headers: [], rows: [] };
    const headers = table.shift().map(header => header.trim());
    while (headers.length && headers[headers.length - 1] === '') headers.pop();
    return {
      headers,
      rows: table.map(values => headers.map((_, index) => values[index] == null ? '' : values[index]))
    };
  }

  function number(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function parseTime(value, utc = false) {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T_ ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const hour = Number(match[4] || 0), minute = Number(match[5] || 0), second = Number(match[6] || 0);
    const millisecond = Number((match[7] || '').padEnd(3, '0').slice(0, 3));
    if (year === 1970 || year < 100 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
    const local = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    const check = new Date(local);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    let offset = utc ? 0 : 480;
    if (match[8]) {
      if (match[8].toUpperCase() === 'Z') offset = 0;
      else {
        const zone = match[8].replace(':', '');
        const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(3, 5));
        if (hours > 23 || minutes > 59) return null;
        offset = (hours * 60 + minutes) * (zone[0] === '-' ? -1 : 1);
      }
    }
    return local - offset * 60000;
  }

  function normalizePath(value) {
    return String(value).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^(\.\/)+/, '');
  }

  function fileMeta(name, relativePath = name) {
    if (typeof name !== 'string') return null;
    const base = normalizePath(name).split('/').pop();
    const match = base.match(/^(.+)_(\d{6})_(\d+)_(ctd\d*|mot\d*|keydata|level)_[^/]*?interval(\d+)[^/]*\.csv$/i);
    if (!match) return null;
    const date = match[2];
    const dateText = `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)}`;
    if (parseTime(dateText) === null) return null;
    const normalized = normalizePath(relativePath || base);
    const slash = normalized.lastIndexOf('/');
    const parent = slash < 0 ? '' : normalized.slice(0, slash);
    const profile = String(Number(match[3]));
    const sourceKind = match[4].toLowerCase();
    return {
      id: normalized,
      name: base,
      relativePath: normalized,
      date,
      profile,
      interval: Number(match[5]),
      kind: /^ctd/i.test(sourceKind) ? 'ctd' : /^mot/i.test(sourceKind) ? 'mot' : sourceKind,
      ...(sourceKind.startsWith('mot') ? { motor: sourceKind } : {}),
      taskKey: JSON.stringify([parent, match[1].toLowerCase(), date, profile])
    };
  }

  function buildLibrary(records) {
    const keydata = new Map(), levels = new Map(), motors = new Map();
    let keydataCount = 0, levelCount = 0, motCount = 0;
    for (const record of records) {
      if (record.kind !== 'keydata' && record.kind !== 'level' && record.kind !== 'mot') continue;
      const lookup = record.kind === 'keydata' ? keydata : record.kind === 'level' ? levels : motors;
      if (record.kind === 'keydata') keydataCount++;
      else if (record.kind === 'level') levelCount++;
      else motCount++;
      if (!record.taskKey) continue;
      if (!lookup.has(record.taskKey)) lookup.set(record.taskKey, []);
      lookup.get(record.taskKey).push(record);
    }
    const ctd = records.filter(record => record.kind === 'ctd').map(record => ({
      ...record,
      keydata: (keydata.get(record.taskKey) || []).slice(),
      level: (levels.get(record.taskKey) || []).slice(),
      mot: (motors.get(record.taskKey) || []).slice()
    }));
    return { records: ctd, taskCount: new Set(ctd.map(record => record.taskKey)).size, keydataCount, levelCount, motCount };
  }

  function keydataFields(record) {
    const dataset = record && record.dataset;
    if (!dataset || !dataset.headers || !dataset.rows) return {};
    const row = dataset.rows.find(row => row.some(value => value != null && String(value).trim() !== ''));
    if (!row) return {};
    return Object.fromEntries(dataset.headers.filter(header => header !== '').map(header => {
      const value = row[dataset.headers.indexOf(header)];
      return [header, value == null ? '' : value];
    }));
  }

  function levelRows(records) {
    const result = [];
    for (const record of records) {
      const dataset = record && record.dataset;
      if (!dataset || !dataset.headers || !dataset.rows) continue;
      const headers = dataset.headers;
      const beijing = headers.findIndex(header => /北京时间|本地时间/.test(header));
      const utc = headers.findIndex(header => /格林威治|UTC|GMT/i.test(header));
      const generic = headers.findIndex(header => /时间|datetime|timestamp|^time$/i.test(header));
      const timeIndex = beijing >= 0 ? beijing : utc >= 0 ? utc : generic;
      const labelIndex = headers.findIndex(header => /数据标记|标记|label/i.test(header));
      const temperatureIndex = headers.findIndex(header => /温度|temperature/i.test(header));
      const salinityIndex = headers.findIndex(header => /盐度|salinity/i.test(header));
      const pressureIndex = headers.findIndex(header => /压力|深度|pressure|depth/i.test(header));
      dataset.rows.forEach((row, index) => {
        const timeRaw = timeIndex >= 0 ? row[timeIndex] || '' : '';
        result.push({
          time: parseTime(timeRaw, timeIndex >= 0 && timeIndex === utc),
          timeRaw,
          label: labelIndex >= 0 && String(row[labelIndex] || '').trim() ? String(row[labelIndex]).trim() : '未标记',
          temperature: number(row[temperatureIndex]),
          salinity: number(row[salinityIndex]),
          pressure: number(row[pressureIndex]),
          source: record.relativePath || record.name || '',
          index
        });
      });
    }
    return result.sort((a, b) => {
      if (a.time === null) return b.time === null ? 0 : 1;
      if (b.time === null) return -1;
      return a.time - b.time;
    });
  }

  return { decodeBytes, parseDelimited, fileMeta, buildLibrary, keydataFields, levelRows, parseTime, number };
});
