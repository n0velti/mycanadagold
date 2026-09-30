import { ensureLinkedPosSessions } from './auth';
import { reviewerCustomerMatchScore } from './bonuses';
import { posSourcesFromSession } from './transactions';
import { searchClients } from './triageLookups';

export function cleanReviewerName(author) {
  return String(author || '')
    .replace(/\(\s*usergoogle\d+\s*\)/gi, '')
    .replace(/\busergoogle\d+\b/gi, '')
    .trim();
}

export function isAnonymousReviewer(author) {
  const name = cleanReviewerName(author);
  return !name || /^(anonymous|google user|a google user)$/i.test(name);
}

function personKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function searchAcrossPos(session, query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const authed = await ensureLinkedPosSessions(session);
  const sources = posSourcesFromSession(authed);
  const batches = await Promise.all(
    sources.map(async (source) => {
      try {
        return await searchClients(source.token, q, source.baseUrl, source);
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set();
  const rows = [];
  for (const batch of batches) {
    for (const row of batch) {
      const key = `${row.systemKey || ''}:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

function pickUniqueMatch(rows, reviewerName) {
  const scored = (rows || [])
    .map((row) => ({ row, score: reviewerCustomerMatchScore(reviewerName, row.label) }))
    .filter((entry) => entry.score >= 80)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const best = scored[0].score;
  const top = scored.filter((entry) => entry.score === best);
  const people = new Set(top.map((entry) => personKey(entry.row.label)));
  if (people.size > 1) return null;
  return top[0].row;
}

function rowFromTransactionMatch(session, match) {
  const id = String(match?.customerId || '').trim();
  if (!id) return null;
  const sources = posSourcesFromSession(session);
  const source = sources.find((row) => row.key === match.systemKey) || sources[0];
  if (!source?.token) return null;
  return {
    id,
    label: match.customerName || 'Customer',
    systemKey: source.key,
    systemLabel: source.label,
    token: source.token,
    baseUrl: source.baseUrl,
  };
}

/** POS customer for a Google reviewer, or null when the name is missing or ambiguous. */
export async function findCustomerForReviewer(session, { author, transactionMatch } = {}) {
  const reviewer = cleanReviewerName(author);
  if (isAnonymousReviewer(reviewer)) return null;

  const authed = await ensureLinkedPosSessions(session);
  const fromTxn = rowFromTransactionMatch(authed, transactionMatch);
  if (fromTxn) return fromTxn;

  const queries = [];
  const named = String(transactionMatch?.customerName || '').trim();
  if (named) queries.push(named);
  queries.push(reviewer);
  const tokens = reviewer.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens[tokens.length - 1].length === 1) {
    queries.push(tokens[0]);
  }

  const seen = new Set();
  for (const query of queries) {
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = await searchAcrossPos(authed, query);
    const hit = pickUniqueMatch(rows, named || reviewer);
    if (hit) return hit;
  }
  return null;
}
