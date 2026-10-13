import { Platform } from 'react-native';
import { ProxyError, proxyJson } from './proxy';
import { removeSecure } from './secureAuthStorage';
import { contactName } from './messages';

const OAUTH_STATE_KEY = 'cgold_gmail_oauth_state';
const OAUTH_REDIRECT_KEY = 'cgold_gmail_oauth_redirect';
export const GMAIL_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GMAIL_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function getErrorMessage(payload, fallback) {
  const nested = payload?.error;
  const fromPayload =
    (nested && typeof nested === 'object' ? nested.message : null) ||
    payload?.message ||
    payload?.error_description ||
    (typeof nested === 'string' ? nested : null);
  return fromPayload || fallback;
}

export function getGmailRedirectUri() {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.location?.origin) {
    return '';
  }
  // Google compares this byte-for-byte with the OAuth client. Origin has no
  // trailing slash; including the current path (often "/") is a common mismatch.
  return String(window.location.origin).replace(/\/+$/, '');
}

export async function loadGmailOAuthApp() {
  const payload = await proxyJson('gmail/oauth/config');
  return {
    clientId: asString(payload?.clientId),
    configured: Boolean(payload?.configured),
    hostedDomain: asString(payload?.hostedDomain) || 'canadagold.ca',
  };
}

export function createGmailOAuthState() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `gmail.${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function persistGmailOAuthState(state, redirectUri) {
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    if (redirectUri) sessionStorage.setItem(OAUTH_REDIRECT_KEY, redirectUri);
  }
}

export function readGmailOAuthState() {
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    return sessionStorage.getItem(OAUTH_STATE_KEY) || '';
  }
  return '';
}

export function readGmailOAuthRedirect() {
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    return sessionStorage.getItem(OAUTH_REDIRECT_KEY) || getGmailRedirectUri();
  }
  return getGmailRedirectUri();
}

export function clearGmailOAuthState() {
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    sessionStorage.removeItem(OAUTH_REDIRECT_KEY);
  }
}

export function readGmailOAuthCallback() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search || '');
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');
  if (!code && !error) return null;
  const expected = readGmailOAuthState();
  if (!expected || !state || expected !== state) return null;
  return { code, state, error, errorDescription };
}

export function clearGmailOAuthCallbackFromUrl() {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.history?.replaceState) {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  url.searchParams.delete('scope');
  url.searchParams.delete('authuser');
  url.searchParams.delete('hd');
  url.searchParams.delete('prompt');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

export function buildGmailAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  hostedDomain,
  loginHint,
  includeGrantedScopes = true,
  selectAccount = false,
}) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GMAIL_SCOPES,
    state,
    access_type: 'offline',
    // Adding a second inbox must show the account chooser, not reuse the
    // Google account that is already signed in.
    prompt: selectAccount ? 'select_account consent' : 'consent',
  });
  // Hours mailbox must not reuse an earlier grant that only allowed profile.
  if (includeGrantedScopes) params.set('include_granted_scopes', 'true');
  if (hostedDomain) params.set('hd', hostedDomain.split(',')[0].trim());
  if (loginHint) params.set('login_hint', loginHint);
  return `${GMAIL_AUTHORIZE_URL}?${params.toString()}`;
}

const LEGACY_SESSION_KEY = 'cgold_gmail_session';

function mapAccount(row) {
  const email = asString(row?.email).toLowerCase();
  if (!email) return null;
  return {
    email,
    name: asString(row?.name),
    picture: asString(row?.picture),
    connectedAt: row?.connectedAt || null,
    lastUsedAt: row?.lastUsedAt || null,
    connected: row?.connected !== false,
    error: asString(row?.error) || '',
  };
}

function mapAccounts(payload) {
  return (Array.isArray(payload?.accounts) ? payload.accounts : []).map(mapAccount).filter(Boolean);
}

/**
 * Inboxes this person has connected. Tokens stay on the server, so this is
 * the same list on every device and after every login.
 */
export async function listGmailAccounts() {
  let payload;
  try {
    payload = await proxyJson('gmail/accounts');
  } catch (error) {
    // A proxy that predates per-person inboxes has no such route.
    if (error instanceof ProxyError && error.status === 404) {
      throw new Error('Mail needs the latest server deploy. Ask a system admin to deploy the proxy.');
    }
    throw error;
  }
  return mapAccounts(payload);
}

export async function exchangeGmailOAuthCode({ code, redirectUri }) {
  let payload;
  try {
    payload = await proxyJson('gmail/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirectUri }),
    });
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    throw new Error(error?.message || 'Google sign-in failed.');
  }
  const account = mapAccount(payload?.account);
  if (!account) throw new Error(getErrorMessage(payload, 'Google did not return an account.'));
  return { account, accounts: mapAccounts(payload) };
}

export async function disconnectGmailAccount(email) {
  const payload = await proxyJson('gmail/accounts/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: asString(email).toLowerCase() }),
  });
  return mapAccounts(payload);
}

/** Older builds kept a Gmail token in device storage. Nothing reads it now; drop it. */
export async function clearLegacyGmailSession() {
  await removeSecure(LEGACY_SESSION_KEY);
}

export function isGmailNotConnected(error) {
  return error instanceof ProxyError && (error.status === 401 || error.code === 'gmail_unauthenticated');
}

function profileIndex(people) {
  const byEmail = new Map();
  (Array.isArray(people) ? people : []).forEach((person) => {
    const email = asString(person?.email).toLowerCase();
    if (email) byEmail.set(email, person);
  });
  return byEmail;
}

export function mapGmailPerson(address, profilesByEmail) {
  const email = asString(address?.email).toLowerCase();
  const profile = email && profilesByEmail instanceof Map ? profilesByEmail.get(email) : null;
  const fullName =
    asString(profile?.fullName) ||
    asString(address?.name) ||
    email ||
    'Unknown';
  return {
    id: profile?.id || (email ? `email:${email}` : fullName),
    profileId: asString(profile?.id || profile?.profileId),
    firstName: asString(profile?.firstName),
    lastName: asString(profile?.lastName),
    fullName,
    name: fullName,
    avatarUrl: asString(profile?.avatarUrl || address?.picture),
    locationName: asString(profile?.locationName),
    email: email || asString(profile?.email),
  };
}

export function mapGmailMail(row, people = []) {
  const profilesByEmail = people instanceof Map ? people : profileIndex(people);
  const sender = mapGmailPerson(row?.from, profilesByEmail);
  const recipients = [...(Array.isArray(row?.to) ? row.to : []), ...(Array.isArray(row?.cc) ? row.cc : [])]
    .map((address) => mapGmailPerson(address, profilesByEmail))
    .filter((person, index, all) => all.findIndex((item) => item.id === person.id) === index);
  return {
    id: asString(row?.id),
    source: 'gmail',
    account: asString(row?.account).toLowerCase(),
    subject: asString(row?.subject),
    preview: asString(row?.snippet || row?.preview),
    body: asString(row?.body),
    attachments: Array.isArray(row?.attachments) ? row.attachments : [],
    createdAt: row?.createdAt || null,
    unread: Boolean(row?.unread),
    sender,
    recipients,
  };
}

export async function listGmailMailbox(account, folder, { maxResults } = {}) {
  const email = asString(typeof account === 'string' ? account : account?.email).toLowerCase();
  if (!email) throw new Error('Pick an inbox first.');
  const payload = await proxyJson('gmail/mailbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account: email,
      folder: folder === 'sent' ? 'sent' : 'inbox',
      maxResults: maxResults || undefined,
    }),
  });
  return {
    account: email,
    messages: (Array.isArray(payload?.messages) ? payload.messages : []).map((row) => ({ ...row, account: email })),
  };
}

export async function getGmailMessage(account, messageId) {
  const email = asString(typeof account === 'string' ? account : account?.email).toLowerCase();
  if (!email) throw new Error('Pick an inbox first.');
  const id = encodeURIComponent(asString(messageId));
  const payload = await proxyJson(`gmail/message?account=${encodeURIComponent(email)}&id=${id}`);
  return { account: email, message: { ...payload, account: email } };
}

export function mailboxPartyLabel(row, folder) {
  if (folder === 'sent') {
    const names = (row.recipients || []).map(contactName).filter(Boolean);
    if (!names.length) return 'No recipients';
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }
  return contactName(row.sender);
}
