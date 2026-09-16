import { getSupabase } from './supabase';
import { contactName } from './messages';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /staff_email|list_email_|send_staff_email|get_staff_email/i.test(message);
}

function describeError(error, action = 'load mail') {
  if (!error) return `Could not ${action}.`;
  if (isMissingRelation(error)) {
    return 'Run the Emails SQL in Supabase, then refresh.';
  }
  return error.message || `Could not ${action}.`;
}

function throwQueryError(error, action) {
  const wrapped = new Error(describeError(error, action));
  wrapped.code = error?.code;
  throw wrapped;
}

export function mapEmailPerson(row) {
  if (!row) return null;
  const source = typeof row === 'object' ? row : {};
  const id = asString(source.id || source.user_id);
  if (!id) return null;
  const fullName =
    asString(source.full_name || source.fullName) ||
    [source.first_name || source.firstName, source.last_name || source.lastName].filter(Boolean).join(' ') ||
    asString(source.email) ||
    'Teammate';
  return {
    id,
    profileId: id,
    firstName: asString(source.first_name || source.firstName),
    lastName: asString(source.last_name || source.lastName),
    fullName,
    name: fullName,
    avatarUrl: asString(source.avatar_url || source.avatarUrl),
    locationName: asString(source.location_name || source.locationName),
    email: asString(source.email),
    lastSeenAt: source.last_seen_at || source.lastSeenAt || null,
    isOnline: Boolean(source.is_online ?? source.isOnline),
  };
}

function mapEmailRow(row) {
  if (!row?.id) return null;
  const recipients = (Array.isArray(row.recipients) ? row.recipients : [])
    .map(mapEmailPerson)
    .filter(Boolean);
  return {
    id: row.id,
    subject: asString(row.subject),
    preview: asString(row.preview),
    body: asString(row.body),
    createdAt: row.created_at || row.createdAt || null,
    readAt: row.read_at || row.readAt || null,
    unread: !(row.read_at || row.readAt),
    sender: mapEmailPerson(row.sender),
    recipients,
  };
}

export function emailSubject(row) {
  return asString(row?.subject) || '(No subject)';
}

export function recipientNames(people, { max = 3 } = {}) {
  const names = (Array.isArray(people) ? people : []).map(contactName).filter(Boolean);
  if (names.length === 0) return 'No recipients';
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

export async function listEmailContacts() {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('list_email_contacts');
  if (error) throwQueryError(error, 'load people');
  return (data || []).map(mapEmailPerson).filter(Boolean);
}

export async function listEmailInbox() {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('list_email_inbox');
  if (error) throwQueryError(error, 'load inbox');
  return (data || []).map(mapEmailRow).filter(Boolean);
}

export async function listEmailSent() {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('list_email_sent');
  if (error) throwQueryError(error, 'load sent mail');
  return (data || []).map((row) => {
    const mapped = mapEmailRow(row);
    return mapped ? { ...mapped, unread: false } : null;
  }).filter(Boolean);
}

export async function getStaffEmail(emailId) {
  const id = asString(emailId);
  if (!id) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_staff_email', { p_email_id: id });
  if (error) throwQueryError(error, 'open that email');
  const row = Array.isArray(data) ? data[0] : data;
  return mapEmailRow(row);
}

export async function sendStaffEmail({ recipientIds, subject, body }) {
  const ids = [...new Set((Array.isArray(recipientIds) ? recipientIds : []).map(asString).filter(Boolean))];
  if (ids.length === 0) throw new Error('Pick someone to email.');
  const text = asString(body);
  if (!text) throw new Error('Write a message.');
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('send_staff_email', {
    p_recipient_ids: ids,
    p_subject: asString(subject),
    p_body: text,
  });
  if (error) throwQueryError(error, 'send that email');
  return data;
}

export async function markStaffEmailRead(emailId) {
  const id = asString(emailId);
  if (!id) return;
  const supabase = getSupabase();
  const { error } = await supabase.rpc('mark_staff_email_read', { p_email_id: id });
  if (error) throwQueryError(error, 'mark that email read');
}

export async function fetchEmailUnreadTotal() {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('email_unread_total');
  if (error) throwQueryError(error, 'load unread count');
  return Number(data) || 0;
}

export function subscribeStaffEmails({ myId, onChange }) {
  const supabase = getSupabase();
  const channel = supabase
    .channel(`staff-emails-${myId || 'anon'}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'staff_email_recipients', filter: myId ? `user_id=eq.${myId}` : undefined },
      () => onChange?.(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'staff_emails', filter: myId ? `sender_id=eq.${myId}` : undefined },
      () => onChange?.(),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
