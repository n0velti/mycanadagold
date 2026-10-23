/**
 * Sends the join temporary password.
 *
 * Tries, in order: a dedicated JOIN_GMAIL_* sender, the hours mailbox, a
 * company inbox already connected in Emails with send, then JOIN_SMTP_*.
 * The hours inbox was first connected for Rippling CSV reads and often has
 * no send scope — that must not abort the others.
 * The password is the message body and is never logged or returned.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const DEFAULT_JOIN_DOMAINS = ['canadagold.ca', 'cdncoin.com'];
const HOURS_MAILBOX = 'edward.anuichi@canadagold.ca';
const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';

export function allowedJoinDomains(): string[] {
  const extra = String(Deno.env.get('GOOGLE_MAIL_HOSTED_DOMAIN') || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_JOIN_DOMAINS, ...extra])];
}

export function joinEmailHint(): string {
  const domains = allowedJoinDomains();
  if (domains.length <= 1) return `Use your @${domains[0] || 'canadagold.ca'} email.`;
  if (domains.length === 2) return `Use your @${domains[0]} or @${domains[1]} email.`;
  const last = domains[domains.length - 1];
  return `Use your ${domains.slice(0, -1).map((domain) => `@${domain}`).join(', ')}, or @${last} email.`;
}

export function companyJoinEmail(value: unknown): string {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 320 || email.includes('+') || /[\r\n\0]/.test(email)) return '';
  const match = /^[^\s@<>"]+@([a-z0-9.-]+)$/.exec(email);
  if (!match || !allowedJoinDomains().includes(match[1])) return '';
  return email;
}

function mailboxAddress(value: unknown): string {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 320 || /[\r\n\0]/.test(email)) return '';
  const match = /^[^\s@<>"]+@([a-z0-9.-]+)$/.exec(email);
  return match ? email : '';
}

function scopeAllowsSend(scope: string): boolean {
  const value = String(scope || '');
  return (
    value.includes(GMAIL_SEND) ||
    value.includes('https://www.googleapis.com/auth/gmail.compose') ||
    value.includes('https://www.googleapis.com/auth/gmail.modify') ||
    value.includes('https://mail.google.com/')
  );
}

function mailError(message: string, status = 502, code = 'mail_failed'): Error {
  return Object.assign(new Error(message), { status, code });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function messageBytes(from: string, to: string, temporaryPassword: string): Uint8Array {
  const text = [
    `From: MyCanadaGold <${from}>`,
    `To: ${to}`,
    'Subject: Your MyCanadaGold temporary password',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Your MyCanadaGold temporary password is:',
    '',
    temporaryPassword,
    '',
    'Sign in with this email address and the temporary password.',
    'You will be asked to choose a new password before the app opens.',
    '',
  ].join('\r\n');
  return new TextEncoder().encode(text);
}

async function readReply(conn: Deno.Conn): Promise<string> {
  const buf = new Uint8Array(4096);
  let text = '';
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const n = await conn.read(buf);
    if (n === null) break;
    text += new TextDecoder().decode(buf.subarray(0, n));
    const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
    const last = lines[lines.length - 1] || '';
    if (/^\d{3} /.test(last)) return text;
  }
  throw mailError('Could not email that temporary password.');
}

async function smtpCommand(conn: Deno.Conn, line: string, ok: number): Promise<void> {
  await conn.write(new TextEncoder().encode(`${line}\r\n`));
  const reply = await readReply(conn);
  const last = reply.split(/\r?\n/).filter((row) => row.length > 0).pop() || '';
  if (Number(last.slice(0, 3)) !== ok) {
    console.error('join mail smtp', Number(last.slice(0, 3)));
    throw mailError('Could not email that temporary password.');
  }
}

async function sendSmtp(from: string, to: string, temporaryPassword: string): Promise<void> {
  const user = (Deno.env.get('JOIN_SMTP_USER') || '').trim();
  const pass = Deno.env.get('JOIN_SMTP_PASS') || '';
  const host = (Deno.env.get('JOIN_SMTP_HOST') || 'smtp.gmail.com').trim();
  const port = Number(Deno.env.get('JOIN_SMTP_PORT') || '465');
  if (!user || !pass || /[\r\n]/.test(user) || /[\r\n]/.test(pass)) {
    throw mailError('Join email is not configured.', 503, 'join_unconfigured');
  }
  const conn = await Deno.connectTls({ hostname: host, port });
  try {
    const greeting = await readReply(conn);
    if (!greeting.startsWith('220')) throw mailError('Could not email that temporary password.');
    await smtpCommand(conn, 'EHLO mycanadagold.ca', 250);
    await smtpCommand(conn, 'AUTH LOGIN', 334);
    await smtpCommand(conn, bytesToBase64(new TextEncoder().encode(user)), 334);
    await smtpCommand(conn, bytesToBase64(new TextEncoder().encode(pass)), 235);
    await smtpCommand(conn, `MAIL FROM:<${from}>`, 250);
    await smtpCommand(conn, `RCPT TO:<${to}>`, 250);
    await smtpCommand(conn, 'DATA', 354);
    await conn.write(messageBytes(from, to, temporaryPassword));
    await conn.write(new TextEncoder().encode('\r\n.\r\n'));
    const accepted = await readReply(conn);
    if (!accepted.split(/\r?\n/).filter(Boolean).pop()?.startsWith('250')) {
      throw mailError('Could not email that temporary password.');
    }
    await smtpCommand(conn, 'QUIT', 221).catch(() => {});
  } finally {
    try {
      conn.close();
    } catch {
      // The message was already accepted or the connection is gone.
    }
  }
}

async function gmailAccessToken(refreshToken: string): Promise<{ accessToken: string; scope: string; refreshToken: string }> {
  const clientId = (Deno.env.get('GOOGLE_MAIL_CLIENT_ID') || '').trim();
  const clientSecret = (Deno.env.get('GOOGLE_MAIL_CLIENT_SECRET') || '').trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw mailError('Join email is not configured.', 503, 'join_unconfigured');
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json().catch(() => null) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
  } | null;
  const accessToken = String(payload?.access_token || '').trim();
  if (!response.ok || !accessToken) {
    console.error('join mail token', response.status);
    throw mailError('Could not email that temporary password.');
  }
  return {
    accessToken,
    scope: String(payload?.scope || ''),
    refreshToken: String(payload?.refresh_token || '').trim(),
  };
}

async function hoursMailbox(admin: SupabaseClient): Promise<{ email: string; refreshToken: string } | null> {
  const read = await admin
    .from('rippling_time_sync')
    .select('gmail_email, gmail_refresh_token')
    .eq('id', true)
    .maybeSingle();
  if (read.error || !read.data) return null;
  const row = read.data as { gmail_email?: string; gmail_refresh_token?: string };
  const email = mailboxAddress(row.gmail_email);
  const refreshToken = String(row.gmail_refresh_token || '').trim();
  if (!email || !refreshToken) return null;
  return { email, refreshToken };
}

async function staffSendMailbox(
  admin: SupabaseClient,
  exceptToken = '',
): Promise<{ email: string; refreshToken: string } | null> {
  const read = await admin
    .from('staff_gmail_accounts')
    .select('email, refresh_token, granted_scope')
    .is('disconnected_at', null);
  if (read.error || !Array.isArray(read.data)) return null;
  const allowed = new Set(allowedJoinDomains());
  const usable: { email: string; refreshToken: string }[] = [];
  for (const row of read.data as { email?: string; refresh_token?: string; granted_scope?: string }[]) {
    const email = mailboxAddress(row.email);
    const refreshToken = String(row.refresh_token || '').trim();
    const domain = email.split('@')[1] || '';
    if (!email || !refreshToken || refreshToken === exceptToken) continue;
    if (!allowed.has(domain)) continue;
    if (row.granted_scope && !scopeAllowsSend(row.granted_scope)) continue;
    usable.push({ email, refreshToken });
  }
  return usable.find((row) => row.email === HOURS_MAILBOX) || usable[0] || null;
}

async function sendGmail(from: string, refreshToken: string, to: string, temporaryPassword: string, admin: SupabaseClient | null): Promise<void> {
  const token = await gmailAccessToken(refreshToken);
  const scope = token.scope;
  if (scope && !scopeAllowsSend(scope)) {
    throw mailError(
      'The company mailbox can read mail but cannot send it. Reconnect it and allow sending.',
      503,
      'join_unconfigured',
    );
  }
  if (admin && token.refreshToken && token.refreshToken !== refreshToken) {
    await admin
      .from('rippling_time_sync')
      .update({ gmail_refresh_token: token.refreshToken, updated_at: new Date().toISOString() })
      .eq('id', true);
  }
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: base64Url(messageBytes(from, to, temporaryPassword)) }),
  });
  if (!response.ok) {
    console.error('join mail gmail', response.status);
    if (response.status === 403) {
      throw mailError(
        'The company mailbox can read mail but cannot send it. Reconnect it and allow sending.',
        503,
        'join_unconfigured',
      );
    }
    throw mailError('Could not email that temporary password.');
  }
}

export async function sendTemporaryPassword(
  admin: SupabaseClient,
  to: string,
  temporaryPassword: string,
): Promise<void> {
  const recipient = companyJoinEmail(to);
  if (!recipient || !temporaryPassword) throw mailError('Could not email that temporary password.', 400);

  const attempts: Array<() => Promise<void>> = [];

  const dedicatedRefresh = (Deno.env.get('JOIN_GMAIL_REFRESH_TOKEN') || '').trim();
  const dedicatedFrom = mailboxAddress(Deno.env.get('JOIN_MAIL_FROM') || '');
  if (dedicatedRefresh && dedicatedFrom) {
    attempts.push(() => sendGmail(dedicatedFrom, dedicatedRefresh, recipient, temporaryPassword, null));
  }

  const hours = await hoursMailbox(admin);
  if (hours) {
    attempts.push(() => sendGmail(hours.email, hours.refreshToken, recipient, temporaryPassword, admin));
  }

  const staffSend = await staffSendMailbox(admin, hours?.refreshToken || '');
  if (staffSend) {
    attempts.push(() => sendGmail(staffSend.email, staffSend.refreshToken, recipient, temporaryPassword, null));
  }

  const smtpUser = (Deno.env.get('JOIN_SMTP_USER') || '').trim();
  const smtpPass = Deno.env.get('JOIN_SMTP_PASS') || '';
  const smtpFrom = mailboxAddress(Deno.env.get('JOIN_MAIL_FROM') || smtpUser);
  if (smtpUser && smtpPass && smtpFrom) {
    attempts.push(() => sendSmtp(smtpFrom, recipient, temporaryPassword));
  }

  if (!attempts.length) {
    throw mailError('Join email is not configured. Connect the company mailbox first.', 503, 'join_unconfigured');
  }

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      await attempt();
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error('join mail attempt', lastError.message);
    }
  }
  throw lastError || mailError('Could not email that temporary password.');
}
