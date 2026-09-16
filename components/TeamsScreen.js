import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  createTeam,
  deleteTeam,
  intakeNames,
  listTeams,
  teamMemberName,
  updateTeam,
} from '../lib/teams';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#2563EB';
const ACCENT_SOFT = '#EEF4FF';
const MOBILE_BREAKPOINT = 768;
const NEW_ID = '__new';

function confirmDelete(name) {
  const message = `Delete ${name}? People on this team will need to pick a new one.`;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise((resolve) => {
    Alert.alert('Delete team', message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function MemberAvatar({ person, size = 36 }) {
  const [failed, setFailed] = useState(false);
  const uri = person?.avatarUrl;
  const name = teamMemberName(person);
  const parts = name.split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : (parts[0] || '?').slice(0, 2).toUpperCase();

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const showImage = Boolean(uri) && !failed;
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        !showImage && styles.avatarFallback,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[styles.avatarInitials, { fontSize: size > 40 ? 16 : 12 }]}>{initials}</Text>
      )}
    </View>
  );
}

function TeamForm({ name, description, busy, error, onChangeName, onChangeDescription, onSave, onCancel, saveLabel }) {
  return (
    <View style={styles.form}>
      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput
        style={styles.field}
        value={name}
        onChangeText={onChangeName}
        placeholder="e.g. Retail Toronto"
        placeholderTextColor="#8e8e93"
        maxLength={80}
        autoCapitalize="words"
      />
      <Text style={styles.fieldLabel}>What this team is</Text>
      <TextInput
        style={[styles.field, styles.fieldMultiline]}
        value={description}
        onChangeText={onChangeDescription}
        placeholder="Who they serve, and what they own."
        placeholderTextColor="#8e8e93"
        maxLength={500}
        multiline
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.formActions}>
        {onCancel ? (
          <Pressable onPress={onCancel} style={styles.secondaryButton} disabled={busy}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onSave}
          disabled={busy || !name.trim()}
          style={[styles.primaryButton, (!name.trim() || busy) && styles.primaryButtonOff]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>{saveLabel}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function TeamDetail({ team, compact, onClose, onEdit, onDelete }) {
  if (!team) {
    return (
      <View style={styles.detailEmpty}>
        <View style={styles.emptyIcon}>
          <Ionicons name="people-circle-outline" size={22} color={ACCENT} />
        </View>
        <Text style={styles.emptyTitle}>Select a team</Text>
        <Text style={styles.emptyBody}>Create a team, then people pick it in their profile.</Text>
      </View>
    );
  }

  const intake = intakeNames(team);
  return (
    <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
      {compact ? (
        <View style={styles.detailMobileHeader}>
          <Text style={styles.detailMobileTitle}>{team.name}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color="#1d1d1f" />
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.detailName}>{team.name}</Text>
      {team.description ? <Text style={styles.detailDescription}>{team.description}</Text> : (
        <Text style={styles.detailMuted}>No description yet.</Text>
      )}
      <Text style={styles.detailMeta}>
        {team.memberCount} {team.memberCount === 1 ? 'person' : 'people'}
        {intake ? ` · Intake ${intake}` : ' · No intake contact yet'}
      </Text>
      <View style={styles.detailActions}>
        <Pressable onPress={onEdit} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Edit</Text>
        </Pressable>
        <Pressable onPress={onDelete} style={styles.dangerButton}>
          <Text style={styles.dangerButtonText}>Delete</Text>
        </Pressable>
      </View>
      <Text style={styles.sectionLabel}>People</Text>
      {team.members.length === 0 ? (
        <Text style={styles.detailMuted}>Nobody has selected this team in their profile yet.</Text>
      ) : (
        team.members.map((person) => (
          <View key={person.id} style={styles.memberRow}>
            <MemberAvatar person={person} />
            <View style={styles.memberCopy}>
              <Text style={styles.memberName} numberOfLines={1}>
                {teamMemberName(person)}
              </Text>
              <Text style={styles.memberSub} numberOfLines={1}>
                {person.isTeamIntake ? 'Intake contact' : person.locationName || 'Member'}
                {person.isTeamIntake && person.locationName ? ` · ${person.locationName}` : ''}
              </Text>
            </View>
            {person.isTeamIntake ? (
              <View style={styles.intakeBadge}>
                <Text style={styles.intakeBadgeText}>Intake</Text>
              </View>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

export default function TeamsScreen({ focusTeamId }) {
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(focusTeamId || null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await listTeams();
      setTeams(rows);
      setSelectedId((current) => {
        if (focusTeamId && rows.some((row) => row.id === focusTeamId)) return focusTeamId;
        if (current === NEW_ID) return current;
        if (current && rows.some((row) => row.id === current)) return current;
        return null;
      });
    } catch (err) {
      setTeams([]);
      setError(err?.message || 'Could not load teams.');
    } finally {
      setLoading(false);
    }
  }, [focusTeamId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (focusTeamId) setSelectedId(focusTeamId);
  }, [focusTeamId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((team) => {
      const hay = `${team.name} ${team.description} ${team.members.map(teamMemberName).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [teams, query]);

  const selected = useMemo(
    () => teams.find((team) => team.id === selectedId) || null,
    [teams, selectedId],
  );

  const startCreate = () => {
    setSelectedId(NEW_ID);
    setEditing(true);
    setName('');
    setDescription('');
    setFormError('');
  };

  const startEdit = () => {
    if (!selected) return;
    setEditing(true);
    setName(selected.name);
    setDescription(selected.description || '');
    setFormError('');
  };

  const cancelEdit = () => {
    if (selectedId === NEW_ID) setSelectedId(null);
    setEditing(false);
    setFormError('');
  };

  const handleSave = async () => {
    const label = name.trim();
    if (!label) {
      setFormError('Name this team first.');
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      if (selectedId === NEW_ID) {
        const created = await createTeam({ name: label, description });
        await load();
        setSelectedId(created.id);
      } else {
        await updateTeam(selectedId, { name: label, description });
        await load();
      }
      setEditing(false);
    } catch (err) {
      setFormError(err?.message || 'Could not save that team.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    const ok = await confirmDelete(selected.name);
    if (!ok) return;
    setBusy(true);
    try {
      await deleteTeam(selected.id);
      setSelectedId(null);
      setEditing(false);
      await load();
    } catch (err) {
      setError(err?.message || 'Could not delete that team.');
    } finally {
      setBusy(false);
    }
  };

  const showForm = editing || selectedId === NEW_ID;
  const detail = showForm ? (
    <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
      {isMobile ? (
        <View style={styles.detailMobileHeader}>
          <Text style={styles.detailMobileTitle}>{selectedId === NEW_ID ? 'New team' : 'Edit team'}</Text>
          <Pressable onPress={cancelEdit} hitSlop={8} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color="#1d1d1f" />
          </Pressable>
        </View>
      ) : (
        <Text style={styles.detailName}>{selectedId === NEW_ID ? 'New team' : 'Edit team'}</Text>
      )}
      <TeamForm
        name={name}
        description={description}
        busy={busy}
        error={formError}
        onChangeName={setName}
        onChangeDescription={setDescription}
        onSave={handleSave}
        onCancel={isMobile ? null : cancelEdit}
        saveLabel={selectedId === NEW_ID ? 'Create team' : 'Save'}
      />
    </ScrollView>
  ) : (
    <TeamDetail
      team={selected}
      compact={isMobile}
      onClose={() => setSelectedId(null)}
      onEdit={startEdit}
      onDelete={handleDelete}
    />
  );

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search-outline" size={15} color="#8a8a8a" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search teams or people"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color="#b0b0b0" />
            </Pressable>
          ) : null}
        </View>
        <Pressable style={styles.primaryButton} onPress={startCreate}>
          <Text style={styles.primaryButtonText}>New team</Text>
        </Pressable>
      </View>

      <Text style={styles.hint}>
        Define each team here. People choose theirs in Profile, and can mark themselves as intake contacts.
      </Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading && teams.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#1a1a1a" />
        </View>
      ) : (
        <View style={styles.split}>
          <View style={styles.tableWrap}>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {filtered.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    {query.trim()
                      ? 'No teams match that search.'
                      : 'No teams yet. Create one so people can join from their profile.'}
                  </Text>
                </View>
              ) : (
                filtered.map((team) => {
                  const active = !isMobile && selectedId === team.id;
                  return (
                    <Pressable
                      key={team.id}
                      onPress={() => {
                        setSelectedId(team.id);
                        setEditing(false);
                      }}
                      style={[styles.row, active && styles.rowActive]}
                    >
                      <View style={styles.teamIcon}>
                        <Ionicons name="people" size={16} color={ACCENT} />
                      </View>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {team.name}
                        </Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {team.memberCount
                            ? `${team.memberCount} ${team.memberCount === 1 ? 'person' : 'people'}`
                            : 'No members'}
                          {team.intakeCount ? ` · Intake ${intakeNames(team, 2)}` : ''}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
          {!isMobile ? <View style={styles.detailPane}>{detail}</View> : null}
        </View>
      )}

      {isMobile ? (
        <Modal
          visible={Boolean(selectedId)}
          animationType="slide"
          onRequestClose={() => {
            setSelectedId(null);
            setEditing(false);
          }}
        >
          <View
            style={styles.mobileDetail}
            {...(Platform.OS === 'web' ? { className: 'cgold-mobile-sheet-top' } : null)}
          >
            {detail}
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f2f2f7',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  hint: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  split: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
  },
  tableWrap: {
    flex: 1,
    minWidth: 0,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rowActive: {
    backgroundColor: '#f5f5f7',
  },
  teamIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  rowSub: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 2,
  },
  detailPane: {
    width: 360,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#e5e5ea',
    backgroundColor: '#fafafa',
  },
  detailContent: {
    padding: 20,
    paddingBottom: 40,
  },
  detailMobileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  detailMobileTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  detailName: {
    fontFamily,
    fontSize: 22,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  detailDescription: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: '#3a3a3c',
    marginBottom: 8,
  },
  detailMuted: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    marginBottom: 8,
  },
  detailMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    marginBottom: 16,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  sectionLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  memberCopy: {
    flex: 1,
    minWidth: 0,
  },
  memberName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  memberSub: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 1,
  },
  intakeBadge: {
    backgroundColor: ACCENT_SOFT,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  intakeBadgeText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: ACCENT,
  },
  avatar: {
    overflow: 'hidden',
    backgroundColor: '#e8e8ed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallback: {
    backgroundColor: ACCENT,
  },
  avatarInitials: {
    fontFamily,
    fontWeight: '700',
    color: '#fff',
  },
  form: {
    gap: 8,
  },
  fieldLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#6b6b6b',
    marginTop: 8,
  },
  field: {
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d1d6',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  fieldMultiline: {
    height: 96,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    height: 36,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  primaryButtonOff: {
    opacity: 0.45,
  },
  primaryButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  secondaryButton: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef0f4',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  secondaryButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  dangerButton: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fee2e2',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  dangerButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#b91c1c',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  emptyText: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    textAlign: 'center',
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 6,
  },
  emptyBody: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
    maxWidth: 240,
  },
  detailEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#c41e3a',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  mobileDetail: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 12,
  },
});
