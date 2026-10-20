import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const IDLE = {
  status: 'idle',
  progress: '',
  turns: [],
  messages: [],
  draft: '',
  error: '',
  label: '',
  context: null,
};

/**
 * State for one range review conversation. The transcript (`messages`) is the
 * saved context for that request: every follow-up is answered against it until
 * `run` starts a new review or `reset` clears it.
 */
export function useAuditRangeChat() {
  const [state, setState] = useState(IDLE);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = useCallback((next) => {
    setState((prev) => ({ ...prev, ...(typeof next === 'function' ? next(prev) : next) }));
  }, []);

  const setDraft = useCallback((draft) => patch({ draft }), [patch]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * analyze({ signal, onProgress, onDelta }) → { text, messages, context }
   */
  const run = useCallback(
    async (analyze, { label = '' } = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        ...IDLE,
        status: 'running',
        progress: 'Starting…',
        turns: [{ role: 'assistant', content: '' }],
        label,
      });

      try {
        const result = await analyze({
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted) patch({ progress });
          },
          onDelta: (_chunk, full) => {
            if (!controller.signal.aborted) patch({ turns: [{ role: 'assistant', content: full || '' }] });
          },
        });
        if (controller.signal.aborted) return null;
        patch({
          status: 'done',
          progress: '',
          turns: [{ role: 'assistant', content: result?.text || '' }],
          messages: result?.messages || [],
          context: result?.context || null,
        });
        return result;
      } catch (error) {
        if (controller.signal.aborted) {
          patch({ status: 'idle', progress: '', turns: [] });
          return null;
        }
        patch({
          status: 'error',
          progress: '',
          error: error?.message || 'Range review failed.',
          turns: [],
        });
        return null;
      }
    },
    [patch],
  );

  /**
   * continueChat({ messages, userMessage, signal, onDelta }) → { text, messages }
   */
  const send = useCallback(
    async (continueChat) => {
      const question = String(state.draft || '').trim();
      if (!question || state.status === 'running' || !state.messages.length) return null;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const baseMessages = state.messages;

      patch((prev) => ({
        status: 'running',
        progress: 'Replying…',
        error: '',
        draft: '',
        turns: [...prev.turns, { role: 'user', content: question }, { role: 'assistant', content: '' }],
      }));

      const replaceTail = (content) =>
        patch((prev) => {
          if (!prev.turns.length) return prev;
          const turns = prev.turns.slice();
          turns[turns.length - 1] = { role: 'assistant', content };
          return { turns };
        });

      try {
        const result = await continueChat({
          messages: baseMessages,
          userMessage: question,
          signal: controller.signal,
          onDelta: (_chunk, full) => {
            if (!controller.signal.aborted) replaceTail(full || '');
          },
        });
        if (controller.signal.aborted) return null;
        replaceTail(result?.text || '');
        patch({ status: 'done', progress: '', messages: result?.messages || baseMessages });
        return result;
      } catch (error) {
        if (controller.signal.aborted) {
          patch({ status: 'done', progress: '' });
          return null;
        }
        patch((prev) => {
          const last = prev.turns[prev.turns.length - 1];
          const turns =
            last?.role === 'assistant' && !String(last.content || '').trim() ? prev.turns.slice(0, -1) : prev.turns;
          return { status: 'error', progress: '', error: error?.message || 'Follow-up failed.', turns };
        });
        return null;
      }
    },
    [patch, state.draft, state.messages, state.status],
  );

  return useMemo(
    () => ({
      ...state,
      busy: state.status === 'running',
      hasContext: state.messages.length > 0,
      run,
      send,
      reset,
      stop,
      setDraft,
    }),
    [state, run, send, reset, stop, setDraft],
  );
}
