import { createElement, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { formatDateParam, formatPickerDate, parseDateParam } from '../lib/transactions';
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
import { useIsMobile } from '../lib/mobileUi';

const fontFamily = 'Sohne';
const GOLD = '#E8C36A';

const IMPORTANCE_COLOR = {
  low: '#8e8e93',
  medium: '#e8c36a',
  high: '#ff9f0a',
  urgent: '#ff453a',
};

function DueDateField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value || new Date());

  if (Platform.OS === 'web') {
    return createElement('input', {
      type: 'date',
      value: value || '',
      onChange: (event) => onChange(event.target.value),
      style: {
        fontFamily,
        fontSize: 15,
        color: '#1d1d1f',
        border: '1px solid #d1d1d6',
        borderRadius: 10,
        padding: '10px 12px',
        background: '#fff',
        width: '100%',
        boxSizing: 'border-box',
      },
    });
  }

  return (
    <>
      <Pressable style={styles.dateChip} onPress={() => setOpen(true)}>
        <Ionicons name="calendar-outline" size={16} color="#8e8e93" />
        <Text style={styles.dateChipText}>{value ? formatPickerDate(dateValue) : 'None'}</Text>
      </Pressable>
      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) onChange(formatDateParam(selected));
          }}
        />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.pickerBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.pickerCard}>
              <View style={styles.pickerHeader}>
                <Pressable onPress={() => onChange('')} hitSlop={8}>
                  <Text style={styles.pickerClear}>Clear</Text>
                </Pressable>
                <Text style={styles.pickerTitle}>Due</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.pickerDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                onChange={(_, selected) => {
                  if (selected) onChange(formatDateParam(selected));
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function ChipRow({ options, value, onChange }) {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={[styles.chip, selected && styles.chipSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AddNoteModal({ visible, onClose, onSave, saving, error }) {
  const [body, setBody] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [category, setCategory] = useState('general');
  const [importance, setImportance] = useState('medium');

  useEffect(() => {
    if (!visible) return;
    setBody('');
    setDueOn('');
    setCategory('general');
    setImportance('medium');
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.orgBackdrop} onPress={onClose} accessibilityLabel="Close add note" />
        <View style={styles.modalSheet} pointerEvents="box-none">
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add note</Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color="#8e8e93" />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalBody}
            >
              <Text style={styles.fieldLabel}>Note</Text>
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="Write a note"
                placeholderTextColor="#8e8e93"
                multiline
                style={styles.noteInput}
              />
              <Text style={styles.fieldLabel}>Due</Text>
              <DueDateField value={dueOn} onChange={setDueOn} />
              {dueOn && Platform.OS === 'web' ? (
                <Pressable onPress={() => setDueOn('')} hitSlop={6} style={styles.clearDue}>
                  <Text style={styles.clearDueText}>Clear due date</Text>
                </Pressable>
              ) : null}
              <Text style={styles.fieldLabel}>Category</Text>
              <ChipRow options={NOTE_CATEGORIES} value={category} onChange={setCategory} />
              <Text style={styles.fieldLabel}>Importance</Text>
              <ChipRow options={NOTE_IMPORTANCE} value={importance} onChange={setImportance} />
              {error ? <Text style={styles.modalError}>{error}</Text> : null}
            </ScrollView>
            <Pressable
              onPress={() => onSave({ body, dueOn, category, importance })}
              disabled={saving || !body.trim()}
              style={({ hovered, pressed }) => [
                styles.saveButton,
                (hovered || pressed) && !saving && styles.saveButtonPressed,
                (saving || !body.trim()) && styles.saveButtonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save note"
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Save note</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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

export default function ProfileNotesTable({ profileId, myId }) {
  const isMobile = useIsMobile();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deletingId, setDeletingId] = useState('');

  useEffect(() => {
    let cancelled = false;
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

  const handleSave = async (fields) => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const row = await addProfileNote(profileId, fields);
      setNotes((current) => [row, ...current.filter((note) => note.id !== row.id)]);
      setAddOpen(false);
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
          onPress={() => {
            setSaveError('');
            setAddOpen(true);
          }}
          disabled={!profileId}
          style={({ hovered, pressed }) => [
            styles.addButton,
            (hovered || pressed) && styles.addButtonPressed,
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
      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={GOLD} />
        </View>
      ) : notes.length === 0 ? (
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
      {error && notes.length > 0 ? <Text style={styles.tableError}>{error}</Text> : null}
    </View>
  );

  return (
    <View style={[styles.wrap, isMobile && styles.wrapMobile]}>
      {isMobile ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
          {table}
        </ScrollView>
      ) : (
        table
      )}
      <AddNoteModal
        visible={addOpen}
        onClose={() => {
          if (!saving) setAddOpen(false);
        }}
        onSave={(fields) => void handleSave(fields)}
        saving={saving}
        error={saveError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 28,
    width: '100%',
  },
  wrapMobile: {
    marginTop: 20,
  },
  hScroll: {
    minWidth: 760,
  },
  table: {
    backgroundColor: '#111',
    borderRadius: 14,
    overflow: 'hidden',
    minWidth: 760,
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
    width: 108,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  importanceText: {
    flex: 1,
    fontWeight: '600',
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
  orgBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modalRoot: {
    flex: 1,
  },
  modalSheet: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '86%',
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  modalTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  modalBody: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  fieldLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginTop: 4,
  },
  noteInput: {
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    minHeight: 96,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 10,
    paddingHorizontal: 12,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  dateChipText: {
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
  },
  clearDue: {
    alignSelf: 'flex-start',
    marginTop: -4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  clearDueText: {
    fontFamily,
    fontSize: 13,
    color: '#007AFF',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chipSelected: {
    backgroundColor: '#1d1d1f',
    borderColor: '#1d1d1f',
  },
  chipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  chipTextSelected: {
    color: '#fff',
  },
  modalError: {
    fontFamily,
    fontSize: 13,
    color: '#b42318',
  },
  saveButton: {
    margin: 16,
    marginTop: 4,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#1d1d1f',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  saveButtonPressed: {
    opacity: 0.88,
  },
  saveButtonDisabled: {
    opacity: 0.45,
  },
  saveButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  pickerCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pickerTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  pickerDone: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#007AFF',
  },
  pickerClear: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
  },
});
