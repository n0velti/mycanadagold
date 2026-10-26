import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { IosGroup, IosRow, IosSwitch } from './IosSettings';
import { CANVAS, MOBILE, NAV_TAB_ACTIVE_RADIUS, useIsMobile } from '../lib/mobileUi';
import { FONT_LIGHT } from '../lib/typography';
import {
  defaultTaskSources,
  extractTasks,
  formatDaysAgo,
  formatSourcesSummary,
  formatTaskWhen,
  formatUpdatedAgo,
  loadTaskDigest,
  loadTasksModel,
  loadTasksSnapshot,
  loadTasksSources,
  loadTasksState,
  normalizeTaskSources,
  pruneTasksState,
  saveTasksModel,
  saveTasksSnapshot,
  saveTasksSources,
  saveTasksState,
  sortTasks,
  sourcesEqual,
  taskAccountLabel,
  taskChannelLabel,
  taskOpenLabel,
  TASK_MODEL_OPTIONS,
  TASK_SOURCE_OPTIONS,
  TASK_WINDOW_OPTIONS,
} from '../lib/tasks';
import TaskSourcePane from './TaskSourcePane';

const fontFamily = Platform.select({ ios: 'Sohne', android: 'Sohne', default: 'Sohne' });
const titleFontFamily = FONT_LIGHT;
const TEXT = MOBILE.label;
const SECONDARY = MOBILE.secondary;
const ACCENT = '#059669';
const ACCENT_TINT = '#ECFDF5';
const TAB_BORDER = '#d0d0d0';
const HAIRLINE = '#e5e5ea';
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

// Cached lists older than this refresh on open; newer ones wait for Refresh.
const STALE_AFTER_MS = 20 * 60 * 1000;

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
];

const PRIORITY_META = {
  high: { label: 'High', color: '#B91C1C', bg: '#FEE2E2' },
  normal: { label: 'Normal', color: '#1D4ED8', bg: '#DBEAFE' },
  low: { label: 'Low', color: '#6B7280', bg: '#F3F4F6' },
};

function Chip({ icon, label, onPress, disabled, active, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={({ hovered, pressed }) => [
        styles.chip,
        active && styles.chipActive,
        (hovered || pressed) && !disabled && styles.chipHover,
        disabled && styles.chipDisabled,
      ]}
    >
      {icon ? <Ionicons name={icon} size={15} color={active ? ACCENT : TEXT} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ModelPicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const selected = TASK_MODEL_OPTIONS.find((option) => option.key === value) || TASK_MODEL_OPTIONS[0];
  return (
    <View style={styles.modelWrap}>
      <Chip
        icon="sparkles-outline"
        label={selected.label}
        onPress={() => setOpen((current) => !current)}
        disabled={disabled}
        accessibilityLabel="Choose AI model"
      />
      {open ? (
        <View style={styles.modelMenu}>
          {TASK_MODEL_OPTIONS.map((option) => {
            const active = option.key === selected.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => {
                  setOpen(false);
                  onChange(option.key);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ hovered, pressed }) => [
                  styles.modelOption,
                  (hovered || pressed) && styles.modelOptionHover,
                ]}
              >
                <View style={styles.modelOptionCopy}>
                  <Text style={[styles.modelOptionLabel, active && styles.modelOptionLabelActive]}>
                    {option.label}
                  </Text>
                  <Text style={styles.modelOptionTag}>{option.tag}</Text>
                </View>
                {active ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function SourcesModal({ visible, draft, onChange, onCancel, onApply, isMobile }) {
  const prefs = normalizeTaskSources(draft);
  const enabled = TASK_SOURCE_OPTIONS.filter((option) => prefs[option.key]).length;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.modalRoot, isMobile && styles.modalRootMobile]}>
        <Pressable style={styles.modalBackdrop} onPress={onCancel} accessibilityLabel="Close sources" />
        <View style={[styles.modalSheet, isMobile && styles.modalSheetMobile]}>
          <View style={styles.modalNav}>
            <Pressable onPress={onCancel} hitSlop={8} style={styles.modalNavSide} accessibilityLabel="Cancel">
              <Text style={styles.modalCancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle} numberOfLines={1}>
              Sources
            </Text>
            <Pressable onPress={onApply} hitSlop={8} style={styles.modalNavSideRight} accessibilityLabel="Apply sources">
              <Text style={styles.modalSave}>Apply</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.modalLead}>
              Choose where Tasks reads from, and how far back. The AI only sees the sources you turn on
              inside this rolling window.
            </Text>
            <IosGroup
              header="Sources"
              footer={
                enabled
                  ? `${enabled} source${enabled === 1 ? '' : 's'} will be sent to the model.`
                  : 'Turn on at least one source to build a list.'
              }
            >
              {TASK_SOURCE_OPTIONS.map((option, index) => (
                <IosRow
                  key={option.key}
                  icon={option.icon}
                  iconColor={option.key === 'email' ? '#007AFF' : option.key === 'messages' ? '#34C759' : '#AF52DE'}
                  label={option.label}
                  last={index === TASK_SOURCE_OPTIONS.length - 1}
                  accessory={
                    <IosSwitch
                      on={Boolean(prefs[option.key])}
                      onPress={() => onChange({ ...prefs, [option.key]: !prefs[option.key] })}
                    />
                  }
                >
                  <Text style={styles.sourceHint}>{option.hint}</Text>
                </IosRow>
              ))}
            </IosGroup>
            <IosGroup header="Time frame" footer="A rolling window ending today. Older items stay out of the analysis.">
              <View style={styles.windowGrid}>
                {TASK_WINDOW_OPTIONS.map((option) => {
                  const active = prefs.windowDays === option.days;
                  return (
                    <Pressable
                      key={option.days}
                      onPress={() => onChange({ ...prefs, windowDays: option.days })}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[styles.windowChip, active && styles.windowChipActive]}
                    >
                      <Text style={[styles.windowChipText, active && styles.windowChipTextActive]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </IosGroup>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function TaskRow({ task, done, expanded, showAccount, onToggleDone, onToggleExpand, onDismiss, onOpen }) {
  const priority = PRIORITY_META[task.priority] || PRIORITY_META.normal;
  const when = formatTaskWhen(task.receivedAt);
  const channel = taskChannelLabel(task.channel);
  const meta = [
    channel,
    task.requester ? `From ${task.requester}` : '',
    showAccount && task.channel !== 'phone' ? (task.channel === 'email' ? taskAccountLabel(task.account) : task.account) : '',
    when,
  ].filter(Boolean);
  const handled = task.handled && !done;
  return (
    <View style={[styles.taskRow, done && styles.taskRowDone]}>
      <Pressable
        onPress={() => onToggleDone(task)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? `Mark “${task.title}” not done` : `Mark “${task.title}” done`}
        hitSlop={8}
        style={styles.checkWrap}
      >
        <Ionicons
          name={done ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={done ? ACCENT : '#c7c7cc'}
        />
      </Pressable>
      <Pressable
        onPress={() => (onOpen ? onOpen(task) : onToggleExpand(task))}
        onLongPress={() => onToggleExpand(task)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.taskBody}
      >
        <View style={styles.taskTop}>
          <Text style={[styles.taskTitle, done && styles.taskTitleDone]} numberOfLines={expanded ? undefined : 2}>
            {task.title}
          </Text>
          {task.priority === 'high' && !done ? (
            <View style={[styles.priorityPill, { backgroundColor: priority.bg }]}>
              <Text style={[styles.priorityText, { color: priority.color }]}>{priority.label}</Text>
            </View>
          ) : null}
        </View>
        {task.detail ? (
          <Text style={[styles.taskDetail, done && styles.taskDetailDone]} numberOfLines={expanded ? undefined : 2}>
            {task.detail}
          </Text>
        ) : null}
        <View style={styles.taskMetaRow}>
          {meta.length ? (
            <Text style={styles.taskMeta} numberOfLines={1}>
              {meta.join(' · ')}
            </Text>
          ) : null}
          {task.due ? (
            <View style={styles.dueRow}>
              <Ionicons name="time-outline" size={12} color={ACCENT} />
              <Text style={styles.dueText} numberOfLines={1}>
                {task.due}
              </Text>
            </View>
          ) : null}
          {onOpen && !expanded ? (
            <Text style={styles.openHint}>{taskOpenLabel(task.channel)}</Text>
          ) : null}
        </View>
        {handled ? (
          <Text style={styles.handledNote} numberOfLines={expanded ? undefined : 1}>
            Looks handled{task.handledNote ? ` — ${task.handledNote}` : ' in your sent mail.'}
          </Text>
        ) : null}
        {expanded ? (
          <View style={styles.taskActions}>
            {task.subject ? (
              <Text style={styles.taskSubject} numberOfLines={2}>
                Re: {task.subject}
              </Text>
            ) : null}
            <View style={styles.taskActionRow}>
              {onOpen ? (
                <Chip
                  icon={
                    task.channel === 'messages'
                      ? 'chatbubbles-outline'
                      : task.channel === 'phone'
                        ? 'call-outline'
                        : 'mail-outline'
                  }
                  label={taskOpenLabel(task.channel)}
                  onPress={() => onOpen(task)}
                />
              ) : null}
              <Chip icon="eye-off-outline" label="Dismiss" onPress={() => onDismiss(task)} />
            </View>
          </View>
        ) : null}
        {task.receivedAt ? (
          <Text style={[styles.daysAgo, done && styles.daysAgoDone]}>{formatDaysAgo(task.receivedAt)}</Text>
        ) : null}
      </Pressable>
    </View>
  );
}

export default function TasksScreen({ session, onOpenEmails, onRequireLogin }) {
  const isMobile = useIsMobile();
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const owner =
    String(session?.profile?.firstName || '').trim() ||
    String(session?.profile?.fullName || '').trim().split(/\s+/)[0] ||
    '';

  const [snapshot, setSnapshot] = useState(null);
  const [marks, setMarks] = useState({ done: {}, dismissed: {} });
  const [model, setModel] = useState(TASK_MODEL_OPTIONS[0].key);
  const [sources, setSources] = useState(defaultTaskSources);
  const [sourceDraft, setSourceDraft] = useState(defaultTaskSources);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState(''); // '' | 'mail' | 'ai'
  const [error, setError] = useState('');
  const [emptyReason, setEmptyReason] = useState(''); // '' | 'sources' | 'inbox' | 'none'
  const [filter, setFilter] = useState('open');
  const [expandedId, setExpandedId] = useState('');
  const [openTask, setOpenTask] = useState(null);
  const abortRef = useRef(null);
  const modelRef = useRef(model);
  const sourcesRef = useRef(sources);
  modelRef.current = model;
  sourcesRef.current = sources;

  const refresh = useCallback(async () => {
    if (!myId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const prefs = normalizeTaskSources(sourcesRef.current);
    setError('');
    setEmptyReason('');
    setPhase('mail');
    try {
      if (!prefs.email && !prefs.messages && !prefs.phone) {
        setEmptyReason('sources');
        setSnapshot(null);
        setPhase('');
        return;
      }
      const digest = await loadTaskDigest({
        sources: prefs,
        session,
        owner,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (digest.noInbox && prefs.email && !prefs.messages && !prefs.phone) {
        setEmptyReason('inbox');
        setSnapshot(null);
        setPhase('');
        return;
      }
      if (!digest.itemCount && digest.noInbox && !digest.threads.length && !digest.calls.length) {
        setEmptyReason(prefs.email && !digest.connected.length ? 'inbox' : 'none');
        setSnapshot({
          generatedAt: new Date().toISOString(),
          model: modelRef.current,
          summary: digest.noInbox
            ? 'Connect an inbox in Emails, or turn on another source.'
            : 'Nothing in the selected sources for this window.',
          accounts: digest.accounts,
          messageCount: 0,
          itemCount: 0,
          sources: prefs,
          tasks: [],
        });
        setPhase('');
        if (digest.sourceErrors.length) setError(digest.sourceErrors.join(' '));
        return;
      }
      setPhase('ai');
      const result = await extractTasks({
        digest,
        model: modelRef.current,
        owner,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (result.model && result.model !== modelRef.current) {
        setModel(result.model);
        modelRef.current = result.model;
        saveTasksModel(myId, result.model);
      }
      const failed = digest.inboxes.filter((inbox) => inbox.error);
      const next = {
        generatedAt: new Date().toISOString(),
        model: modelRef.current,
        summary: result.summary,
        accounts: digest.accounts,
        messageCount: digest.messageCount,
        itemCount: digest.itemCount,
        sources: prefs,
        tasks: result.tasks,
      };
      setSnapshot(next);
      saveTasksSnapshot(myId, next);
      setMarks((current) => {
        const pruned = pruneTasksState(current, next.tasks);
        saveTasksState(myId, pruned);
        return pruned;
      });
      const warnings = [...digest.sourceErrors];
      if (failed.length) {
        warnings.push(
          failed.length === digest.inboxes.length
            ? failed[0].error
            : `${failed.map((inbox) => taskAccountLabel(inbox.account)).join(', ')} did not load; email tasks come from the other inbox${digest.inboxes.length - failed.length === 1 ? '' : 'es'}.`,
        );
      }
      if (warnings.length) setError(warnings.join(' '));
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') return;
      setError(err?.message || 'Could not build your task list.');
    } finally {
      if (!controller.signal.aborted) setPhase('');
    }
  }, [myId, owner, session]);

  useEffect(() => {
    if (!myId) return undefined;
    let cancelled = false;
    (async () => {
      const [savedModel, savedSnapshot, savedMarks, savedSources] = await Promise.all([
        loadTasksModel(myId),
        loadTasksSnapshot(myId),
        loadTasksState(myId),
        loadTasksSources(myId),
      ]);
      if (cancelled) return;
      setModel(savedModel);
      modelRef.current = savedModel;
      setSources(savedSources);
      sourcesRef.current = savedSources;
      setSourceDraft(savedSources);
      setMarks(savedMarks);
      if (savedSnapshot) setSnapshot(savedSnapshot);
      setReady(true);
      const age = savedSnapshot?.generatedAt ? Date.now() - new Date(savedSnapshot.generatedAt).getTime() : Infinity;
      if (!savedSnapshot || !Number.isFinite(age) || age > STALE_AFTER_MS) refresh();
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [myId, refresh]);

  const changeModel = (key) => {
    setModel(key);
    modelRef.current = key;
    saveTasksModel(myId, key);
  };

  const openSources = () => {
    setSourceDraft(sources);
    setSourcesOpen(true);
  };

  const applySources = () => {
    const next = normalizeTaskSources(sourceDraft);
    setSourcesOpen(false);
    if (sourcesEqual(next, sources)) return;
    setSources(next);
    sourcesRef.current = next;
    saveTasksSources(myId, next);
    refresh();
  };

  const updateMarks = (updater) => {
    setMarks((current) => {
      const next = updater(current);
      saveTasksState(myId, next);
      return next;
    });
  };

  const toggleDone = (task) =>
    updateMarks((current) => {
      const done = { ...current.done };
      if (done[task.id]) delete done[task.id];
      else done[task.id] = new Date().toISOString();
      return { ...current, done };
    });

  const dismiss = (task) => {
    setExpandedId('');
    updateMarks((current) => ({
      ...current,
      dismissed: { ...current.dismissed, [task.id]: new Date().toISOString() },
    }));
  };

  const restoreDismissed = () =>
    updateMarks((current) => ({ ...current, dismissed: {} }));

  const tasks = useMemo(() => sortTasks(snapshot?.tasks || []), [snapshot]);
  const visibleTasks = useMemo(() => tasks.filter((task) => !marks.dismissed[task.id]), [tasks, marks.dismissed]);
  const openTasks = useMemo(() => visibleTasks.filter((task) => !marks.done[task.id]), [visibleTasks, marks.done]);
  const doneTasks = useMemo(() => visibleTasks.filter((task) => marks.done[task.id]), [visibleTasks, marks.done]);
  const dismissedCount = tasks.length - visibleTasks.length;
  const highCount = openTasks.filter((task) => task.priority === 'high').length;
  const showAccount = (snapshot?.accounts?.length || 0) > 1 || (snapshot?.tasks || []).some((task) => task.channel && task.channel !== 'email');
  const sourceCount = [sources.email, sources.messages, sources.phone].filter(Boolean).length;
  const list = filter === 'open' ? openTasks : filter === 'done' ? doneTasks : visibleTasks;
  const busy = Boolean(phase);

  if (!session?.token && !myId) {
    return (
      <View style={styles.centered}>
        <View style={styles.placeholderIcon}>
          <Ionicons name="checkbox-outline" size={30} color={ACCENT} />
        </View>
        <Text style={styles.emptyTitle}>Sign in to see your tasks</Text>
        <Text style={styles.emptyHint}>Tasks are read from the inboxes connected to your profile.</Text>
        {onRequireLogin ? (
          <Pressable style={styles.primaryButton} onPress={onRequireLogin}>
            <Text style={styles.primaryButtonText}>Go to Profile</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const subtitle = (() => {
    if (emptyReason === 'sources') return 'No sources selected';
    if (emptyReason === 'inbox') return 'No inbox connected yet';
    const parts = [formatSourcesSummary(snapshot?.sources || sources)];
    if (phase === 'mail') parts.push('Reading sources…');
    else if (phase === 'ai') parts.push('Finding what needs doing…');
    else if (snapshot?.generatedAt) parts.push(formatUpdatedAgo(snapshot.generatedAt));
    return parts.join(' · ');
  })();

  const renderBody = () => {
    if (!ready || (busy && !snapshot)) {
      return (
        <View style={styles.centeredInline}>
          <ActivityIndicator color={SECONDARY} />
          <Text style={styles.loadingText}>
            {phase === 'ai' ? 'Reading your sources for things to do…' : 'Loading the selected sources…'}
          </Text>
        </View>
      );
    }
    if (emptyReason === 'sources') {
      return (
        <View style={styles.centeredInline}>
          <View style={styles.placeholderIcon}>
            <Ionicons name="layers-outline" size={28} color={ACCENT} />
          </View>
          <Text style={styles.emptyTitle}>Turn on a source</Text>
          <Text style={styles.emptyHint}>
            Pick email, direct messages, or phone calls, and a rolling window. The AI only reads what you
            turn on.
          </Text>
          <Pressable style={styles.primaryButton} onPress={openSources}>
            <Text style={styles.primaryButtonText}>Sources</Text>
          </Pressable>
        </View>
      );
    }
    if (emptyReason === 'inbox') {
      return (
        <View style={styles.centeredInline}>
          <View style={styles.placeholderIcon}>
            <Ionicons name="mail-outline" size={28} color={ACCENT} />
          </View>
          <Text style={styles.emptyTitle}>Connect an inbox first</Text>
          <Text style={styles.emptyHint}>
            Email is on, but no Google inbox is connected. Connect one in Emails, or turn on messages or
            phone in Sources.
          </Text>
          <View style={styles.emptyActions}>
            {onOpenEmails ? (
              <Pressable style={styles.primaryButton} onPress={() => onOpenEmails(null)}>
                <Text style={styles.primaryButtonText}>Open Emails</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.secondaryButton} onPress={openSources}>
              <Text style={styles.secondaryButtonText}>Sources</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    if (!snapshot) {
      return (
        <View style={styles.centeredInline}>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyHint}>{error || 'Tap Refresh to read the selected sources.'}</Text>
          <Pressable style={styles.primaryButton} onPress={refresh}>
            <Text style={styles.primaryButtonText}>Refresh</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <>
        <View style={[styles.summaryCard, isMobile && styles.summaryCardMobile]}>
          <View style={styles.summaryCounts}>
            <View style={styles.countBlock}>
              <Text style={styles.countValue}>{openTasks.length}</Text>
              <Text style={styles.countLabel}>Open</Text>
            </View>
            <View style={styles.countBlock}>
              <Text style={[styles.countValue, highCount > 0 && styles.countValueHigh]}>{highCount}</Text>
              <Text style={styles.countLabel}>High</Text>
            </View>
            <View style={styles.countBlock}>
              <Text style={styles.countValue}>{doneTasks.length}</Text>
              <Text style={styles.countLabel}>Done</Text>
            </View>
          </View>
          {snapshot.summary ? <Text style={styles.summaryText}>{snapshot.summary}</Text> : null}
        </View>

        <View style={styles.filterRow}>
          <View style={styles.segmented}>
            {FILTERS.map((item) => {
              const active = filter === item.key;
              const count = item.key === 'open' ? openTasks.length : item.key === 'done' ? doneTasks.length : visibleTasks.length;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setFilter(item.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.segment, active && styles.segmentActive]}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {item.label}
                    {count ? ` ${count}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {dismissedCount > 0 ? (
            <Pressable onPress={restoreDismissed} accessibilityRole="button" style={styles.linkButton}>
              <Text style={styles.linkText}>
                Show {dismissedCount} dismissed
              </Text>
            </Pressable>
          ) : null}
        </View>

        {list.length === 0 ? (
          <View style={styles.centeredInline}>
            <Ionicons name={filter === 'done' ? 'checkmark-done-outline' : 'sunny-outline'} size={32} color="#c7c7cc" />
            <Text style={styles.emptyTitle}>
              {filter === 'done' ? 'Nothing marked done yet' : 'You are all caught up'}
            </Text>
            <Text style={styles.emptyHint}>
              {filter === 'done'
                ? 'Tick a task off and it moves here.'
                : 'Nothing in the selected sources is waiting on you. Refresh after new activity arrives.'}
            </Text>
          </View>
        ) : (
          <View style={styles.listBox}>
            {list.map((task, index) => (
              <View key={task.id}>
                {index > 0 ? <View style={styles.rowRule} /> : null}
                <TaskRow
                  task={task}
                  done={Boolean(marks.done[task.id])}
                  expanded={expandedId === task.id}
                  showAccount={showAccount}
                  onToggleDone={toggleDone}
                  onToggleExpand={(row) => setExpandedId((current) => (current === row.id ? '' : row.id))}
                  onDismiss={dismiss}
                  onOpen={setOpenTask}
                />
              </View>
            ))}
          </View>
        )}
      </>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.shell, isMobile && styles.shellMobile]}>
      <View style={styles.main}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, isMobile && styles.scrollContentMobile]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.head, isMobile && styles.headMobile]}>
          <View style={[styles.headRow, isMobile && styles.headRowMobile]}>
            <View style={styles.titleBlock}>
              <Text style={[styles.title, isMobile && styles.titleMobile]} numberOfLines={2}>
                Tasks
              </Text>
              <Text style={styles.subtitle} numberOfLines={2}>
                {subtitle}
              </Text>
            </View>
            <View style={styles.headActions}>
              <Chip
                icon="layers-outline"
                label={sourceCount ? `Sources · ${sourceCount}` : 'Sources'}
                onPress={openSources}
                disabled={!myId}
                accessibilityLabel="Choose sources and time frame"
              />
              <ModelPicker value={model} onChange={changeModel} disabled={busy} />
              <Chip
                icon={busy ? undefined : 'refresh-outline'}
                label={busy ? 'Working…' : 'Refresh'}
                onPress={refresh}
                disabled={busy || !myId}
              />
            </View>
          </View>
          <View
            style={styles.headRule}
            {...(Platform.OS === 'web' ? { className: 'cgold-home-row-rule' } : null)}
          />
        </View>
        {error && (snapshot || emptyReason) ? (
          <View style={[styles.errorBox, isMobile && styles.errorBoxMobile]}>
            <Ionicons name="alert-circle-outline" size={16} color="#B91C1C" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        <View style={[styles.content, isMobile && styles.contentMobile]}>{renderBody()}</View>
      </ScrollView>
      </View>
      {openTask && !isMobile ? (
        <TaskSourcePane
          key={openTask.id}
          task={openTask}
          session={session}
          isMobile={false}
          onClose={() => setOpenTask(null)}
        />
      ) : null}
      </View>
      {openTask && isMobile ? (
        <View style={styles.paneOverlay}>
          <Pressable style={styles.paneScrim} onPress={() => setOpenTask(null)} accessibilityLabel="Close source" />
          <View style={styles.paneSheet}>
            <TaskSourcePane
              key={openTask.id}
              task={openTask}
              session={session}
              isMobile
              onClose={() => setOpenTask(null)}
            />
          </View>
        </View>
      ) : null}
      <SourcesModal
        visible={sourcesOpen}
        draft={sourceDraft}
        onChange={setSourceDraft}
        onCancel={() => setSourcesOpen(false)}
        onApply={applySources}
        isMobile={isMobile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: CANVAS,
  },
  shell: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  shellMobile: {
    flexDirection: 'column',
  },
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  paneOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    zIndex: 40,
  },
  paneScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  paneSheet: {
    width: '88%',
    maxWidth: 440,
    height: '100%',
    backgroundColor: CANVAS,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 36,
  },
  scrollContentMobile: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  head: {
    marginBottom: 8,
    paddingTop: 20,
    paddingHorizontal: 48,
    zIndex: 20,
  },
  headMobile: {
    paddingHorizontal: 0,
    paddingTop: 8,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingBottom: 20,
  },
  headRowMobile: {
    alignItems: 'center',
    paddingBottom: 14,
  },
  headActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 0,
    zIndex: 30,
    maxWidth: '58%',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    paddingTop: 4,
    gap: 6,
  },
  title: {
    fontFamily: titleFontFamily,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '300',
    color: TEXT,
    letterSpacing: -0.3,
  },
  titleMobile: {
    fontSize: 20,
    lineHeight: 24,
  },
  subtitle: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    letterSpacing: -0.15,
  },
  headRule: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(42,38,30,0.16)',
    marginTop: 4,
    marginBottom: 4,
  },
  content: {
    paddingHorizontal: 48,
    gap: 14,
  },
  contentMobile: {
    paddingHorizontal: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  chipActive: {
    borderColor: ACCENT,
    backgroundColor: ACCENT_TINT,
  },
  chipHover: {
    backgroundColor: '#f0f0f2',
  },
  chipDisabled: {
    opacity: 0.55,
  },
  chipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.1,
  },
  chipTextActive: {
    color: ACCENT,
  },
  modelWrap: {
    position: 'relative',
    zIndex: 40,
  },
  modelMenu: {
    position: 'absolute',
    top: 38,
    right: 0,
    minWidth: 220,
    maxHeight: 360,
    ...Platform.select({ web: { overflow: 'auto' }, default: {} }),
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingVertical: 6,
    ...Platform.select({
      web: { boxShadow: '0 10px 30px rgba(0,0,0,0.12)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 14,
        elevation: 6,
      },
    }),
  },
  modelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  modelOptionHover: {
    backgroundColor: '#f5f5f7',
  },
  modelOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  modelOptionLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
  },
  modelOptionLabelActive: {
    color: ACCENT,
  },
  modelOptionTag: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginTop: 1,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 48,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
  },
  errorBoxMobile: {
    marginHorizontal: 0,
  },
  errorText: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#B91C1C',
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 16,
    ...CHIP_SHADOW,
  },
  summaryCardMobile: {
    flexDirection: 'column',
    gap: 14,
    paddingHorizontal: 16,
  },
  summaryCounts: {
    flexDirection: 'row',
    gap: 22,
    flexShrink: 0,
  },
  countBlock: {
    minWidth: 48,
  },
  countValue: {
    fontFamily: titleFontFamily,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '300',
    color: TEXT,
    letterSpacing: -0.6,
  },
  countValueHigh: {
    color: '#B91C1C',
  },
  countLabel: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  summaryText: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: TEXT,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: '#e8e8ed',
    borderRadius: 9,
    padding: 2,
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 7,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  segmentActive: {
    backgroundColor: '#fff',
    ...CHIP_SHADOW,
  },
  segmentText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
  },
  segmentTextActive: {
    color: TEXT,
  },
  linkButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  linkText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  listBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: '#fff',
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  rowRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: HAIRLINE,
    marginLeft: 56,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 12,
  },
  taskRowDone: {
    backgroundColor: '#fafafa',
  },
  checkWrap: {
    paddingTop: 1,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  taskBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  taskTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  taskTitle: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.15,
  },
  taskTitleDone: {
    color: SECONDARY,
    textDecorationLine: 'line-through',
  },
  priorityPill: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 1,
  },
  priorityText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  taskDetail: {
    fontFamily,
    fontSize: 14,
    lineHeight: 19,
    color: '#3a3a3c',
  },
  taskDetailDone: {
    color: SECONDARY,
  },
  taskMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 2,
  },
  taskMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    flexShrink: 1,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dueText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: ACCENT,
  },
  openHint: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: ACCENT,
  },
  handledNote: {
    fontFamily,
    fontSize: 12,
    color: '#6B7280',
    fontStyle: 'italic',
    marginTop: 2,
  },
  daysAgo: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginTop: 4,
  },
  daysAgoDone: {
    color: '#c7c7cc',
  },
  taskActions: {
    marginTop: 8,
    gap: 8,
  },
  taskSubject: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  taskActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
    backgroundColor: CANVAS,
  },
  centeredInline: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 8,
  },
  loadingText: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    marginTop: 8,
  },
  placeholderIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: ACCENT_TINT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'center',
  },
  emptyHint: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: SECONDARY,
    textAlign: 'center',
    maxWidth: 420,
  },
  primaryButton: {
    marginTop: 10,
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  primaryButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  secondaryButton: {
    marginTop: 10,
    backgroundColor: ACCENT_TINT,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  secondaryButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: ACCENT,
  },
  emptyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  sourceHint: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: SECONDARY,
    marginTop: 2,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalRootMobile: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  modalSheet: {
    width: 460,
    maxWidth: '100%',
    maxHeight: '86%',
    backgroundColor: '#F2F2F7',
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 16px 48px rgba(0,0,0,0.18)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 10,
      },
    }),
  },
  modalSheetMobile: {
    width: '100%',
    borderRadius: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxHeight: '92%',
  },
  modalNav: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
    backgroundColor: '#F2F2F7',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.18)',
  },
  modalNavSide: {
    minWidth: 72,
    minHeight: 44,
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  modalNavSideRight: {
    minWidth: 72,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 8,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  modalCancel: {
    fontFamily,
    fontSize: 17,
    color: '#007AFF',
    paddingLeft: 8,
  },
  modalTitle: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'center',
  },
  modalSave: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: ACCENT,
  },
  modalScroll: {
    maxHeight: 520,
  },
  modalScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
  },
  modalLead: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: SECONDARY,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  windowGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  windowChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9,
    backgroundColor: '#e8e8ed',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  windowChipActive: {
    backgroundColor: ACCENT,
  },
  windowChipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  windowChipTextActive: {
    color: '#fff',
  },
});
