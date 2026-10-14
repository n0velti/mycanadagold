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
import { Ionicons } from '@expo/vector-icons';
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
import { CANVAS, DESKTOP_TOP_BAR_HEIGHT, MOBILE, MOBILE_FILTER_INSET, useIsMobile } from '../lib/mobileUi';
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
const LABEL = MOBILE.label;
const SECONDARY = MOBILE.secondary;
const INK = '#1a1a1a';
const HAIRLINE = 'rgba(42,38,30,0.08)';
const CHIP_BORDER = '#d0d0d0';
const CHIP_RADIUS = 6;
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

function DetailRow({ label, value, last, onPress }) {
  const content = (
    <>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValueWrap}>
        <Text style={styles.detailValue} numberOfLines={2}>
          {value || '—'}
        </Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={14} color="#c7c7cc" /> : null}
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

function ContactAction({ icon, label, onPress, disabled, busy }) {
  const inactive = disabled || busy;
  const iconColor = inactive ? '#c7c7cc' : INK;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ hovered, pressed }) => [
        styles.contactAction,
        (hovered || pressed) && !inactive && styles.contactActionPressed,
        inactive && styles.contactActionDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(inactive) }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <Ionicons name={icon} size={15} color={iconColor} />
      )}
      <Text style={[styles.contactActionLabel, inactive && styles.contactActionLabelDisabled]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ContactRow({ caption, value, placeholder = 'None', last, onPress, link, icon }) {
  const empty = !String(value || '').trim();
  const display = empty ? placeholder : value;
  const rowStyle = [styles.contactRow, last && styles.contactRowLast];
  const valueStyle = [
    styles.contactValue,
    empty && styles.contactValueEmpty,
    !empty && (link || onPress) && styles.contactValueLink,
  ];
  const content = (
    <>
      {icon ? (
        <View style={styles.contactIconCol}>
          <View style={styles.contactIcon}>
            <Ionicons name={icon} size={15} color={empty ? SECONDARY : INK} />
          </View>
        </View>
      ) : null}
      <View style={styles.contactCopy}>
        <Text style={styles.contactCaption}>{caption}</Text>
      </View>
      <Text style={valueStyle} numberOfLines={2}>
        {display}
      </Text>
      {onPress ? (
        <View style={styles.contactChevron}>
          <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
        </View>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${caption}, ${display}`}
        style={({ pressed }) => [rowStyle, pressed && styles.contactRowPressed]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={rowStyle}>{content}</View>;
}

function Group({ children, style }) {
  return <View style={[styles.mobileGroup, style]}>{children}</View>;
}

function GroupLabel({ title, trailing }) {
  return (
    <View style={styles.groupLabelRow}>
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
      accessLabel
        ? {
            key: 'category',
            label: canSwitchRole ? 'Role' : 'Category',
            value: accessLabel,
            onPress: canSwitchRole ? () => setRolePickerOpen(true) : undefined,
          }
        : null,
      profile?.employeeType
        ? { key: 'employeeType', label: 'Employee type', value: profile.employeeType }
        : null,
      profile?.role && profile.role !== profile.employeeType
        ? { key: 'role', label: 'Aureus role', value: profile.role }
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
    <View style={styles.contactActions}>
      {viewingOther ? (
        <ContactAction
          icon="chatbubble-outline"
          label="Message"
          onPress={() => onMessage?.(profileId)}
          disabled={!messageEnabled}
        />
      ) : null}
      <ContactAction
        icon="call-outline"
        label="Call"
        onPress={handlePhoneCall}
        disabled={!canPhone}
        busy={callBusy}
      />
      <ContactAction
        icon="videocam-outline"
        label="Video"
        onPress={() => void handleVideoCall()}
        disabled={!canPhone}
        busy={callBusy}
      />
      <ContactAction
        icon="mail-outline"
        label="Mail"
        onPress={() => void handleMail()}
        disabled={!canMail}
      />
      <ContactAction icon="people-outline" label="Org" onPress={openOrgChart} />
    </View>
  );

  const notifyCards = !viewingOther && Array.isArray(notifications) && notifications.length ? (
    <>
      <GroupLabel title="Notifications" />
      <Group style={styles.mobileGroupSpaced}>
        {notifications.slice(0, 12).map((item, index) => (
          <ContactRow
            key={item.id}
            caption={item.title}
            icon={item.readAt ? 'notifications-outline' : 'notifications'}
            value={item.body || formatInboxTime(item.createdAt) || 'Open chat'}
            onPress={
              item.conversationId
                ? () => onOpenNotification?.(item.conversationId)
                : undefined
            }
            last={index === Math.min(notifications.length, 12) - 1}
          />
        ))}
      </Group>
    </>
  ) : null;

  const infoCards = (
    <>
      {notifyCards}
      <Group style={styles.mobileGroupSpaced}>
        <ContactRow
          caption="Phone"
          icon="call-outline"
          value={phoneLabel}
          placeholder={canPhone ? 'No number on file' : 'Phone isn’t available'}
          onPress={canCall ? handlePhoneCall : undefined}
          link={canCall}
        />
        <ContactRow
          caption="Email"
          icon="mail-outline"
          value={email}
          placeholder="No email on file"
          last
          onPress={canMail ? () => void handleMail() : undefined}
          link={canMail}
        />
      </Group>

      <Group style={styles.mobileGroupSpaced}>
        {[
          {
            key: 'location',
            caption: 'Location',
            icon: 'storefront-outline',
            value: locationName,
            placeholder: canEdit ? 'Not set in Aureus' : 'None',
            onPress: canEdit ? () => setLocationPickerOpen(true) : undefined,
          },
          jobTitle ? { key: 'title', caption: 'Title', icon: 'briefcase-outline', value: jobTitle } : null,
        ]
          .filter(Boolean)
          .map((row, index, rows) => (
            <ContactRow
              key={row.key}
              caption={row.caption}
              icon={row.icon}
              value={row.value}
              placeholder={row.placeholder}
              onPress={row.onPress}
              link={Boolean(row.onPress)}
              last={index === rows.length - 1}
            />
          ))}
      </Group>
    </>
  );

  const mobileBody = (
    <>
      {actionError ? <Text style={styles.mobileError}>{actionError}</Text> : null}
      {avatarError ? <Text style={styles.mobileError}>{avatarError}</Text> : null}

      {infoCards}

      <ProfileNotesTable profileId={profileId} myId={myId} />

      {canEdit ? (
        <Group style={styles.logoutGroupMobile}>
          <Pressable
            onPress={onLogout}
            style={({ pressed }) => [styles.logoutRow, pressed && styles.contactRowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Log out"
          >
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>
        </Group>
      ) : null}
    </>
  );

  const desktopBody = settingsOpen && canEdit ? (
    <>
      {accountRows.length > 0 ? (
        <View style={[styles.group, styles.groupIos]}>
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
          <View style={[styles.group, styles.groupIos]}>
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

      <View style={[styles.group, styles.logoutGroup, styles.groupIos]}>
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
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      {avatarError ? <Text style={styles.error}>{avatarError}</Text> : null}
      {infoCards}
      <ProfileNotesTable profileId={profileId} myId={myId} />
      {linkedSystems.length > 0 ? (
        <>
          <GroupLabel title="Linked POS" />
          <Group>
            {linkedSystems.map((linked, index) => (
              <ContactRow
                key={linked.key}
                caption={linked.label}
                icon="link-outline"
                value={linked.token ? 'Connected' : linked.error || 'Not connected'}
                last={index === linkedSystems.length - 1}
              />
            ))}
          </Group>
        </>
      ) : null}
      {canEdit ? (
        <Group style={styles.logoutGroupMobile}>
          <Pressable
            onPress={onLogout}
            style={({ hovered, pressed }) => [styles.logoutRow, (hovered || pressed) && styles.rowHovered]}
            accessibilityRole="button"
            accessibilityLabel="Log out"
          >
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>
        </Group>
      ) : null}
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

  const desktopDetails = (
    <View style={[styles.group, styles.groupIos]}>
      {[
        {
          key: 'phone',
          label: 'Phone',
          value: phoneLabel || (canPhone ? 'No number on file' : 'Phone isn’t available'),
          onPress: canCall ? handlePhoneCall : undefined,
        },
        {
          key: 'email',
          label: 'Email',
          value: email || 'No email on file',
          onPress: canMail ? () => void handleMail() : undefined,
        },
        {
          key: 'location',
          label: 'Location',
          value: locationName || (canEdit ? 'Not set in Aureus' : 'None'),
          onPress: canEdit ? () => setLocationPickerOpen(true) : undefined,
        },
        jobTitle ? { key: 'title', label: 'Title', value: jobTitle } : null,
      ]
        .filter(Boolean)
        .map((row, index, rows) => (
          <DetailRow
            key={row.key}
            label={row.label}
            value={row.value}
            onPress={row.onPress}
            last={index === rows.length - 1}
          />
        ))}
    </View>
  );

  const desktopSheet = settingsOpen && canEdit ? (
    desktopBody
  ) : (
    <>
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      {avatarError ? <Text style={styles.error}>{avatarError}</Text> : null}
      <View style={styles.deskStack}>
        {desktopDetails}
        <ProfileNotesTable profileId={profileId} myId={myId} />
        {canEdit ? (
          <View style={[styles.group, styles.logoutGroup, styles.groupIos]}>
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
        ) : null}
      </View>
    </>
  );

  const mobileSettings = (
    <>
      {accountRows.length > 0 ? (
        <Group>
          {accountRows.map((row, index) => (
            <ContactRow
              key={row.key}
              caption={row.label}
              value={row.value}
              onPress={row.onPress}
              link={Boolean(row.onPress)}
              last={index === accountRows.length - 1}
            />
          ))}
        </Group>
      ) : null}
      {linkedSystems.length > 0 ? (
        <>
          <GroupLabel title="Linked POS" />
          <Group>
            {linkedSystems.map((linked, index) => (
              <ContactRow
                key={linked.key}
                caption={linked.label}
                value={linked.token ? 'Connected' : linked.error || 'Not connected'}
                last={index === linkedSystems.length - 1}
              />
            ))}
          </Group>
        </>
      ) : null}
      {canEdit ? (
        <Group style={styles.logoutGroupMobile}>
          <Pressable
            onPress={onLogout}
            style={({ pressed }) => [styles.logoutRow, pressed && styles.contactRowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Log out"
          >
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>
        </Group>
      ) : null}
    </>
  );

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

  const pagePad = isMobile
    ? MOBILE_FILTER_INSET
    : windowWidth >= 1600
      ? 24
      : windowWidth >= 1200
        ? 20
        : 16;
  const body = settingsOpen && canEdit ? (isMobile ? mobileSettings : desktopBody) : isMobile ? mobileBody : desktopSheet;

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
                style={styles.iconChip}
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
                style={styles.textChip}
                accessibilityRole="button"
                accessibilityLabel="Settings"
              >
                <Ionicons name="settings-outline" size={15} color={INK} />
                <Text style={styles.textChipLabel}>Settings</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      <ScrollView
        style={styles.homeScroll}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: isMobile ? 60 : DESKTOP_TOP_BAR_HEIGHT + 16,
          paddingBottom: isMobile ? mobileTabBarReserve() + 24 : 36,
          paddingHorizontal: pagePad,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        overScrollMode="never"
        {...(isMobile ? tabBarScroll : null)}
        {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll' } : null)}
      >
        <View style={styles.identity}>
          {settingsOpen ? null : (
            <Pressable
              onPress={handleViewAvatar}
              disabled={avatarBusy}
              style={styles.identityAvatar}
              accessibilityRole="button"
              accessibilityLabel={avatarUrl ? `View ${name || 'profile'} photo` : 'View photo'}
            >
              <ProfileAvatar uri={avatarUrl} name={name} size={isMobile ? 44 : 52} style={styles.avatar} />
              {canEdit ? (
                <Pressable
                  onPress={handlePickAvatar}
                  disabled={avatarBusy}
                  style={styles.identityEdit}
                  accessibilityRole="button"
                  accessibilityLabel={avatarUrl ? 'Edit profile photo' : 'Add a profile photo'}
                  hitSlop={4}
                >
                  {avatarBusy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="pencil" size={11} color="#fff" />
                  )}
                </Pressable>
              ) : null}
            </Pressable>
          )}
          <View style={styles.identityCopy}>
            <Text style={styles.identityName} numberOfLines={2}>
              {heroTitle}
            </Text>
            {!settingsOpen && subtitle ? (
              <Text style={styles.identityMeta} numberOfLines={2}>
                {subtitle}
              </Text>
            ) : settingsOpen ? (
              <Text style={styles.identityMeta}>Account</Text>
            ) : null}
          </View>
          {!isMobile && showBack ? (
            <Pressable
              onPress={goBack}
              style={styles.textChip}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={16} color={INK} />
              <Text style={styles.textChipLabel}>Back</Text>
            </Pressable>
          ) : null}
          {!isMobile && canEdit && !viewingOther && !settingsOpen ? (
            <Pressable
              onPress={() => setSettingsOpen(true)}
              style={styles.textChip}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Ionicons name="settings-outline" size={15} color={INK} />
              <Text style={styles.textChipLabel}>Settings</Text>
            </Pressable>
          ) : null}
        </View>
        {settingsOpen && canEdit ? null : profileActions}
        <View style={styles.tableBlock}>{body}</View>
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
    backgroundColor: 'rgba(252,252,251,0.92)',
    ...Platform.select({
      web: {
        backdropFilter: 'saturate(120%) blur(12px)',
        WebkitBackdropFilter: 'saturate(120%) blur(12px)',
      },
      default: {},
    }),
  },
  mobileBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingVertical: 8,
  },
  mobileBarTitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '200',
    color: INK,
    letterSpacing: -0.2,
  },
  mobileBarSpacer: {
    flex: 1,
  },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
    alignItems: 'center',
    justifyContent: 'center',
    ...CHIP_SHADOW,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  textChip: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  textChipLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: INK,
    letterSpacing: -0.2,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 16,
  },
  identityAvatar: {
    position: 'relative',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  identityEdit: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: CANVAS,
    zIndex: 2,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  identityName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
  },
  identityMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.1,
  },
  tableBlock: {
    alignSelf: 'stretch',
    width: '100%',
    minWidth: 0,
    gap: 16,
  },
  screenMobile: {
    backgroundColor: CANVAS,
  },
  deskStack: {
    width: '100%',
    minWidth: 0,
    gap: 16,
  },
  chromeRow: {
    zIndex: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    minHeight: 44,
    gap: 12,
    paddingHorizontal: 32,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: 'transparent',
  },
  chromeRowDesktop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: DESKTOP_TOP_BAR_HEIGHT + 16,
  },
  chromeLead: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chromeBack: {
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
  chromeTitle: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#6B5E3A',
    letterSpacing: -0.3,
  },
  chromeChip: {
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        boxShadow: '0 10px 28px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.08)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 18,
        elevation: 12,
      },
    }),
  },
  chromeChipBlur: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(255,255,255,0.56)',
  },
  chromeChipText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: INK,
  },
  stage: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  pinnedTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    elevation: 0,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  pinnedTopDesktop: {
    paddingHorizontal: 32,
    paddingTop: DESKTOP_TOP_BAR_HEIGHT + 56,
    paddingBottom: 4,
  },
  topDate: {
    alignSelf: 'stretch',
    minHeight: 44,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#6B5E3A',
    letterSpacing: 0.2,
    lineHeight: 44,
    marginBottom: 10,
  },
  overlayScroll: {
    zIndex: 4,
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
  sheet: {
    zIndex: 2,
    flexGrow: 1,
    backgroundColor: '#F3F1EA',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'visible',
    paddingHorizontal: 16,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    ...Platform.select({
      web: {
        boxShadow: '0 -8px 24px rgba(0,0,0,0.12), 0 -1px 0 rgba(255,255,255,0.9)',
      },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.14,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -6 },
        elevation: 8,
      },
    }),
  },
  sheetDesktop: {
    paddingHorizontal: 32,
    paddingTop: 24,
    width: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
    overflow: 'visible',
  },
  heroShell: {
    alignSelf: 'stretch',
    position: 'relative',
  },
  heroLift: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(18,16,12,0.06), 0 10px 28px rgba(18,16,12,0.14)',
      },
      default: {
        shadowColor: '#12100C',
        shadowOpacity: 0.16,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 0,
      },
    }),
  },
  heroInset: {
    alignSelf: 'stretch',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    borderRadius: 20,
    backgroundColor: '#1F1E1B',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(212,175,55,0.32)',
    ...Platform.select({
      web: {
        boxShadow:
          'inset 0 1px 0 rgba(255,236,180,0.16), inset 0 -1px 0 rgba(0,0,0,0.38), 0 0 0 0.5px rgba(18,16,12,0.12)',
      },
      default: {},
    }),
  },
  heroInsetDesktop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 36,
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  heroInsetProfile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 18,
    paddingTop: 22,
    paddingBottom: 18,
  },
  heroInsetProfileDesktop: {
    paddingHorizontal: 32,
    paddingVertical: 28,
    gap: 22,
  },
  heroLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  heroLeadDesktop: {
    flex: 1.1,
  },
  heroLeadProfile: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
  },
  heroCopyBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  heroCopyBlockCenter: {
    alignItems: 'center',
    flex: 0,
    width: '100%',
  },
  heroPortrait: {
    position: 'relative',
    flexShrink: 0,
  },
  heroPortraitGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    ...Platform.select({
      web: {
        boxShadow:
          '0 0 0 1px rgba(18,16,12,0.45), 0 10px 22px rgba(0,0,0,0.32), 0 0 24px rgba(232,195,106,0.16)',
      },
      default: {
        shadowColor: '#1d1d1f',
        shadowOpacity: 0.28,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      },
    }),
  },
  heroPortraitBezel: {
    borderRadius: 999,
    padding: 3,
    borderWidth: 2,
    borderColor: '#1d1d1f',
    backgroundColor: '#161513',
    ...Platform.select({
      web: {
        boxShadow:
          'inset 0 1px 0 rgba(255,236,180,0.42), inset 0 -1px 0 rgba(0,0,0,0.45), 0 0 0 1px rgba(232,195,106,0.22)',
      },
      default: {},
    }),
  },
  heroAvatarTap: {
    position: 'relative',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  heroAvatarEdit: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1d1d1f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#1F1E1B',
    zIndex: 2,
  },
  heroAvatarEditLarge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    right: 2,
    bottom: 2,
  },
  heroAmount: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '400',
    color: '#F6F1E6',
    letterSpacing: -1,
  },
  heroAmountDesktop: {
    fontSize: 44,
    lineHeight: 48,
  },
  heroAmountProfile: {
    flex: 0,
    textAlign: 'center',
    fontSize: 32,
    lineHeight: 36,
  },
  heroAmountProfileDesktop: {
    fontSize: 42,
    lineHeight: 46,
  },
  heroSubtitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: '#C4A35A',
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(212,175,55,0.14)',
  },
  heroStatsDesktop: {
    flex: 1,
    marginTop: 0,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  heroStatsBare: {
    marginTop: 16,
  },
  heroStat: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  heroStatDivider: {
    width: StyleSheet.hairlineWidth,
    height: 26,
    marginHorizontal: 10,
    backgroundColor: 'rgba(244,228,180,0.16)',
  },
  heroStatValue: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#F6F1E6',
    letterSpacing: -0.28,
  },
  heroStatLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
    color: '#C4A35A',
    letterSpacing: 0.2,
  },
  chromeCircle: {
    width: 32,
    height: 32,
    borderRadius: 32 / 2,
    overflow: 'hidden',
    zIndex: 24,
    ...Platform.select({
      web: {
        cursor: 'pointer',
        boxShadow: '0 1px 6px rgba(0,0,0,0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 1 },
        elevation: 3,
      },
    }),
  },
  chromeCircleBlur: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32 / 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(252,252,251,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    ...Platform.select({
      web: {
        backdropFilter: 'saturate(120%) blur(12px)',
        WebkitBackdropFilter: 'saturate(120%) blur(12px)',
      },
      default: {},
    }),
  },
  backDock: {
    position: 'absolute',
    top: 8,
    left: MOBILE_FILTER_INSET,
    zIndex: 24,
  },
  filterDock: {
    position: 'absolute',
    top: 8,
    right: MOBILE_FILTER_INSET,
    zIndex: 24,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8e8ed',
  },
  actionItem: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    maxWidth: 76,
    minWidth: 56,
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
  orgSheetMobile: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  orgCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '78%',
    backgroundColor: CANVAS,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  orgCardMobile: {
    maxWidth: '100%',
    maxHeight: '88%',
    borderRadius: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  orgGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d1d1d6',
    marginTop: 8,
    marginBottom: 2,
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
    borderColor: '#1d1d1f',
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
    height: 32,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
    alignItems: 'center',
    justifyContent: 'center',
    ...CHIP_SHADOW,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  orgOpenTeamsText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: INK,
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
    backgroundColor: 'transparent',
    borderRadius: 0,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
  },
  groupIos: {
    backgroundColor: 'transparent',
    borderRadius: 0,
  },
  detailLabel: {
    fontFamily,
    width: 108,
    flexShrink: 0,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  detailLabelIos: {
    width: 'auto',
    flex: 1,
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '400',
    color: '#000',
    letterSpacing: -0.4,
  },
  detailValue: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  detailValueIos: {
    fontSize: 17,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.4,
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
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f2f2f2',
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
  detailValueWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
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
    minHeight: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  logoutText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: '#ff3b30',
    letterSpacing: -0.2,
  },
  contactActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  contactActionsDesk: {
    flexShrink: 0,
    alignSelf: 'stretch',
    marginTop: 22,
    marginBottom: 0,
    gap: 8,
  },
  contactAction: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  contactActionDesk: {
    flex: 0,
    width: 80,
    minHeight: 72,
    borderRadius: 14,
    backgroundColor: '#F6F3EA',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(18,16,12,0.06)',
  },
  contactActionPressed: {
    backgroundColor: '#f0f0f2',
  },
  contactActionDeskHover: {
    backgroundColor: '#EFE8D8',
  },
  contactActionDisabled: {
    opacity: 0.45,
  },
  contactActionGlyph: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactActionGlyphDesk: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(232,195,106,0.16)',
  },
  contactActionLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: INK,
    letterSpacing: -0.2,
  },
  contactActionLabelDesk: {
    color: '#6B5E3A',
    fontWeight: '600',
  },
  contactActionLabelDisabled: {
    color: SECONDARY,
  },
  mobileError: {
    fontFamily,
    fontSize: 13,
    color: '#ff3b30',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 8,
  },
  groupLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingTop: 16,
    paddingBottom: 6,
  },
  groupLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  mobileGroup: {
    backgroundColor: 'transparent',
    borderRadius: 0,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
  },
  mobileGroupSpaced: {
    marginTop: 8,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f2f2f2',
  },
  contactRowLast: {
    borderBottomWidth: 0,
  },
  contactRowPressed: {
    backgroundColor: '#f2f2f7',
  },
  contactIconCol: {
    width: PROFILE_ICON_COL,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  contactIcon: {
    width: 26,
    height: 26,
    borderRadius: CHIP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactCopy: {
    flex: 1,
    minWidth: 0,
  },
  contactCaption: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  contactValue: {
    maxWidth: '52%',
    flexShrink: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  contactValueEmpty: {
    color: SECONDARY,
    fontWeight: '400',
  },
  contactValueLink: {
    color: LABEL,
  },
  contactChevron: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  logoutGroupMobile: {
    marginTop: 16,
  },
  homeScroll: {
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
  homeHeroPad: {
    paddingHorizontal: MOBILE_FILTER_INSET,
  },
  homeHero: {
    alignSelf: 'stretch',
    paddingTop: 4,
    paddingBottom: 12,
  },
  homeHeroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
  },
  homeHeroRowBare: {
    alignItems: 'center',
  },
  homeHeroIconCol: {
    width: PROFILE_ICON_COL,
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexShrink: 0,
  },
  homeHeroAvatarTap: {
    position: 'relative',
    width: 48,
    height: 48,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeHeroAvatarEdit: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: CANVAS,
    zIndex: 2,
  },
  homeHeroCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
    justifyContent: 'center',
    minHeight: 48,
  },
  homeHeroCopyBare: {
    marginLeft: 0,
    minHeight: 40,
  },
  homeHeroName: {
    fontFamily: fontFamily,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.8,
  },
  homeHeroStats: {
    flexDirection: 'column',
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
    gap: 1,
    minWidth: 108,
    maxWidth: 132,
    paddingTop: 6,
    paddingLeft: 14,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(60, 60, 67, 0.12)',
  },
  homeHeroStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 2,
  },
  homeHeroStatLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 10,
    fontWeight: '500',
    color: '#aeaeb2',
    letterSpacing: 0.02,
  },
  homeHeroStatValue: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    textAlign: 'right',
    flexShrink: 1,
    maxWidth: '62%',
  },
  homeActionPad: {
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingTop: 4,
    paddingBottom: 8,
  },
  homeSheet: {
    backgroundColor: 'transparent',
    marginTop: 8,
    width: '100%',
    alignSelf: 'stretch',
  },
  contactActionsPills: {
    marginBottom: 0,
    gap: 8,
  },
  contactActionPill: {
    flex: 1,
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.18)',
    paddingVertical: 8,
    gap: 4,
  },
  contactActionPillPressed: {
    backgroundColor: '#f2f2f7',
  },
  contactActionGlyphPill: {
    width: 20,
    height: 20,
  },
  contactActionLabelPill: {
    fontSize: 11,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: 0,
    textTransform: 'capitalize',
  },
});
