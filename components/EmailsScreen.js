import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  avatarColorForId,
  contactName,
  formatInboxTime,
  formatThreadStamp,
  initialsFromName,
} from '../lib/messages';
import {
  emailSubject,
  listEmailContacts,
  mapEmailPerson,
  recipientNames,
} from '../lib/emails';
import {
  buildGmailAuthorizeUrl,
  clearGmailOAuthCallbackFromUrl,
  clearGmailOAuthState,
  clearLegacyGmailSession,
  createGmailOAuthState,
  disconnectGmailAccount,
  draftFromMail,
  exchangeGmailOAuthCode,
  getGmailMessage,
  getGmailRedirectUri,
  isGmailNotConnected,
  listGmailAccounts,
  listGmailMailbox,
  loadGmailOAuthApp,
  mapGmailMail,
  persistGmailOAuthState,
  readGmailOAuthCallback,
  readGmailOAuthRedirect,
  readGmailOAuthState,
} from '../lib/gmail';
import { useIsMobile } from '../lib/mobileUi';
import EmailComposer from './EmailComposer';
import ProfilePhotoModal from './ProfilePhotoModal';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const BLUE = '#0A84FF';
const ACCENT = '#4338CA';
const LIST_WIDTH = 340;
const FOLDER_WIDTH = 168;

function PersonAvatar({ person, size = 40 }) {
  const [failed, setFailed] = useState(false);
  const name = contactName(person);
  const initials = initialsFromName(name);
  const color = avatarColorForId(person?.id || person?.email || name);
  const uri = person?.avatarUrl;
  const showImage = Boolean(uri) && !failed;

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: showImage ? '#e8e8ed' : color,
        },
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[styles.avatarInitials, { fontSize: Math.max(11, Math.round(size * 0.36)) }]}>
          {initials || '?'}
        </Text>
      )}
    </View>
  );
}

function FolderButton({ item, active, count, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ hovered, pressed }) => [
        styles.folderBtn,
        active && styles.folderBtnActive,
        (hovered || pressed) && !active && styles.folderBtnHover,
      ]}
    >
      <Ionicons
        name={active ? item.iconActive : item.icon}
        size={18}
        color={active ? ACCENT : '#8e8e93'}
      />
      <Text style={[styles.folderLabel, active && styles.folderLabelActive]} numberOfLines={1}>
        {item.label}
      </Text>
      {count > 0 ? (
        <View style={styles.folderBadge}>
          <Text style={styles.folderBadgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ProfileCard({ person, subtitle, onOpen, compact = false }) {
  if (!person) return null;
  const name = contactName(person);
  const location = person.locationName || '';
  const email = person.email || '';
  const meta = [location, email].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={() => onOpen?.(person)}
      disabled={!onOpen}
      accessibilityRole={onOpen ? 'button' : undefined}
      accessibilityLabel={onOpen ? `Open ${name}’s profile` : name}
      style={({ hovered, pressed }) => [
        styles.profileCard,
        compact && styles.profileCardCompact,
        onOpen && (hovered || pressed) && styles.profileCardHover,
      ]}
    >
      <PersonAvatar person={person} size={compact ? 40 : 56} />
      <View style={styles.profileCardCopy}>
        <Text style={styles.profileCardName} numberOfLines={1}>
          {name}
        </Text>
        {subtitle ? (
          <Text style={styles.profileCardSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text style={styles.profileCardMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : (
          <Text style={styles.profileCardMeta} numberOfLines={1}>
            App user
          </Text>
        )}
      </View>
      {onOpen ? <Ionicons name="chevron-forward" size={16} color="#c7c7cc" /> : null}
    </Pressable>
  );
}

const ACCOUNT_PREF_KEY = 'cgold.emails.account';

function accountLabel(email) {
  const text = String(email || '');
  return text.split('@')[0] || text || 'Inbox';
}

function accountPerson(account) {
  return {
    id: account?.email || 'inbox',
    fullName: account?.name || account?.email || 'Inbox',
    avatarUrl: account?.picture || '',
    email: account?.email || '',
  };
}

function sortNewest(rows) {
  const stamp = (row) => {
    const at = new Date(row?.createdAt || 0).getTime();
    return Number.isFinite(at) ? at : 0;
  };
  return [...rows].sort((a, b) => stamp(b) - stamp(a));
}

function AccountRow({ account, all = false, active, count, warning, onPress }) {
  const label = all ? 'All inboxes' : accountLabel(account?.email);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={all ? 'All inboxes' : account?.email}
      style={({ hovered, pressed }) => [
        styles.folderBtn,
        active && styles.folderBtnActive,
        (hovered || pressed) && !active && styles.folderBtnHover,
      ]}
    >
      {all ? (
        <View style={styles.allInboxesMark}>
          <Ionicons name="albums-outline" size={14} color={active ? ACCENT : '#8e8e93'} />
        </View>
      ) : (
        <PersonAvatar person={accountPerson(account)} size={22} />
      )}
      <Text style={[styles.folderLabel, styles.accountLabel, active && styles.folderLabelActive]} numberOfLines={1}>
        {label}
      </Text>
      {warning ? (
        <Ionicons name="alert-circle" size={16} color="#b91c1c" />
      ) : count > 0 ? (
        <View style={styles.folderBadge}>
          <Text style={styles.folderBadgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function AccountChip({ account, all = false, active, count, warning, onPress }) {
  const label = all ? 'All' : accountLabel(account?.email);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={all ? 'All inboxes' : account?.email}
      style={[styles.accountChip, active && styles.accountChipActive]}
    >
      {!all ? <PersonAvatar person={accountPerson(account)} size={18} /> : null}
      <Text style={[styles.accountChipText, active && styles.accountChipTextActive]} numberOfLines={1}>
        {label}
      </Text>
      {warning ? (
        <Ionicons name="alert-circle" size={14} color="#b91c1c" />
      ) : count > 0 ? (
        <Text style={[styles.accountChipCount, active && styles.accountChipTextActive]}>{count > 99 ? '99+' : count}</Text>
      ) : null}
    </Pressable>
  );
}

export default function EmailsScreen({
  session,
  onRequireLogin,
  onOpenProfile,
  focus = null,
  capture = null,
  storeFilter = '',
  embedded = false,
}) {
  const isMobile = useIsMobile();
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const myPerson = useMemo(
    () =>
      mapEmailPerson({
        id: myId,
        full_name:
          session?.profile?.fullName ||
          [session?.profile?.firstName, session?.profile?.lastName].filter(Boolean).join(' '),
        avatar_url: session?.profile?.avatarUrl,
        location_name: session?.profile?.locationName,
        email: session?.profile?.email || session?.login || '',
      }),
    [myId, session],
  );

  const folders = useMemo(() => {
    const rows = [
      { key: 'inbox', label: 'Inbox', icon: 'mail-outline', iconActive: 'mail' },
      { key: 'sent', label: 'Sent', icon: 'paper-plane-outline', iconActive: 'paper-plane' },
    ];
    if (capture) {
      rows.push({ key: 'customers', label: 'Customers', icon: 'people-outline', iconActive: 'people' });
    }
    return rows;
  }, [capture]);

  // Inside a store drawer the store-scoped Customers folder is the point, so
  // land there instead of the (personal) Gmail inbox.
  const [folder, setFolder] = useState(capture && storeFilter ? 'customers' : 'inbox');
  const [inbox, setInbox] = useState([]);
  const [sent, setSent] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState(null);
  const [activeMail, setActiveMail] = useState(null);
  // A draft from draftFromMail (reply / forward) or { mode: 'new' }. Null = closed.
  const [composeDraft, setComposeDraft] = useState(null);
  const [notice, setNotice] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMail, setLoadingMail] = useState(false);
  const [error, setError] = useState('');
  const [photoPerson, setPhotoPerson] = useState(null);
  const composeOpen = Boolean(composeDraft);
  const noticeTimer = useRef(null);
  // Connected inboxes live on the server (per signed-in person), so they are
  // the same on every device and survive logouts. `selectedAccount` is '' for
  // the merged "All inboxes" view and is remembered per person on this device.
  const [accounts, setAccounts] = useState([]);
  const [accountErrors, setAccountErrors] = useState({});
  const [selectedAccount, setSelectedAccount] = useState('');
  const [accountsReady, setAccountsReady] = useState(false);
  const [oauthApp, setOauthApp] = useState(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const appliedFocusKey = useRef(null);
  const accountsRef = useRef([]);
  accountsRef.current = accounts;
  const prefKey = `${ACCOUNT_PREF_KEY}.${myId || 'local'}`;

  const connectedEmails = useMemo(() => new Set(accounts.map((account) => account.email)), [accounts]);
  const list = useMemo(() => {
    const rows = folder === 'sent' ? sent : inbox;
    return selectedAccount ? rows.filter((row) => row.account === selectedAccount) : rows;
  }, [folder, inbox, sent, selectedAccount]);
  const unreadByAccount = useMemo(() => {
    const counts = {};
    for (const row of inbox) {
      if (row.unread) counts[row.account] = (counts[row.account] || 0) + 1;
    }
    return counts;
  }, [inbox]);
  const totalUnread = useMemo(
    () => Object.values(unreadByAccount).reduce((sum, count) => sum + count, 0),
    [unreadByAccount],
  );
  const unreadCount = selectedAccount ? unreadByAccount[selectedAccount] || 0 : totalUnread;
  const focusAccount = selectedAccount
    ? accounts.find((account) => account.email === selectedAccount) || null
    : accounts.length === 1
      ? accounts[0]
      : null;
  const multiAccount = accounts.length > 1;

  useEffect(() => {
    if (!focus?.key || focus.key === appliedFocusKey.current) return;
    appliedFocusKey.current = focus.key;
    if (capture) {
      setFolder('customers');
      setComposeDraft(null);
      setActiveKey(null);
      setActiveMail(null);
    }
  }, [focus, capture]);

  const chooseAccount = useCallback(
    (email) => {
      const next = String(email || '').toLowerCase();
      setSelectedAccount(next);
      setActiveKey(null);
      setActiveMail(null);
      setComposeDraft(null);
      AsyncStorage.setItem(prefKey, next).catch(() => {});
    },
    [prefKey],
  );

  const reloadAccounts = useCallback(async () => {
    const rows = await listGmailAccounts();
    setAccounts(rows);
    return rows;
  }, []);

  useEffect(() => {
    if (!myId) return undefined;
    let cancelled = false;
    setAccountsReady(false);
    (async () => {
      clearLegacyGmailSession().catch(() => {});
      const pendingOAuth = Boolean(readGmailOAuthCallback());
      const [saved, app] = await Promise.all([
        AsyncStorage.getItem(prefKey).catch(() => null),
        loadGmailOAuthApp().catch(() => ({ clientId: '', configured: false, hostedDomain: 'canadagold.ca' })),
      ]);
      if (cancelled) return;
      setOauthApp(app);
      const remembered = String(saved || '').toLowerCase();
      if (remembered) setSelectedAccount(remembered);
      // The OAuth effect below finishes the connect and loads the list itself.
      if (pendingOAuth) return;
      try {
        const rows = await reloadAccounts();
        if (cancelled) return;
        if (remembered && !rows.some((row) => row.email === remembered)) setSelectedAccount('');
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load your inboxes.');
      } finally {
        if (!cancelled) setAccountsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myId, prefKey, reloadAccounts]);

  useEffect(() => {
    if (!myId) return undefined;
    const callback = readGmailOAuthCallback();
    if (!callback) return undefined;
    let cancelled = false;
    (async () => {
      setOauthBusy(true);
      setError('');
      try {
        if (callback.error) {
          throw new Error(callback.errorDescription || callback.error || 'Google sign-in was cancelled.');
        }
        const expected = readGmailOAuthState();
        if (!expected || !callback.state || expected !== callback.state) {
          throw new Error('Google sign-in state did not match. Try again.');
        }
        const result = await exchangeGmailOAuthCode({
          code: callback.code,
          redirectUri: readGmailOAuthRedirect() || getGmailRedirectUri(),
        });
        clearGmailOAuthState();
        clearGmailOAuthCallbackFromUrl();
        if (!cancelled) {
          setAccounts(result.accounts.length ? result.accounts : [result.account]);
          setAccountErrors({});
          chooseAccount(result.account.email);
          setFolder('inbox');
        }
      } catch (err) {
        clearGmailOAuthCallbackFromUrl();
        if (!cancelled) setError(err?.message || 'Google sign-in failed.');
        await reloadAccounts().catch(() => {});
      } finally {
        if (!cancelled) {
          setOauthBusy(false);
          setAccountsReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myId, chooseAccount, reloadAccounts]);

  const refreshList = useCallback(async () => {
    const connected = accountsRef.current.filter((account) => account.connected);
    if (!connected.length) {
      setInbox([]);
      setSent([]);
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    try {
      const people = await listEmailContacts().catch(() => []);
      if (myPerson?.email) {
        const mine = people.some((person) => person.id === myPerson.id);
        if (!mine) people.push(myPerson);
      }
      const results = await Promise.all(
        connected.map(async (account) => {
          try {
            const [inboxRes, sentRes] = await Promise.all([
              listGmailMailbox(account.email, 'inbox'),
              listGmailMailbox(account.email, 'sent'),
            ]);
            return { account: account.email, inbox: inboxRes.messages || [], sent: sentRes.messages || [] };
          } catch (err) {
            return {
              account: account.email,
              error: isGmailNotConnected(err)
                ? err?.message || 'Reconnect this inbox.'
                : err?.message || 'Could not load mail.',
            };
          }
        }),
      );
      const problems = {};
      const inboxRows = [];
      const sentRows = [];
      for (const result of results) {
        if (result.error) {
          problems[result.account] = result.error;
          continue;
        }
        inboxRows.push(...result.inbox.map((row) => mapGmailMail(row, people)));
        sentRows.push(...result.sent.map((row) => mapGmailMail(row, people)));
      }
      setContacts(people);
      setInbox(sortNewest(inboxRows));
      setSent(sortNewest(sentRows));
      setAccountErrors(problems);
      const failed = results.filter((result) => result.error);
      setError(failed.length === results.length ? failed[0].error : '');
    } catch (err) {
      setError(err.message || 'Could not load mail.');
    } finally {
      setLoadingList(false);
    }
  }, [myPerson]);

  const openMail = useCallback(
    async (row) => {
      if (!row?.id || !row.account) return;
      setActiveKey(`${row.account}|${row.id}`);
      setComposeDraft(null);
      setLoadingMail(true);
      try {
        const result = await getGmailMessage(row.account, row.id);
        setActiveMail(mapGmailMail(result.message, contacts));
        setInbox((current) =>
          current.map((item) =>
            item.id === row.id && item.account === row.account ? { ...item, unread: false } : item,
          ),
        );
        setError('');
      } catch (err) {
        setError(err.message || 'Could not open that email.');
      } finally {
        setLoadingMail(false);
      }
    },
    [contacts],
  );

  const accountsKey = accounts.map((account) => `${account.email}:${account.connected ? 1 : 0}`).join(',');
  useEffect(() => {
    if (!accountsReady) return;
    refreshList();
  }, [accountsReady, accountsKey, refreshList]);

  const handleOpenProfile = (person) => {
    if (!person?.profileId) return;
    if (onOpenProfile) {
      onOpenProfile(person);
      return;
    }
    setPhotoPerson(person);
  };

  const signInWithGoogle = async ({ loginHint = '', selectAccount = false } = {}) => {
    const redirectUri = getGmailRedirectUri();
    if (!redirectUri) {
      setError('Google mail sign-in is available in the web app.');
      return;
    }
    if (!oauthApp?.configured || !oauthApp.clientId) {
      setError(
        'Google mail is not set up on the server yet. Ask a system admin to add the Gmail OAuth app on the server, then deploy the proxy.',
      );
      return;
    }
    setOauthBusy(true);
    setError('');
    try {
      const state = createGmailOAuthState();
      persistGmailOAuthState(state, redirectUri);
      const url = buildGmailAuthorizeUrl({
        clientId: oauthApp.clientId,
        redirectUri,
        state,
        hostedDomain: oauthApp.hostedDomain,
        loginHint,
        selectAccount,
      });
      if (typeof window !== 'undefined') {
        window.location.assign(url);
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      setError(err?.message || 'Could not start Google sign-in.');
      setOauthBusy(false);
    }
  };

  const connectFirstInbox = () =>
    signInWithGoogle({ loginHint: session?.profile?.email || session?.login || '' });
  const addInbox = () => signInWithGoogle({ selectAccount: true });
  const reconnectInbox = (email) => signInWithGoogle({ loginHint: email });

  const disconnectInbox = async (email) => {
    if (!email) return;
    try {
      const rows = await disconnectGmailAccount(email);
      setAccounts(rows);
      setInbox((current) => current.filter((row) => row.account !== email));
      setSent((current) => current.filter((row) => row.account !== email));
      setAccountErrors((current) => {
        const next = { ...current };
        delete next[email];
        return next;
      });
      if (selectedAccount === email) chooseAccount('');
      if (activeMail?.account === email) {
        setActiveKey(null);
        setActiveMail(null);
      }
      setError('');
    } catch (err) {
      setError(err?.message || 'Could not disconnect that inbox.');
    }
  };

  const showNotice = useCallback((text) => {
    clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(''), 4000);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const composeAccount = selectedAccount || activeMail?.account || accounts.find((account) => account.connected)?.email || '';
  const connectedList = useMemo(() => Array.from(connectedEmails), [connectedEmails]);

  const startCompose = () => {
    setError('');
    setComposeDraft({ mode: 'new', to: [], cc: [], bcc: [], subject: '' });
  };

  const startReply = (mode) => {
    if (!activeMail) return;
    setError('');
    setComposeDraft(draftFromMail(activeMail, mode, connectedList));
  };

  const handleSent = (result) => {
    setComposeDraft(null);
    showNotice(result?.mode === 'new' ? 'Sent.' : result?.mode === 'forward' ? 'Forwarded.' : 'Reply sent.');
    // Gmail files the message under Sent right away; pull it in so the folder is current.
    refreshList();
  };

  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) => {
      const hay = `${emailSubject(row)} ${contactName(row.sender)} ${recipientNames(row.recipients)} ${row.preview} ${row.account}`.toLowerCase();
      return hay.includes(q);
    });
  }, [list, query]);

  if (!session?.token && !myId) {
    return (
      <View style={styles.signedOut}>
        <View style={styles.placeholderIcon}>
          <Ionicons name="mail-outline" size={32} color={ACCENT} />
        </View>
        <Text style={styles.emptyTitle}>Sign in to open mail</Text>
        <Text style={styles.emptyHint}>Your inbox and sent mail live with your profile.</Text>
        <Pressable style={styles.loginButton} onPress={onRequireLogin}>
          <Text style={styles.loginButtonText}>Go to Profile</Text>
        </Pressable>
      </View>
    );
  }

  const needsGoogle = accountsReady && accounts.length === 0 && folder !== 'customers';
  // On mobile the composer takes the whole screen; on desktop it replaces the reader.
  const showFolders = !isMobile || (!activeKey && !composeOpen);
  const showList = !needsGoogle && folder !== 'customers' && (!isMobile || (!activeKey && !composeOpen));
  const showReader = !needsGoogle && folder !== 'customers' && (!isMobile || Boolean(activeKey) || composeOpen);
  const isMe = (person) =>
    Boolean(person) && (person.profileId === myId || (person.email && connectedEmails.has(person.email)));

  const renderList = () => {
    if (loadingList && list.length === 0) {
      return (
        <View style={styles.inboxCentered}>
          <ActivityIndicator color="#1d1d1f" />
        </View>
      );
    }

    if (filteredList.length === 0) {
      const warning = focusAccount ? accountErrors[focusAccount.email] : '';
      return (
        <View style={styles.inboxCentered}>
          <Ionicons name={folder === 'sent' ? 'paper-plane-outline' : 'mail-outline'} size={36} color="#c7c7cc" />
          <Text style={styles.emptyTitle}>
            {warning ? 'Inbox needs a reconnect' : folder === 'sent' ? 'No sent mail' : 'Inbox zero'}
          </Text>
          <Text style={styles.emptyHint}>
            {warning
              ? warning
              : folder === 'sent'
                ? 'Mail you send from a connected inbox appears here.'
                : 'New mail to your connected inboxes appears here.'}
          </Text>
          {warning && focusAccount ? (
            <Pressable onPress={() => reconnectInbox(focusAccount.email)} style={styles.loginButton}>
              <Text style={styles.loginButtonText}>Reconnect {accountLabel(focusAccount.email)}</Text>
            </Pressable>
          ) : null}
        </View>
      );
    }

    return filteredList.map((row) => {
      const key = `${row.account}|${row.id}`;
      const selected = key === activeKey;
      const unread = folder === 'inbox' && row.unread;
      const who = folder === 'sent' ? recipientNames(row.recipients) : contactName(row.sender);
      return (
        <Pressable
          key={key}
          onPress={() => openMail(row)}
          {...(Platform.OS === 'web'
            ? { className: selected ? 'cgold-dm-row cgold-dm-row-active' : 'cgold-dm-row' }
            : null)}
          style={({ pressed }) => [
            styles.personRow,
            selected && styles.personRowSelected,
            pressed && styles.rowPressed,
          ]}
        >
          {folder === 'sent' ? (
            row.recipients.length > 1 ? (
              <View style={styles.stackAvatars}>
                <PersonAvatar person={row.recipients[0]} size={36} />
                <View style={styles.stackAvatarTwo}>
                  <PersonAvatar person={row.recipients[1]} size={28} />
                </View>
              </View>
            ) : (
              <PersonAvatar person={row.recipients[0]} size={44} />
            )
          ) : (
            <PersonAvatar person={row.sender} size={44} />
          )}
          <View style={styles.personCopy}>
            <View style={styles.personTop}>
              <Text style={[styles.personName, unread && styles.personNameUnread]} numberOfLines={1}>
                {who}
              </Text>
              {multiAccount && !selectedAccount ? (
                <Text style={styles.rowAccount} numberOfLines={1}>
                  {accountLabel(row.account)}
                </Text>
              ) : null}
              <Text style={[styles.personTime, unread && styles.personTimeUnread]}>
                {formatInboxTime(row.createdAt)}
              </Text>
            </View>
            <Text style={[styles.mailSubject, unread && styles.personNameUnread]} numberOfLines={1}>
              {emailSubject(row)}
            </Text>
            <Text style={[styles.personSub, unread && styles.personPreviewUnread]} numberOfLines={1}>
              {row.preview || ' '}
            </Text>
          </View>
        </Pressable>
      );
    });
  };

  const renderReader = () => {
    if (composeOpen) {
      return (
        <View style={styles.thread}>
          <EmailComposer
            key={`${composeDraft.mode}:${composeDraft.reply?.messageId || ''}:${composeAccount}`}
            draft={composeDraft}
            accounts={accounts}
            initialAccount={composeAccount}
            contacts={contacts}
            isMobile={isMobile}
            onClose={() => setComposeDraft(null)}
            onSent={handleSent}
            onReconnect={(email) => reconnectInbox(email)}
          />
        </View>
      );
    }

    if (isMobile && !activeKey) return null;

    if (!activeKey) {
      return (
        <View style={styles.threadPlaceholder}>
          <View style={styles.placeholderIcon}>
            <Ionicons name="mail-open-outline" size={32} color={ACCENT} />
          </View>
          <Text style={styles.emptyTitle}>No message selected</Text>
          <Text style={styles.emptyHint}>
            Choose a message from {folder === 'sent' ? 'Sent' : 'Inbox'}.
          </Text>
        </View>
      );
    }

    if (loadingMail && !activeMail) {
      return (
        <View style={styles.threadPlaceholder}>
          <ActivityIndicator color="#1d1d1f" />
        </View>
      );
    }

    if (!activeMail) {
      return (
        <View style={styles.threadPlaceholder}>
          <Text style={styles.emptyHint}>That email could not be opened.</Text>
        </View>
      );
    }

    const fromPerson = activeMail.sender;
    const toPeople = activeMail.recipients || [];
    const stamp = formatThreadStamp(activeMail.createdAt);

    return (
      <View style={styles.thread}>
        <View style={styles.threadHeader}>
          {isMobile ? (
            <Pressable
              onPress={() => {
                setActiveKey(null);
                setActiveMail(null);
              }}
              style={styles.backButton}
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={22} color={BLUE} />
            </Pressable>
          ) : null}
          <View style={styles.threadHeaderCopy}>
            <Text style={styles.threadName} numberOfLines={2}>
              {emailSubject(activeMail)}
            </Text>
            <Text style={styles.threadSeen}>
              {multiAccount && activeMail.account ? `${stamp} · ${activeMail.account}` : stamp}
            </Text>
          </View>
          <View style={styles.threadActions}>
            {[
              { mode: 'reply', label: 'Reply', icon: 'arrow-undo-outline' },
              { mode: 'replyAll', label: 'Reply all', icon: 'arrow-undo-circle-outline' },
              { mode: 'forward', label: 'Forward', icon: 'arrow-redo-outline' },
            ].map((action) => (
              <Pressable
                key={action.mode}
                onPress={() => startReply(action.mode)}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ hovered, pressed }) => [
                  styles.threadAction,
                  isMobile && styles.threadActionIcon,
                  (hovered || pressed) && styles.threadActionHover,
                ]}
              >
                <Ionicons name={action.icon} size={isMobile ? 20 : 15} color={ACCENT} />
                {!isMobile ? <Text style={styles.threadActionText}>{action.label}</Text> : null}
              </Pressable>
            ))}
          </View>
        </View>
        <ScrollView style={styles.threadList} contentContainerStyle={styles.mailBodyContent}>
          <Text style={styles.sectionLabel}>From</Text>
          <ProfileCard
            person={fromPerson}
            subtitle={isMe(fromPerson) ? 'You' : 'Sent this email'}
            onOpen={fromPerson?.profileId ? handleOpenProfile : null}
          />
          <Text style={styles.sectionLabel}>To</Text>
          {toPeople.map((person) => (
            <ProfileCard
              key={person.id}
              person={person}
              compact
              subtitle={isMe(person) ? 'You' : 'Recipient'}
              onOpen={person.profileId ? handleOpenProfile : null}
            />
          ))}
          <View style={styles.mailBodyCard}>
            {Array.isArray(activeMail.attachments) && activeMail.attachments.length ? (
              <View style={styles.attachmentRow}>
                {activeMail.attachments.map((file, index) => (
                  <Text key={`${file.filename || file.mimeType}-${index}`} style={styles.attachmentName}>
                    {file.filename || file.mimeType || 'Attachment'}
                  </Text>
                ))}
              </View>
            ) : null}
            <Text style={styles.mailBodyText}>{activeMail.body}</Text>
          </View>
          <View style={styles.replyBar}>
            <Pressable
              onPress={() => startReply('reply')}
              accessibilityRole="button"
              style={({ hovered, pressed }) => [styles.replyBarButton, (hovered || pressed) && styles.replyBarButtonHover]}
            >
              <Ionicons name="arrow-undo-outline" size={16} color={ACCENT} />
              <Text style={styles.replyBarText}>Reply</Text>
            </Pressable>
            <Pressable
              onPress={() => startReply('replyAll')}
              accessibilityRole="button"
              style={({ hovered, pressed }) => [styles.replyBarButton, (hovered || pressed) && styles.replyBarButtonHover]}
            >
              <Ionicons name="arrow-undo-circle-outline" size={16} color={ACCENT} />
              <Text style={styles.replyBarText}>Reply all</Text>
            </Pressable>
            <Pressable
              onPress={() => startReply('forward')}
              accessibilityRole="button"
              style={({ hovered, pressed }) => [styles.replyBarButton, (hovered || pressed) && styles.replyBarButtonHover]}
            >
              <Ionicons name="arrow-redo-outline" size={16} color={ACCENT} />
              <Text style={styles.replyBarText}>Forward</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderAccountRail = () => {
    if (!accounts.length) return null;
    if (isMobile) {
      return (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.accountChipsScroll}
          contentContainerStyle={styles.accountChips}
          keyboardShouldPersistTaps="handled"
        >
          {multiAccount ? (
            <AccountChip all active={!selectedAccount} count={totalUnread} onPress={() => chooseAccount('')} />
          ) : null}
          {accounts.map((account) => (
            <AccountChip
              key={account.email}
              account={account}
              active={selectedAccount === account.email || (!multiAccount && !selectedAccount)}
              count={unreadByAccount[account.email] || 0}
              warning={Boolean(accountErrors[account.email]) || !account.connected}
              onPress={() => chooseAccount(multiAccount ? account.email : '')}
            />
          ))}
          <Pressable
            onPress={addInbox}
            disabled={oauthBusy}
            accessibilityRole="button"
            accessibilityLabel="Add an inbox"
            style={styles.accountChip}
          >
            <Ionicons name="add" size={16} color={ACCENT} />
            <Text style={[styles.accountChipText, { color: ACCENT }]}>Add inbox</Text>
          </Pressable>
        </ScrollView>
      );
    }
    return (
      <View style={styles.accountsSection}>
        <Text style={styles.accountsTitle}>Inboxes</Text>
        {multiAccount ? (
          <AccountRow all active={!selectedAccount} count={totalUnread} onPress={() => chooseAccount('')} />
        ) : null}
        {accounts.map((account) => (
          <AccountRow
            key={account.email}
            account={account}
            active={selectedAccount === account.email || (!multiAccount && !selectedAccount)}
            count={unreadByAccount[account.email] || 0}
            warning={Boolean(accountErrors[account.email]) || !account.connected}
            onPress={() => chooseAccount(multiAccount ? account.email : '')}
          />
        ))}
        <Pressable
          onPress={addInbox}
          disabled={oauthBusy}
          accessibilityRole="button"
          accessibilityLabel="Add an inbox"
          style={({ hovered, pressed }) => [styles.folderBtn, (hovered || pressed) && styles.folderBtnHover]}
        >
          <View style={styles.allInboxesMark}>
            <Ionicons name="add" size={16} color={ACCENT} />
          </View>
          <Text style={[styles.folderLabel, styles.accountLabel, { color: ACCENT }]} numberOfLines={1}>
            Add inbox
          </Text>
        </Pressable>
      </View>
    );
  };

  const renderAccountBlock = () => {
    if (!focusAccount) return null;
    const warning = accountErrors[focusAccount.email] || (!focusAccount.connected ? focusAccount.error || 'Reconnect this inbox.' : '');
    return (
      <View style={[styles.accountBlock, isMobile && styles.accountBlockMobile]}>
        <Text style={styles.accountEmail} numberOfLines={1}>
          {focusAccount.email}
        </Text>
        {warning ? (
          <Pressable onPress={() => reconnectInbox(focusAccount.email)} style={styles.disconnectBtn}>
            <Text style={styles.disconnectText}>Reconnect</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => disconnectInbox(focusAccount.email)}
          style={styles.disconnectBtn}
          accessibilityRole="button"
          accessibilityLabel={`Disconnect ${focusAccount.email}`}
        >
          <Text style={styles.disconnectText}>Disconnect</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.root, isMobile && styles.rootMobile, embedded && styles.rootEmbedded]}>
      {showFolders ? (
        <View style={[styles.folders, isMobile && styles.foldersMobile]}>
          {!isMobile ? <Text style={styles.foldersTitle}>Mail</Text> : null}
          <View style={[styles.folderList, isMobile && styles.folderListMobile]}>
            {folders.map((item) => (
              <FolderButton
                key={item.key}
                item={item}
                active={folder === item.key && !composeOpen}
                count={item.key === 'inbox' ? unreadCount : 0}
                onPress={() => {
                  setFolder(item.key);
                  setComposeDraft(null);
                  setActiveKey(null);
                  setActiveMail(null);
                  setQuery('');
                }}
              />
            ))}
          </View>
          {renderAccountRail()}
          {!isMobile ? renderAccountBlock() : null}
        </View>
      ) : null}

      {folder === 'customers' ? (
        <View style={styles.captureHost}>{capture}</View>
      ) : !accountsReady ? (
        <View style={styles.connectHost}>
          <ActivityIndicator color="#1d1d1f" />
        </View>
      ) : needsGoogle ? (
        <View style={styles.connectHost}>
          <View style={styles.placeholderIcon}>
            <Ionicons name="logo-google" size={28} color={ACCENT} />
          </View>
          <Text style={styles.emptyTitle}>Connect your Canada Gold email</Text>
          <Text style={styles.emptyHint}>
            Sign in with a {oauthApp?.hostedDomain || 'canadagold.ca'} Google account to load Inbox and
            Sent. You can add more than one inbox, and they stay connected the next time you log in.
            If the sender is on this app, their profile opens from the message.
          </Text>
          {error ? <Text style={styles.connectError}>{error}</Text> : null}
          {getGmailRedirectUri() ? (
            <View style={styles.redirectBox}>
              <Text style={styles.redirectLabel}>Add this exact Authorized redirect URI in Google Cloud</Text>
              <Text selectable style={styles.redirectUri}>
                {getGmailRedirectUri()}
              </Text>
              <Text style={styles.redirectHint}>
                APIs & Services → Credentials → your Web client → Authorized redirect URIs. Google
                compares it byte-for-byte, including http vs https and a trailing slash.
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={connectFirstInbox}
            disabled={oauthBusy || (oauthApp && !oauthApp.configured)}
            style={({ hovered, pressed }) => [
              styles.googleButton,
              (hovered || pressed) && styles.googleButtonHover,
              (oauthBusy || (oauthApp && !oauthApp.configured)) && styles.googleButtonDisabled,
            ]}
          >
            {oauthBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="logo-google" size={16} color="#fff" />
                <Text style={styles.googleButtonText}>Sign in with Google</Text>
              </>
            )}
          </Pressable>
          {oauthApp && !oauthApp.configured ? (
            <Text style={styles.emptyHint}>
              A system admin still needs to add the Google OAuth client on the server.
            </Text>
          ) : null}
        </View>
      ) : (
        <>
          {showList ? (
            <View style={[styles.inbox, isMobile && styles.inboxMobile]}>
              <View style={[styles.inboxHeader, isMobile && styles.inboxHeaderMobile]}>
                <View style={styles.inboxTitleRow}>
                  <Text style={styles.inboxTitle}>{folder === 'sent' ? 'Sent' : 'Inbox'}</Text>
                  <Pressable
                    onPress={startCompose}
                    accessibilityRole="button"
                    accessibilityLabel="New message"
                    style={({ hovered, pressed }) => [
                      styles.composeButton,
                      (hovered || pressed) && styles.composeButtonHover,
                      composeOpen && composeDraft?.mode === 'new' && styles.composeButtonActive,
                    ]}
                  >
                    <Ionicons name="create-outline" size={20} color={ACCENT} />
                  </Pressable>
                </View>
                {isMobile ? renderAccountBlock() : null}
              </View>
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color="#8e8e93" />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search"
                  placeholderTextColor="#8e8e93"
                  style={styles.searchInput}
                />
              </View>
              {notice ? (
                <View style={styles.noticeRow}>
                  <Ionicons name="checkmark-circle" size={14} color="#15803D" />
                  <Text style={styles.noticeText}>{notice}</Text>
                </View>
              ) : null}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <ScrollView style={styles.inboxList} contentContainerStyle={styles.inboxListContent}>
                {renderList()}
              </ScrollView>
            </View>
          ) : null}
          {showReader ? renderReader() : null}
        </>
      )}

      <ProfilePhotoModal
        visible={Boolean(photoPerson)}
        onClose={() => setPhotoPerson(null)}
        profileId={photoPerson?.id || ''}
        name={contactName(photoPerson)}
        avatarUrl={photoPerson?.avatarUrl || ''}
        locationName={photoPerson?.locationName || ''}
        myId={myId}
        myName={contactName(myPerson)}
        myAvatarUrl={session?.profile?.avatarUrl || ''}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    height: '100%',
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
  },
  rootMobile: {
    flexDirection: 'column',
  },
  rootEmbedded: {
    borderTopWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 14,
    overflow: 'hidden',
  },
  folders: {
    width: FOLDER_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#e5e5ea',
    backgroundColor: '#f5f5f7',
    paddingTop: 18,
    paddingHorizontal: 10,
    paddingBottom: 16,
  },
  foldersMobile: {
    width: '100%',
    borderRightWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  accountsSection: {
    marginTop: 18,
    gap: 2,
  },
  accountsTitle: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 10,
    marginBottom: 4,
  },
  accountLabel: {
    fontSize: 14,
  },
  allInboxesMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e5ea',
  },
  accountChipsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  accountChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  accountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 6,
    paddingRight: 10,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#e8e8ed',
    maxWidth: 180,
  },
  accountChipActive: {
    backgroundColor: '#e8e7ff',
  },
  accountChipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    flexShrink: 1,
  },
  accountChipTextActive: {
    color: ACCENT,
  },
  accountChipCount: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#8e8e93',
  },
  rowAccount: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: ACCENT,
    backgroundColor: '#eef0ff',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
    maxWidth: 96,
  },
  accountBlockMobile: {
    marginTop: 4,
    paddingTop: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  foldersTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '700',
    color: '#1d1d1f',
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  folderList: {
    gap: 2,
  },
  folderListMobile: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  folderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  folderBtnActive: {
    backgroundColor: '#e8e7ff',
  },
  folderBtnHover: {
    backgroundColor: '#ececef',
  },
  folderLabel: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  folderLabelActive: {
    color: ACCENT,
  },
  folderBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
  },
  folderBadgeText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  inbox: {
    width: LIST_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#e5e5ea',
    backgroundColor: '#fff',
    minHeight: 0,
  },
  inboxMobile: {
    width: '100%',
    borderRightWidth: 0,
    flex: 1,
  },
  inboxHeader: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },
  inboxHeaderMobile: {
    paddingTop: 8,
  },
  inboxTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  inboxTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '700',
    color: '#1d1d1f',
  },
  composeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  composeButtonHover: {
    backgroundColor: '#f2f2f7',
  },
  composeButtonActive: {
    backgroundColor: '#e8e7ff',
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
  },
  noticeText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#15803D',
  },
  threadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  threadAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#eef0ff',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  threadActionIcon: {
    width: 36,
    height: 36,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 18,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  threadActionHover: {
    backgroundColor: '#dcdfff',
  },
  threadActionText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  replyBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
  },
  replyBarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dcdfff',
    backgroundColor: '#fff',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  replyBarButtonHover: {
    backgroundColor: '#eef0ff',
  },
  replyBarText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f2f2f7',
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    paddingVertical: 0,
    outlineStyle: 'none',
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#b91c1c',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  inboxList: {
    flex: 1,
    minHeight: 0,
  },
  inboxListContent: {
    paddingBottom: 24,
  },
  inboxCentered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 64,
    gap: 8,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  personRowSelected: {
    backgroundColor: '#ececef',
  },
  rowPressed: {
    backgroundColor: '#f5f5f7',
  },
  personCopy: {
    flex: 1,
    minWidth: 0,
  },
  personTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  personName: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  personNameUnread: {
    fontWeight: '700',
  },
  personTime: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
  },
  personTimeUnread: {
    color: ACCENT,
    fontWeight: '600',
  },
  mailSubject: {
    fontFamily,
    fontSize: 14,
    color: '#1d1d1f',
    marginTop: 1,
  },
  personSub: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 1,
  },
  personPreviewUnread: {
    color: '#3a3a3c',
  },
  avatar: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily,
    fontWeight: '700',
    color: '#fff',
  },
  stackAvatars: {
    width: 44,
    height: 44,
  },
  stackAvatarTwo: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 16,
  },
  thread: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: '#fff',
  },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  threadHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  threadName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  threadSeen: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 1,
  },
  backButton: {
    width: 28,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  threadList: {
    flex: 1,
    minHeight: 0,
  },
  mailBodyContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  sectionLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 8,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 6,
    borderRadius: 14,
    backgroundColor: '#f5f5f7',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  profileCardCompact: {
    paddingVertical: 8,
  },
  profileCardHover: {
    backgroundColor: '#ececef',
  },
  profileCardCopy: {
    flex: 1,
    minWidth: 0,
  },
  profileCardName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  profileCardSub: {
    fontFamily,
    fontSize: 12,
    color: ACCENT,
    fontWeight: '600',
    marginTop: 1,
  },
  profileCardMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 1,
  },
  mailBodyCard: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
    gap: 12,
  },
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  attachmentName: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    backgroundColor: '#f2f2f7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  mailBodyText: {
    fontFamily,
    fontSize: 16,
    lineHeight: 24,
    color: '#1d1d1f',
  },
  threadPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  placeholderIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1d1d1f',
    textAlign: 'center',
  },
  emptyHint: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  signedOut: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
    backgroundColor: '#fff',
  },
  loginButton: {
    marginTop: 12,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  loginButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  connectHost: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  connectError: {
    fontFamily,
    fontSize: 13,
    color: '#b91c1c',
    textAlign: 'center',
  },
  redirectBox: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#f5f5f7',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  redirectLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  redirectUri: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  redirectHint: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    lineHeight: 16,
  },
  googleButton: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  googleButtonHover: {
    backgroundColor: '#3730A3',
  },
  googleButtonDisabled: {
    opacity: 0.55,
  },
  googleButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  accountBlock: {
    marginTop: 'auto',
    paddingTop: 12,
    gap: 6,
  },
  accountEmail: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    paddingHorizontal: 4,
    flexShrink: 1,
  },
  disconnectBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  disconnectText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  captureHost: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
});
