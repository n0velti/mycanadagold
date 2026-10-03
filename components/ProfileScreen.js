import { useEffect, useMemo, useRef, useState } from 'react';
import { BlurView } from 'expo-blur';
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
import { FONT_LIGHT } from '../lib/typography';
import { IOS } from './IosSettings';
import { formatPhoneNumber } from '../lib/ringcentral';
import ProfilePhotoModal from './ProfilePhotoModal';
import ProfilePhotoPicker from './ProfilePhotoPicker';
import ProfileLocationPicker from './ProfileLocationPicker';
import ProfileRolePicker from './ProfileRolePicker';
import ProfileTeamPicker from './ProfileTeamPicker';
import ProfileNotesTable from './ProfileNotesTable';
import { usePhoneCalls } from './PhoneCallProvider';
import { AvatarRing } from '../lib/clockedIn';

const fontFamily = 'Sohne';
const titleFontFamily = FONT_LIGHT;
const BLUE = '#007AFF';
const GOLD = '#E8C36A';
const CARD = '#fff';
const LABEL = MOBILE.label;
const SECONDARY = MOBILE.secondary;
const TAB_INK = '#1a1a1a';
const PROFILE_TOP_FILTER_SIZE = 44;
const PROFILE_ICON_COL = 56;
const PROFILE_BODY_LEADING = 12;

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

function ChromeCircle({ onPress, accessibilityLabel, children, style }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={[styles.chromeCircle, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <BlurView
        intensity={32}
        tint="light"
        style={styles.chromeCircleBlur}
        {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-bar' } : null)}
      >
        {children}
      </BlurView>
    </Pressable>
  );
}

function ProfileHeroStat({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.homeHeroStat}>
      <Text style={styles.homeHeroStatLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.homeHeroStatValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function DetailRow({ label, value, last, onPress }) {
  const isMobile = useIsMobile();
  const content = (
    <>
      <Text style={[styles.detailLabel, isMobile && styles.detailLabelIos]}>{label}</Text>
      <View style={styles.detailValueWrap}>
        <Text style={[styles.detailValue, isMobile && styles.detailValueIos]} numberOfLines={2}>
          {value || '—'}
        </Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={isMobile ? IOS.chevron : '#c7c7cc'} /> : null}
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

function ContactAction({ icon, label, onPress, disabled, busy, variant = 'sheet' }) {
  const inactive = disabled || busy;
  const desk = variant === 'desk';
  const pill = variant === 'pill';
  const iconColor = inactive ? '#c7c7cc' : desk ? '#6B5E3A' : pill ? TAB_INK : BLUE;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ hovered, pressed }) => [
        styles.contactAction,
        desk && styles.contactActionDesk,
        pill && styles.contactActionPill,
        pressed && !inactive && (pill ? styles.contactActionPillPressed : styles.contactActionPressed),
        hovered && desk && !inactive && styles.contactActionDeskHover,
        inactive && styles.contactActionDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(inactive) }}
    >
      <View style={[styles.contactActionGlyph, desk && styles.contactActionGlyphDesk, pill && styles.contactActionGlyphPill]}>
        {busy ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <Ionicons name={icon} size={pill ? 16 : 18} color={iconColor} />
        )}
      </View>
      <Text
        style={[
          styles.contactActionLabel,
          desk && styles.contactActionLabelDesk,
          pill && styles.contactActionLabelPill,
          inactive && styles.contactActionLabelDisabled,
        ]}
        numberOfLines={1}
      >
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
            <Ionicons name={icon} size={17} color={empty ? SECONDARY : TAB_INK} />
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
  openSettings = false,
  onSettingsClose,
}) {
  const isMobile = useIsMobile();
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
  const [heroHeight, setHeroHeight] = useState(180);
  const [stageHeight, setStageHeight] = useState(0);

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
  const avatarSize = isMobile ? 48 : 132;
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

  const profileActions = (variant = 'sheet') => (
    <View
      style={[
        styles.contactActions,
        variant === 'desk' && styles.contactActionsDesk,
        variant === 'pill' && styles.contactActionsPills,
      ]}
    >
      {viewingOther ? (
        <ContactAction
          variant={variant}
          icon="chatbubble"
          label="message"
          onPress={() => onMessage?.(profileId)}
          disabled={!messageEnabled}
        />
      ) : null}
      <ContactAction
        variant={variant}
        icon="call"
        label="call"
        onPress={handlePhoneCall}
        disabled={!canPhone}
        busy={callBusy}
      />
      <ContactAction
        variant={variant}
        icon="videocam"
        label="video"
        onPress={() => void handleVideoCall()}
        disabled={!canPhone}
        busy={callBusy}
      />
      <ContactAction
        variant={variant}
        icon="mail"
        label="mail"
        onPress={() => void handleMail()}
        disabled={!canMail}
      />
      <ContactAction variant={variant} icon="people" label="org" onPress={openOrgChart} />
    </View>
  );

  const infoCards = (
    <>
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

  const profileHero = (
    <View style={styles.heroShell}>
      <View pointerEvents="none" style={styles.heroLift} />
      <View
        style={[
          styles.heroInset,
          !isMobile && styles.heroInsetDesktop,
          !settingsOpen && styles.heroInsetProfile,
          !settingsOpen && !isMobile && styles.heroInsetProfileDesktop,
        ]}
      >
        <View
          style={[
            styles.heroLead,
            !isMobile && styles.heroLeadDesktop,
            !settingsOpen && styles.heroLeadProfile,
          ]}
        >
          {settingsOpen ? null : (
            <Pressable
              onPress={handleViewAvatar}
              disabled={avatarBusy}
              style={styles.heroAvatarTap}
              accessibilityRole="button"
              accessibilityLabel={avatarUrl ? `View ${name || 'profile'} photo` : 'View photo'}
            >
              <View style={styles.heroPortrait}>
                <View pointerEvents="none" style={styles.heroPortraitGlow} />
                <View style={styles.heroPortraitBezel}>
                  <ProfileAvatar uri={avatarUrl} name={name} size={avatarSize} style={styles.avatar} />
                </View>
              </View>
              {canEdit ? (
                <Pressable
                  onPress={handlePickAvatar}
                  disabled={avatarBusy}
                  style={[styles.heroAvatarEdit, isMobile && styles.heroAvatarEditLarge]}
                  accessibilityRole="button"
                  accessibilityLabel={avatarUrl ? 'Edit profile photo' : 'Add a profile photo'}
                  hitSlop={4}
                >
                  {avatarBusy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="pencil" size={isMobile ? 13 : 14} color="#fff" />
                  )}
                </Pressable>
              ) : null}
            </Pressable>
          )}
          <View style={[styles.heroCopyBlock, !settingsOpen && isMobile && styles.heroCopyBlockCenter]}>
            <Text
              style={[
                styles.heroAmount,
                !isMobile && styles.heroAmountDesktop,
                !settingsOpen && styles.heroAmountProfile,
                !settingsOpen && !isMobile && styles.heroAmountProfileDesktop,
              ]}
              numberOfLines={2}
            >
              {heroTitle}
            </Text>
            {!settingsOpen && subtitle ? (
              <Text style={styles.heroSubtitle} numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        {settingsOpen ? (
          <View style={[styles.heroStats, !isMobile && styles.heroStatsDesktop, styles.heroStatsBare]}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{accountRows.length}</Text>
              <Text style={styles.heroStatLabel}>Account</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{linkedSystems.length}</Text>
              <Text style={styles.heroStatLabel}>Linked POS</Text>
            </View>
          </View>
        ) : (
          profileActions('sheet')
        )}
      </View>
    </View>
  );

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

  const mobileHero = (
    <View style={styles.homeHero}>
      <View style={[styles.homeHeroRow, settingsOpen && styles.homeHeroRowBare]}>
        {settingsOpen ? null : (
          <View style={styles.homeHeroIconCol}>
            <Pressable
              onPress={handleViewAvatar}
              disabled={avatarBusy}
              style={styles.homeHeroAvatarTap}
              accessibilityRole="button"
              accessibilityLabel={avatarUrl ? `View ${name || 'profile'} photo` : 'View photo'}
            >
              <ProfileAvatar uri={avatarUrl} name={name} size={48} style={styles.avatar} />
              {canEdit ? (
                <Pressable
                  onPress={handlePickAvatar}
                  disabled={avatarBusy}
                  style={styles.homeHeroAvatarEdit}
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
          </View>
        )}
        <View style={[styles.homeHeroCopy, settingsOpen && styles.homeHeroCopyBare]}>
          <Text style={styles.homeHeroName} numberOfLines={2}>
            {heroTitle}
          </Text>
        </View>
        {settingsOpen || !(jobTitle || locationName || accessLabel) ? null : (
          <View style={styles.homeHeroStats}>
            <ProfileHeroStat label="Title" value={jobTitle} />
            <ProfileHeroStat label="Store" value={locationName} />
            <ProfileHeroStat label="Role" value={accessLabel} />
          </View>
        )}
      </View>
    </View>
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

  if (isMobile) {
    return (
      <View style={[styles.screen, styles.screenMobile]}>
        {showBack ? (
          <ChromeCircle onPress={goBack} accessibilityLabel="Back" style={styles.backDock}>
            <Ionicons name="chevron-back" size={22} color={TAB_INK} />
          </ChromeCircle>
        ) : null}
        {canEdit && !viewingOther && !settingsOpen ? (
          <View pointerEvents="box-none" style={styles.filterDock}>
            <ChromeCircle onPress={() => setSettingsOpen(true)} accessibilityLabel="Settings">
              <Ionicons name="settings-outline" size={20} color={TAB_INK} />
            </ChromeCircle>
          </View>
        ) : null}
        <ScrollView
          style={styles.homeScroll}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: PROFILE_TOP_FILTER_SIZE + MOBILE_FILTER_INSET,
            paddingBottom: mobileTabBarReserve() + 16,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          overScrollMode="never"
          {...tabBarScroll}
          {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll' } : null)}
        >
          <View style={styles.homeHeroPad}>{mobileHero}</View>
          {settingsOpen && canEdit ? null : (
            <View style={styles.homeActionPad}>{profileActions('pill')}</View>
          )}
          <View style={styles.homeSheet}>
            {settingsOpen && canEdit ? mobileSettings : mobileBody}
          </View>
        </ScrollView>
        {profileModals}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View pointerEvents="box-none" style={[styles.chromeRow, styles.chromeRowDesktop]}>
        <View style={styles.chromeLead}>
          {showBack ? (
            <Pressable
              onPress={goBack}
              hitSlop={8}
              style={styles.chromeBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={22} color="#6B5E3A" />
            </Pressable>
          ) : null}
          <Text style={styles.chromeTitle} numberOfLines={1}>
            {topLabel}
          </Text>
        </View>
        {canEdit && !settingsOpen && !viewingOther ? (
          <Pressable
            onPress={() => setSettingsOpen(true)}
            style={styles.chromeChip}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <BlurView
              intensity={32}
              tint="light"
              style={styles.chromeChipBlur}
              {...(Platform.OS === 'web' ? { className: 'cgold-home-chip-blur' } : null)}
            >
              <Ionicons name="settings-outline" size={16} color={TAB_INK} />
              <Text style={styles.chromeChipText}>Settings</Text>
            </BlurView>
          </Pressable>
        ) : null}
      </View>
      <View
        style={styles.stage}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          setStageHeight((current) => (Math.abs(current - height) < 0.5 ? current : height));
        }}
      >
        <View
          pointerEvents="box-none"
          style={[styles.pinnedTop, styles.pinnedTopDesktop]}
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height;
            setHeroHeight((current) => (Math.abs(current - height) < 0.5 ? current : height));
          }}
        >
          {profileHero}
        </View>
        <ScrollView
          pointerEvents="box-none"
          style={styles.overlayScroll}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: 0,
            paddingBottom: 0,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          overScrollMode="never"
          {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll' } : null)}
        >
          <View pointerEvents="none" style={{ height: heroHeight + 18 }} />
          <View
            pointerEvents="auto"
            style={[
              styles.sheet,
              styles.sheetDesktop,
              {
                paddingBottom: 32,
                ...(stageHeight > 0 ? { minHeight: stageHeight } : null),
              },
            ]}
          >
            {desktopSheet}
          </View>
        </ScrollView>
      </View>
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
    color: TAB_INK,
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
        shadowColor: GOLD,
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
    borderColor: GOLD,
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
    fontFamily: titleFontFamily,
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
    width: PROFILE_TOP_FILTER_SIZE,
    height: PROFILE_TOP_FILTER_SIZE,
    borderRadius: PROFILE_TOP_FILTER_SIZE / 2,
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
    borderRadius: PROFILE_TOP_FILTER_SIZE / 2,
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
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
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
    backgroundColor: CARD,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(18,16,12,0.08)',
  },
  groupIos: {
    backgroundColor: CARD,
    borderRadius: 16,
  },
  detailLabel: {
    fontFamily,
    width: 108,
    flexShrink: 0,
    fontSize: 15,
    color: '#8e8e93',
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
    fontSize: 15,
    color: '#1d1d1f',
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
    minHeight: 52,
    paddingVertical: 13,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(18,16,12,0.08)',
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
  contactActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  contactActionsDesk: {
    flexShrink: 0,
    alignSelf: 'stretch',
    marginTop: 22,
    marginBottom: 0,
    gap: 8,
  },
  contactAction: {
    flex: 1,
    minHeight: 62,
    borderRadius: 10,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
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
    backgroundColor: '#e5e5ea',
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
    fontSize: 12,
    fontWeight: '500',
    color: BLUE,
    letterSpacing: -0.1,
    textTransform: 'capitalize',
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
    backgroundColor: CARD,
    borderRadius: 0,
    overflow: 'hidden',
  },
  mobileGroupSpaced: {
    marginTop: 8,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingVertical: 12,
    paddingLeft: MOBILE_FILTER_INSET,
    paddingRight: MOBILE_FILTER_INSET,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.18)',
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
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactCopy: {
    flex: 1,
    minWidth: 0,
  },
  contactCaption: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
  },
  contactValue: {
    maxWidth: '46%',
    flexShrink: 0,
    minWidth: 0,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: LABEL,
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
    backgroundColor: TAB_INK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: CANVAS,
    zIndex: 2,
  },
  homeHeroCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: PROFILE_BODY_LEADING,
    justifyContent: 'center',
    minHeight: 48,
  },
  homeHeroCopyBare: {
    marginLeft: 0,
    minHeight: 40,
  },
  homeHeroName: {
    fontFamily: titleFontFamily,
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
    backgroundColor: '#fff',
    marginTop: 8,
    width: '100%',
    alignSelf: 'stretch',
    flexGrow: 1,
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
