/**
 * Who is clocked in right now, shared by every staff portrait in the app.
 * Floor staff come from the latest Rippling clock-in report. Branch managers
 * cannot punch in Rippling, so they follow their rostered shift. General
 * managers stay clocked in. A report older than a work day is ignored.
 */
import { createElement, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import {
  CLOCK_STATUS_MAX_AGE_MS,
  RIPPLING_MAIL_CHECK_MS,
  clockedInNameIndex,
  loadManagerClockOverrides,
  managerNamesClockedInNow,
  nameIsClockedIn,
  syncHoursFeed,
} from './ripplingTime';
import { getSupabase } from './supabase';
import { FONT } from './typography';

const MAX_AGE_MS = CLOCK_STATUS_MAX_AGE_MS;
const POLL_MS = RIPPLING_MAIL_CHECK_MS;
const SCHEDULE_TICK_MS = 60_000;

let clockIndex = clockedInNameIndex([]);
const listeners = new Set();
let pollTimer = null;
let scheduleTimer = null;
let inFlight = null;
let reportNames = [];
let managerOverrides = { alwaysNames: [], scheduled: [] };

function emit() {
  for (const listener of listeners) listener();
}

function replaceIndex(next) {
  const same = next.exact.size === clockIndex.exact.size
    && [...next.exact].every((name) => clockIndex.exact.has(name));
  clockIndex = next;
  if (!same) emit();
}

function nextScheduleBoundary(now) {
  let next = Infinity;
  for (const person of managerOverrides.scheduled || []) {
    for (const shift of person.shifts || []) {
      const start = shift.start?.getTime();
      const end = shift.end?.getTime();
      if (Number.isFinite(start) && start > now) next = Math.min(next, start);
      if (Number.isFinite(end) && end > now) next = Math.min(next, end);
    }
  }
  return next;
}

function applyClockIndex() {
  replaceIndex(clockedInNameIndex([
    ...reportNames,
    ...managerNamesClockedInNow(managerOverrides),
  ]));
}

function clearScheduleTimer() {
  if (!scheduleTimer) return;
  clearTimeout(scheduleTimer);
  scheduleTimer = null;
}

function armScheduleTimer() {
  clearScheduleTimer();
  if (!(managerOverrides.scheduled || []).some((person) => (person.shifts || []).length)) return;
  const now = Date.now();
  const boundary = nextScheduleBoundary(now);
  const delay = Number.isFinite(boundary)
    ? Math.min(SCHEDULE_TICK_MS, Math.max(1000, boundary - now + 250))
    : SCHEDULE_TICK_MS;
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null;
    applyClockIndex();
    armScheduleTimer();
  }, delay);
}

export function clearClockedIn() {
  reportNames = [];
  managerOverrides = { alwaysNames: [], scheduled: [] };
  clearScheduleTimer();
  replaceIndex(clockedInNameIndex([]));
}

export async function reloadClockedIn() {
  const supabase = getSupabase();
  const [statusResult, overrides] = await Promise.all([
    supabase
      .from('rippling_clock_status')
      .select('employee_name, is_clocked_in, reported_at')
      .eq('is_clocked_in', true)
      .limit(1000),
    loadManagerClockOverrides().catch(() => ({ alwaysNames: [], scheduled: [] })),
  ]);
  const names = [];
  if (!statusResult.error) {
    const freshAfter = Date.now() - MAX_AGE_MS;
    for (const row of statusResult.data || []) {
      const at = row?.reported_at ? Date.parse(row.reported_at) : 0;
      if (!at || at < freshAfter) continue;
      if (row?.employee_name) names.push(row.employee_name);
    }
  }
  reportNames = names;
  managerOverrides = overrides || { alwaysNames: [], scheduled: [] };
  applyClockIndex();
  armScheduleTimer();
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
    clearScheduleTimer();
  };
}

export function isClockedInName(name) {
  return nameIsClockedIn(name, clockIndex);
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

const TIP_STYLE_ID = 'cgold-clock-tip-style';
const GREEN_RING =
  'conic-gradient(from 210deg, #b7ebc8 0deg, #8fd9a8 140deg, #6ecf96 260deg, #b7ebc8 360deg)';

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

function ringMetrics(size) {
  const stroke = size >= 48 ? 2 : 1.5;
  const inner = Math.max(8, size - stroke * 2);
  return { stroke, inner, scale: inner / size };
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

const BADGE_GREEN = '#15803D';

/**
 * Marks a portrait when that person is clocked in.
 * `ring` draws the gradient used on profile and message avatars.
 * `badge` draws a small IN tag, used where portraits overlap.
 * Hovering the portrait shows who it is and that they are clocked in.
 * `force` draws the mark even when the name is not in the live clock set.
 */
export function ClockedInMark({ name, size = 24, force = false, variant = 'ring', children }) {
  const on = useIsClockedIn(name) || force;
  const [hoverEl, setHoverEl] = useState(null);
  if (!on) return children;
  const label = String(name || '').trim();
  const hover =
    Platform.OS === 'web'
      ? {
          onMouseEnter: (event) => setHoverEl(event?.currentTarget || null),
          onMouseLeave: () => setHoverEl(null),
        }
      : null;
  const tip = hoverEl ? <ClockedInTip anchorEl={hoverEl} name={label} /> : null;
  if (variant === 'badge') {
    return (
      <View
        accessibilityLabel={label ? `${label}, clocked in` : 'Clocked in'}
        style={{ width: size, height: size, flexShrink: 0, overflow: 'visible' }}
        {...hover}
      >
        {children}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: -5,
            alignItems: 'center',
            zIndex: 2,
          }}
        >
          <View
            style={{
              paddingHorizontal: 4,
              height: 14,
              borderRadius: 4,
              backgroundColor: BADGE_GREEN,
              borderWidth: 1.5,
              borderColor: '#fff',
              alignItems: 'center',
              justifyContent: 'center',
              ...Platform.select({
                web: { boxShadow: '0 1px 2px rgba(0,0,0,0.18)' },
                default: {},
              }),
            }}
          >
            <Text
              style={{
                fontFamily: FONT,
                fontSize: 8,
                lineHeight: 10,
                fontWeight: '700',
                letterSpacing: 0.4,
                color: '#fff',
              }}
            >
              IN
            </Text>
          </View>
        </View>
        {tip}
      </View>
    );
  }
  const ring = ringMetrics(size);
  return (
    <View
      accessibilityLabel={label ? `${label}, clocked in` : 'Clocked in'}
      style={{ width: size, height: size, flexShrink: 0 }}
      {...hover}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: size,
          height: size,
          borderRadius: size / 2,
          ...(Platform.OS === 'web'
            ? { backgroundImage: GREEN_RING }
            : { backgroundColor: '#7DCEA0' }),
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: ring.stroke,
          top: ring.stroke,
          width: ring.inner,
          height: ring.inner,
          borderRadius: ring.inner / 2,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            left: (ring.inner - size) / 2,
            top: (ring.inner - size) / 2,
            transform: [{ scale: ring.scale }],
          }}
        >
          {children}
        </View>
      </View>
      {tip}
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
