/**
 * Who is clocked in right now, shared by every staff portrait in the app.
 * The set is filled from `rippling_clock_status` and from a clocked-in column
 * on the newest CSV. A snapshot older than a work day is ignored.
 */
import { createElement, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { CLOCK_STATUS_MAX_AGE_MS, personNameKeys, syncHoursFeed } from './ripplingTime';
import { getSupabase } from './supabase';

const MAX_AGE_MS = CLOCK_STATUS_MAX_AGE_MS;
const CLOCKED_IN_VALUES = new Set(['yes', 'true', 'y', '1', 'clocked in', 'in']);
const POLL_MS = 5 * 60_000;

const names = new Set();
const listeners = new Set();
let pollTimer = null;
let inFlight = null;

function emit() {
  for (const listener of listeners) listener();
}

function replaceNames(next) {
  const same = next.size === names.size && [...next].every((name) => names.has(name));
  names.clear();
  for (const name of next) names.add(name);
  if (!same) emit();
}

export function clearClockedIn() {
  replaceNames(new Set());
}

function addPerson(next, name) {
  for (const key of personNameKeys(name)) next.add(key);
}

function clockedInFromSnapshot(row, freshAfter) {
  const at = Date.parse(row?.updated_at || row?.received_at || '') || 0;
  if (!at || at < freshAfter) return [];
  const headers = (Array.isArray(row?.headers) ? row.headers : []).map((cell) => String(cell || '').trim().toLowerCase());
  const flagCol = headers.findIndex((name) => /clocked\s*in/.test(name) || /clock\s*in\s*status/.test(name));
  const nameCol = headers.findIndex((name) => name === 'employee' || name === 'name' || name === 'full name' || (/employee/.test(name) && !/\bid\b/.test(name)));
  if (flagCol < 0 || nameCol < 0) return [];
  const names = [];
  for (const line of Array.isArray(row?.rows) ? row.rows : []) {
    const cells = Array.isArray(line) ? line : [];
    const flag = String(cells[flagCol] || '').trim().toLowerCase();
    if (!CLOCKED_IN_VALUES.has(flag)) continue;
    const name = String(cells[nameCol] || '').trim();
    if (name) names.push(name);
  }
  return names;
}

export async function reloadClockedIn() {
  const supabase = getSupabase();
  const [statusResult, snapshotResult] = await Promise.all([
    supabase
      .from('rippling_clock_status')
      .select('employee_name, is_clocked_in, reported_at')
      .eq('is_clocked_in', true)
      .limit(1000),
    supabase
      .from('rippling_report_snapshot')
      .select('headers, rows, received_at, updated_at')
      .eq('id', true)
      .maybeSingle(),
  ]);
  if (statusResult.error && snapshotResult.error) return;
  const freshAfter = Date.now() - MAX_AGE_MS;
  const next = new Set();
  for (const row of statusResult.data || []) {
    const at = row?.reported_at ? Date.parse(row.reported_at) : 0;
    if (!at || at < freshAfter) continue;
    addPerson(next, row.employee_name);
  }
  if (!snapshotResult.error && snapshotResult.data) {
    for (const name of clockedInFromSnapshot(snapshotResult.data, freshAfter)) addPerson(next, name);
  }
  replaceNames(next);
}

/** Pull the latest report from the hours mailbox and refresh who is clocked in. */
export async function refreshClockedIn() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await syncHoursFeed().catch(() => {});
    await reloadClockedIn().catch(() => {});
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function startClockedInSync() {
  refreshClockedIn();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    refreshClockedIn();
  }, POLL_MS);
  return () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };
}

export function isClockedInName(name) {
  return personNameKeys(name).some((key) => names.has(key));
}

export function useIsClockedIn(name) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return isClockedInName(name);
}

const CLOCKED_GREEN = '#34C759';
const TIP_STYLE_ID = 'cgold-clock-tip-style';

function ensureClockTipStyle() {
  if (typeof document === 'undefined' || document.getElementById(TIP_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TIP_STYLE_ID;
  style.textContent = [
    '.cgold-clock-tip{position:fixed;z-index:100000;pointer-events:none;display:flex;flex-direction:column;gap:3px;max-width:220px;padding:8px 10px;border-radius:10px;background:#1c1c1e;box-shadow:0 10px 28px rgba(0,0,0,0.22),0 0 0 0.5px rgba(255,255,255,0.06);font-family:Sohne,sans-serif;color:#fff;}',
    '.cgold-clock-name{font-size:12px;line-height:15px;font-weight:600;letter-spacing:-0.15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.cgold-clock-status{display:flex;align-items:center;gap:7px;font-size:12px;line-height:15px;font-weight:500;letter-spacing:-0.1px;color:rgba(255,255,255,0.9);}',
    '.cgold-clock-pulse{position:relative;width:8px;height:8px;flex:0 0 8px;}',
    '.cgold-clock-pulse i{position:absolute;inset:0;border-radius:50%;background:#34C759;}',
    '.cgold-clock-pulse i::after{content:"";position:absolute;inset:-3px;border-radius:50%;border:1.5px solid rgba(52,199,89,0.9);animation:cgold-clock-ping 1.6s ease-out infinite;}',
    '@keyframes cgold-clock-ping{0%{transform:scale(.65);opacity:.85}100%{transform:scale(1.9);opacity:0}}',
    '@media (prefers-reduced-motion:reduce){.cgold-clock-pulse i::after{animation:none;opacity:0}}',
  ].join('');
  document.head.appendChild(style);
}

function dotMetrics(size, edge) {
  const outer = size >= 64 ? 14 : size >= 40 ? 11 : size >= 28 ? 8 : 7;
  const border = outer >= 11 ? 2 : 1.5;
  const radius = size / 2;
  const reach = Math.max(outer / 2 + 1, radius - outer * 0.28);
  // Stacked home faces cover a corner pip. Sit that one higher so it stays on the photo.
  const degrees = edge === 'stack' ? 76 : 50;
  const angle = (-degrees * Math.PI) / 180;
  const cx = radius + Math.cos(angle) * reach;
  const cy = radius + Math.sin(angle) * reach;
  return {
    outer,
    border,
    left: cx - outer / 2,
    top: cy - outer / 2,
  };
}

function ClockedInTip({ anchorEl, name }) {
  const [box, setBox] = useState(null);
  const place = useCallback(() => {
    if (!anchorEl?.getBoundingClientRect || typeof window === 'undefined') {
      setBox(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    const above = rect.top > 56;
    const center = rect.left + rect.width / 2;
    setBox({
      left: Math.min(window.innerWidth - 12, Math.max(12, center)),
      top: above ? rect.top - 8 : rect.bottom + 8,
      transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
    });
  }, [anchorEl]);

  useLayoutEffect(() => {
    place();
  }, [place, name]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [place]);

  if (Platform.OS !== 'web' || !box || typeof document === 'undefined') return null;
  ensureClockTipStyle();
  const label = String(name || '').trim();
  const { createPortal } = require('react-dom');
  return createPortal(
    createElement(
      'div',
      { className: 'cgold-clock-tip', style: box, role: 'tooltip' },
      label ? createElement('div', { className: 'cgold-clock-name' }, label) : null,
      createElement(
        'div',
        { className: 'cgold-clock-status' },
        createElement('span', { className: 'cgold-clock-pulse', 'aria-hidden': 'true' }, createElement('i')),
        'Clocked in',
      ),
    ),
    document.body,
  );
}

/**
 * Small presence dot on the top-right of a portrait. Hovering the portrait
 * shows who it is and that they are clocked in.
 * `force` shows the dot even when the name is not in the live clock set.
 */
export function ClockedInMark({ name, size = 24, force = false, edge, children }) {
  const on = useIsClockedIn(name) || force;
  const [hoverEl, setHoverEl] = useState(null);
  if (!on) return children;
  const dot = dotMetrics(size, edge);
  const label = String(name || '').trim();
  const hover =
    Platform.OS === 'web'
      ? {
          onMouseEnter: (event) => setHoverEl(event?.currentTarget || null),
          onMouseLeave: () => setHoverEl(null),
        }
      : null;
  return (
    <View
      accessibilityLabel={label ? `${label}, clocked in` : 'Clocked in'}
      style={{ width: size, height: size, overflow: 'visible', flexShrink: 0 }}
      {...hover}
    >
      {children}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: dot.outer,
          height: dot.outer,
          borderRadius: dot.outer / 2,
          left: dot.left,
          top: dot.top,
          backgroundColor: CLOCKED_GREEN,
          borderWidth: dot.border,
          borderColor: '#fff',
          zIndex: 2,
          ...Platform.select({
            web: { boxShadow: '0 1px 2px rgba(0,0,0,0.22)' },
            default: {
              shadowColor: '#000',
              shadowOpacity: 0.22,
              shadowRadius: 1.5,
              shadowOffset: { width: 0, height: 1 },
              elevation: 2,
            },
          }),
        }}
      />
      {hoverEl ? <ClockedInTip anchorEl={hoverEl} name={label} /> : null}
    </View>
  );
}

/** Portrait wrapper that badges staff who are currently clocked in. */
export function AvatarRing({ name, size = 24, children }) {
  return (
    <ClockedInMark name={name} size={size}>
      {children}
    </ClockedInMark>
  );
}
