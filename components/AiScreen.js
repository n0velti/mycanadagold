import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import {
  AI_CHAT_APPS,
  prepareAiChatSession,
  sendAiChatMessage,
  titleAiChat,
} from '../lib/aiChat';
import { saveAiDmChat } from '../lib/messages';
import { peekInventoryMatrix, fetchInventoryMatrix } from '../lib/inventory';
import { useAppAccess } from '../lib/permissions';
import {
  formatModelReleased,
  getModelMeta,
  OPENROUTER_MODELS,
} from '../lib/openrouter';
import {
  defaultDateRange,
  formatDateParam,
  formatPickerDate,
  parseDateParam,
} from '../lib/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#6B4DE6';
const MODEL_OPTIONS = OPENROUTER_MODELS;
const DEFAULT_MODEL =
  MODEL_OPTIONS.find((model) => model.key === 'anthropic/claude-sonnet-5')?.key ||
  MODEL_OPTIONS[0].key;
const ALL_LOCATIONS = '';
const DEFAULT_APPS = [];

function inlineRuns(text) {
  const value = String(text || '').replace(/^\s{0,3}#{1,3}\s+/, '');
  const runs = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match = re.exec(value);
  while (match) {
    if (match.index > last) runs.push({ text: value.slice(last, match.index), strong: false });
    runs.push({ text: match[1], strong: true });
    last = match.index + match[0].length;
    match = re.exec(value);
  }
  if (last < value.length) runs.push({ text: value.slice(last), strong: false });
  return runs.length ? runs : [{ text: value, strong: false }];
}

function AssistantBody({ text }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let list = null;

  const flushList = () => {
    if (!list) return;
    blocks.push(list);
    list = null;
  };

  for (const line of lines) {
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      if (!list) list = { type: 'list', items: [] };
      list.items.push(bullet[1]);
      continue;
    }
    flushList();
    if (!line.trim()) {
      if (blocks.length && blocks[blocks.length - 1].type !== 'gap') {
        blocks.push({ type: 'gap' });
      }
      continue;
    }
    blocks.push({ type: 'p', text: line.trim() });
  }
  flushList();

  return (
    <View style={styles.answer}>
      {blocks.map((block, index) => {
        if (block.type === 'gap') return <View key={`gap-${index}`} style={styles.answerGap} />;
        if (block.type === 'list') {
          return (
            <View key={`list-${index}`} style={styles.answerList}>
              {block.items.map((item, itemIndex) => (
                <View key={`item-${itemIndex}`} style={styles.answerRow}>
                  <Text style={styles.answerBullet}>•</Text>
                  <Text style={styles.answerItem}>
                    {inlineRuns(item).map((run, runIndex) =>
                      run.strong ? (
                        <Text key={runIndex} style={styles.bubbleStrong}>
                          {run.text}
                        </Text>
                      ) : (
                        run.text
                      ),
                    )}
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={`p-${index}`} style={styles.bubbleText}>
            {inlineRuns(block.text).map((run, runIndex) =>
              run.strong ? (
                <Text key={runIndex} style={styles.bubbleStrong}>
                  {run.text}
                </Text>
              ) : (
                run.text
              ),
            )}
          </Text>
        );
      })}
    </View>
  );
}

function modelOptionMetaLine(option) {
  const parts = [];
  if (option.provider) parts.push(option.provider);
  parts.push(`Speed: ${option.speed}`);
  parts.push(`Accuracy: ${option.accuracy}`);
  if (option.released) parts.push(`Released ${formatModelReleased(option.released)}`);
  return parts.join('  ·  ');
}

function DateChip({ label, value, onChange, minimumDate, maximumDate }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (minimumDate && date < parseDateParam(minimumDate)) {
      date = parseDateParam(minimumDate);
    }
    if (maximumDate && date > parseDateParam(maximumDate)) {
      date = parseDateParam(maximumDate);
    }
    onChange(date);
  };

  if (Platform.OS === 'web') {
    return (
      <View style={styles.dateChip}>
        <Text style={styles.dateChipLabel}>{label}</Text>
        <View style={styles.dateChipControl}>
          <Ionicons name="calendar-outline" size={14} color="#6b6b6b" />
          {createElement('input', {
            type: 'date',
            value: formatDateParam(dateValue),
            min: minimumDate ? formatDateParam(minimumDate) : undefined,
            max: maximumDate ? formatDateParam(maximumDate) : undefined,
            onChange: (event) => {
              if (event.target.value) commit(event.target.value);
            },
            style: {
              border: 'none',
              background: 'transparent',
              fontFamily,
              fontSize: 13,
              color: '#1a1a1a',
              padding: 0,
              margin: 0,
              outline: 'none',
              cursor: 'pointer',
              minWidth: 118,
            },
          })}
        </View>
      </View>
    );
  }

  return (
    <>
      <Pressable style={styles.dateChip} onPress={() => setOpen(true)}>
        <Text style={styles.dateChipLabel}>{label}</Text>
        <View style={styles.dateChipControl}>
          <Ionicons name="calendar-outline" size={14} color="#6b6b6b" />
          <Text style={styles.dateChipValue}>{formatPickerDate(dateValue)}</Text>
        </View>
      </Pressable>

      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
          maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) commit(selected);
          }}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.dateModalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.dateModalCard}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.dateModalTitle}>{label}</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.dateModalDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
                maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
                onChange={(_, selected) => {
                  if (selected) commit(selected);
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function FilterDropdown({
  value,
  meta,
  open,
  onToggle,
  children,
  accessibilityLabel,
}) {
  return (
    <View style={styles.dropdownWrap}>
      <Pressable
        style={[styles.dropdown, open && styles.dropdownOpen]}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <View style={styles.dropdownMain}>
          <Text style={styles.dropdownValue} numberOfLines={1}>
            {value}
          </Text>
          {meta ? (
            <Text style={styles.dropdownMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color="#8a8a8a" />
      </Pressable>
      {open ? <View style={styles.dropdownMenu}>{children}</View> : null}
    </View>
  );
}

export default function AiScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
}) {
  const { width } = useWindowDimensions();
  const stacked = width < 900 || embedded;
  const lockedStore = Boolean(storeFilter);
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('ai');
  const chatScrollRef = useRef(null);
  const chatAbortRef = useRef(null);
  const turnsRef = useRef([]);
  const modelRef = useRef(model);
  const archivedKeyRef = useRef('');

  const [startDate, setStartDate] = useState(() => defaultDateRange(7).startDate);
  const [endDate, setEndDate] = useState(() => defaultDateRange(7).endDate);
  const [selectedApps, setSelectedApps] = useState(DEFAULT_APPS);
  const [locationName, setLocationName] = useState(storeFilter || ALL_LOCATIONS);
  const [locations, setLocations] = useState([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);

  const [ingestStatus, setIngestStatus] = useState('idle');
  const [ingestProgress, setIngestProgress] = useState('');
  const [ingestSummaries, setIngestSummaries] = useState([]);
  const [ingestError, setIngestError] = useState('');
  const [seedMessages, setSeedMessages] = useState([]);
  const [chatContext, setChatContext] = useState(null);
  const [lookupLabel, setLookupLabel] = useState('');

  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');

  const modelMeta = getModelMeta(model, MODEL_OPTIONS) || MODEL_OPTIONS[0];
  turnsRef.current = turns;
  modelRef.current = model;

  const archiveChat = useCallback(async (snapshot) => {
    const usable = (snapshot || []).filter(
      (turn) =>
        (turn?.role === 'user' || turn?.role === 'assistant') && String(turn.content || '').trim(),
    );
    if (!usable.some((turn) => turn.role === 'user')) return;
    const key = usable.map((turn) => `${turn.role}:${turn.content}`).join('\n');
    if (archivedKeyRef.current === key) return;
    archivedKeyRef.current = key;
    try {
      const title = await titleAiChat(usable, modelRef.current);
      await saveAiDmChat(title, usable);
    } catch {
      if (archivedKeyRef.current === key) archivedKeyRef.current = '';
    }
  }, []);

  useEffect(() => {
    return () => {
      void archiveChat(turnsRef.current);
    };
  }, [archiveChat]);
  const selectedAppMeta = AI_CHAT_APPS.filter((app) => selectedApps.includes(app.key));
  const companyMode = selectedApps.length === 0;
  const appsSummary = companyMode
    ? 'Company overview'
    : selectedAppMeta.length === 1
      ? selectedAppMeta[0].label
      : `${selectedAppMeta.length} apps`;
  const locationLabel = locationName || 'All locations';
  const canSend =
    Boolean(String(draft || '').trim()) &&
    !chatBusy &&
    ingestStatus === 'ready' &&
    seedMessages.length > 0;

  useEffect(() => {
    if (storeFilter) setLocationName(storeFilter);
  }, [storeFilter]);

  useEffect(() => {
    let cancelled = false;
    if (!session?.token) {
      setLocations([]);
      return undefined;
    }

    const cached = peekInventoryMatrix(session);
    if (cached?.stores?.length) {
      const names = [...new Set(cached.stores.map((store) => store.name).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }),
      );
      setLocations(names);
    }

    fetchInventoryMatrix(session)
      .then((matrix) => {
        if (cancelled) return;
        const names = [...new Set((matrix.stores || []).map((store) => store.name).filter(Boolean))].sort(
          (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }),
        );
        setLocations(names);
      })
      .catch(() => {
        if (!cancelled && !cached?.stores?.length) setLocations([]);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  const toggleApp = (key) => {
    setSelectedApps((current) => {
      if (current.includes(key)) {
        return current.filter((entry) => entry !== key);
      }
      return [...current, key];
    });
  };

  const ingestKey = `${selectedApps.slice().sort().join(',')}|${startDate}|${endDate}|${locationName}`;

  useEffect(() => {
    if (!session?.token) {
      setIngestStatus('idle');
      setSeedMessages([]);
      setChatContext(null);
      setIngestSummaries([]);
      setTurns([]);
      return;
    }

    void archiveChat(turnsRef.current);
    const prepared = prepareAiChatSession({
      apps: selectedApps,
      startDate,
      endDate,
      locationName: locationName || undefined,
    });
    setSeedMessages(prepared.seedMessages);
    setChatContext(prepared.context);
    setIngestSummaries(prepared.summaries);
    setIngestStatus('ready');
    setIngestProgress('');
    setIngestError('');
    setTurns([]);
    setChatError('');
  }, [session, ingestKey, selectedApps, startDate, endDate, locationName, archiveChat]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    const handle = setTimeout(() => {
      chatScrollRef.current?.scrollToEnd?.({ animated: true });
    }, 40);
    return () => clearTimeout(handle);
  }, [turns, chatBusy]);

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
    };
  }, []);

  const send = useCallback(async () => {
    const question = String(draft || '').trim();
    if (!question || chatBusy || ingestStatus !== 'ready') return;

    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;

    const prior = turns;
    setDraft('');
    setChatError('');
    setChatBusy(true);
    setTurns([...prior, { role: 'user', content: question }, { role: 'assistant', content: '' }]);

    try {
      const result = await sendAiChatMessage({
        seedMessages,
        turns: prior,
        userMessage: question,
        model,
        signal: controller.signal,
        session,
        context: chatContext,
        startDate,
        endDate,
        locationName,
        onLookup: (label) => {
          if (!controller.signal.aborted) setLookupLabel(label || '');
        },
        onDelta: (full) => {
          setLookupLabel('');
          setTurns([...prior, { role: 'user', content: question }, { role: 'assistant', content: full }]);
        },
      });
      if (controller.signal.aborted) return;
      setTurns(result.turns);
      if (result.sources?.length) {
        setChatContext((current) =>
          current ? { ...current, lastSources: result.sources } : current,
        );
      }
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      setChatError(error?.message || 'Chat failed.');
      setTurns(prior);
      setDraft(question);
    } finally {
      if (chatAbortRef.current === controller) {
        setChatBusy(false);
        setLookupLabel('');
      }
    }
  }, [draft, chatBusy, ingestStatus, turns, seedMessages, model, session, chatContext, startDate, endDate, locationName]);

  const clearChat = () => {
    chatAbortRef.current?.abort();
    void archiveChat(turns);
    setTurns([]);
    setChatError('');
    setChatBusy(false);
    setDraft('');
  };

  if (!session?.token) {
    return (
      <View style={[styles.screen, embedded && styles.screenEmbedded]}>
        <Text style={styles.hint}>
          Sign in to chat over store data.{' '}
          {onRequireLogin ? (
            <Text style={styles.link} onPress={onRequireLogin}>
              Go to Profile
            </Text>
          ) : null}
        </Text>
      </View>
    );
  }

  const placeholder =
    ingestStatus === 'ready'
      ? companyMode
        ? locationName
          ? `Ask how ${locationName} is doing…`
          : 'Ask about the company…'
        : locationName
          ? `Ask about ${appsSummary.toLowerCase()} in ${locationName}…`
          : `Ask about ${appsSummary.toLowerCase()}…`
      : 'Waiting for data…';

  return (
    <View style={[styles.screen, embedded && styles.screenEmbedded]}>
      <View style={[styles.layout, stacked && styles.layoutStacked]}>
        <View style={[styles.chatPane, stacked && styles.chatPaneStacked]}>
          <View style={styles.chatHeader}>
            <View style={styles.chatHeaderCopy}>
              <Text style={styles.heading}>MyCanadaGold AI</Text>
              <Text style={styles.subheading} numberOfLines={2}>
                {ingestStatus === 'loading'
                  ? ingestProgress || 'Ingesting selected data…'
                  : ingestStatus === 'ready'
                    ? `Using ${modelMeta?.label || 'model'} · ${locationLabel} · ${formatPickerDate(startDate)} – ${formatPickerDate(endDate)}`
                    : 'Ask a question to load data'}
              </Text>
            </View>
            {turns.length > 0 ? (
              <Pressable style={styles.clearChat} onPress={clearChat} hitSlop={8}>
                <Text style={styles.clearChatLabel}>New chat</Text>
              </Pressable>
            ) : null}
          </View>

          {ingestSummaries.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.summaryRow}
              style={styles.summaryStrip}
            >
              {ingestSummaries.map((entry) => (
                <View key={entry.key} style={styles.summaryChip}>
                  <Text style={styles.summaryChipLabel}>{entry.label}</Text>
                  {entry.detail ? (
                    <Text style={styles.summaryChipDetail}>{entry.detail}</Text>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          ) : null}

          {ingestError ? <Text style={styles.warnText}>{ingestError}</Text> : null}

          <ScrollView
            ref={chatScrollRef}
            style={styles.transcript}
            contentContainerStyle={styles.transcriptContent}
            showsVerticalScrollIndicator={false}
          >
            {turns.length === 0 ? (
              <View style={styles.emptyChat}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="sparkles-outline" size={22} color={ACCENT} />
                </View>
                <Text style={styles.emptyTitle}>
                  {ingestStatus === 'ready'
                    ? companyMode
                      ? 'Ready'
                      : 'Context loaded'
                    : 'Loading context…'}
                </Text>
                <Text style={styles.emptyBody}>
                  {ingestStatus === 'ready'
                    ? companyMode
                      ? 'Ask about tills, sales, stock, staff, or prices. Only that data is loaded, then the answer comes back as a short list.'
                      : `Try “Are there any gold maples in ${locationName || 'Montreal'}?” then keep talking.`
                    : 'Ready when you ask.'}
                </Text>
              </View>
            ) : (
              turns.map((turn, index) => {
                const isUser = turn.role === 'user';
                const isStreamingTail =
                  chatBusy && !isUser && index === turns.length - 1 && !String(turn.content || '').trim();
                return (
                  <View
                    key={`${turn.role}-${index}`}
                    style={[
                      styles.bubble,
                      isUser ? styles.bubbleUser : styles.bubbleAssistant,
                    ]}
                  >
                    <Text style={[styles.bubbleRole, isUser && styles.bubbleRoleUser]}>
                      {isUser ? 'You' : 'MyCanadaGold AI'}
                    </Text>
                    {isUser ? (
                      <Text style={[styles.bubbleText, styles.bubbleTextUser]}>
                        {turn.content}
                      </Text>
                    ) : turn.content ? (
                      <AssistantBody text={turn.content} />
                    ) : (
                      <Text style={styles.bubbleText}>
                        {isStreamingTail ? lookupLabel || '…' : ''}
                      </Text>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>

          {chatError ? <Text style={styles.errorText}>{chatError}</Text> : null}

          <View style={styles.composer}>
            <TextInput
              style={styles.composerInput}
              value={draft}
              onChangeText={setDraft}
              placeholder={placeholder}
              placeholderTextColor="#b0b0b0"
              editable={!chatBusy && ingestStatus === 'ready'}
              multiline={false}
              numberOfLines={1}
              returnKeyType="send"
              blurOnSubmit
              onSubmitEditing={() => {
                if (canSend) void send();
              }}
              onKeyPress={(event) => {
                const key = event?.nativeEvent?.key || event?.key;
                if (key === 'Enter') {
                  event.preventDefault?.();
                  if (canSend) void send();
                }
              }}
            />
            <Pressable
              style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
              onPress={() => void send()}
              disabled={!canSend}
              accessibilityLabel="Send message"
            >
              {chatBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={16} color="#fff" />
              )}
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={[styles.sidePane, stacked && styles.sidePaneStacked]}
          contentContainerStyle={styles.sidePaneContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.settingsGroup}>
            <Text style={styles.groupTitle}>Model</Text>
            <FilterDropdown
              value={modelMeta?.label ?? 'Select model'}
              meta={modelMeta ? modelOptionMetaLine(modelMeta) : ''}
              open={modelMenuOpen}
              onToggle={() => {
                setModelMenuOpen((open) => !open);
                setLocationMenuOpen(false);
              }}
              accessibilityLabel="Select AI model"
            >
              <ScrollView style={styles.menuScroll} nestedScrollEnabled>
                {MODEL_OPTIONS.map((option) => {
                  const active = option.key === model;
                  return (
                    <Pressable
                      key={option.key}
                      style={[styles.menuOption, active && styles.menuOptionActive]}
                      onPress={() => {
                        setModel(option.key);
                        setModelMenuOpen(false);
                      }}
                    >
                      <View style={styles.menuOptionCopy}>
                        <View style={styles.menuOptionHeader}>
                          <Text
                            style={[styles.menuOptionText, active && styles.menuOptionTextActive]}
                          >
                            {option.label}
                          </Text>
                          {active ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
                        </View>
                        <Text style={styles.menuOptionStats}>{modelOptionMetaLine(option)}</Text>
                        {option.blurb ? (
                          <Text style={styles.menuOptionBlurb}>{option.blurb}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </FilterDropdown>
          </View>

          <View style={styles.settingsGroup}>
            <Text style={styles.groupTitle}>Date</Text>
            <View style={styles.dateRow}>
              <DateChip
                label="From"
                value={startDate}
                maximumDate={parseDateParam(endDate)}
                onChange={(date) => setStartDate(formatDateParam(date))}
              />
              <DateChip
                label="To"
                value={endDate}
                minimumDate={parseDateParam(startDate)}
                maximumDate={new Date()}
                onChange={(date) => setEndDate(formatDateParam(date))}
              />
            </View>
            {selectedAppMeta.length > 0 && selectedAppMeta.every((app) => !app.usesDate) ? (
              <Text style={styles.helpText}>
                The selected apps are live snapshots, so the date range is unused until you add Transactions, Financials, Audit, FINTRAC, or 100 Ways.
              </Text>
            ) : null}
          </View>

          <View style={styles.settingsGroup}>
            <View style={styles.appsHeader}>
              <Text style={styles.groupTitle}>Apps</Text>
              {selectedApps.length > 0 ? (
                <Pressable onPress={() => setSelectedApps([])} hitSlop={8}>
                  <Text style={styles.clearAppsLabel}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.appList}>
              <Pressable
                style={[styles.appRow, companyMode && styles.appRowActive]}
                onPress={() => setSelectedApps([])}
              >
                <Ionicons
                  name="business-outline"
                  size={16}
                  color={companyMode ? ACCENT : '#8a8a8a'}
                />
                <Text
                  style={[styles.appRowLabel, companyMode && styles.appRowLabelActive]}
                  numberOfLines={1}
                >
                  None · company overview
                </Text>
                {companyMode ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
              </Pressable>
              <ScrollView style={styles.appListScroll} nestedScrollEnabled>
                {AI_CHAT_APPS.map((app) => {
                  const active = selectedApps.includes(app.key);
                  return (
                    <Pressable
                      key={app.key}
                      style={[styles.appRow, active && styles.appRowActive]}
                      onPress={() => toggleApp(app.key)}
                    >
                      <Ionicons
                        name={app.icon}
                        size={16}
                        color={active ? ACCENT : '#8a8a8a'}
                      />
                      <Text
                        style={[styles.appRowLabel, active && styles.appRowLabelActive]}
                        numberOfLines={1}
                      >
                        {app.label}
                      </Text>
                      {active ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <Text style={styles.helpText}>
              {companyMode
                ? 'Nothing loads until you ask. Each question pulls only the datasets it needs.'
                : `${appsSummary} selected. A question still loads only the data it needs.`}
            </Text>
          </View>

          <View style={styles.settingsGroup}>
            <Text style={styles.groupTitle}>Location</Text>
            {lockedStore || !allowFilters ? (
              <View style={styles.lockedLocation}>
                <Ionicons name="location-outline" size={16} color={ACCENT} />
                <Text style={styles.lockedLocationLabel}>{locationLabel}</Text>
              </View>
            ) : (
              <FilterDropdown
                value={locationLabel}
                meta={locations.length ? `${locations.length} stores` : 'From inventory'}
                open={locationMenuOpen}
                onToggle={() => {
                  setLocationMenuOpen((open) => !open);
                  setModelMenuOpen(false);
                }}
                accessibilityLabel="Select location"
              >
                <ScrollView style={styles.menuScroll} nestedScrollEnabled>
                  <Pressable
                    style={[styles.menuOption, !locationName && styles.menuOptionActive]}
                    onPress={() => {
                      setLocationName(ALL_LOCATIONS);
                      setLocationMenuOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.menuOptionText,
                        !locationName && styles.menuOptionTextActive,
                      ]}
                    >
                      All locations
                    </Text>
                    {!locationName ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
                  </Pressable>
                  {locations.map((name) => {
                    const active = namesEqual(name, locationName);
                    return (
                      <Pressable
                        key={name}
                        style={[styles.menuOption, active && styles.menuOptionActive]}
                        onPress={() => {
                          setLocationName(name);
                          setLocationMenuOpen(false);
                        }}
                      >
                        <Text
                          style={[styles.menuOptionText, active && styles.menuOptionTextActive]}
                        >
                          {name}
                        </Text>
                        {active ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </FilterDropdown>
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function namesEqual(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    marginTop: 8,
  },
  screenEmbedded: {
    marginTop: 0,
  },
  hint: {
    fontFamily,
    fontSize: 14,
    color: '#6b6b6b',
    marginTop: 12,
  },
  link: {
    color: ACCENT,
    fontWeight: '600',
  },
  layout: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 28,
  },
  layoutStacked: {
    flexDirection: 'column',
    gap: 16,
  },
  chatPane: {
    flex: 1.5,
    minWidth: 0,
    minHeight: 0,
    gap: 10,
  },
  chatPaneStacked: {
    width: '100%',
    flex: 1,
    minHeight: 320,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  chatHeaderCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  heading: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.4,
  },
  subheading: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#8a8a8a',
  },
  clearChat: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  clearChatLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  summaryStrip: {
    maxHeight: 40,
  },
  summaryRow: {
    gap: 8,
    alignItems: 'center',
    paddingVertical: 2,
  },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F3EEFF',
  },
  summaryChipLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: ACCENT,
  },
  summaryChipDetail: {
    fontFamily,
    fontSize: 12,
    color: '#6b5bb0',
  },
  warnText: {
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    color: '#9a6700',
  },
  transcript: {
    flex: 1,
    minHeight: 0,
  },
  transcriptContent: {
    gap: 10,
    paddingBottom: 8,
    flexGrow: 1,
  },
  emptyChat: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 24,
    maxWidth: 420,
  },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3EEFF',
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  emptyBody: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: '#6b6b6b',
  },
  bubble: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 4,
    maxWidth: '92%',
  },
  bubbleAssistant: {
    borderColor: '#E8E4F5',
    backgroundColor: '#F7F5FC',
    alignSelf: 'flex-start',
  },
  bubbleUser: {
    borderColor: '#DDD6F5',
    backgroundColor: '#EFEAFA',
    alignSelf: 'flex-end',
  },
  bubbleRole: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: ACCENT,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  bubbleRoleUser: {
    color: '#4c3d8a',
  },
  bubbleText: {
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    color: '#1a1a1a',
  },
  answerItem: {
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    color: '#1a1a1a',
    flex: 1,
  },
  bubbleStrong: {
    fontFamily,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  answer: {
    gap: 2,
  },
  answerGap: {
    height: 8,
  },
  answerList: {
    gap: 4,
  },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  answerBullet: {
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    color: ACCENT,
    width: 12,
  },
  bubbleTextUser: {
    color: '#1a1a1a',
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#b91c1c',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
    paddingTop: 12,
  },
  composerInput: {
    flex: 1,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 0,
    fontFamily,
    fontSize: 15,
    color: '#1a1a1a',
    backgroundColor: '#f7f7f7',
    outlineStyle: 'none',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sidePane: {
    flex: 0.85,
    minWidth: 260,
    maxWidth: 340,
    minHeight: 0,
  },
  sidePaneStacked: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    flexGrow: 0,
    flexShrink: 0,
  },
  sidePaneContent: {
    gap: 20,
    paddingBottom: 24,
  },
  settingsGroup: {
    gap: 8,
  },
  groupTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8a8a8a',
    letterSpacing: -0.1,
  },
  dateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dateChip: {
    flexGrow: 1,
    minWidth: 140,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f7f7f7',
    gap: 4,
  },
  dateChipLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  dateChipControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateChipValue: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  dateModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  dateModalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dateModalTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  dateModalDone: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  appsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  clearAppsLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  appList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  appListScroll: {
    maxHeight: 280,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f0f0f0',
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  appRowActive: {
    backgroundColor: '#F7F5FC',
  },
  appRowLabel: {
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
    flex: 1,
  },
  appRowLabelActive: {
    fontWeight: '600',
    color: ACCENT,
  },
  helpText: {
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    color: '#8a8a8a',
  },
  lockedLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f7f7f7',
  },
  lockedLocationLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  dropdownWrap: {
    position: 'relative',
    zIndex: 5,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f7f7f7',
  },
  dropdownOpen: {
    borderColor: '#d0d0d0',
    backgroundColor: '#fff',
  },
  dropdownMain: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  dropdownValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1a1a1a',
    letterSpacing: -0.2,
  },
  dropdownMeta: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
  dropdownMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 6,
    maxHeight: 280,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    zIndex: 20,
  },
  menuScroll: {
    maxHeight: 280,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  menuOptionActive: {
    backgroundColor: '#f7f7f7',
  },
  menuOptionCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  menuOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  menuOptionText: {
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
    flex: 1,
  },
  menuOptionTextActive: {
    fontWeight: '600',
    color: ACCENT,
  },
  menuOptionStats: {
    fontFamily,
    fontSize: 11,
    color: '#6b6b6b',
  },
  menuOptionBlurb: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    lineHeight: 15,
  },
});
