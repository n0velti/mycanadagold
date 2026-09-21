/**
 * Who is clocked in right now, shared by every staff portrait in the app.
 * The set is filled from `rippling_clock_status` (the hourly Clock In report).
 * A snapshot older than three hours is ignored so a stopped feed cannot leave
 * people marked in for the rest of the day.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { normalizePersonName, syncHoursFeed } from './ripplingTime';
import { loadGmailSession, refreshGmailSession } from './gmail';
import { proxyJson } from './proxy';
import { getSupabase } from './supabase';

const MAX_AGE_MS = 3 * 60 * 60_000;
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

export async function reloadClockedIn() {
  const { data, error } = await getSupabase()
    .from('rippling_clock_status')
    .select('employee_name, is_clocked_in, reported_at')
    .eq('is_clocked_in', true)
    .limit(1000);
  if (error) return;
  const freshAfter = Date.now() - MAX_AGE_MS;
  const next = new Set();
  for (const row of data || []) {
    const at = row?.reported_at ? Date.parse(row.reported_at) : 0;
    if (!at || at < freshAfter) continue;
    const key = normalizePersonName(row.employee_name);
    if (key) next.add(key);
  }
  replaceNames(next);
}

async function ingestFromSignedInGmail() {
  const session = await loadGmailSession();
  if (!session?.token) return;
  const post = (token) =>
    proxyJson('rippling/time/ingest', {
      method: 'POST',
      upstreamAuthorization: `Bearer ${token}`,
    });
  try {
    await post(session.token);
  } catch (error) {
    const expired = error?.status === 401 || error?.code === 'gmail_unauthenticated';
    if (!expired || !session.refreshToken) return;
    const next = await refreshGmailSession(session).catch(() => null);
    if (next?.token) await post(next.token).catch(() => {});
  }
}

/** Pull the latest report (shared mailbox, then this browser's Gmail) and refresh the rings. */
export async function refreshClockedIn() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await syncHoursFeed().catch(() => {});
    await ingestFromSignedInGmail().catch(() => {});
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
  const raw = String(name || '');
  const candidates = [raw, raw.split('·')[0], raw.split('|')[0]];
  for (const candidate of candidates) {
    const key = normalizePersonName(candidate);
    if (key && names.has(key)) return true;
  }
  return false;
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
