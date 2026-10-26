import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { enterToSendProps } from '../lib/mobileUi';
import {
  DEFAULT_PERMISSIONS_AGENT_MODEL,
  PERMISSIONS_AGENT_MODELS,
  describeAgentContext,
  runPermissionsAgent,
} from '../lib/permissionsAgent';
import { Chip, FONT, T } from './TriageKit';

const THREAD_MAX_HEIGHT = 300;
const INPUT_LINE_HEIGHT = 20;
const INPUT_MAX_LINES = 5;

let turnSeq = 0;
function nextTurnId() {
  turnSeq += 1;
  return `t${Date.now().toString(36)}${turnSeq}`;
}

function suggestionsFor(context, personName) {
  if (context?.tab === 'roles') {
    return [
      'Hide revenue on Home for this role',
      'Block phone data in Analytics for this role',
      'This role should not open Bonuses',
    ];
  }
  if (personName) {
    return [
      `Hide revenue on Home for ${personName}`,
      `${personName} should not ask about hours in Analytics`,
      `Put ${personName} back on role defaults`,
    ];
  }
  return [
    'Branch Managers in Quebec should not see revenue on Home',
    'PMA and Branch Manager should not ask about phone data in Analytics',
    'Show me every rule',
  ];
}

function TurnBubble({ turn, compact }) {
  const mine = turn.role === 'user';
  return (
    <View style={[styles.turnRow, mine ? styles.turnRowMine : styles.turnRowTheirs]}>
      {mine ? null : (
        <View style={styles.turnMark}>
          <Ionicons name="sparkles" size={11} color="#fff" />
        </View>
      )}
      <View style={[styles.turnBody, compact && styles.turnBodyCompact]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, turn.error && styles.bubbleError]}>
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine, turn.error && styles.bubbleTextError]}>
            {turn.content}
          </Text>
        </View>
        {turn.changes?.length ? (
          <View style={styles.changeList}>
            {turn.changes.map((line, index) => (
              <View key={`${turn.id}-${index}`} style={styles.changeRow}>
                <Ionicons name="checkmark-circle" size={14} color={T.green} />
                <Text style={styles.changeText}>{line}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Chat for Settings → Permissions. Talks to lib/permissionsAgent.js; the
 * `store` adapter from PermissionsPanel does the saving so the matrix and the
 * person card update as the assistant works.
 *
 * `variant="rail"` fills a sidebar column. `variant="dock"` is the compact
 * strip used on a phone.
 */
export default function PermissionsAiChat({
  context,
  store,
  adminName,
  compact = false,
  disabled = false,
  variant = 'dock',
}) {
  const { height: windowHeight } = useWindowDimensions();
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(true);
  const [model, setModel] = useState(DEFAULT_PERMISSIONS_AGENT_MODEL);
  const [modelOpen, setModelOpen] = useState(false);
  const [inputHeight, setInputHeight] = useState(INPUT_LINE_HEIGHT);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const snapshot = store?.snapshot?.() || null;
  const contextLabel = describeAgentContext(context, snapshot);
  const personName = useMemo(() => {
    if (context?.tab !== 'people' || !context.personId) return '';
    const person = snapshot?.staffById?.get(context.personId);
    const first = String(person?.firstName || '').trim();
    return first || String(person?.fullName || '').trim().split(/\s+/)[0] || '';
  }, [context?.tab, context?.personId, snapshot]);
  const suggestions = useMemo(() => suggestionsFor(context, personName), [context, personName]);
  const modelLabel = PERMISSIONS_AGENT_MODELS.find((item) => item.key === model)?.label || model;
  const inputMaxHeight = INPUT_LINE_HEIGHT * INPUT_MAX_LINES;
  const rail = variant === 'rail';
  const threadMaxHeight = compact ? Math.max(180, Math.round(windowHeight * 0.38)) : THREAD_MAX_HEIGHT;
  const canSend = !busy && !disabled && Boolean(draft.trim()) && Boolean(store);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 40);
    return () => clearTimeout(handle);
  }, [turns, status, open]);

  const send = useCallback(
    async (text) => {
      const message = String(text ?? draft).trim();
      if (!message || busy || disabled || !store) return;
      const controller = new AbortController();
      abortRef.current = controller;
      const userTurn = { id: nextTurnId(), role: 'user', content: message };
      const history = turns;
      setTurns((current) => [...current, userTurn]);
      setDraft('');
      setInputHeight(INPUT_LINE_HEIGHT);
      setOpen(true);
      setBusy(true);
      setStatus('Reading the request…');
      try {
        const reply = await runPermissionsAgent({
          model,
          turns: history,
          message,
          context: contextRef.current,
          store,
          adminName,
          signal: controller.signal,
          onStatus: (note) => {
            if (mountedRef.current && abortRef.current === controller) setStatus(note);
          },
        });
        if (!mountedRef.current || controller.signal.aborted) return;
        setTurns((current) => [
          ...current,
          { id: nextTurnId(), role: 'assistant', content: reply.text, changes: reply.changes },
        ]);
      } catch (error) {
        if (!mountedRef.current) return;
        if (controller.signal.aborted || error?.name === 'AbortError') {
          setTurns((current) => [...current, { id: nextTurnId(), role: 'assistant', content: 'Stopped.', error: true }]);
        } else {
          setTurns((current) => [
            ...current,
            {
              id: nextTurnId(),
              role: 'assistant',
              content: error?.message || 'Something went wrong. Try again or pick another model.',
              error: true,
            },
          ]);
        }
      } finally {
        if (mountedRef.current && abortRef.current === controller) {
          abortRef.current = null;
          setBusy(false);
          setStatus('');
        }
      }
    },
    [adminName, busy, disabled, draft, model, store, turns],
  );

  const stop = () => {
    abortRef.current?.abort();
  };

  const clear = () => {
    if (busy) return;
    setTurns([]);
  };

  const contextIcon = context?.tab === 'roles' ? 'people-circle-outline' : 'person-circle-outline';

  const introCopy =
    context?.tab === 'roles'
      ? 'Say what this role should or should not see. Name a store to narrow it, for example “Branch Managers in Quebec”.'
      : personName
        ? `Say what ${personName} should or should not see, on Home or in the Analytics AI.`
        : 'Ask about a person, a role, or a store. Pick someone in the grid to talk about them.';

  const contextChip = (
    <View style={[styles.contextChip, rail && styles.contextChipRail]} accessibilityLabel={`Talking about ${contextLabel}`}>
      <Ionicons name={contextIcon} size={13} color={T.secondary} />
      <Text style={styles.contextChipText} numberOfLines={1}>
        {contextLabel}
      </Text>
    </View>
  );

  return (
    <View style={[styles.dock, compact && styles.dockCompact, rail && styles.rail]}>
      <View style={[styles.head, rail && styles.headRail]}>
        <View style={styles.titleRow}>
          <View style={styles.titleMark}>
            <Ionicons name="sparkles" size={12} color="#fff" />
          </View>
          <Text style={styles.title} numberOfLines={1}>
            Assistant
          </Text>
        </View>
        {rail ? contextChip : null}
        <View style={[styles.headTrail, rail && styles.headTrailRail]}>
          {rail ? null : contextChip}
          {turns.length ? (
            <>
              <Pressable
                onPress={clear}
                disabled={busy}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Clear conversation"
                style={[styles.headButton, busy && styles.headButtonOff]}
              >
                <Ionicons name="refresh-outline" size={15} color={T.secondary} />
              </Pressable>
              {rail ? null : (
                <Pressable
                  onPress={() => setOpen((value) => !value)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={open ? 'Collapse conversation' : 'Expand conversation'}
                  style={styles.headButton}
                >
                  <Ionicons name={open ? 'chevron-down' : 'chevron-up'} size={15} color={T.secondary} />
                </Pressable>
              )}
            </>
          ) : null}
        </View>
      </View>

      {turns.length === 0 ? (
        <View style={[styles.intro, rail && styles.introRail]}>
          <Text style={styles.introText}>{introCopy}</Text>
          <View style={styles.chipRow}>
            {suggestions.map((line) => (
              <Chip key={line} label={line} onPress={() => void send(line)} />
            ))}
          </View>
        </View>
      ) : open ? (
        <ScrollView
          ref={scrollRef}
          style={[styles.thread, rail ? styles.threadRail : { maxHeight: threadMaxHeight }]}
          contentContainerStyle={styles.threadContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {turns.map((turn) => (
            <TurnBubble key={turn.id} turn={turn} compact={compact} />
          ))}
          {busy ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={T.secondary} />
              <Text style={styles.statusText}>{status || 'Working…'}</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <Pressable onPress={() => setOpen(true)} style={styles.collapsedRow} accessibilityRole="button">
          <Text style={styles.collapsedText} numberOfLines={1}>
            {busy ? status || 'Working…' : turns[turns.length - 1]?.content || ''}
          </Text>
        </Pressable>
      )}

      {modelOpen ? (
        <View style={styles.chipRow}>
          {PERMISSIONS_AGENT_MODELS.map((item) => (
            <Chip
              key={item.key}
              label={item.label}
              selected={item.key === model}
              onPress={() => {
                setModel(item.key);
                setModelOpen(false);
              }}
            />
          ))}
        </View>
      ) : null}

      <View style={[styles.composer, disabled && styles.composerOff]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={disabled ? 'Loading permissions…' : 'Tell me what to change…'}
          placeholderTextColor={T.secondary}
          editable={!busy && !disabled}
          multiline
          scrollEnabled={inputHeight >= inputMaxHeight}
          onContentSizeChange={(event) => {
            const next = Math.ceil(event?.nativeEvent?.contentSize?.height || INPUT_LINE_HEIGHT);
            setInputHeight(Math.min(inputMaxHeight, Math.max(INPUT_LINE_HEIGHT, next)));
          }}
          style={[styles.input, { height: inputHeight, maxHeight: inputMaxHeight }]}
          accessibilityLabel="Message the permissions assistant"
          {...enterToSendProps(() => {
            if (canSend) void send();
          })}
        />
        <Pressable
          onPress={() => setModelOpen((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={`Model, ${modelLabel}`}
          style={styles.modelButton}
        >
          {compact ? (
            <Ionicons name="options-outline" size={16} color={T.secondary} />
          ) : (
            <>
              <Text style={styles.modelText} numberOfLines={1}>
                {modelLabel}
              </Text>
              <Ionicons name={modelOpen ? 'chevron-up' : 'chevron-down'} size={12} color={T.secondary} />
            </>
          )}
        </Pressable>
        <Pressable
          onPress={() => (busy ? stop() : void send())}
          disabled={!busy && !canSend}
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Stop' : 'Send'}
          style={[styles.sendButton, busy || canSend ? styles.sendButtonOn : styles.sendButtonOff]}
        >
          {busy ? <View style={styles.stopMark} /> : <Ionicons name="arrow-up" size={16} color="#fff" />}
        </Pressable>
      </View>
      {compact || rail ? null : (
        <Text style={styles.hint}>Enter to send · Shift+Enter for a new line · Changes save as they are applied</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    borderRadius: 12,
    backgroundColor: T.card,
    padding: 12,
    gap: 10,
  },
  dockCompact: {
    padding: 10,
    gap: 8,
    borderRadius: 12,
  },
  rail: {
    flex: 1,
    minHeight: 0,
    marginTop: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
    gap: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headRail: {
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  titleMark: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: T.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '700',
    color: T.text,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  headTrail: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minWidth: 0,
  },
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
    backgroundColor: '#f4f4f5',
    maxWidth: 240,
  },
  contextChipRail: {
    maxWidth: '100%',
  },
  headTrailRail: {
    flex: 0,
    marginLeft: 'auto',
  },
  contextChipText: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.text,
    flexShrink: 1,
  },
  headButton: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f4f5',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  headButtonOff: {
    opacity: 0.5,
  },
  intro: {
    gap: 8,
  },
  introRail: {
    flex: 1,
    minHeight: 0,
  },
  introText: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: T.secondary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  thread: {
    flexGrow: 0,
  },
  threadRail: {
    flex: 1,
    flexGrow: 1,
    minHeight: 0,
  },
  threadContent: {
    gap: 10,
    paddingVertical: 2,
  },
  turnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  turnRowMine: {
    justifyContent: 'flex-end',
  },
  turnRowTheirs: {
    justifyContent: 'flex-start',
  },
  turnMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: T.text,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    flexShrink: 0,
  },
  turnBody: {
    maxWidth: '84%',
    flexShrink: 1,
    gap: 6,
  },
  turnBodyCompact: {
    maxWidth: '90%',
  },
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...Platform.select({ web: { width: 'fit-content', maxWidth: '100%' }, default: {} }),
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: T.text,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#f4f4f5',
    borderBottomLeftRadius: 4,
  },
  bubbleError: {
    backgroundColor: '#FFF1F0',
  },
  bubbleText: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 20,
    color: T.text,
  },
  bubbleTextMine: {
    color: '#fff',
  },
  bubbleTextError: {
    color: '#B42318',
  },
  changeList: {
    alignSelf: 'flex-start',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    backgroundColor: T.card,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  changeText: {
    flexShrink: 1,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: T.text,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 30,
  },
  statusText: {
    fontFamily: FONT,
    fontSize: 12,
    color: T.secondary,
  },
  collapsedRow: {
    paddingVertical: 2,
  },
  collapsedText: {
    fontFamily: FONT,
    fontSize: 12,
    color: T.secondary,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    borderRadius: 10,
    backgroundColor: '#f6f6f9',
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
  },
  composerOff: {
    opacity: 0.6,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: INPUT_LINE_HEIGHT,
    paddingVertical: 4,
    paddingHorizontal: 0,
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: INPUT_LINE_HEIGHT,
    color: T.text,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: { outlineStyle: 'none', lineHeight: `${INPUT_LINE_HEIGHT}px`, resize: 'none' },
      default: {},
    }),
  },
  modelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minHeight: 30,
    paddingHorizontal: 8,
    borderRadius: 8,
    maxWidth: 150,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  modelText: {
    flexShrink: 1,
    fontFamily: FONT,
    fontSize: 12,
    color: T.secondary,
  },
  sendButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  sendButtonOn: {
    backgroundColor: T.text,
  },
  sendButtonOff: {
    backgroundColor: '#c7c7cc',
  },
  stopMark: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  hint: {
    fontFamily: FONT,
    fontSize: 11,
    color: T.secondary,
  },
});
