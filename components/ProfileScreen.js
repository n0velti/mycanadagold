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
  useWindowDimensions,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { uploadOwnAvatar } from '../lib/profiles';
import {
  canSwitchAppRoles,
  canUseWorkshopLocation,
  categoryLabel,
  findStaffByEmployeeName,
  findStaffById,
  listStaffProfiles,
  selectableAppRoles,
} from '../lib/permissions';
import { listTeams, teamMemberName } from '../lib/teams';
import { posEmployeeId } from '../lib/auth';
import { fetchAureusEmployee } from '../lib/aureusEmployees';
import { CANVAS, DESKTOP_TOP_BAR_HEIGHT, MOBILE_FILTER_INSET, useIsMobile } from '../lib/mobileUi';
import { mobileTabBarReserve, useMobileTabBarScrollProps } from '../lib/mobileTabBar';
import { formatPhoneNumber } from '../lib/ringcentral';
import ProfilePhotoModal from './ProfilePhotoModal';
import ProfilePhotoPicker from './ProfilePhotoPicker';
import ProfileLocationPicker from './ProfileLocationPicker';
import ProfileRolePicker from './ProfileRolePicker';
import ProfileTeamPicker from './ProfileTeamPicker';
import ProfileNotesTable from './ProfileNotesTable';
import { usePhoneCalls } from './PhoneCallProvider';
import { AvatarRing } from '../lib/clockedIn';
import { formatInboxTime } from '../lib/messages';

const fontFamily = 'Sohne';
const LABEL = '#1d1d1f';
const ACTIVE_LABEL = '#3A3A3C';
const SECONDARY = '#8e8e93';
const INK = '#1a1a1a';
const HAIRLINE = 'rgba(42,38,30,0.08)';
const CHIP_BORDER = '#d0d0d0';
const CHIP_RADIUS = 8;
const CHIP_BG = '#fff';
const HOVER_WASH = 'rgba(60,60,67,0.06)';
const PRESS_WASH = 'rgba(60,60,67,0.10)';
const PROFILE_ICON_COL = 26;
const CHIP_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
});
const CHIP_CARD = {
  backgroundColor: CHIP_BG,
  borderRadius: CHIP_RADIUS,
  borderWidth: 1,
  borderColor: CHIP_BORDER,
  ...CHIP_SHADOW,
};

export { profileTargetFromPerson } from '../lib/profileTarget';

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
    <AvatarRing name={name} size={size}>
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
            fontSize: Math.max(10, Math.round(size * 0.38)),
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
    </AvatarRing>
  );
}

function ProfileRow({
  label,
  value,
  last,
  onPress,
  icon,
  placeholder = '—',
  link,
  destructive,
}) {
  const isMobile = useIsMobile();
  const empty = !String(value || '').trim();
  const display = empty ? placeholder : value;
  const showValue = value != null || placeholder;
  const rowStyle = [
    styles.row,
    !isMobile && styles.rowDesk,
    last && styles.rowLast,
    onPress && styles.rowTappable,
  ];
  const valueStyle = [
    styles.rowValue,
    !isMobile && styles.rowValueDesk,
    empty && styles.rowValueEmpty,
    !empty && (link || onPress) && styles.rowValueLink,
  ];
  const content = (
    <>
      {isMobile && icon ? (
        <View style={styles.rowIconCol}>
          <Ionicons name={icon} size={17} color={destructive ? '#FF3B30' : empty ? SECONDARY : INK} />
        </View>
      ) : null}
      <Text
        style={[
          styles.rowLabel,
          !isMobile && styles.rowLabelDesk,
          destructive && styles.rowLabelDestructive,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {showValue && !destructive ? (
        <Text style={valueStyle} numberOfLines={2}>
          {display}
        </Text>
      ) : null}
      {onPress && !destructive ? <Ionicons name="chevron-forward" size={14} color="#c7c7cc" /> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={destructive ? label : `${label}, ${display}`}
        style={({ hovered, pressed }) => [
          rowStyle,
          hovered && styles.rowHover,
          pressed && styles.rowPress,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={rowStyle}>{content}</View>;
}

function ContactAction({ icon, label, onPress, disabled, busy, fill }) {
  const inactive = disabled || busy;
  const iconColor = inactive ? SECONDARY : INK;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ hovered, pressed }) => [
        styles.chip,
        fill && styles.chipFill,
        hovered && !inactive && styles.chipHover,
        pressed && !inactive && styles.chipPress,
        inactive && styles.chipDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(inactive) }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <Ionicons name={icon} size={17} color={iconColor} />
      )}
      <Text style={[styles.chipLabel, inactive && styles.chipLabelDisabled]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Group({ children, style }) {
  const isMobile = useIsMobile();
  return <View style={[isMobile ? styles.stack : styles.card, style]}>{children}</View>;
}

function GroupLabel({ title, trailing }) {
  const isMobile = useIsMobile();
  return (
    <View style={[styles.groupLabelRow, !isMobile && styles.groupLabelRowDesk]}>
      <Text style={styles.groupLabel}>{title}</Text>
      {trailing}
    </View>
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

function OrgChartModal({ visible, onClose, team, profileId, onOpenTeams, isMobile }) {
  const members = Array.isArray(team?.members) ? team.members : [];
  const leads = members.filter((row) => row.isTeamIntake);
  const rest = members.filter((row) => !row.isTeamIntake);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isMobile ? 'slide' : 'fade'}
      onRequestClose={onClose}
    >
      <Pressable style={styles.orgBackdrop} onPress={onClose} accessibilityLabel="Close org chart" />
      <View style={[styles.orgSheet, isMobile && styles.orgSheetMobile]} pointerEvents="box-none">
        <View style={[styles.orgCard, isMobile && styles.orgCardMobile]}>
          {isMobile ? <View style={styles.orgGrabber} /> : null}
          <View style={styles.orgHeader}>
            <Text style={styles.orgTitle}>Org Chart</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={SECONDARY} />
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
                hovered && styles.chipHover,
                pressed && styles.chipPress,
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
  onOpenNotification,
  notifications = [],
  openSettings = false,
  onSettingsClose,
}) {
  const isMobile = useIsMobile();
  const { width: windowWidth } = useWindowDimensions();
  const tabBarScroll = useMobileTabBarScrollProps();
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
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
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

  const employeeId = posEmployeeId(viewingOther ? staff?.aureusUserId : own?.aureusUserId);
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

  const profile = useMemo(
    () =>
      viewingOther
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
        : own,
    [own, person, staff, teamName, viewingOther],
  );

  const name = viewingOther
    ? profile?.fullName || person?.name || 'Profile'
    : profile?.fullName ||
      [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
      session?.login ||
      'Profile';
  const email = (viewingOther ? profile?.email || person?.email : profile?.email || session?.login) || '';
  const locationName = profile?.locationName || '';
  const avatarUrl = profile?.avatarUrl || '';
  const profileId = viewingOther ? profile?.id || person?.profileId || '' : myId;
  const accessLabel = viewingOther ? categoryLabel(profile) : categoryLabel(profile);
  const canEdit = !viewingOther;
  const canSwitchRole = canEdit && canSwitchAppRoles(profile);
  const switchableRoles = canSwitchRole ? selectableAppRoles(profile) : [];
  const canCall = canPhone && Boolean(phoneNumber);
  const messageEnabled = canMessage && Boolean(profileId) && viewingOther;
  const canMail = Boolean(email);
  const phoneLabel = phoneNumber ? formatPhoneNumber(phoneNumber) : '';
  const jobTitle = profile?.employeeType || profile?.role || '';
  const accountRows = useMemo(() => {
    if (viewingOther) return [];

    return [
      {
        key: 'store',
        label: 'Location',
        icon: 'storefront-outline',
        value: locationName || 'Not set in Aureus',
        onPress: () => setLocationPickerOpen(true),
      },
      {
        key: 'team',
        label: 'Team',
        icon: 'people-outline',
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
      accessLabel
        ? {
            key: 'category',
            label: canSwitchRole ? 'Role' : 'Category',
            icon: 'shield-outline',
            value: accessLabel,
            onPress: canSwitchRole ? () => setRolePickerOpen(true) : undefined,
          }
        : null,
      profile?.employeeType
        ? { key: 'employeeType', label: 'Employee type', icon: 'briefcase-outline', value: profile.employeeType }
        : null,
      profile?.role && profile.role !== profile.employeeType
        ? { key: 'role', label: 'Aureus role', icon: 'id-card-outline', value: profile.role }
        : null,
    ].filter(Boolean);
  }, [viewingOther, locationName, profile, accessLabel, canSwitchRole]);

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

  const handleMail = async () => {
    if (!canMail) {
      setActionError('No email on file.');
      return;
    }
    const mailto = `mailto:${email}`;
    setActionError('');
    try {
      if (await Linking.canOpenURL(mailto)) {
        await Linking.openURL(mailto);
        return;
      }
    } catch {
      // Fall through.
    }
    setActionError('Could not open Mail.');
  };

  const subtitle = [jobTitle, locationName].filter(Boolean).join(' · ');
  const linkedSystems = viewingOther ? [] : Object.values(session?.linked || {});
  const openOrgChart = () => {
    setActionError('');
    setOrgOpen(true);
  };

  const profileActions = (
    <View style={[styles.contactActions, !isMobile && styles.contactActionsDesk]}>
      {viewingOther ? (
        <ContactAction
          icon="chatbubble-outline"
          label="Message"
          onPress={() => onMessage?.(profileId)}
          disabled={!messageEnabled}
          fill={!isMobile}
        />
      ) : null}
      <ContactAction
        icon="call-outline"
        label="Call"
        onPress={handlePhoneCall}
        disabled={!canPhone}
        busy={callBusy}
        fill={!isMobile}
      />
      <ContactAction
        icon="videocam-outline"
        label="Video"
        onPress={() => void handleVideoCall()}
        disabled={!canPhone}
        busy={callBusy}
        fill={!isMobile}
      />
      <ContactAction
        icon="mail-outline"
        label="Mail"
        onPress={() => void handleMail()}
        disabled={!canMail}
        fill={!isMobile}
      />
      <ContactAction icon="people-outline" label="Org" onPress={openOrgChart} fill={!isMobile} />
    </View>
  );

  const notifyRows =
    !viewingOther && Array.isArray(notifications)
      ? notifications.slice(0, 12)
      : [];
  const contactRows = [
    {
      key: 'phone',
      label: 'Phone',
      icon: 'call-outline',
      value: phoneLabel,
      placeholder: canPhone ? 'No number on file' : 'Phone isn’t available',
      onPress: canCall ? handlePhoneCall : undefined,
      link: canCall,
    },
    {
      key: 'email',
      label: 'Email',
      icon: 'mail-outline',
      value: email,
      placeholder: 'No email on file',
      onPress: canMail ? () => void handleMail() : undefined,
      link: canMail,
    },
  ];
  const workRows = [
    {
      key: 'location',
      label: 'Location',
      icon: 'storefront-outline',
      value: locationName,
      placeholder: canEdit ? 'Not set in Aureus' : 'None',
      onPress: canEdit ? () => setLocationPickerOpen(true) : undefined,
      link: canEdit,
    },
    jobTitle ? { key: 'title', label: 'Title', icon: 'briefcase-outline', value: jobTitle } : null,
  ].filter(Boolean);

  const logoutRow = canEdit ? (
    <Group>
      <ProfileRow label="Log Out" onPress={onLogout} destructive last />
    </Group>
  ) : null;

  const linkedBlock =
    linkedSystems.length > 0 ? (
      <>
        <GroupLabel title="Linked POS" />
        <Group>
          {linkedSystems.map((linked, index) => (
            <ProfileRow
              key={linked.key}
              label={linked.label}
              icon="link-outline"
              value={linked.token ? 'Connected' : linked.error || 'Not connected'}
              last={index === linkedSystems.length - 1}
            />
          ))}
        </Group>
      </>
    ) : null;

  const profileBody = (
    <>
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      {avatarError ? <Text style={styles.error}>{avatarError}</Text> : null}
      {notifyRows.length > 0 ? (
        <>
          <GroupLabel title="Notifications" />
          <Group>
            {notifyRows.map((item, index) => (
              <ProfileRow
                key={item.id}
                label={item.title}
                icon={item.readAt ? 'notifications-outline' : 'notifications'}
                value={item.body || formatInboxTime(item.createdAt) || 'Open chat'}
                onPress={
                  item.conversationId ? () => onOpenNotification?.(item.conversationId) : undefined
                }
                last={index === notifyRows.length - 1}
              />
            ))}
          </Group>
        </>
      ) : null}
      <View>
        <GroupLabel title="Contact" />
        <Group>
          {contactRows.map((row, index) => (
            <ProfileRow
              key={row.key}
              label={row.label}
              icon={row.icon}
              value={row.value}
              placeholder={row.placeholder}
              onPress={row.onPress}
              link={row.link}
              last={index === contactRows.length - 1}
            />
          ))}
        </Group>
      </View>
      <View>
        <GroupLabel title="Work" />
        <Group>
          {workRows.map((row, index) => (
            <ProfileRow
              key={row.key}
              label={row.label}
              icon={row.icon}
              value={row.value}
              placeholder={row.placeholder}
              onPress={row.onPress}
              link={row.link}
              last={index === workRows.length - 1}
            />
          ))}
        </Group>
      </View>
      <ProfileNotesTable profileId={profileId} myId={myId} />
      {logoutRow}
    </>
  );

  const settingsBody = (
    <>
      {accountRows.length > 0 ? (
        <View>
          <GroupLabel title="Account" />
          <Group>
            {accountRows.map((row, index) => (
              <ProfileRow
                key={row.key}
                label={row.label}
                icon={row.icon}
                value={row.value}
                onPress={row.onPress}
                link={Boolean(row.onPress)}
                last={index === accountRows.length - 1}
              />
            ))}
          </Group>
        </View>
      ) : null}
      {linkedBlock}
      {logoutRow}
    </>
  );

  const goBack = () => {
    if (settingsOpen) {
      setSettingsOpen(false);
      onSettingsClose?.();
      return;
    }
    onBack?.();
  };

  const topLabel = settingsOpen ? 'Settings' : viewingOther ? 'Staff' : 'Profile';
  const heroTitle = settingsOpen ? 'Settings' : name || 'Profile';
  const showBack = viewingOther || settingsOpen;
  const body = settingsOpen && canEdit ? settingsBody : profileBody;

  const profileModals = (
    <>
      <OrgChartModal
        visible={orgOpen}
        onClose={() => setOrgOpen(false)}
        team={team}
        profileId={profileId}
        isMobile={isMobile}
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
            includeWorkshop={canUseWorkshopLocation(profile)}
            onClose={() => setLocationPickerOpen(false)}
            onChanged={({ locationId, locationName: nextName }) => {
              onProfileChange?.({
                locationId: locationId || own?.locationId,
                locationName: nextName || own?.locationName,
              });
            }}
          />
          <ProfileRolePicker
            visible={rolePickerOpen}
            roles={switchableRoles}
            selectedRole={profile?.appRole}
            onClose={() => setRolePickerOpen(false)}
            onChanged={(updated) => {
              onProfileChange?.({
                appRole: updated?.appRole || profile?.appRole,
                allowedAppRoles: updated?.allowedAppRoles || profile?.allowedAppRoles,
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
    </>
  );

  const pagePad = isMobile ? MOBILE_FILTER_INSET : windowWidth >= 1440 ? 40 : 28;
  const chromeChip = (onPress, label, icon) => (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.chip,
        !isMobile && styles.chipStretch,
        hovered && styles.chipHover,
        pressed && styles.chipPress,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={17} color={INK} />
      <Text style={styles.chipLabel}>{label}</Text>
    </Pressable>
  );

  const identityBlock = (
    <View style={[styles.identity, !isMobile && styles.identityDesk]}>
      {settingsOpen ? null : (
        <Pressable
          onPress={handleViewAvatar}
          disabled={avatarBusy}
          style={[styles.identityAvatar, !isMobile && styles.identityAvatarDesk]}
          accessibilityRole="button"
          accessibilityLabel={avatarUrl ? `View ${name || 'profile'} photo` : 'View photo'}
        >
          <ProfileAvatar uri={avatarUrl} name={name} size={isMobile ? 36 : 72} style={styles.avatar} />
          {canEdit ? (
            <Pressable
              onPress={handlePickAvatar}
              disabled={avatarBusy}
              style={[styles.identityEdit, !isMobile && styles.identityEditDesk]}
              accessibilityRole="button"
              accessibilityLabel={avatarUrl ? 'Edit profile photo' : 'Add a profile photo'}
              hitSlop={4}
            >
              {avatarBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="pencil" size={isMobile ? 10 : 11} color="#fff" />
              )}
            </Pressable>
          ) : null}
        </Pressable>
      )}
      <View style={styles.identityCopy}>
        <Text style={[styles.identityName, !isMobile && styles.identityNameDesk]} numberOfLines={2}>
          {heroTitle}
        </Text>
        {!settingsOpen && subtitle ? (
          <Text style={[styles.identityMeta, !isMobile && styles.identityMetaDesk]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : settingsOpen ? (
          <Text style={[styles.identityMeta, !isMobile && styles.identityMetaDesk]}>Account</Text>
        ) : null}
      </View>
      {isMobile ? null : settingsOpen && canEdit ? null : profileActions}
      {isMobile ? null : showBack ? chromeChip(goBack, 'Back', 'chevron-back') : null}
      {isMobile
        ? null
        : canEdit && !viewingOther && !settingsOpen
          ? chromeChip(() => setSettingsOpen(true), 'Settings', 'settings-outline')
          : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      {isMobile ? (
        <View pointerEvents="box-none" style={styles.mobileBar}>
          <View pointerEvents="none" style={styles.mobileBarFill} />
          <View style={styles.mobileBarRow}>
            {showBack ? (
              <Pressable
                onPress={goBack}
                hitSlop={8}
                style={({ hovered, pressed }) => [
                  styles.chipIcon,
                  hovered && styles.chipHover,
                  pressed && styles.chipPress,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Ionicons name="chevron-back" size={18} color={INK} />
              </Pressable>
            ) : (
              <Text style={styles.mobileBarTitle} numberOfLines={1}>
                {topLabel}
              </Text>
            )}
            <View style={styles.mobileBarSpacer} />
            {canEdit && !viewingOther && !settingsOpen ? (
              <Pressable
                onPress={() => setSettingsOpen(true)}
                style={({ hovered, pressed }) => [
                  styles.chip,
                  hovered && styles.chipHover,
                  pressed && styles.chipPress,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Settings"
              >
                <Ionicons name="settings-outline" size={17} color={INK} />
                <Text style={styles.chipLabel}>Settings</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: isMobile ? 60 : DESKTOP_TOP_BAR_HEIGHT + 28,
          paddingBottom: isMobile ? mobileTabBarReserve() + 24 : 48,
          paddingHorizontal: pagePad,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        overScrollMode="never"
        {...(isMobile ? tabBarScroll : null)}
        {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll' } : null)}
      >
        <View style={[styles.column, !isMobile && styles.columnDesk]}>
          {isMobile ? (
            <>
              {identityBlock}
              {settingsOpen && canEdit ? null : profileActions}
              <View style={styles.tableBlock}>{body}</View>
            </>
          ) : (
            <View style={styles.deskSplit}>
              <View style={styles.deskAside}>{identityBlock}</View>
              <View style={styles.deskMain}>{body}</View>
            </View>
          )}
        </View>
      </ScrollView>
      {profileModals}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
    position: 'relative',
  },
  mobileBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  mobileBarFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(252,252,251,0.72)',
    ...Platform.select({
      web: {
        backdropFilter: 'saturate(180%) blur(22px)',
        WebkitBackdropFilter: 'saturate(180%) blur(22px)',
      },
      default: {},
    }),
  },
  mobileBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingVertical: 8,
  },
  mobileBarTitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: ACTIVE_LABEL,
    letterSpacing: -0.2,
  },
  mobileBarSpacer: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: {
        overflowY: 'auto',
        overflowX: 'hidden',
        height: 0,
      },
      default: {},
    }),
  },
  column: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'flex-start',
    gap: 10,
  },
  columnDesk: {
    maxWidth: 980,
    alignSelf: 'center',
    gap: 0,
  },
  deskSplit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 40,
    width: '100%',
  },
  deskAside: {
    width: 248,
    flexShrink: 0,
  },
  deskMain: {
    flex: 1,
    minWidth: 0,
    gap: 20,
    paddingTop: 2,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingVertical: 8,
    paddingHorizontal: 10,
    ...CHIP_CARD,
  },
  identityDesk: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 14,
    minHeight: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    ...Platform.select({
      web: { boxShadow: 'none' },
      default: {
        shadowOpacity: 0,
        elevation: 0,
      },
    }),
  },
  identityAvatar: {
    position: 'relative',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  identityAvatarDesk: {
    alignSelf: 'flex-start',
  },
  identityEdit: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: CHIP_BG,
    zIndex: 2,
  },
  identityEditDesk: {
    width: 22,
    height: 22,
    borderRadius: 11,
    right: 0,
    bottom: 0,
    borderColor: CANVAS,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  identityName: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: ACTIVE_LABEL,
    letterSpacing: -0.2,
  },
  identityNameDesk: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  identityMeta: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  identityMetaDesk: {
    fontSize: 14,
    lineHeight: 18,
    marginTop: 2,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8e8ed',
  },
  chip: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    ...CHIP_CARD,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chipFill: {
    flexGrow: 1,
    minWidth: 108,
    justifyContent: 'center',
  },
  chipStretch: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  chipIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    ...CHIP_CARD,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chipHover: {
    backgroundColor: '#f4f4f5',
  },
  chipPress: {
    backgroundColor: '#ececee',
  },
  chipDisabled: {
    opacity: 0.45,
  },
  chipLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: ACTIVE_LABEL,
    letterSpacing: -0.2,
  },
  chipLabelDisabled: {
    color: SECONDARY,
  },
  contactActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  contactActionsDesk: {
    gap: 8,
  },
  stack: {
    gap: 2,
    width: '100%',
  },
  card: {
    overflow: 'hidden',
    paddingVertical: 4,
    ...CHIP_CARD,
  },
  groupLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 2,
  },
  groupLabelRowDesk: {
    paddingHorizontal: 2,
    paddingTop: 0,
    paddingBottom: 8,
  },
  groupLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  tableBlock: {
    alignSelf: 'stretch',
    width: '100%',
    minWidth: 0,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 8,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowDesk: {
    minHeight: 40,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 16,
    borderRadius: 0,
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowTappable: {
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rowHover: {
    backgroundColor: HOVER_WASH,
  },
  rowPress: {
    backgroundColor: PRESS_WASH,
  },
  rowIconCol: {
    width: PROFILE_ICON_COL,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  rowLabelDesk: {
    flexGrow: 0,
    flexShrink: 0,
    width: 120,
  },
  rowLabelDestructive: {
    color: '#FF3B30',
  },
  rowValue: {
    maxWidth: '54%',
    flexShrink: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: ACTIVE_LABEL,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  rowValueDesk: {
    flex: 1,
    maxWidth: 'none',
    textAlign: 'left',
  },
  rowValueEmpty: {
    color: SECONDARY,
  },
  rowValueLink: {
    color: LABEL,
  },
  error: {
    fontFamily,
    fontSize: 13,
    color: '#b42318',
    letterSpacing: -0.2,
    paddingHorizontal: 8,
  },
  orgBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  orgSheet: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  orgSheetMobile: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  orgCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '78%',
    overflow: 'hidden',
    ...CHIP_CARD,
  },
  orgCardMobile: {
    maxWidth: '100%',
    maxHeight: '88%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  orgGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d0d0d0',
    marginTop: 8,
    marginBottom: 2,
  },
  orgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  orgTitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: ACTIVE_LABEL,
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
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.2,
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
    backgroundColor: HAIRLINE,
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
    borderWidth: 1,
    borderColor: CHIP_BORDER,
  },
  orgPersonName: {
    fontFamily,
    fontSize: 12,
    color: ACTIVE_LABEL,
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  orgPersonNameCurrent: {
    fontWeight: '600',
  },
  orgEmpty: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    letterSpacing: -0.2,
  },
  orgOpenTeams: {
    margin: 12,
    marginTop: 4,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    ...CHIP_CARD,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  orgOpenTeamsText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: ACTIVE_LABEL,
    letterSpacing: -0.2,
  },
});
