import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
  clearGmailSession,
  createGmailOAuthState,
  exchangeGmailOAuthCode,
  getGmailMessage,
  getGmailRedirectUri,
  readGmailOAuthRedirect,
  listGmailMailbox,
  loadGmailOAuthApp,
  loadGmailSession,
  mapGmailMail,
  persistGmailOAuthState,
  readGmailOAuthCallback,
  readGmailOAuthState,
} from '../lib/gmail';
import { useIsMobile } from '../lib/mobileUi';
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
  const [activeId, setActiveId] = useState(null);
  const [activeMail, setActiveMail] = useState(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [subjectDraft, setSubjectDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMail, setLoadingMail] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [photoPerson, setPhotoPerson] = useState(null);
  const [gmailSession, setGmailSession] = useState(null);
  const [gmailReady, setGmailReady] = useState(false);
  const [oauthApp, setOauthApp] = useState(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const appliedFocusKey = useRef(null);
  const gmailSessionRef = useRef(null);
  gmailSessionRef.current = gmailSession;

  const list = folder === 'sent' ? sent : inbox;
  const unreadCount = useMemo(() => inbox.filter((row) => row.unread).length, [inbox]);
  const connectedEmail = gmailSession?.email || '';

  useEffect(() => {
    if (!focus?.key || focus.key === appliedFocusKey.current) return;
    appliedFocusKey.current = focus.key;
    if (capture) {
      setFolder('customers');
      setComposeOpen(false);
      setActiveId(null);
      setActiveMail(null);
    }
  }, [focus, capture]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mail, app] = await Promise.all([
          loadGmailSession(),
          loadGmailOAuthApp().catch(() => ({ clientId: '', configured: false, hostedDomain: 'canadagold.ca' })),
        ]);
        if (cancelled) return;
        setGmailSession(mail);
        setOauthApp(app);
      } finally {
        if (!cancelled) setGmailReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
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
        const next = await exchangeGmailOAuthCode({
          code: callback.code,
          redirectUri: readGmailOAuthRedirect() || getGmailRedirectUri(),
        });
        clearGmailOAuthState();
        clearGmailOAuthCallbackFromUrl();
        if (!cancelled) {
          setGmailSession(next);
          setFolder('inbox');
        }
      } catch (err) {
        clearGmailOAuthCallbackFromUrl();
        if (!cancelled) setError(err?.message || 'Google sign-in failed.');
      } finally {
        if (!cancelled) setOauthBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshList = useCallback(async () => {
    const mailSession = gmailSessionRef.current;
    if (!mailSession?.token) {
      setInbox([]);
      setSent([]);
      setLoadingList(false);
      return [];
    }
    setLoadingList(true);
    try {
      const people = await listEmailContacts().catch(() => []);
      if (myPerson?.email) {
        const mine = people.some((person) => person.id === myPerson.id);
        if (!mine) people.push(myPerson);
      }
      const [inboxRes, sentRes] = await Promise.all([
        listGmailMailbox(mailSession, 'inbox'),
        listGmailMailbox(mailSession, 'sent'),
      ]);
      const latest = sentRes.session || inboxRes.session || mailSession;
      setGmailSession(latest);
      setContacts(people);
      setInbox((inboxRes.messages || []).map((row) => mapGmailMail(row, people)));
      setSent((sentRes.messages || []).map((row) => mapGmailMail(row, people)));
      setError('');
      return inboxRes.messages || [];
    } catch (err) {
      setError(err.message || 'Could not load mail.');
      return [];
    } finally {
      setLoadingList(false);
    }
  }, [myPerson]);

  const openMail = useCallback(async (emailId) => {
    if (!emailId) return;
    const mailSession = gmailSessionRef.current;
    if (!mailSession?.token) return;
    setActiveId(emailId);
    setComposeOpen(false);
    setLoadingMail(true);
    try {
      const result = await getGmailMessage(mailSession, emailId);
      setGmailSession(result.session);
      const mapped = mapGmailMail(result.message, contacts);
      setActiveMail(mapped);
      setInbox((current) =>
        current.map((item) => (item.id === emailId ? { ...item, unread: false } : item)),
      );
      setError('');
    } catch (err) {
      setError(err.message || 'Could not open that email.');
    } finally {
      setLoadingMail(false);
    }
  }, [contacts]);

  useEffect(() => {
    if (!gmailReady) return;
    refreshList();
  }, [gmailReady, gmailSession?.token, refreshList]);

  const handleOpenProfile = (person) => {
    if (!person?.profileId) return;
    if (onOpenProfile) {
      onOpenProfile(person);
      return;
    }
    setPhotoPerson(person);
  };

  const signInWithGoogle = async () => {
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
        loginHint: session?.profile?.email || session?.login || '',
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

  const disconnectGoogle = async () => {
    await clearGmailSession();
    setGmailSession(null);
    setInbox([]);
    setSent([]);
    setActiveId(null);
    setActiveMail(null);
    setError('');
  };

  const startCompose = (people = [], { subject = '', body = '' } = {}) => {
    setComposeOpen(true);
    setActiveId(null);
    setActiveMail(null);
    setSelectedIds(people.map((person) => person.id).filter(Boolean));
    setSubjectDraft(subject);
    setBodyDraft(body);
    setQuery('');
  };

  const toggleSelected = (personId) => {
    setSelectedIds((current) =>
      current.includes(personId)
        ? current.filter((id) => id !== personId)
        : [...current, personId],
    );
  };

  const handleSend = async () => {
    setError('This inbox is read-only. Reply from Gmail for now.');
  };

  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || composeOpen) return list;
    return list.filter((row) => {
      const hay = `${emailSubject(row)} ${contactName(row.sender)} ${recipientNames(row.recipients)} ${row.preview}`.toLowerCase();
      return hay.includes(q);
    });
  }, [composeOpen, list, query]);

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((person) => {
      const hay = `${contactName(person)} ${person.email || ''} ${person.locationName || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [contacts, query]);

  const selectedPeople = useMemo(
    () => selectedIds.map((id) => contacts.find((person) => person.id === id)).filter(Boolean),
    [selectedIds, contacts],
  );

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

  const needsGoogle = gmailReady && !gmailSession && folder !== 'customers';
  const showFolders = !isMobile || !activeId;
  const showList = !needsGoogle && folder !== 'customers' && (!isMobile || !activeId);
  const showReader = !needsGoogle && folder !== 'customers' && (!isMobile || Boolean(activeId)) && !(isMobile && composeOpen);

  const renderList = () => {
    if (composeOpen) {
      if (filteredPeople.length === 0) {
        return (
          <Text style={styles.emptyHint}>
            {contacts.length === 0 ? 'No other staff have signed in yet.' : 'No matching people.'}
          </Text>
        );
      }
      return filteredPeople.map((person) => {
        const checked = selectedIds.includes(person.id);
        return (
          <Pressable
            key={person.id}
            onPress={() => toggleSelected(person.id)}
            {...(Platform.OS === 'web' ? { className: 'cgold-dm-row' } : null)}
            style={({ pressed }) => [styles.personRow, pressed && styles.rowPressed]}
          >
            <PersonAvatar person={person} size={44} />
            <View style={styles.personCopy}>
              <Text style={styles.personName} numberOfLines={1}>
                {contactName(person)}
              </Text>
              <Text style={styles.personSub} numberOfLines={1}>
                {[person.email, person.locationName].filter(Boolean).join(' · ') || 'App user'}
              </Text>
            </View>
            <Ionicons
              name={checked ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={checked ? BLUE : '#c7c7cc'}
            />
          </Pressable>
        );
      });
    }

    if (loadingList && list.length === 0) {
      return (
        <View style={styles.inboxCentered}>
          <ActivityIndicator color="#1d1d1f" />
        </View>
      );
    }

    if (filteredList.length === 0) {
      return (
        <View style={styles.inboxCentered}>
          <Ionicons name={folder === 'sent' ? 'paper-plane-outline' : 'mail-outline'} size={36} color="#c7c7cc" />
          <Text style={styles.emptyTitle}>{folder === 'sent' ? 'No sent mail' : 'Inbox zero'}</Text>
          <Text style={styles.emptyHint}>
            {folder === 'sent'
              ? 'Mail you send from this Google account appears here.'
              : 'New mail to this Google account appears here.'}
          </Text>
        </View>
      );
    }

    return filteredList.map((row) => {
      const selected = row.id === activeId;
      const unread = folder === 'inbox' && row.unread;
      const who = folder === 'sent' ? recipientNames(row.recipients) : contactName(row.sender);
      return (
        <Pressable
          key={row.id}
          onPress={() => openMail(row.id)}
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
        <KeyboardAvoidingView
          style={styles.thread}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {isMobile ? (
            <View style={styles.threadHeader}>
              <Pressable onPress={() => setComposeOpen(false)} style={styles.backButton} accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={22} color={BLUE} />
              </Pressable>
              <Text style={styles.threadName}>New message</Text>
            </View>
          ) : (
            <View style={styles.threadHeader}>
              <Text style={styles.threadName}>New message</Text>
            </View>
          )}
          <View style={styles.composeFields}>
            <View style={styles.composeRow}>
              <Text style={styles.composeLabel}>To</Text>
              <View style={styles.recipientBody}>
                {selectedPeople.length === 0 ? (
                  <Text style={styles.composePlaceholder}>Choose people on the left</Text>
                ) : (
                  selectedPeople.map((person) => (
                    <Pressable
                      key={person.id}
                      onPress={() => toggleSelected(person.id)}
                      style={({ hovered }) => [styles.chip, hovered && styles.chipHover]}
                    >
                      <PersonAvatar person={person} size={22} />
                      <Text style={styles.chipText}>{contactName(person)}</Text>
                    </Pressable>
                  ))
                )}
              </View>
            </View>
            <View style={styles.composeRow}>
              <Text style={styles.composeLabel}>Subject</Text>
              <TextInput
                value={subjectDraft}
                onChangeText={setSubjectDraft}
                placeholder="Subject"
                placeholderTextColor="#8e8e93"
                style={styles.composeInput}
              />
            </View>
          </View>
          <TextInput
            value={bodyDraft}
            onChangeText={setBodyDraft}
            placeholder="Write your email…"
            placeholderTextColor="#8e8e93"
            multiline
            textAlignVertical="top"
            style={styles.composeBody}
          />
          <View style={styles.composeFooter}>
            <Pressable
              onPress={handleSend}
              disabled={sending || selectedIds.length === 0 || !bodyDraft.trim()}
              style={({ hovered, pressed }) => [
                styles.sendButton,
                (hovered || pressed) && styles.sendButtonHover,
                (sending || selectedIds.length === 0 || !bodyDraft.trim()) && styles.sendButtonDisabled,
              ]}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={14} color="#fff" />
                  <Text style={styles.sendButtonText}>Send</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      );
    }

    if (isMobile && !activeId) return null;

    if (!activeId) {
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

    return (
      <View style={styles.thread}>
        <View style={styles.threadHeader}>
          {isMobile ? (
            <Pressable
              onPress={() => {
                setActiveId(null);
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
            <Text style={styles.threadSeen}>{formatThreadStamp(activeMail.createdAt)}</Text>
          </View>
        </View>
        <ScrollView style={styles.threadList} contentContainerStyle={styles.mailBodyContent}>
          <Text style={styles.sectionLabel}>From</Text>
          <ProfileCard
            person={fromPerson}
            subtitle={fromPerson?.profileId === myId || fromPerson?.email === connectedEmail ? 'You' : 'Sent this email'}
            onOpen={fromPerson?.profileId ? handleOpenProfile : null}
          />
          <Text style={styles.sectionLabel}>To</Text>
          {toPeople.map((person) => (
            <ProfileCard
              key={person.id}
              person={person}
              compact
              subtitle={person.profileId === myId || person.email === connectedEmail ? 'You' : 'Recipient'}
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
        </ScrollView>
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
                  setComposeOpen(false);
                  setActiveId(null);
                  setActiveMail(null);
                  setQuery('');
                }}
              />
            ))}
          </View>
          {gmailSession ? (
            <View style={styles.accountBlock}>
              <Text style={styles.accountEmail} numberOfLines={1}>
                {connectedEmail || 'Connected'}
              </Text>
              <Pressable onPress={disconnectGoogle} style={styles.disconnectBtn}>
                <Text style={styles.disconnectText}>Disconnect</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {folder === 'customers' ? (
        <View style={styles.captureHost}>{capture}</View>
      ) : needsGoogle || !gmailReady ? (
        <View style={styles.connectHost}>
          <View style={styles.placeholderIcon}>
            <Ionicons name="logo-google" size={28} color={ACCENT} />
          </View>
          <Text style={styles.emptyTitle}>Sign in to your Canada Gold email</Text>
          <Text style={styles.emptyHint}>
            Connect the Google account for {oauthApp?.hostedDomain || 'canadagold.ca'} to load Inbox and
            Sent. If the sender is on this app, their profile opens from the message.
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
            onPress={signInWithGoogle}
            disabled={oauthBusy || (oauthApp && !oauthApp.configured)}
            style={({ hovered, pressed }) => [
              styles.googleButton,
              (hovered || pressed) && styles.googleButtonHover,
              (oauthBusy || (oauthApp && !oauthApp.configured)) && styles.googleButtonDisabled,
            ]}
          >
            {oauthBusy || !gmailReady ? (
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
                <Text style={styles.inboxTitle}>
                  {composeOpen ? (isMobile ? 'New message' : 'To') : folder === 'sent' ? 'Sent' : 'Inbox'}
                </Text>
              </View>
              {isMobile && composeOpen ? (
                <View style={styles.composeFields}>
                  <View style={styles.composeRow}>
                    <Text style={styles.composeLabel}>To</Text>
                    <View style={styles.recipientBody}>
                      {selectedPeople.length === 0 ? (
                        <Text style={styles.composePlaceholder}>Tap people below</Text>
                      ) : (
                        selectedPeople.map((person) => (
                          <Pressable
                            key={person.id}
                            onPress={() => toggleSelected(person.id)}
                            style={({ hovered }) => [styles.chip, hovered && styles.chipHover]}
                          >
                            <PersonAvatar person={person} size={22} />
                            <Text style={styles.chipText}>{contactName(person)}</Text>
                          </Pressable>
                        ))
                      )}
                    </View>
                  </View>
                  <View style={styles.composeRow}>
                    <Text style={styles.composeLabel}>Subject</Text>
                    <TextInput
                      value={subjectDraft}
                      onChangeText={setSubjectDraft}
                      placeholder="Subject"
                      placeholderTextColor="#8e8e93"
                      style={styles.composeInput}
                    />
                  </View>
                </View>
              ) : null}
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color="#8e8e93" />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={composeOpen ? 'Search people' : 'Search'}
                  placeholderTextColor="#8e8e93"
                  style={styles.searchInput}
                />
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <ScrollView style={styles.inboxList} contentContainerStyle={styles.inboxListContent}>
                {renderList()}
              </ScrollView>
              {isMobile && composeOpen ? (
                <View style={styles.composeFooter}>
                  <TextInput
                    value={bodyDraft}
                    onChangeText={setBodyDraft}
                    placeholder="Write your email…"
                    placeholderTextColor="#8e8e93"
                    multiline
                    textAlignVertical="top"
                    style={styles.composeBodyMobile}
                  />
                  <Pressable
                    onPress={handleSend}
                    disabled={sending || selectedIds.length === 0 || !bodyDraft.trim()}
                    style={({ hovered, pressed }) => [
                      styles.sendButton,
                      (hovered || pressed) && styles.sendButtonHover,
                      (sending || selectedIds.length === 0 || !bodyDraft.trim()) && styles.sendButtonDisabled,
                    ]}
                  >
                    {sending ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="paper-plane" size={14} color="#fff" />
                        <Text style={styles.sendButtonText}>Send</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              ) : null}
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
  composeBodyMobile: {
    minHeight: 88,
    maxHeight: 140,
    fontFamily,
    fontSize: 16,
    lineHeight: 22,
    color: '#1d1d1f',
    marginBottom: 10,
    outlineStyle: 'none',
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
    paddingBottom: 10,
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
  composeFab: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  composeFabMobile: {
    marginTop: 0,
    width: 42,
    height: 42,
    borderRadius: 21,
    paddingVertical: 0,
  },
  composeFabHover: {
    backgroundColor: '#3730A3',
  },
  composeFabText: {
    fontFamily,
    fontSize: 15,
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
  inboxTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '700',
    color: '#1d1d1f',
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
  headerAction: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
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
  composeFields: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  composeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  composeLabel: {
    width: 64,
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#8e8e93',
  },
  composePlaceholder: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
  },
  composeInput: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    paddingVertical: 4,
    outlineStyle: 'none',
  },
  composeBody: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    lineHeight: 22,
    color: '#1d1d1f',
    paddingHorizontal: 16,
    paddingTop: 14,
    outlineStyle: 'none',
  },
  composeFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
    alignItems: 'flex-start',
  },
  recipientBody: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#eef4ff',
    borderRadius: 999,
    paddingLeft: 2,
    paddingRight: 8,
    paddingVertical: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chipHover: {
    backgroundColor: '#dceaff',
  },
  chipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: BLUE,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sendButtonHover: {
    backgroundColor: '#3730A3',
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  sendButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
