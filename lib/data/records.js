/**
 * Record loaders behind the `list_records` tool: the rows an app screen
 * shows, read from the same functions the screen uses and flattened to the
 * fields lib/semantics/records.js lists. Nothing is summarised; the caller
 * tabulates, charts, or exports the rows by resultId.
 *
 * Each loader takes the resolved scope (stores, YYYY-MM-DD dates) and the
 * tool's filters, and returns { rows, errors, notes, coveredStores }. Rows
 * that name a person pass through the viewer's AI scopes (hours,
 * compensation, employee performance) exactly as query_metrics does.
 */
import { listActionLogs } from '../actionLog';
import {
  employeeAllowedByScope,
  filterEmployeeRowsByScope,
  scopeRefusalReason,
  scopesFromSession,
} from '../aiScopes';
import { BONUS_ACCESS_DENIED } from '../auth';
import { bonusBoardAccessDenied, buildBonusBoard } from '../bonuses';
import { listTriageErrorFacts } from '../employeeMetrics';
import { listMonerisTransactions } from '../moneris';
import { ACTIONS, CATALOG, itemHaystack } from '../numismaticCatalog';
import { fetchAllPayments, fetchCashPayments, fetchDebitPayments } from '../payments';
import {
  fetchCallInsights,
  fetchPhoneHistory,
  fetchPhoneInbox,
  formatDuration,
  hasRecording,
  inboundCallsUnique,
  inboundOutcome,
  missedResolutionIndex,
  phoneHistoryNeeded,
  resolveMissedInbound,
  resultLabel,
  summarizeInsight,
} from '../phoneCalls';
import { formatPhoneNumber } from '../ringcentral';
import { collapseNestedShifts, fetchPunchesBetween, fetchShiftRolesBetween } from '../ripplingTime';
import { HOME_PINNED_STORES, canonicalStoreName, storesMatch } from '../storeCatalog';
import { listSupplies, supplyOrderMeta } from '../supplies';
import { fetchDashboardTransfers } from '../transfers';
import { formatDateParam, parseDateParam } from '../transactions';
import { recordKind } from '../semantics/records';
import {
  PHONE_STORES,
  canonicalStore,
  loadStaffDirectory,
  storeForPerson,
  storeIndexFromDirectory,
  storeInList,
  torontoDate,
} from './facts';

const TORONTO = 'America/Toronto';
const MAX_ROWS = 2000;
const PAYMENT_DAY_CONCURRENCY = 3;
const TRANSFER_MAX_PAGES = 4;
const LOG_PAGE = 200;
const LOG_MAX_PAGES = 5;

function asString(value) {
  return value == null ? '' : String(value).trim();
}

function fold(value) {
  return asString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function words(value) {
  return fold(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasWords(haystack, needles) {
  if (!needles.length) return true;
  const text = fold(haystack);
  return needles.every((needle) => text.includes(needle));
}

function digitsOf(value) {
  return asString(value).replace(/\D/g, '');
}

function torontoTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString('en-CA', { timeZone: TORONTO, hour: 'numeric', minute: '2-digit' });
}

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function eachDay(startDate, endDate) {
  const days = [];
  for (let cursor = parseDateParam(startDate); formatDateParam(cursor) <= endDate; cursor.setDate(cursor.getDate() + 1)) {
    days.push(formatDateParam(cursor));
  }
  return days;
}

async function mapPool(items, limit, mapper) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * A person filter the model passed ("employee") against the viewer's scope
 * for this kind of row, then the row set itself. Returns { rows } or
 * { refused } exactly as query_metrics does.
 */
function applyPersonScope(rows, kind, { employee, session }) {
  const scopeKey = kind?.scope;
  if (!scopeKey) return { rows };
  const scopes = scopesFromSession(session);
  const viewer = session?.profile;
  const scope = scopes[scopeKey];
  const wanted = words(employee);
  if (wanted.length) {
    const matched = rows.filter((row) => hasWords(row.employee, wanted));
    const subjectStore = matched[0]?.store;
    const allowed = employeeAllowedByScope({ scope, viewer, subjectName: asString(employee), subjectStore });
    if (!allowed) return { refused: { refused: true, reason: scopeRefusalReason(scope, scopeKey) } };
    return { rows: matched };
  }
  const scoped = filterEmployeeRowsByScope(rows, { scope, viewer });
  const note =
    scope === 'self'
      ? 'Rows are limited to the signed-in user; other people are omitted.'
      : scope === 'store'
        ? "Rows are limited to people at this user's store."
        : '';
  return { rows: scoped, note };
}

// ----------------------------------------------------------------- Phone

function phoneStoresFor(stores) {
  if (!stores?.length) return PHONE_STORES;
  const picked = PHONE_STORES.filter((name) => stores.some((wanted) => storesMatch(name, wanted)));
  return picked.length ? picked : stores.map(canonicalStore);
}

async function phonePayloads(stores, startDate, endDate, onProgress, label) {
  const dateFrom = parseDateParam(startDate);
  const dateTo = parseDateParam(endDate);
  dateTo.setDate(dateTo.getDate() + 1);
  const needHistory = phoneHistoryNeeded(startDate, endDate);
  const wanted = phoneStoresFor(stores);
  onProgress?.(`Reading ${label} for ${wanted.length} ${wanted.length === 1 ? 'store' : 'stores'}…`);
  const errors = [];
  const covered = [];
  const payloads = await Promise.all(
    wanted.map(async (store) => {
      try {
        const payload = needHistory ? await fetchPhoneHistory(store, { dateFrom, dateTo }) : await fetchPhoneInbox(store);
        covered.push(canonicalStore(store));
        return { store: canonicalStore(store), payload };
      } catch (error) {
        errors.push(`${store}: ${error?.message || 'phone log did not load'}`);
        return null;
      }
    }),
  );
  return { payloads: payloads.filter(Boolean), errors, covered, dateFrom, dateTo, stores: wanted.map(canonicalStore) };
}

function inWindow(value, dateFrom, dateTo) {
  const at = value ? new Date(value) : null;
  if (!at || !Number.isFinite(at.getTime())) return null;
  return at >= dateFrom && at < dateTo ? at : null;
}

function partyMatches(row, needle) {
  if (!needle) return true;
  const digits = digitsOf(needle);
  if (digits.length >= 3) return digitsOf(row.number).includes(digits) || digitsOf(row.to).includes(digits);
  return hasWords(`${row.name} ${row.number}`, words(needle));
}

async function loadCalls({ stores, startDate, endDate, direction, outcome, hasRecording: wantRecording, search, onProgress }) {
  const { payloads, errors, covered, dateFrom, dateTo } = await phonePayloads(stores, startDate, endDate, onProgress, 'calls');
  const rows = [];
  for (const { store, payload } of payloads) {
    const all = payload.calls || [];
    const index = missedResolutionIndex(all);
    // Inbound legs that rang several extensions are folded into one call, as
    // the Missed tab, the Ratio tab, and query_metrics count them.
    const inbound = inboundCallsUnique(all);
    const outbound = all.filter((call) => asString(call.direction) === 'Outbound');
    for (const call of [...inbound, ...outbound]) {
      const at = inWindow(call.startTime, dateFrom, dateTo);
      if (!at) continue;
      const isInbound = asString(call.direction) !== 'Outbound';
      const callOutcome = isInbound ? inboundOutcome(call.result, call.duration) : '';
      let recovered = '';
      if (isInbound && callOutcome !== 'answered') {
        const fix = resolveMissedInbound(call, all, index);
        recovered = fix ? (fix.kind === 'callback' ? 'callback' : 'answered later') : 'still missed';
      }
      rows.push({
        store,
        date: torontoDate(at),
        time: torontoTime(at),
        direction: isInbound ? 'Inbound' : 'Outbound',
        number: formatPhoneNumber(isInbound ? call.from : call.to),
        name: asString(isInbound ? call.fromName : call.toName),
        to: formatPhoneNumber(isInbound ? call.to : call.from),
        result: resultLabel(call.result) || (callOutcome ? callOutcome : ''),
        outcome: callOutcome,
        recovered,
        duration: formatDuration(call.duration),
        seconds: Number(call.duration) || 0,
        recording: hasRecording(call) ? 'Yes' : '',
        recordingId: asString(call.recordingId) || undefined,
        startTime: asString(call.startTime),
        id: asString(call.id),
      });
    }
  }
  const dir = asString(direction).toLowerCase();
  const want = asString(outcome).toLowerCase();
  const filtered = rows.filter((row) => {
    if (dir === 'inbound' && row.direction !== 'Inbound') return false;
    if (dir === 'outbound' && row.direction !== 'Outbound') return false;
    if (want && want !== 'all') {
      if (row.direction !== 'Inbound') return false;
      if (want === 'answered' && row.outcome !== 'answered') return false;
      if (want === 'missed' && row.outcome === 'answered') return false;
      if (want === 'stillmissed' && row.recovered !== 'still missed') return false;
      if (want === 'recovered' && !(row.recovered && row.recovered !== 'still missed')) return false;
      if (want === 'voicemail' && row.outcome !== 'voicemail') return false;
      if (want === 'rejected' && row.outcome !== 'rejected') return false;
    }
    if (wantRecording && row.recording !== 'Yes') return false;
    if (!partyMatches(row, search)) return false;
    return true;
  });
  const notes = [
    'Inbound calls are unique calls (a call that rang several extensions is one row), the same count as the Missed and Ratio tabs. outcome missed means not picked up on the first ring; recovered says whether we reached that number afterwards.',
  ];
  return { rows: filtered, errors, notes, coveredStores: covered };
}

async function loadVoicemails({ stores, startDate, endDate, status, search, onProgress }) {
  const { payloads, errors, covered, dateFrom, dateTo } = await phonePayloads(stores, startDate, endDate, onProgress, 'voicemail');
  const rows = [];
  for (const { store, payload } of payloads) {
    for (const mail of payload.voicemails || []) {
      const at = inWindow(mail.creationTime, dateFrom, dateTo);
      if (!at) continue;
      rows.push({
        store,
        date: torontoDate(at),
        time: torontoTime(at),
        number: formatPhoneNumber(mail.from),
        name: asString(mail.fromName),
        to: formatPhoneNumber(mail.to),
        duration: formatDuration(mail.duration),
        seconds: Number(mail.duration) || 0,
        read: /unread/i.test(asString(mail.readStatus)) ? 'Unread' : 'Read',
        subject: asString(mail.subject),
        startTime: asString(mail.creationTime),
        id: asString(mail.id),
      });
    }
  }
  const want = asString(status).toLowerCase();
  const filtered = rows.filter((row) => {
    if (want === 'unread' && row.read !== 'Unread') return false;
    if (want === 'read' && row.read !== 'Read') return false;
    return partyMatches(row, search);
  });
  return { rows: filtered, errors, notes: [], coveredStores: covered };
}

async function loadCallInsights({ stores, startDate, endDate, direction, status, search, onProgress }) {
  const wanted = phoneStoresFor(stores);
  onProgress?.('Reading call analyses…');
  const errors = [];
  const covered = [];
  const dateFrom = startDate ? parseDateParam(startDate) : null;
  const dateTo = endDate ? parseDateParam(endDate) : null;
  if (dateTo) dateTo.setDate(dateTo.getDate() + 1);
  const batches = await Promise.all(
    wanted.map(async (store) => {
      try {
        const result = await fetchCallInsights(store);
        covered.push(canonicalStore(store));
        if (result.aiError) errors.push(`${store}: ${result.aiError}`);
        return result.insights.map((insight) => ({ store: canonicalStore(store), insight }));
      } catch (error) {
        errors.push(`${store}: ${error?.message || 'analyses did not load'}`);
        return [];
      }
    }),
  );
  const rows = [];
  for (const { store, insight } of batches.flat()) {
    const at = insight.startTime ? new Date(insight.startTime) : null;
    if (dateFrom && dateTo && !(at && at >= dateFrom && at < dateTo)) continue;
    const isInbound = asString(insight.direction) !== 'Outbound';
    const view = summarizeInsight(insight);
    rows.push({
      store,
      date: at && Number.isFinite(at.getTime()) ? torontoDate(at) : '',
      time: at && Number.isFinite(at.getTime()) ? torontoTime(at) : '',
      direction: isInbound ? 'Inbound' : 'Outbound',
      number: formatPhoneNumber(isInbound ? insight.from : insight.to),
      name: asString(isInbound ? insight.fromName : insight.toName),
      duration: formatDuration(insight.duration),
      seconds: Number(insight.duration) || 0,
      status: insight.status,
      sentiment: view?.sentiment || '',
      summary: (view?.summary || insight.error || '').slice(0, 400),
      topics: (view?.topics || []).join(', '),
      startTime: asString(insight.startTime),
      id: insight.id,
    });
  }
  const dir = asString(direction).toLowerCase();
  const want = asString(status).toLowerCase();
  const needles = words(search);
  const filtered = rows.filter((row) => {
    if (dir === 'inbound' && row.direction !== 'Inbound') return false;
    if (dir === 'outbound' && row.direction !== 'Outbound') return false;
    if (want && want !== 'all' && row.status !== want) return false;
    if (!needles.length) return true;
    const digits = digitsOf(search);
    if (digits.length >= 3 && digitsOf(row.number).includes(digits)) return true;
    return hasWords(`${row.name} ${row.summary} ${row.topics} ${row.sentiment}`, needles);
  });
  return {
    rows: filtered,
    errors,
    notes: ['Only calls staff sent to RingCentral AI from the Recordings & AI tab have an analysis; a recorded call with no row here was never analysed.'],
    coveredStores: covered,
  };
}

// ---------------------------------------------------------------- People

async function loadShifts({ session, stores, startDate, endDate, employee, search, onProgress }) {
  onProgress?.('Reading the schedule…');
  const [shiftRows, directory] = await Promise.all([
    fetchShiftRolesBetween(startDate, endDate),
    loadStaffDirectory(session).catch(() => []),
  ]);
  const index = storeIndexFromDirectory(directory);
  const needles = words(search);
  const rows = [];
  for (const shift of collapseNestedShifts(shiftRows)) {
    const store = canonicalStore(shift.location) || storeForPerson(index, shift.name);
    if (stores?.length && !storeInList(store, stores)) continue;
    const row = {
      employee: shift.name,
      store,
      date: shift.date,
      start: asString(shift.startLabel) || (shift.start ? torontoTime(shift.start) : ''),
      end: asString(shift.endLabel) || (shift.end ? torontoTime(shift.end) : ''),
      role: shift.role || '',
      hours: round2((Number(shift.minutes) || 0) / 60),
      draft: shift.draft ? 'Yes' : '',
    };
    if (needles.length && !hasWords(`${row.employee} ${row.store} ${row.role}`, needles)) continue;
    rows.push(row);
  }
  const scoped = applyPersonScope(rows, recordKind('shifts'), { employee, session });
  if (scoped.refused) return scoped;
  return { rows: scoped.rows, errors: [], notes: scoped.note ? [scoped.note] : [], coveredStores: [] };
}

async function loadPunches({ session, stores, startDate, endDate, employee, search, onProgress }) {
  onProgress?.('Reading punches…');
  const [punches, directory] = await Promise.all([
    fetchPunchesBetween(startDate, endDate),
    loadStaffDirectory(session).catch(() => []),
  ]);
  const index = storeIndexFromDirectory(directory);
  const needles = words(search);
  const rows = [];
  let unmatched = 0;
  for (const punch of punches) {
    if (!punch.name) continue;
    const store = storeForPerson(index, punch.name);
    if (!store) unmatched += 1;
    if (stores?.length && !storeInList(store, stores)) continue;
    const row = {
      employee: punch.name,
      store,
      date: punch.date,
      clockIn: punch.start ? torontoTime(punch.start) : '',
      clockOut: punch.end ? torontoTime(punch.end) : '',
      hours: round2((Number(punch.minutes) || 0) / 60),
    };
    if (needles.length && !hasWords(`${row.employee} ${row.store}`, needles)) continue;
    rows.push(row);
  }
  const scoped = applyPersonScope(rows, recordKind('punches'), { employee, session });
  if (scoped.refused) return scoped;
  const notes = [];
  if (unmatched) notes.push(`${unmatched} punches belong to people with no default store in the POS directory (store is blank).`);
  if (scoped.note) notes.push(scoped.note);
  return { rows: scoped.rows, errors: [], notes, coveredStores: [] };
}

// ----------------------------------------------------------------- Money

function methodWanted(method) {
  const key = fold(method);
  if (!key || key === 'all' || key === 'any') return { kind: 'all', needles: [] };
  if (/^cash$/.test(key)) return { kind: 'cash', needles: [] };
  if (/^(debit|interac|eft)$/.test(key)) return { kind: 'debit', needles: [] };
  return { kind: 'words', needles: words(key) };
}

async function loadPayments({ session, stores, startDate, endDate, method, direction, minAmount, maxAmount, search, onProgress }) {
  const days = eachDay(startDate, endDate);
  const want = methodWanted(method);
  const storeName = stores?.length === 1 ? stores[0] : '';
  onProgress?.(`Reading payments for ${days.length} ${days.length === 1 ? 'day' : 'days'}…`);
  const errors = [];
  const batches = await mapPool(days, PAYMENT_DAY_CONCURRENCY, async (date) => {
    try {
      const loader = want.kind === 'cash' ? fetchCashPayments : want.kind === 'debit' ? fetchDebitPayments : fetchAllPayments;
      const result = await loader(session, { date, storeName });
      if (result.warning) errors.push(`${date}: ${result.warning}`);
      return result.rows || [];
    } catch (error) {
      errors.push(`${date}: ${error?.message || 'payments did not load'}`);
      return [];
    }
  });
  const dir = asString(direction).toLowerCase();
  const needles = words(search);
  const rows = [];
  for (const payment of batches.flat()) {
    const store = canonicalStoreName(payment.storeName) || payment.storeName || '—';
    if (stores?.length && !storeInList(store, stores)) continue;
    if (want.kind === 'words' && !hasWords(payment.paymentType, want.needles)) continue;
    if (dir === 'in' && payment.type !== 'In') continue;
    if (dir === 'out' && payment.type !== 'Out') continue;
    const amount = round2(payment.amount);
    if (minAmount != null && amount < minAmount) continue;
    if (maxAmount != null && amount > maxAmount) continue;
    if (needles.length && !hasWords(payment.searchText || `${payment.customerName} ${payment.reference} ${payment.title}`, needles)) continue;
    rows.push({
      date: payment.dateLabel || formatDateParam(parseDateParam(payment.date)),
      store,
      direction: payment.type,
      amount,
      currency: payment.currency || 'CAD',
      method: payment.paymentType || '—',
      till: payment.tillName && payment.tillName !== '—' ? payment.tillName : '',
      customer: payment.customerName && payment.customerName !== '—' ? payment.customerName : '',
      reference: payment.reference && payment.reference !== '—' ? payment.reference : '',
      title: payment.title || '',
      cheque: payment.checkNumber || '',
      status: payment.status || '',
      system: payment.systemLabel || '',
      id: payment.id,
    });
  }
  const notes = ['Cleared payments only, as the Accounting, Financials, and Debit ledgers show them. A ticket paid two ways is two payment rows.'];
  if (want.kind === 'cash') notes.push('Cash payments only (the Financials app).');
  if (want.kind === 'debit') notes.push('Debit, Interac, and EFT payments only (the Debit app ledger).');
  return { rows, errors, notes, coveredStores: [] };
}

async function loadMonerisReceipts({ stores, startDate, endDate, status, search, onProgress }) {
  const days = eachDay(startDate, endDate);
  const storeName = stores?.length === 1 ? stores[0] : '';
  onProgress?.('Reading terminal receipts…');
  const errors = [];
  let unavailable = false;
  const batches = await mapPool(days, PAYMENT_DAY_CONCURRENCY, async (date) => {
    try {
      const result = await listMonerisTransactions({ date, storeName });
      if (result.unavailable) unavailable = true;
      return result.rows || [];
    } catch (error) {
      errors.push(`${date}: ${error?.message || 'receipts did not load'}`);
      return [];
    }
  });
  const want = asString(status).toLowerCase();
  const needles = words(search);
  const rows = [];
  for (const receipt of batches.flat()) {
    const store = canonicalStoreName(receipt.storeName) || receipt.storeName || '—';
    if (stores?.length && !storeInList(store, stores)) continue;
    if (want === 'approved' && !receipt.approved) continue;
    if (want === 'declined' && receipt.approved) continue;
    if (needles.length && !hasWords(receipt.searchText, needles)) continue;
    rows.push({
      date: receipt.dateLabel || receipt.date,
      time: receipt.transactedAt ? torontoTime(receipt.transactedAt) : '',
      store,
      terminal: receipt.terminalId || '',
      action: receipt.action,
      amount: round2(receipt.amount),
      card: [receipt.cardType, receipt.cardLast4 ? `••••${receipt.cardLast4}` : ''].filter(Boolean).join(' '),
      approved: receipt.approved ? 'Yes' : 'No',
      orderId: receipt.orderId || '',
      authCode: receipt.authCode || '',
      id: receipt.id,
    });
  }
  const notes = unavailable ? ['Terminal receipts are not recorded on this project yet.'] : [];
  return { rows, errors, notes, coveredStores: [] };
}

// ---------------------------------------------------------------- Triage

async function loadTriageErrors({ session, stores, startDate, endDate, employee, search, minAmount, maxAmount, onProgress }) {
  onProgress?.('Reading triage errors…');
  const facts = await listTriageErrorFacts([], { startDate, endDate });
  const needles = words(search);
  const rows = [];
  for (const fact of facts || []) {
    const store = canonicalStore(fact.store);
    if (stores?.length && !storeInList(store, stores)) continue;
    const amount = round2(fact.amount);
    if (minAmount != null && amount < minAmount) continue;
    if (maxAmount != null && amount > maxAmount) continue;
    const row = {
      date: fact.date || '',
      store,
      employee: fact.employee || 'Unspecified',
      role: fact.role || '',
      errorType: fact.errorType || 'Unspecified',
      amount,
    };
    if (needles.length && !hasWords(`${row.errorType} ${row.employee} ${row.store}`, needles)) continue;
    rows.push(row);
  }
  const scoped = applyPersonScope(rows, recordKind('triageErrors'), { employee, session });
  if (scoped.refused) return scoped;
  return {
    rows: scoped.rows,
    errors: [],
    notes: ['amount is the dollar value staff recorded on the error (the Amount column in Triage), not the PO total.', ...(scoped.note ? [scoped.note] : [])],
    coveredStores: [],
  };
}

// --------------------------------------------------------------- Bonuses

function reviewDay(review) {
  const ts = Number(review?.timestampMs);
  if (Number.isFinite(ts) && ts > 0) return torontoDate(new Date(ts));
  if (review?.date instanceof Date) return torontoDate(review.date);
  return '';
}

async function loadBonusRows({ session, stores, startDate, endDate, employee, search, minAmount, loadTickets, onProgress }) {
  if (bonusBoardAccessDenied(session)) throw new Error(BONUS_ACCESS_DENIED);
  if (typeof loadTickets !== 'function') throw new Error('Ticket loader unavailable.');
  onProgress?.('Reading tickets for the bonus board…');
  const transactionRows = await loadTickets(startDate, endDate);
  onProgress?.('Reading Google reviews…');
  const board = await buildBonusBoard({
    session,
    transactionRows,
    startDate,
    endDate,
    storeFilter: stores?.length === 1 ? stores[0] : null,
  });
  const needles = words(search);
  const wanted = words(employee);
  const rows = [];
  const errors = [];
  const covered = [];
  for (const storeBoard of board.stores || []) {
    if (!storeBoard) continue;
    const store = canonicalStore(storeBoard.storeName);
    if (!store || !storeInList(store, stores)) continue;
    if (storeBoard.reviewsError) {
      errors.push(`${store}: ${storeBoard.reviewsError}`);
      continue;
    }
    covered.push(store);
    for (const person of storeBoard.employees || []) {
      const name = asString(person?.employeeName);
      if (!name || /^unassigned$/i.test(name)) continue;
      if (wanted.length && !hasWords(name, wanted)) continue;
      for (const review of person.reviews || []) {
        const date = reviewDay(review);
        if (!date || date < startDate || date > endDate) continue;
        const payout = round2(review.payout);
        if (minAmount != null && payout < minAmount) continue;
        const text = asString(review.text);
        if (needles.length && !hasWords(`${review.author || ''} ${text}`, needles)) continue;
        rows.push({
          date,
          store,
          employee: name,
          reviewer: asString(review.author),
          rating: Number(review.rating) || 0,
          photos: review.hasPhotos ? 'Yes' : '',
          attribution: asString(review.attributionSource),
          share: round2(review.share),
          reviewBonus: round2(review.reviewShare),
          photoBonus: round2(review.photoShare),
          payout,
          text: text.length > 200 ? `${text.slice(0, 199)}…` : text,
        });
      }
    }
  }
  const notes = [];
  if (board.selfOnly) notes.push('Only reviews credited to the signed-in user are included; other people are omitted.');
  else if (board.storeOnly) notes.push("Rows are limited to this user's store.");
  if (wanted.length && !rows.length && !board.selfOnly) notes.push(`No bonus credits for "${asString(employee)}" in this range.`);
  return { rows, errors, notes, coveredStores: covered };
}

// ------------------------------------------------------------- Transfers

async function loadTransfers({ session, stores, startDate, endDate, status, search, onProgress }) {
  if (!session?.token) throw new Error('Not signed in.');
  onProgress?.('Reading transfers…');
  const transfers = [];
  let warning = '';
  for (let page = 1; page <= TRANSFER_MAX_PAGES; page += 1) {
    const result = await fetchDashboardTransfers(session.token, { page, baseUrl: session.baseUrl });
    if (result.warning) warning = result.warning;
    if (!result.transfers.length) break;
    transfers.push(...result.transfers);
    // Pages come newest first; stop once the received list reaches past the range.
    const oldest = result.transfers
      .filter((row) => row.status !== 'pending')
      .map((row) => row.date)
      .filter(Boolean)
      .sort()[0];
    if (oldest && oldest < startDate) break;
    if (result.transfers.length < 100) break;
  }
  const want = asString(status).toLowerCase();
  const needles = words(search);
  const rows = [];
  const seen = new Set();
  for (const transfer of transfers) {
    if (transfer.id && seen.has(transfer.id)) continue;
    if (transfer.id) seen.add(transfer.id);
    if (transfer.date && (transfer.date < startDate || transfer.date > endDate)) continue;
    const from = canonicalStoreName(transfer.from?.name) || transfer.from?.name || '';
    const to = canonicalStoreName(transfer.to?.name) || transfer.to?.name || '';
    if (stores?.length && !stores.some((wanted) => storesMatch(from, wanted) || storesMatch(to, wanted))) continue;
    if (want && want !== 'all' && transfer.status !== want) continue;
    if (needles.length && !hasWords(transfer.searchText, needles)) continue;
    rows.push({
      reference: transfer.reference,
      date: transfer.date || '',
      status: transfer.status || '',
      from,
      to,
      items: (transfer.itemNames || []).slice(0, 4).join(', ').slice(0, 80),
      itemCount: transfer.itemCount || 0,
      totalQty: transfer.totalQty || 0,
      receivedQty: transfer.receivedQty || 0,
      receivedDate: transfer.receivedDate || '',
      createdBy: transfer.createdBy || '',
      receivedBy: transfer.receivedBy || '',
      tracking: transfer.tracking || '',
      mode: transfer.transferMode || '',
      id: transfer.id,
    });
  }
  return { rows, errors: warning ? [warning] : [], notes: ['Transfers of the primary POS (East); pending means in transit.'], coveredStores: [] };
}

// -------------------------------------------------------------- Supplies

async function loadSupplies({ stores, status, search, onProgress }) {
  const wanted = stores?.length ? stores : HOME_PINNED_STORES;
  onProgress?.('Reading supplies…');
  const errors = [];
  const batches = await mapPool(wanted, 4, async (store) => {
    try {
      return await listSupplies(store);
    } catch (error) {
      errors.push(`${store}: ${error?.message || 'supplies did not load'}`);
      return [];
    }
  });
  const want = asString(status).toLowerCase();
  const needles = words(search);
  const rows = [];
  for (const item of batches.flat()) {
    const orderMore = supplyOrderMeta(item.orderMore);
    if (want && /order|yes|low|need/.test(want) && item.orderMore === 'no') continue;
    if (needles.length && !hasWords(`${item.name} ${item.brand} ${item.category} ${item.notes}`, needles)) continue;
    rows.push({
      store: item.storeName,
      category: item.category,
      name: item.name,
      brand: item.brand,
      inUse: item.inUse,
      unopened: item.unopened,
      orderMore: orderMore?.label || item.orderMore,
      status: item.status,
      lastBought: item.lastBoughtDate || '',
      boughtFrom: item.boughtFrom,
      notes: item.notes,
      id: item.id,
    });
  }
  return { rows, errors, notes: ['Counts are what staff last entered in the Supplies app.'], coveredStores: [] };
}

// ------------------------------------------------------------------ Logs

async function loadActionLogs({ stores, startDate, endDate, employee, search, onProgress }) {
  onProgress?.('Reading the activity log…');
  const rows = [];
  const actorNeedles = words(employee);
  let beforeSeq = null;
  for (let page = 0; page < LOG_MAX_PAGES; page += 1) {
    const batch = await listActionLogs({ limit: LOG_PAGE, beforeSeq: beforeSeq ?? undefined, query: asString(search) || undefined });
    if (!batch.length) break;
    let reachedStart = false;
    for (const entry of batch) {
      const day = torontoDate(entry.clientTs || entry.createdAt);
      if (day && day < startDate) {
        reachedStart = true;
        continue;
      }
      if (day && day > endDate) continue;
      if (actorNeedles.length && !hasWords(`${entry.actorName} ${entry.actorLogin}`, actorNeedles)) continue;
      if (stores?.length && !storeInList(canonicalStore(entry.storeName), stores)) continue;
      rows.push({
        time: `${day} ${torontoTime(entry.clientTs || entry.createdAt)}`,
        date: day,
        actor: entry.actorName,
        role: entry.actorRole,
        action: entry.action,
        label: entry.label,
        app: entry.appLabel || entry.appKey,
        tab: entry.tab,
        store: canonicalStore(entry.storeName) || '',
        platform: entry.platform,
        seq: entry.seq,
      });
    }
    beforeSeq = batch[batch.length - 1]?.seq;
    if (reachedStart || batch.length < LOG_PAGE) break;
  }
  return { rows, errors: [], notes: ['Newest first; the log keeps every press in the app with who made it and where.'], coveredStores: [] };
}

// ------------------------------------------------------------ Numismatic

function loadNumismaticCatalog({ search }) {
  const needles = words(search);
  const rows = [];
  for (const item of CATALOG) {
    if (needles.length && !needles.every((needle) => itemHaystack(item).includes(needle))) continue;
    rows.push({
      tab: item.tab,
      group: item.group,
      name: item.name,
      years: item.years,
      composition: item.composition,
      metal: item.metal || '',
      action: ACTIONS[item.action]?.label || item.action,
      keyDates: (item.keyDates || []).join(', '),
      note: item.note || '',
      id: item.id,
    });
  }
  return { rows, errors: [], notes: ['Reference facts only (years, composition, floor action); no prices. A quote comes from numismatics, not from this list.'], coveredStores: [] };
}

const LOADERS = {
  calls: loadCalls,
  voicemails: loadVoicemails,
  callInsights: loadCallInsights,
  shifts: loadShifts,
  punches: loadPunches,
  payments: loadPayments,
  monerisReceipts: loadMonerisReceipts,
  triageErrors: loadTriageErrors,
  bonusRows: loadBonusRows,
  transfers: loadTransfers,
  supplies: loadSupplies,
  actionLogs: loadActionLogs,
  numismaticCatalog: loadNumismaticCatalog,
};

export function canListRecords(kind) {
  return typeof LOADERS[String(kind || '')] === 'function';
}

// Schedules and punches read in calendar order; everything else newest first.
const CHRONOLOGICAL_KINDS = new Set(['shifts', 'punches']);

function clockMinutes(value) {
  const match = /(\d{1,2}):(\d{2})\s*([ap])?/i.exec(asString(value));
  if (!match) return 0;
  let hours = Number(match[1]) % 12;
  if (match[3] && match[3].toLowerCase() === 'p') hours += 12;
  return hours * 60 + Number(match[2]);
}

function sortRows(rows, sortBy, kind) {
  const key = asString(sortBy).toLowerCase();
  const sorted = rows.slice();
  if (key === 'amount') return sorted.sort((a, b) => (Number(b.amount ?? b.payout) || 0) - (Number(a.amount ?? a.payout) || 0));
  if (key === 'duration') return sorted.sort((a, b) => (Number(b.seconds) || 0) - (Number(a.seconds) || 0));
  if (key === 'name') return sorted.sort((a, b) => String(a.employee || a.name || a.actor || '').localeCompare(String(b.employee || b.name || b.actor || '')));
  if (CHRONOLOGICAL_KINDS.has(kind)) {
    return sorted.sort(
      (a, b) =>
        String(a.date || '').localeCompare(String(b.date || '')) ||
        clockMinutes(a.start || a.clockIn) - clockMinutes(b.start || b.clockIn) ||
        String(a.employee || '').localeCompare(String(b.employee || '')),
    );
  }
  return sorted.sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    if (byDate) return byDate;
    if (a.startTime || b.startTime) return String(b.startTime || '').localeCompare(String(a.startTime || ''));
    return clockMinutes(b.time) - clockMinutes(a.time);
  });
}

/**
 * Load one kind of record. `args` carries the resolved scope and filters;
 * `context` the session, a ticket loader (bonus rows need the ledger), and
 * progress/abort hooks. Rows come back newest first unless sortBy says
 * otherwise, capped so a long range stays drawable.
 */
export async function loadRecords(kind, args = {}, context = {}) {
  const loader = LOADERS[String(kind || '')];
  if (!loader) throw new Error(`Unknown record kind: ${kind}`);
  const result = await loader({ ...args, session: context.session, loadTickets: context.loadTickets, onProgress: context.onProgress });
  if (context.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  if (result.refused) return result;
  const sorted = sortRows(result.rows || [], args.sortBy, String(kind || ''));
  const capped = sorted.slice(0, MAX_ROWS);
  const notes = [...(result.notes || [])];
  if (sorted.length > capped.length) notes.push(`${sorted.length} rows matched; the first ${capped.length} are kept. Narrow the dates or stores for the rest.`);
  return { ...result, rows: capped, total: sorted.length, notes };
}
