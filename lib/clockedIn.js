/**
 * Who is clocked in right now, shared by every staff portrait in the app.
 * The set is filled from `rippling_clock_status` and from a clocked-in column
 * on the newest CSV. A snapshot older than a work day is ignored.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
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

/** Pull the latest report from the hours mailbox and refresh the rings. */
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

/** Green halo around a portrait when `name` is currently clocked in. */
export function AvatarRing({ name, size = 24, children }) {
  const on = useIsClockedIn(name);
  if (!on) return children;
  const ringWidth = size >= 56 ? 3 : 2;
  const gap = size >= 56 ? 3 : 2;
  const outer = size + 2 * (ringWidth + gap);
  return (
    <View
      accessibilityLabel={name ? `${name}, clocked in` : 'Clocked in'}
      style={{
        width: outer,
        height: outer,
        borderRadius: outer / 2,
        borderWidth: ringWidth,
        borderColor: '#248A3D',
        padding: gap,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
    </View>
  );
}
