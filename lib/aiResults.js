/**
 * Result handles. A tool that returns rows registers them here and hands the
 * model a short `resultId`. The renderers (draw_chart, show_table,
 * export_spreadsheet) take that id and the column names to plot, so a chart
 * is always drawn from numbers a tool computed, never from numbers the model
 * typed. Kept in memory for the session; a page reload starts fresh.
 */

const MAX_RESULTS = 60;
const results = new Map();
let counter = 0;

export function rememberResult({ tool, title, scope, columns, rows, note } = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;
  counter += 1;
  const id = `r${counter}`;
  const cols = (Array.isArray(columns) && columns.length ? columns : inferColumns(rows)).map((column) =>
    typeof column === 'string' ? { key: column, label: column } : { key: column.key, label: column.label || column.key, format: column.format },
  );
  results.set(id, { id, tool: tool || '', title: title || '', scope: scope || '', columns: cols, rows, note: note || '', at: Date.now() });
  if (results.size > MAX_RESULTS) results.delete(results.keys().next().value);
  return id;
}

export function getResult(id) {
  return results.get(String(id || '').trim()) || null;
}

export function listResultIds() {
  return [...results.keys()];
}

/** For tests and the eval runner. */
export function clearResults() {
  results.clear();
}

function inferColumns(rows) {
  const keys = [];
  for (const row of rows.slice(0, 20)) {
    for (const key of Object.keys(row || {})) if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Short description the model sees next to a resultId. */
export function describeResult(id) {
  const result = getResult(id);
  if (!result) return null;
  return {
    resultId: result.id,
    rows: result.rows.length,
    columns: result.columns.map((column) => (column.format ? `${column.key} (${column.format})` : column.key)),
  };
}

/**
 * Walk a lookup payload and register every array of plain objects as its own
 * result, so tills by store, hours per person, or review counts can be drawn
 * by id. Returns the handles found, with the path inside the payload.
 */
export function registerNestedResults(payload, { tool, scope, maxDepth = 3 } = {}) {
  const handles = [];
  const walk = (value, path, depth) => {
    if (!value || typeof value !== 'object' || depth > maxDepth) return;
    if (Array.isArray(value)) {
      const objects = value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
      if (objects.length >= 1 && objects.length === value.length && hasNumber(objects)) {
        const id = rememberResult({ tool, title: path.join('.'), scope, rows: objects });
        if (id) handles.push({ resultId: id, path: path.join('.'), rows: objects.length, columns: describeResult(id).columns });
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'note' || key === 'notes' || key === 'privacy') continue;
      walk(child, [...path, key], depth + 1);
    }
  };
  walk(payload, [], 0);
  return handles;
}

function hasNumber(rows) {
  return rows.some((row) => Object.values(row).some((value) => typeof value === 'number' || (typeof value === 'string' && /^-?\$?\d[\d,]*(\.\d+)?%?$/.test(value.trim()))));
}

/** Read a cell as a number: 12, "12", "$1,234.50", "89%" (→ 89). null stays null. */
export function cellNumber(value) {
  if (value == null || value === '' || value === '—') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  const match = text.match(/^-?\$?\s*(-?[\d,]*\.?\d+)\s*%?$/);
  if (!match) return null;
  const n = Number(`${text.startsWith('-') ? '-' : ''}${match[1].replace(/,/g, '').replace(/^-/, '')}`);
  return Number.isFinite(n) ? n : null;
}
