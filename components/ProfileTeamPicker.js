import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { listTeams, setOwnTeam } from '../lib/teams';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export default function ProfileTeamPicker({
  visible,
  selectedId,
  selectedName,
  isIntake,
  onClose,
  onChanged,
}) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [draftId, setDraftId] = useState('');
  const [draftIntake, setDraftIntake] = useState(false);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setError('');
      setSaving(false);
      return undefined;
    }

    setDraftId(asString(selectedId));
    setDraftIntake(Boolean(isIntake) && Boolean(selectedId));

    let cancelled = false;
    setLoading(true);
    setError('');
    listTeams()
      .then((rows) => {
        if (!cancelled) setTeams(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setTeams([]);
        setError(err?.message || 'Could not load teams.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, selectedId, isIntake]);

  const visibleTeams = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return teams;
    return teams.filter((team) => {
      const haystack = `${team.name} ${team.description}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [teams, query]);

  const persist = async (nextId, nextIntake) => {
    const teamId = asString(nextId);
    const intake = Boolean(teamId) && Boolean(nextIntake);
    const currentId = asString(selectedId);
    if (teamId === currentId && intake === Boolean(isIntake)) {
      return true;
    }

    setSaving(true);
    setError('');
    try {
      await setOwnTeam(teamId || null, intake);
      const team = teams.find((row) => row.id === teamId);
      onChanged?.({
        teamId,
        teamName: team?.name || (teamId ? asString(selectedName) : ''),
        isTeamIntake: intake,
      });
      return true;
    } catch (err) {
      setError(err?.message || 'Could not save your team.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSelect = async (team) => {
    if (saving) return;
    const nextId = asString(team?.id);
    if (nextId === draftId) return;
    const nextIntake = false;
    const ok = await persist(nextId, nextIntake);
    if (!ok) return;
    setDraftId(nextId);
    setDraftIntake(false);
  };

  const handleToggleIntake = async () => {
    if (!draftId || saving) return;
    const next = !draftIntake;
    const ok = await persist(draftId, next);
    if (ok) setDraftIntake(next);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Team</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
          <View style={styles.searchField}>
            <Ionicons name="search" size={16} color="#8e8e93" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search teams"
              placeholderTextColor="#8e8e93"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={Platform.OS === 'web'}
            />
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color="#1a1a1a" />
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.modalList}>
              <Pressable
                style={[styles.modalOption, !draftId && styles.modalOptionActive]}
                onPress={() => handleSelect(null)}
                disabled={saving}
                accessibilityRole="button"
                accessibilityState={{ selected: !draftId, busy: saving }}
                accessibilityLabel="No team"
              >
                <View style={styles.modalOptionCopy}>
                  <Text style={styles.modalOptionTitle}>No team</Text>
                  <Text style={styles.modalOptionMeta}>Not assigned yet</Text>
                </View>
                {!draftId ? <Ionicons name="checkmark" size={18} color="#1d1d1f" /> : null}
              </Pressable>
              {visibleTeams.map((team) => {
                const active = team.id === draftId;
                return (
                  <Pressable
                    key={team.id}
                    style={[styles.modalOption, active && styles.modalOptionActive]}
                    onPress={() => handleSelect(team)}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, busy: saving }}
                    accessibilityLabel={team.name}
                  >
                    <View style={styles.modalOptionCopy}>
                      <Text style={styles.modalOptionTitle} numberOfLines={1}>
                        {team.name}
                      </Text>
                      <Text style={styles.modalOptionMeta} numberOfLines={1}>
                        {team.memberCount
                          ? `${team.memberCount} ${team.memberCount === 1 ? 'person' : 'people'}`
                          : 'No members yet'}
                        {team.intakeCount ? ` · ${team.intakeCount} intake` : ''}
                      </Text>
                    </View>
                    {active ? <Ionicons name="checkmark" size={18} color="#1d1d1f" /> : null}
                  </Pressable>
                );
              })}
              {!visibleTeams.length ? (
                <Text style={styles.emptyText}>
                  {teams.length ? 'No teams match that search.' : 'No teams have been created yet. Open the Teams app to add one.'}
                </Text>
              ) : null}
            </ScrollView>
          )}
          <Pressable
            onPress={handleToggleIntake}
            disabled={!draftId || saving}
            style={[
              styles.intakeRow,
              (!draftId || saving) && styles.intakeRowDisabled,
            ]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: draftIntake, disabled: !draftId || saving }}
            accessibilityLabel="I'm an intake contact for this team"
          >
            <Ionicons
              name={draftIntake ? 'checkbox' : 'square-outline'}
              size={22}
              color={!draftId ? '#c7c7cc' : draftIntake ? '#2563EB' : '#8e8e93'}
            />
            <View style={styles.modalOptionCopy}>
              <Text style={[styles.modalOptionTitle, !draftId && styles.intakeDisabledText]}>
                I&apos;m an intake contact
              </Text>
              <Text style={styles.modalOptionMeta}>
                People messaging this team will see you as a first contact.
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  modalTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  doneText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '500',
    color: '#2F6FED',
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#f2f2f7',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#c41e3a',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  loading: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalList: {
    maxHeight: 360,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  modalOptionActive: {
    backgroundColor: '#f2f2f7',
  },
  modalOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  modalOptionTitle: {
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  modalOptionMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 2,
  },
  emptyText: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  intakeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  intakeRowDisabled: {
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  intakeDisabledText: {
    color: '#8e8e93',
  },
});
