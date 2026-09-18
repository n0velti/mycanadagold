import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDateParam, parseDateParam } from '../lib/transactions';
import {
  addProfileNote,
  deleteProfileNote,
  formatNoteDate,
  listProfileNotes,
  NOTE_CATEGORIES,
  NOTE_IMPORTANCE,
  noteCategoryLabel,
  noteImportanceLabel,
} from '../lib/profileNotes';
import { MOBILE, useIsMobile } from '../lib/mobileUi';

const fontFamily = 'Sohne';
const GOLD = '#E8C36A';
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const IMPORTANCE_COLOR = {
  low: '#8e8e93',
  medium: '#e8c36a',
  high: '#ff9f0a',
  urgent: '#ff453a',
};

const EMPTY_DRAFT = {
  body: '',
  dueOn: '',
  category: 'general',
  importance: 'medium',
};

function startOfMonth(date) {
  const value = parseDateParam(date);
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addMonths(date, delta) {
  const value = startOfMonth(date);
  return new Date(value.getFullYear(), value.getMonth() + delta, 1);
}

function sameDay(left, right) {
  if (!left || !right) return false;
  return formatDateParam(left) === formatDateParam(right);
}

function CalendarModal({ visible, value, onChange, onClose }) {
  const selected = value ? parseDateParam(value) : null;
  const today = parseDateParam(new Date());
  const [cursor, setCursor] = useState(() => startOfMonth(selected || today));

  useEffect(() => {
    if (!visible) return;
    setCursor(startOfMonth(value ? parseDateParam(value) : new Date()));
  }, [visible, value]);

  const cells = useMemo(() => {
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const offset = cursor.getDay();
    const next = [];
    for (let i = 0; i < offset; i += 1) next.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      next.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));
    }
    while (next.length % 7 !== 0) next.push(null);
    return next;
  }, [cursor]);

  const title = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.pickerRoot}>
        <Pressable style={styles.pickerBackdrop} onPress={onClose} accessibilityLabel="Close calendar" />
        <View style={styles.calCard}>
          <View style={styles.calHeader}>
            <Pressable
              onPress={() => setCursor((current) => addMonths(current, -1))}
              hitSlop={8}
              accessibilityLabel="Previous month"
              style={styles.calNav}
            >
              <Ionicons name="chevron-back" size={20} color="#1d1d1f" />
            </Pressable>
            <Text style={styles.calTitle}>{title}</Text>
            <Pressable
              onPress={() => setCursor((current) => addMonths(current, 1))}
              hitSlop={8}
              accessibilityLabel="Next month"
              style={styles.calNav}
            >
              <Ionicons name="chevron-forward" size={20} color="#1d1d1f" />
            </Pressable>
          </View>
          <View style={styles.calWeekRow}>
            {WEEKDAYS.map((day) => (
              <Text key={day} style={styles.calWeekday}>
                {day}
              </Text>
            ))}
          </View>
          <View style={styles.calGrid}>
            {cells.map((day, index) => {
              if (!day) {
                return <View key={`empty-${index}`} style={styles.calDay} />;
              }
              const key = formatDateParam(day);
              const isSelected = selected && sameDay(day, selected);
              const isToday = sameDay(day, today);
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    onChange(key);
                    onClose();
                  }}
                  style={styles.calDay}
                  accessibilityRole="button"
                  accessibilityLabel={day.toLocaleDateString()}
                  accessibilityState={{ selected: isSelected }}
                >
                  <View
                    style={[
                      styles.calDayInner,
                      isToday && styles.calDayToday,
                      isSelected && styles.calDaySelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.calDayText,
                        isToday && styles.calDayTextToday,
                        isSelected && styles.calDayTextSelected,
                      ]}
                    >
                      {day.getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.calFooter}>
            <Pressable
              onPress={() => {
                onChange('');
                onClose();
              }}
              hitSlop={8}
              accessibilityLabel="Clear due date"
            >
              <Text style={styles.calClear}>Clear</Text>
            </Pressable>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Done">
              <Text style={styles.calDone}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ChoiceModal({ visible, title, options, value, onChange, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.pickerRoot}>
        <Pressable style={styles.pickerBackdrop} onPress={onClose} accessibilityLabel={`Close ${title}`} />
        <View style={styles.choiceCard}>
          <Text style={styles.choiceTitle}>{title}</Text>
          {options.map((option) => {
            const selected = option.key === value;
            return (
              <Pressable
                key={option.key}
                onPress={() => {
                  onChange(option.key);
                  onClose();
                }}
                style={({ hovered, pressed }) => [
                  styles.choiceRow,
                  selected && styles.choiceRowSelected,
                  (hovered || pressed) && styles.choiceRowHover,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.label}</Text>
                {selected ? <Ionicons name="checkmark" size={16} color="#1d1d1f" /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

function ComposerRow({ draft, onChange, onSave, onCancel, saving, canSave }) {
  const [picker, setPicker] = useState(null);
  const importanceColor = IMPORTANCE_COLOR[draft.importance] || IMPORTANCE_COLOR.medium;

  return (
    <View style={[styles.tableRow, styles.composerRow]}>
      <Text style={[styles.cell, styles.colDate]} numberOfLines={1}>
        {formatNoteDate(new Date())}
      </Text>
      <Text style={[styles.cell, styles.colFrom]} numberOfLines={1}>
        You
      </Text>
      <TextInput
        value={draft.body}
        onChangeText={(body) => onChange({ ...draft, body })}
        placeholder="Write a note"
        placeholderTextColor="#8e8e93"
        multiline
        autoFocus
        style={[styles.cell, styles.colNote, styles.noteField]}
        onSubmitEditing={() => {
          if (canSave) onSave();
        }}
      />
      <Pressable
        onPress={() => setPicker('due')}
        style={[styles.colDue, styles.inlinePick]}
        accessibilityRole="button"
        accessibilityLabel={draft.dueOn ? `Due ${formatNoteDate(draft.dueOn)}` : 'Set due date'}
      >
        <Ionicons name="calendar-outline" size={14} color={draft.dueOn ? GOLD : '#8e8e93'} />
        <Text style={[styles.cell, styles.inlinePickText, !draft.dueOn && styles.placeholder]} numberOfLines={1}>
          {draft.dueOn ? formatNoteDate(draft.dueOn) : 'Due'}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => setPicker('category')}
        style={[styles.colCategory, styles.inlinePick]}
        accessibilityRole="button"
        accessibilityLabel={`Category ${noteCategoryLabel(draft.category)}`}
      >
        <Text style={[styles.cell, styles.inlinePickText]} numberOfLines={1}>
          {noteCategoryLabel(draft.category)}
        </Text>
        <Ionicons name="chevron-down" size={12} color="#8e8e93" />
      </Pressable>
      <View style={styles.colImportance}>
        <Pressable
          onPress={() => setPicker('importance')}
          style={[styles.inlinePick, styles.importancePick]}
          accessibilityRole="button"
          accessibilityLabel={`Importance ${noteImportanceLabel(draft.importance)}`}
        >
          <Text
            style={[styles.cell, styles.inlinePickText, styles.importanceText, { color: importanceColor }]}
            numberOfLines={1}
          >
            {noteImportanceLabel(draft.importance)}
          </Text>
          <Ionicons name="chevron-down" size={12} color="#8e8e93" />
        </Pressable>
        <Pressable
          onPress={onSave}
          disabled={saving || !canSave}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Save note"
          style={styles.rowAction}
        >
          {saving ? (
            <ActivityIndicator size="small" color={GOLD} />
          ) : (
            <Ionicons name="checkmark" size={16} color={canSave ? GOLD : '#5c5c5c'} />
          )}
        </Pressable>
        <Pressable
          onPress={onCancel}
          disabled={saving}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Cancel note"
          style={styles.rowAction}
        >
          <Ionicons name="close" size={16} color="#8e8e93" />
        </Pressable>
      </View>
      <CalendarModal
        visible={picker === 'due'}
        value={draft.dueOn}
        onChange={(dueOn) => onChange({ ...draft, dueOn })}
        onClose={() => setPicker(null)}
      />
      <ChoiceModal
        visible={picker === 'category'}
        title="Category"
        options={NOTE_CATEGORIES}
        value={draft.category}
        onChange={(category) => onChange({ ...draft, category })}
        onClose={() => setPicker(null)}
      />
      <ChoiceModal
        visible={picker === 'importance'}
        title="Importance"
        options={NOTE_IMPORTANCE}
        value={draft.importance}
        onChange={(importance) => onChange({ ...draft, importance })}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

function NoteRow({ note, myId, canDelete, onDelete, deleting }) {
  const fromLabel = note.authorId === myId ? 'You' : note.authorName;
  const importanceColor = IMPORTANCE_COLOR[note.importance] || IMPORTANCE_COLOR.medium;

  return (
    <View style={styles.tableRow}>
      <Text style={[styles.cell, styles.colDate]} numberOfLines={1}>
        {formatNoteDate(note.createdAt)}
      </Text>
      <Text style={[styles.cell, styles.colFrom]} numberOfLines={1}>
        {fromLabel}
      </Text>
      <Text style={[styles.cell, styles.colNote]} numberOfLines={3}>
        {note.body}
      </Text>
      <Text style={[styles.cell, styles.colDue]} numberOfLines={1}>
        {note.dueOn ? formatNoteDate(note.dueOn) : '—'}
      </Text>
      <Text style={[styles.cell, styles.colCategory]} numberOfLines={1}>
        {noteCategoryLabel(note.category)}
      </Text>
      <View style={styles.colImportance}>
        <Text style={[styles.cell, styles.importanceText, { color: importanceColor }]} numberOfLines={1}>
          {noteImportanceLabel(note.importance)}
        </Text>
        {canDelete ? (
          <Pressable
            onPress={onDelete}
            disabled={deleting}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Delete note"
            style={styles.deleteButton}
          >
            {deleting ? (
              <ActivityIndicator size="small" color="#8e8e93" />
            ) : (
              <Ionicons name="trash-outline" size={14} color="#8e8e93" />
            )}
          </Pressable>
        ) : (
          <View style={styles.deleteSpacer} />
        )}
      </View>
    </View>
  );
}

function MobileComposer({ draft, onChange, onSave, onCancel, saving, canSave }) {
  const [picker, setPicker] = useState(null);
  const importanceColor = IMPORTANCE_COLOR[draft.importance] || IMPORTANCE_COLOR.medium;

  return (
    <View style={styles.mobileCard}>
      <TextInput
        value={draft.body}
        onChangeText={(body) => onChange({ ...draft, body })}
        placeholder="Write a note"
        placeholderTextColor={MOBILE.secondary}
        multiline
        autoFocus
        style={styles.mobileField}
        textAlignVertical="top"
      />
      <View style={styles.mobileChipRow}>
        <Pressable
          onPress={() => setPicker('due')}
          style={styles.mobileChip}
          accessibilityRole="button"
          accessibilityLabel={draft.dueOn ? `Due ${formatNoteDate(draft.dueOn)}` : 'Set due date'}
        >
          <Ionicons name="calendar-outline" size={15} color={draft.dueOn ? GOLD : MOBILE.secondary} />
          <Text style={[styles.mobileChipText, !draft.dueOn && styles.mobilePlaceholder]} numberOfLines={1}>
            {draft.dueOn ? formatNoteDate(draft.dueOn) : 'Due'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setPicker('category')}
          style={styles.mobileChip}
          accessibilityRole="button"
          accessibilityLabel={`Category ${noteCategoryLabel(draft.category)}`}
        >
          <Text style={styles.mobileChipText} numberOfLines={1}>
            {noteCategoryLabel(draft.category)}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setPicker('importance')}
          style={styles.mobileChip}
          accessibilityRole="button"
          accessibilityLabel={`Importance ${noteImportanceLabel(draft.importance)}`}
        >
          <Text style={[styles.mobileChipText, { color: importanceColor }]} numberOfLines={1}>
            {noteImportanceLabel(draft.importance)}
          </Text>
        </Pressable>
      </View>
      <View style={styles.mobileComposerActions}>
        <Pressable onPress={onCancel} disabled={saving} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel note">
          <Text style={styles.mobileCancel}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={onSave}
          disabled={saving || !canSave}
          accessibilityRole="button"
          accessibilityLabel="Save note"
          style={[styles.mobileSave, (!canSave || saving) && styles.mobileSaveDisabled]}
        >
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.mobileSaveText}>Save</Text>}
        </Pressable>
      </View>
      <CalendarModal
        visible={picker === 'due'}
        value={draft.dueOn}
        onChange={(dueOn) => onChange({ ...draft, dueOn })}
        onClose={() => setPicker(null)}
      />
      <ChoiceModal
        visible={picker === 'category'}
        title="Category"
        options={NOTE_CATEGORIES}
        value={draft.category}
        onChange={(category) => onChange({ ...draft, category })}
        onClose={() => setPicker(null)}
      />
      <ChoiceModal
        visible={picker === 'importance'}
        title="Importance"
        options={NOTE_IMPORTANCE}
        value={draft.importance}
        onChange={(importance) => onChange({ ...draft, importance })}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

function MobileNoteCard({ note, myId, canDelete, onDelete, deleting }) {
  const fromLabel = note.authorId === myId ? 'You' : note.authorName;
  const importanceColor = IMPORTANCE_COLOR[note.importance] || IMPORTANCE_COLOR.medium;
  const meta = [
    fromLabel,
    formatNoteDate(note.createdAt),
    note.dueOn ? `Due ${formatNoteDate(note.dueOn)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.mobileCard}>
      <Text style={styles.mobileNoteBody}>{note.body}</Text>
      <Text style={styles.mobileNoteMeta}>{meta}</Text>
      <View style={styles.mobileNoteFooter}>
        <Text style={styles.mobileNoteTag}>{noteCategoryLabel(note.category)}</Text>
        <Text style={[styles.mobileNoteTag, styles.mobileNoteImportance, { color: importanceColor }]}>
          {noteImportanceLabel(note.importance)}
        </Text>
        {canDelete ? (
          <Pressable
            onPress={onDelete}
            disabled={deleting}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete note"
            style={styles.mobileDelete}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={MOBILE.secondary} />
            ) : (
              <Ionicons name="trash-outline" size={16} color={MOBILE.secondary} />
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function ProfileNotesTable({ profileId, myId }) {
  const isMobile = useIsMobile();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deletingId, setDeletingId] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setSaveError('');
    if (!profileId) {
      setNotes([]);
      setError('');
      return undefined;
    }

    setLoading(true);
    setError('');
    listProfileNotes(profileId)
      .then((rows) => {
        if (!cancelled) setNotes(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setNotes([]);
          setError(err?.message || 'Could not load notes.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const startAdd = () => {
    if (!profileId || saving) return;
    setSaveError('');
    setDraft({ ...EMPTY_DRAFT });
  };

  const handleSave = async () => {
    if (!draft || saving || !draft.body.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      const row = await addProfileNote(profileId, draft);
      setNotes((current) => [row, ...current.filter((note) => note.id !== row.id)]);
      setDraft(null);
    } catch (err) {
      setSaveError(err?.message || 'Could not save that note.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (noteId) => {
    if (deletingId) return;
    setDeletingId(noteId);
    setError('');
    try {
      await deleteProfileNote(noteId);
      setNotes((current) => current.filter((note) => note.id !== noteId));
    } catch (err) {
      setError(err?.message || 'Could not delete that note.');
    } finally {
      setDeletingId('');
    }
  };

  const table = (
    <View style={styles.table}>
      <View style={styles.tableHead}>
        <Text style={styles.tableTitle}>Notes</Text>
        <Pressable
          onPress={startAdd}
          disabled={!profileId || Boolean(draft)}
          style={({ hovered, pressed }) => [
            styles.addButton,
            (hovered || pressed) && styles.addButtonPressed,
            (!profileId || draft) && styles.addButtonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Add note"
        >
          <Ionicons name="add" size={16} color="#111" />
          <Text style={styles.addButtonText}>Add note</Text>
        </Pressable>
      </View>
      <View style={styles.headerRow}>
        <Text style={[styles.headerCell, styles.colDate]}>Date</Text>
        <Text style={[styles.headerCell, styles.colFrom]}>From</Text>
        <Text style={[styles.headerCell, styles.colNote]}>Note</Text>
        <Text style={[styles.headerCell, styles.colDue]}>Due</Text>
        <Text style={[styles.headerCell, styles.colCategory]}>Category</Text>
        <Text style={[styles.headerCell, styles.colImportance]}>Importance</Text>
      </View>
      {draft ? (
        <ComposerRow
          draft={draft}
          onChange={setDraft}
          onSave={() => void handleSave()}
          onCancel={() => {
            if (!saving) {
              setDraft(null);
              setSaveError('');
            }
          }}
          saving={saving}
          canSave={Boolean(draft.body.trim())}
        />
      ) : null}
      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={GOLD} />
        </View>
      ) : notes.length === 0 && !draft ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {error || 'No notes yet. Add one to keep a record on this profile.'}
          </Text>
        </View>
      ) : (
        notes.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            myId={myId}
            canDelete={note.authorId === myId || note.profileId === myId}
            deleting={deletingId === note.id}
            onDelete={() => void handleDelete(note.id)}
          />
        ))
      )}
      {saveError ? <Text style={styles.tableError}>{saveError}</Text> : null}
      {error && notes.length > 0 ? <Text style={styles.tableError}>{error}</Text> : null}
    </View>
  );

  return (
    <View style={[styles.wrap, isMobile && styles.wrapMobile]}>
      {isMobile ? (
        <View style={styles.mobileWrap}>
          <View style={styles.mobileHead}>
            <Text style={styles.mobileTitle}>Notes</Text>
            <Pressable
              onPress={startAdd}
              disabled={!profileId || Boolean(draft)}
              style={({ pressed }) => [
                styles.mobileAdd,
                pressed && styles.addButtonPressed,
                (!profileId || draft) && styles.addButtonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add note"
            >
              <Ionicons name="add" size={20} color="#007AFF" />
              <Text style={styles.mobileAddText}>Add</Text>
            </Pressable>
          </View>
          {draft ? (
            <MobileComposer
              draft={draft}
              onChange={setDraft}
              onSave={() => void handleSave()}
              onCancel={() => {
                if (!saving) {
                  setDraft(null);
                  setSaveError('');
                }
              }}
              saving={saving}
              canSave={Boolean(draft.body.trim())}
            />
          ) : null}
          {loading ? (
            <View style={styles.mobileEmpty}>
              <ActivityIndicator color="#007AFF" />
            </View>
          ) : notes.length === 0 && !draft ? (
            <View style={styles.mobileEmptyCard}>
              <Text style={styles.mobileEmptyText}>
                {error || 'No notes yet. Add one to keep a record on this profile.'}
              </Text>
            </View>
          ) : (
            notes.map((note) => (
              <MobileNoteCard
                key={note.id}
                note={note}
                myId={myId}
                canDelete={note.authorId === myId || note.profileId === myId}
                deleting={deletingId === note.id}
                onDelete={() => void handleDelete(note.id)}
              />
            ))
          )}
          {saveError ? <Text style={styles.mobileError}>{saveError}</Text> : null}
          {error && notes.length > 0 ? <Text style={styles.mobileError}>{error}</Text> : null}
        </View>
      ) : (
        table
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 28,
    width: '100%',
  },
  wrapMobile: {
    marginTop: 0,
  },
  hScroll: {
    minWidth: 780,
  },
  table: {
    backgroundColor: '#111',
    borderRadius: 14,
    overflow: 'hidden',
    minWidth: 780,
  },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  tableTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: GOLD,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  addButtonPressed: {
    opacity: 0.85,
  },
  addButtonDisabled: {
    opacity: 0.45,
  },
  addButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
    letterSpacing: -0.1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: '#1a1a1a',
  },
  headerCell: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: GOLD,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  composerRow: {
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
  },
  cell: {
    fontFamily,
    fontSize: 13,
    color: '#f2f2f7',
    letterSpacing: -0.1,
  },
  colDate: { width: 108, flexShrink: 0 },
  colFrom: { width: 112, flexShrink: 0 },
  colNote: { flex: 1, minWidth: 160 },
  colDue: { width: 108, flexShrink: 0 },
  colCategory: { width: 104, flexShrink: 0 },
  colImportance: {
    width: 128,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  importancePick: {
    flex: 1,
    minWidth: 0,
  },
  importanceText: {
    flex: 1,
    fontWeight: '600',
  },
  noteField: {
    minHeight: 34,
    maxHeight: 72,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: '#f2f2f7',
    textAlignVertical: 'top',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  inlinePick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 28,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  inlinePickText: {
    flex: 1,
    minWidth: 0,
  },
  placeholder: {
    color: '#8e8e93',
  },
  rowAction: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  deleteButton: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  deleteSpacer: {
    width: 20,
  },
  empty: {
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    textAlign: 'center',
    lineHeight: 18,
  },
  tableError: {
    fontFamily,
    fontSize: 12,
    color: '#ff453a',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  mobileWrap: {
    width: '100%',
    gap: 10,
  },
  mobileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 7,
  },
  mobileTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.08,
  },
  mobileAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileAddText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: '#007AFF',
    letterSpacing: -0.2,
  },
  mobileCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  mobileField: {
    fontFamily,
    fontSize: 17,
    color: MOBILE.label,
    letterSpacing: -0.3,
    minHeight: 88,
    padding: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  mobileChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mobileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: MOBILE.bg,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileChipText: {
    fontFamily,
    fontSize: 14,
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  mobilePlaceholder: {
    color: MOBILE.secondary,
  },
  mobileComposerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
    paddingTop: 4,
  },
  mobileCancel: {
    fontFamily,
    fontSize: 17,
    color: MOBILE.secondary,
    letterSpacing: -0.2,
  },
  mobileSave: {
    minWidth: 72,
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileSaveDisabled: {
    opacity: 0.4,
  },
  mobileSaveText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  mobileNoteBody: {
    fontFamily,
    fontSize: 17,
    color: MOBILE.label,
    letterSpacing: -0.3,
    lineHeight: 22,
  },
  mobileNoteMeta: {
    fontFamily,
    fontSize: 13,
    color: MOBILE.secondary,
    letterSpacing: -0.08,
  },
  mobileNoteFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mobileNoteTag: {
    fontFamily,
    fontSize: 13,
    color: MOBILE.secondary,
    letterSpacing: -0.08,
  },
  mobileNoteImportance: {
    fontWeight: '600',
  },
  mobileDelete: {
    marginLeft: 'auto',
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileEmpty: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  mobileEmptyCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 22,
  },
  mobileEmptyText: {
    fontFamily,
    fontSize: 15,
    color: MOBILE.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  mobileError: {
    fontFamily,
    fontSize: 13,
    color: '#ff3b30',
    paddingHorizontal: 16,
  },
  pickerRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  calCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  calNav: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  calTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  calWeekRow: {
    flexDirection: 'row',
  },
  calWeekday: {
    flex: 1,
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    textAlign: 'center',
    paddingVertical: 4,
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calDay: {
    width: '14.2857%',
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  calDayInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDayToday: {
    borderWidth: 1,
    borderColor: GOLD,
  },
  calDaySelected: {
    backgroundColor: GOLD,
    borderWidth: 0,
  },
  calDayText: {
    fontFamily,
    fontSize: 14,
    color: '#1d1d1f',
  },
  calDayTextToday: {
    fontWeight: '600',
  },
  calDayTextSelected: {
    fontWeight: '700',
    color: '#111',
  },
  calFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingHorizontal: 6,
  },
  calClear: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
  },
  calDone: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#007AFF',
  },
  choiceCard: {
    width: '100%',
    maxWidth: 280,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    paddingVertical: 8,
  },
  choiceTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  choiceRow: {
    minHeight: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  choiceRowSelected: {
    backgroundColor: '#f2f2f7',
  },
  choiceRowHover: {
    backgroundColor: '#e8e8ed',
  },
  choiceText: {
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
  },
  choiceTextSelected: {
    fontWeight: '600',
  },
});
