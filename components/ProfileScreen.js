import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { uploadOwnAvatar } from '../lib/profiles';
import { categoryLabel, findStaffByEmployeeName, findStaffById, listStaffProfiles } from '../lib/permissions';
import { listTeams, teamMemberName } from '../lib/teams';
import { fetchAureusEmployee } from '../lib/aureusEmployees';
import { useIsMobile } from '../lib/mobileUi';
import ProfilePhotoModal from './ProfilePhotoModal';
import ProfilePhotoPicker from './ProfilePhotoPicker';
import ProfileLocationPicker from './ProfileLocationPicker';
import ProfileTeamPicker from './ProfileTeamPicker';
import ProfileNotesTable from './ProfileNotesTable';
import { usePhoneCalls } from './PhoneCallProvider';

const fontFamily = 'Sohne';
const BLUE = '#007AFF';
const GOLD = '#E8C36A';

export function profileTargetFromPerson(person) {
  if (!person) return null;
  const name = String(
    person.name ||
      person.fullName ||
      [person.firstName, person.lastName].filter(Boolean).join(' ') ||
      '',
  ).trim();
  return {
    profileId: String(person.profileId || person.id || '').trim(),
    name,
    avatarUrl: person.avatarUrl || person.photoUrl || '',
    locationName: person.locationName || '',
    email: person.email || '',
    employeeType: person.employeeType || person.posRole || '',
    role: person.role || person.posRole || '',
    teamId: person.teamId || '',
    teamName: person.teamName || '',
  };
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function ProfileAvatar({ uri, name, size = 24, style }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const initials = initialsFromName(name);
  const showImage = Boolean(uri) && !failed;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#e8e8ed',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          onError={() => setFailed(true)}
        />
      ) : initials ? (
        <Text
          style={{
            fontFamily,
            fontSize: Math.max(10, Math.round(size * 0.36)),
            fontWeight: '600',
            color: '#1d1d1f',
          }}
        >
          {initials}
        </Text>
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.5)} color="#8e8e93" />
      )}
    </View>
  );
}

function DetailRow({ label, value, last, onPress }) {
  const content = (
    <>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValueWrap}>
        <Text style={styles.detailValue} numberOfLines={2}>
          {value || '—'}
        </Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color="#c7c7cc" /> : null}
    </>
  );

  const rowStyle = [styles.detailRow, last && styles.detailRowLast, onPress && styles.detailRowTappable];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value || 'Not set'}`}
        style={({ hovered, pressed }) => [rowStyle, (hovered || pressed) && styles.rowHovered]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={rowStyle}>{content}</View>;
}

function ActionIcon({ icon, label, onPress, disabled, busy }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ hovered, pressed }) => [
        styles.actionItem,
        (disabled || busy) && styles.actionItemDisabled,
        (hovered || pressed) && !disabled && !busy && styles.actionItemPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.actionIcon}>
        {busy ? (
          <ActivityIndicator size="small" color={BLUE} />
        ) : (
          <Ionicons name={icon} size={20} color={disabled ? '#c7c7cc' : BLUE} />
        )}
      </View>
      <Text style={[styles.actionLabel, disabled && styles.actionLabelDisabled]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function OrgPerson({ person, size = 52, current }) {
  const name = teamMemberName(person);
  return (
    <View style={[styles.orgPerson, current && styles.orgPersonCurrent]}>
      <View style={current ? styles.orgAvatarRing : null}>
        <ProfileAvatar uri={person?.avatarUrl || ''} name={name} size={size} />
      </View>
      <Text style={[styles.orgPersonName, current && styles.orgPersonNameCurrent]} numberOfLines={2}>
        {name}
      </Text>
    </View>
  );
}

function OrgChartModal({ visible, onClose, team, profileId, onOpenTeams }) {
  const members = Array.isArray(team?.members) ? team.members : [];
  const leads = members.filter((row) => row.isTeamIntake);
  const rest = members.filter((row) => !row.isTeamIntake);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.orgBackdrop} onPress={onClose} accessibilityLabel="Close org chart" />
      <View style={styles.orgSheet} pointerEvents="box-none">
        <View style={styles.orgCard}>
          <View style={styles.orgHeader}>
            <Text style={styles.orgTitle}>Org chart</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color="#8e8e93" />
            </Pressable>
          </View>
          {team ? (
            <ScrollView style={styles.orgBody} contentContainerStyle={styles.orgBodyContent}>
              <Text style={styles.orgTeamName}>{team.name}</Text>
              {leads.length > 0 ? (
                <View style={styles.orgRow}>
                  {leads.map((row) => (
                    <OrgPerson key={row.id} person={row} current={row.id === profileId} />
                  ))}
                </View>
              ) : null}
              {leads.length > 0 && rest.length > 0 ? <View style={styles.orgStem} /> : null}
              {rest.length > 0 ? (
                <View style={styles.orgRow}>
                  {rest.map((row) => (
                    <OrgPerson key={row.id} person={row} size={44} current={row.id === profileId} />
                  ))}
                </View>
              ) : null}
              {members.length === 0 ? (
                <Text style={styles.orgEmpty}>This team has no members yet.</Text>
              ) : null}
            </ScrollView>
          ) : (
            <Text style={styles.orgEmpty}>Not on a team yet.</Text>
          )}
          {onOpenTeams ? (
            <Pressable
              onPress={() => onOpenTeams(team?.id || '')}
              style={({ hovered, pressed }) => [
                styles.orgOpenTeams,
                (hovered || pressed) && styles.actionItemPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open Teams"
            >
              <Text style={styles.orgOpenTeamsText}>Open Teams</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export default function ProfileScreen({
  session,
  person = null,
  canMessage = false,
  canPhone = false,
  canTeams = false,
  onMessage,
  onOpenTeams,
  onBack,
  onLogout,
  onProfileChange,
  openSettings = false,
  onSettingsClose,
}) {
  const isMobile = useIsMobile();
  const phone = usePhoneCalls();
  const own = session?.profile || null;
  const myId = session?.supabaseUserId || own?.id || '';
  const viewingOther = Boolean(person?.profileId || person?.name) && person?.profileId !== myId;
  const [staff, setStaff] = useState(null);
  const [team, setTeam] = useState(null);
  const [teamName, setTeamName] = useState(person?.teamName || '');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [callBusy, setCallBusy] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let nextStaff = null;
      if (viewingOther) {
        try {
          const rows = await listStaffProfiles();
          nextStaff =
            findStaffById(rows, person.profileId) ||
            (person.name ? findStaffByEmployeeName(rows, person.name) : null);
        } catch {
          nextStaff = null;
        }
        if (cancelled) return;
        setStaff(nextStaff);
      } else {
        setStaff(null);
      }

      const teamId = viewingOther ? nextStaff?.teamId || person?.teamId : own?.teamId;
      if (!teamId) {
        if (!cancelled) {
          setTeam(null);
          setTeamName(viewingOther ? person?.teamName || '' : own?.teamName || '');
        }
        return;
      }

      try {
        const teams = await listTeams();
        if (cancelled) return;
        const match = teams.find((row) => row.id === teamId) || null;
        setTeam(match);
        setTeamName(match?.name || person?.teamName || own?.teamName || '');
      } catch {
        if (!cancelled) {
          setTeam(null);
          setTeamName(viewingOther ? person?.teamName || '' : own?.teamName || '');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewingOther, person?.profileId, person?.name, person?.teamId, person?.teamName, own?.teamId, own?.teamName]);

  useEffect(() => {
    setSettingsOpen(false);
  }, [viewingOther, person?.profileId]);

  const openedFromSidebar = useRef(false);
  useEffect(() => {
    if (openSettings) {
      setSettingsOpen(true);
      openedFromSidebar.current = true;
      return;
    }
    if (openedFromSidebar.current) {
      setSettingsOpen(false);
      openedFromSidebar.current = false;
    }
  }, [openSettings]);

  const employeeId = viewingOther ? staff?.aureusUserId : own?.aureusUserId;
  useEffect(() => {
    if (!session?.token || !employeeId) {
      setPhoneNumber('');
      return undefined;
    }
    let cancelled = false;
    fetchAureusEmployee(session.token, employeeId, session.baseUrl)
      .then(({ mapped }) => {
        if (!cancelled) setPhoneNumber(mapped?.phone || '');
      })
      .catch(() => {
        if (!cancelled) setPhoneNumber('');
      });
    return () => {
      cancelled = true;
    };
  }, [session?.token, session?.baseUrl, employeeId]);

  const profile = viewingOther
    ? {
        id: staff?.id || person.profileId || '',
        fullName: staff?.fullName || person.name || '',
        firstName: staff?.firstName || '',
        lastName: staff?.lastName || '',
        email: staff?.email || person.email || '',
        avatarUrl: staff?.avatarUrl || person.avatarUrl || '',
        locationName: staff?.locationName || person.locationName || '',
        employeeType: staff?.employeeType || person.employeeType || '',
        role: staff?.posRole || staff?.role || person.role || '',
        teamId: staff?.teamId || person.teamId || '',
        teamName,
        appRole: staff?.appRole || '',
        isSystemAdmin: Boolean(staff?.isSystemAdmin),
        isTeamIntake: Boolean(staff?.isTeamIntake),
      }
    : own;

  const name = viewingOther
    ? profile?.fullName || person?.name || 'Profile'
    : profile?.fullName ||
      [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
      session?.login ||
      'Profile';
  const email = viewingOther ? '' : profile?.email || session?.login || '';
  const locationName = profile?.locationName || '';
  const avatarUrl = profile?.avatarUrl || '';
  const profileId = viewingOther ? profile?.id || person?.profileId || '' : myId;
  const accessLabel = viewingOther ? '' : categoryLabel(profile);
  const avatarSize = isMobile ? 124 : 152;
  const canEdit = !viewingOther;
  const canCall = canPhone && Boolean(phoneNumber);
  const messageEnabled = canMessage && Boolean(profileId) && viewingOther;

  const accountRows = useMemo(() => {
    if (viewingOther) return [];

    return [
      {
        key: 'store',
        label: 'Location',
        value: locationName || 'Not set in Aureus',
        onPress: () => setLocationPickerOpen(true),
      },
      {
        key: 'team',
        label: 'Team',
        value: profile?.teamName
          ? profile.isTeamIntake
            ? `${profile.teamName} · Intake`
            : profile.teamName
          : profile?.teamId
            ? profile.isTeamIntake
              ? 'Assigned · Intake'
              : 'Assigned'
            : 'Not set',
        onPress: () => setTeamPickerOpen(true),
      },
      accessLabel ? { key: 'category', label: 'Category', value: accessLabel } : null,
      profile?.employeeType
        ? { key: 'employeeType', label: 'Employee type', value: profile.employeeType }
        : null,
      profile?.role && profile.role !== profile.employeeType
        ? { key: 'role', label: 'Aureus role', value: profile.role }
        : null,
    ].filter(Boolean);
  }, [viewingOther, locationName, profile, accessLabel]);

  const handlePickAvatar = () => {
    if (!canEdit || avatarBusy) return;
    setAvatarError('');
    setAvatarViewerOpen(false);
    setAvatarPickerOpen(true);
  };

  const handleViewAvatar = () => {
    if (avatarBusy) return;
    setAvatarViewerOpen(true);
  };

  const handleAvatarConfirm = async (asset) => {
    setAvatarError('');
    setAvatarBusy(true);
    try {
      const nextUrl = await uploadOwnAvatar(asset);
      onProfileChange?.({ avatarUrl: nextUrl });
      setAvatarPickerOpen(false);
    } catch (error) {
      const message = error?.message || 'Could not save that portrait.';
      setAvatarError(message);
      throw error;
    } finally {
      setAvatarBusy(false);
    }
  };

  const startCall = async () => {
    if (!canCall) {
      setActionError(canPhone ? 'No phone number on file.' : 'You don’t have access to Phone.');
      return;
    }
    setActionError('');
    setCallBusy(true);
    try {
      await phone.ringOut(phoneNumber);
    } catch (err) {
      setActionError(err?.message || 'Could not start the call.');
    } finally {
      setCallBusy(false);
    }
  };

  const handleVideoCall = async () => {
    if (!canCall) {
      setActionError(canPhone ? 'No number on file for a video call.' : 'You don’t have access to Phone.');
      return;
    }
    const digits = String(phoneNumber || '').replace(/[^\d+]/g, '');
    const facetime = digits ? `facetime:${digits}` : '';
    setActionError('');
    try {
      if (facetime && (await Linking.canOpenURL(facetime))) {
        await Linking.openURL(facetime);
        return;
      }
    } catch {
      // Fall through to RingOut.
    }
    await startCall();
  };

  const handlePhoneCall = () => {
    void startCall();
  };

  const subtitle = viewingOther
    ? [locationName, profile?.employeeType, profile?.teamName].filter(Boolean).join(' · ')
    : '';
  const linkedSystems = viewingOther ? [] : Object.values(session?.linked || {});

  return (
    <View style={[styles.screen, isMobile && styles.screenMobile]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, isMobile && styles.scrollContentMobile]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.section,
            !settingsOpen && styles.sectionWide,
            isMobile && styles.sectionMobile,
          ]}
        >
          {viewingOther ? (
            <View style={styles.topBar}>
              <Pressable
                onPress={onBack}
                hitSlop={8}
                style={styles.backButton}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Ionicons name="chevron-back" size={26} color={BLUE} />
              </Pressable>
              <Text style={styles.topTitle} numberOfLines={1}>
                {name}
              </Text>
              <View style={styles.topSide} />
            </View>
          ) : settingsOpen ? (
            <View style={styles.topBar}>
              <Pressable
                onPress={() => {
                  setSettingsOpen(false);
                  onSettingsClose?.();
                }}
                hitSlop={8}
                style={styles.backButton}
                accessibilityRole="button"
                accessibilityLabel="Back to profile"
              >
                <Ionicons name="chevron-back" size={26} color={BLUE} />
              </Pressable>
              <Text style={styles.topTitle} numberOfLines={1}>
                Settings
              </Text>
              <View style={styles.topSide} />
            </View>
          ) : null}

          {settingsOpen && canEdit ? (
            <>
              {accountRows.length > 0 ? (
                <View style={styles.group}>
                  {accountRows.map((row, index) => (
                    <DetailRow
                      key={row.key}
                      label={row.label}
                      value={row.value}
                      onPress={row.onPress}
                      last={index === accountRows.length - 1}
                    />
                  ))}
                </View>
              ) : null}

              {linkedSystems.length > 0 ? (
                <View style={styles.linkedBlock}>
                  <Text style={styles.sectionLabel}>Linked POS</Text>
                  <View style={styles.group}>
                    {linkedSystems.map((linked, index) => (
                      <DetailRow
                        key={linked.key}
                        label={linked.label}
                        value={linked.token ? 'Connected' : linked.error || 'Not connected'}
                        last={index === linkedSystems.length - 1}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={[styles.group, styles.logoutGroup]}>
                <Pressable
                  onPress={onLogout}
                  style={({ hovered, pressed }) => [
                    styles.logoutRow,
                    (hovered || pressed) && styles.rowHovered,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Log out"
                >
                  <Text style={styles.logoutText}>Log Out</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={[styles.heroWrap, isMobile && styles.heroWrapMobile]}>
                <View style={[styles.hero, isMobile && styles.heroMobile]}>
            <View style={styles.avatarButton}>
              <Pressable
                onPress={handleViewAvatar}
                disabled={avatarBusy}
                style={styles.avatarTap}
                accessibilityRole="button"
                accessibilityLabel={avatarUrl ? `View ${name || 'profile'} photo` : 'View photo'}
              >
                <View style={[styles.avatarRing, { borderRadius: (avatarSize + 12) / 2 }]}>
                  <ProfileAvatar uri={avatarUrl} name={name} size={avatarSize} style={styles.avatar} />
                </View>
              </Pressable>
              {canEdit ? (
                <Pressable
                  onPress={handlePickAvatar}
                  disabled={avatarBusy}
                  style={styles.avatarEdit}
                  accessibilityRole="button"
                  accessibilityLabel={avatarUrl ? 'Edit profile photo' : 'Add a profile photo'}
                  hitSlop={4}
                >
                  {avatarBusy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="pencil" size={14} color="#fff" />
                  )}
                </Pressable>
              ) : null}
            </View>

            <View style={[styles.heroCopy, isMobile && styles.heroCopyMobile]}>
              <Text style={[styles.name, isMobile && styles.nameMobile]} numberOfLines={2}>
                {name}
              </Text>
              {subtitle ? <Text style={styles.meta}>{subtitle}</Text> : null}
              {email ? <Text style={styles.email}>{email}</Text> : null}

              <View style={[styles.actions, isMobile && styles.actionsMobile]}>
                <ActionIcon
                  icon="paper-plane-outline"
                  label="Direct message"
                  onPress={() => onMessage?.(profileId)}
                  disabled={!messageEnabled}
                />
                <ActionIcon
                  icon="git-network-outline"
                  label="Org chart"
                  onPress={() => {
                    setActionError('');
                    setOrgOpen(true);
                  }}
                />
                <ActionIcon
                  icon="videocam-outline"
                  label="Video call"
                  onPress={() => void handleVideoCall()}
                  disabled={!canPhone}
                  busy={callBusy}
                />
                <ActionIcon
                  icon="call-outline"
                  label="Phone call"
                  onPress={handlePhoneCall}
                  disabled={!canPhone}
                  busy={callBusy}
                />
                {canEdit ? (
                  <ActionIcon
                    icon="settings-outline"
                    label="Settings"
                    onPress={() => setSettingsOpen(true)}
                  />
                ) : null}
                  </View>
                </View>
                </View>
              </View>

              {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

              {avatarError ? <Text style={styles.error}>{avatarError}</Text> : null}

              <ProfileNotesTable profileId={profileId} myId={myId} />
            </>
          )}
        </View>
      </ScrollView>

      <OrgChartModal
        visible={orgOpen}
        onClose={() => setOrgOpen(false)}
        team={team}
        profileId={profileId}
        onOpenTeams={
          canTeams
            ? (teamId) => {
                setOrgOpen(false);
                onOpenTeams?.(teamId);
              }
            : null
        }
      />
      <ProfilePhotoModal
        visible={avatarViewerOpen}
        onClose={() => setAvatarViewerOpen(false)}
        profileId={profileId}
        name={name}
        avatarUrl={avatarUrl}
        locationName={locationName}
        myId={myId}
        myName={
          own?.fullName ||
          [own?.firstName, own?.lastName].filter(Boolean).join(' ') ||
          'You'
        }
        myAvatarUrl={own?.avatarUrl || ''}
        canEdit={canEdit}
        onEdit={handlePickAvatar}
      />
      {canEdit ? (
        <>
          <ProfilePhotoPicker
            visible={avatarPickerOpen}
            onClose={() => setAvatarPickerOpen(false)}
            onConfirm={handleAvatarConfirm}
          />
          <ProfileLocationPicker
            visible={locationPickerOpen}
            session={session}
            selectedId={own?.locationId}
            selectedName={locationName}
            onClose={() => setLocationPickerOpen(false)}
            onChanged={({ locationId, locationName: nextName }) => {
              onProfileChange?.({
                locationId: locationId || own?.locationId,
                locationName: nextName || own?.locationName,
              });
            }}
          />
          <ProfileTeamPicker
            visible={teamPickerOpen}
            selectedId={own?.teamId}
            selectedName={own?.teamName}
            isIntake={own?.isTeamIntake}
            onClose={() => setTeamPickerOpen(false)}
            onChanged={({ teamId, teamName: nextTeamName, isTeamIntake }) => {
              onProfileChange?.({
                teamId: teamId || '',
                teamName: nextTeamName || '',
                isTeamIntake: Boolean(isTeamIntake),
              });
            }}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
  },
  screenMobile: {
    backgroundColor: '#fff',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    ...Platform.select({
      web: {
        overflowY: 'auto',
        overflowX: 'hidden',
        height: 0,
      },
      default: {},
    }),
  },
  scrollContent: {
    paddingBottom: 48,
    paddingTop: 20,
    paddingHorizontal: 32,
  },
  scrollContentMobile: {
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  section: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  sectionWide: {
    maxWidth: 960,
  },
  sectionMobile: {
    maxWidth: '100%',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    minHeight: 36,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  topTitle: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  topSide: {
    width: 36,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 28,
    paddingTop: 8,
    paddingBottom: 28,
  },
  heroWrap: {
    width: '100%',
    maxWidth: 560,
  },
  heroWrapMobile: {
    maxWidth: '100%',
    alignItems: 'center',
  },
  heroMobile: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  avatarButton: {
    position: 'relative',
    overflow: 'visible',
    flexShrink: 0,
  },
  avatarTap: {
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  avatarRing: {
    padding: 4,
    borderWidth: 2,
    borderColor: GOLD,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8e8ed',
  },
  avatarEdit: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1d1d1f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    zIndex: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    gap: 6,
  },
  heroCopyMobile: {
    alignItems: 'center',
    width: '100%',
  },
  name: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.6,
  },
  nameMobile: {
    fontSize: 24,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  meta: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    letterSpacing: -0.2,
  },
  email: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    letterSpacing: -0.2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
  },
  actionsMobile: {
    justifyContent: 'center',
  },
  actionItem: {
    width: 76,
    alignItems: 'center',
    gap: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  actionItemPressed: {
    opacity: 0.72,
  },
  actionItemDisabled: {
    opacity: 0.45,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.1,
    textAlign: 'center',
    lineHeight: 14,
  },
  actionLabelDisabled: {
    color: '#8e8e93',
  },
  orgBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  orgSheet: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  orgCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '78%',
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
  },
  orgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  orgTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  orgBody: {
    maxHeight: 360,
  },
  orgBodyContent: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 10,
  },
  orgTeamName: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginBottom: 6,
  },
  orgRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  orgStem: {
    width: 2,
    height: 16,
    backgroundColor: '#e5e5ea',
    borderRadius: 1,
  },
  orgPerson: {
    width: 72,
    alignItems: 'center',
    gap: 6,
  },
  orgPersonCurrent: {
    opacity: 1,
  },
  orgAvatarRing: {
    padding: 2,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: GOLD,
  },
  orgPersonName: {
    fontFamily,
    fontSize: 12,
    color: '#1d1d1f',
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  orgPersonNameCurrent: {
    fontWeight: '700',
  },
  orgEmpty: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  orgOpenTeams: {
    margin: 16,
    marginTop: 4,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  orgOpenTeamsText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: BLUE,
    letterSpacing: -0.2,
  },
  error: {
    fontFamily,
    fontSize: 13,
    color: '#b42318',
    marginBottom: 16,
    textAlign: 'center',
  },
  group: {
    backgroundColor: '#f2f2f7',
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  detailRowTappable: {
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    fontFamily,
    width: 108,
    flexShrink: 0,
    fontSize: 15,
    color: '#8e8e93',
    letterSpacing: -0.2,
  },
  detailValueWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  detailValue: {
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  rowHovered: {
    backgroundColor: '#e8e8ed',
  },
  linkedBlock: {
    marginTop: 24,
  },
  logoutGroup: {
    marginTop: 28,
  },
  logoutRow: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  logoutText: {
    fontFamily,
    fontSize: 17,
    color: '#ff3b30',
    letterSpacing: -0.2,
  },
});
