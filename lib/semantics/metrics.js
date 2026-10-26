/**
 * The metrics registry: every number the assistants can report, defined
 * once. A metric names the fact it is computed from, how to aggregate the
 * fact rows in a bucket, how to print it, and which dimensions it supports.
 * The model never does this arithmetic; it asks for metrics by name and the
 * query engine (lib/metricsQuery.js) computes them.
 *
 * Fact rows are flat objects with the shared keys `store`, `date`
 * (YYYY-MM-DD, Toronto), and where the source has them `employee`,
 * `customer`, `docRef`. Everything else on a row is a measure.
 */

import { TICKET_LABEL_KEYS } from './ticketLabels';

/** Ticket-only dimensions: every label on the POS record (lib/semantics/ticketLabels.js). */
export const LABEL_DIMENSIONS = [...TICKET_LABEL_KEYS];
export const DIMENSIONS = ['date', 'week', 'month', 'weekday', 'store', 'employee', ...LABEL_DIMENSIONS, 'none'];
export const TIME_DIMENSIONS = new Set(['date', 'week', 'month']);

/** One row per real thing that happened, per source. */
export const FACTS = {
  tickets: {
    label: 'POS tickets',
    source: 'Aureus (orders and purchases records of East, GTA, and PMX / Richmond Hill)',
    grain: `one row per sale (SO) or purchase (PO) ticket, carrying every label on its record (${LABEL_DIMENSIONS.join(', ')})`,
    dimensions: ['date', 'week', 'month', 'weekday', 'store', 'employee', ...LABEL_DIMENSIONS, 'none'],
  },
  calls: {
    label: 'Phone calls',
    source: 'RingCentral',
    grain: 'one row per unique inbound call, with how it ended',
    dimensions: ['date', 'week', 'month', 'weekday', 'store', 'none'],
  },
  hours: {
    label: 'Hours worked',
    source: 'Rippling',
    grain: 'one row per punch (clock in to clock out)',
    dimensions: ['date', 'week', 'month', 'weekday', 'store', 'employee', 'none'],
    note: 'Rippling carries no store; store is the person\'s default store in the POS directory.',
  },
  bonuses: {
    label: 'Bonus payouts',
    source: 'Google reviews + POS',
    grain: 'one row per eligible review credited to an employee, dated the day the review was posted (a review naming two people is two half rows)',
    dimensions: ['date', 'week', 'month', 'weekday', 'store', 'employee', 'none'],
    note: 'The per-review rate comes from the store\'s email rate and negative-review count over the asked dates, as the Bonuses app computes it; days, weeks, and months add up to that range total. Pay figures follow the user\'s role: a non-manager sees only their own.',
  },
  reviews: {
    label: 'Google reviews',
    source: 'Google',
    grain: 'one row per Google review, dated the day it was posted',
    dimensions: ['date', 'week', 'month', 'weekday', 'store', 'none'],
  },
};

function sum(rows, field) {
  let total = 0;
  for (const row of rows) total += Number(row[field]) || 0;
  return total;
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

// Percent metrics are kept in percent units (0–100) so axes and tooltips read
// naturally; null means the denominator was zero.
function percent(numerator, denominator) {
  const value = ratio(numerator, denominator);
  return value == null ? null : value * 100;
}

/**
 * agg(rows, bucket) → number | null. `bucket.days` is the calendar days the
 * bucket covers inside the asked range. null means "no value", which the
 * renderers draw as a gap, never as zero.
 */
export const METRICS = {
  transactions: {
    fact: 'tickets',
    label: 'Transactions',
    format: 'int',
    description: 'Ticket count (SO + PO).',
    agg: (rows) => rows.length,
  },
  volume: {
    fact: 'tickets',
    label: 'Volume',
    format: 'money',
    description: 'Dollar total of tickets.',
    agg: (rows) => sum(rows, 'amount'),
  },
  buys: {
    fact: 'tickets',
    label: 'Buys',
    format: 'int',
    description: 'Purchase tickets (PO#).',
    agg: (rows) => rows.filter((row) => row.type === 'buy').length,
  },
  sells: {
    fact: 'tickets',
    label: 'Sells',
    format: 'int',
    description: 'Sale tickets (SO#).',
    agg: (rows) => rows.filter((row) => row.type === 'sell').length,
  },
  buyVolume: {
    fact: 'tickets',
    label: 'Buy volume',
    format: 'money',
    agg: (rows) => sum(rows.filter((row) => row.type === 'buy'), 'amount'),
  },
  sellVolume: {
    fact: 'tickets',
    label: 'Sell volume',
    format: 'money',
    agg: (rows) => sum(rows.filter((row) => row.type === 'sell'), 'amount'),
  },
  avgTicket: {
    fact: 'tickets',
    label: 'Avg ticket',
    format: 'money',
    description: 'Volume / transactions. null when there are no tickets.',
    agg: (rows) => ratio(sum(rows, 'amount'), rows.length),
  },
  transactionsPerDay: {
    fact: 'tickets',
    label: 'Transactions per day',
    format: 'decimal',
    description: 'Transactions / calendar days the bucket covers in range.',
    agg: (rows, bucket) => ratio(rows.length, bucket.days),
  },
  volumePerDay: {
    fact: 'tickets',
    label: 'Volume per day',
    format: 'money',
    agg: (rows, bucket) => ratio(sum(rows, 'amount'), bucket.days),
  },
  uniqueCustomers: {
    fact: 'tickets',
    label: 'Unique customers',
    format: 'int',
    agg: (rows) => new Set(rows.map((row) => row.customer).filter(Boolean)).size,
  },

  inboundCalls: {
    fact: 'calls',
    label: 'Inbound calls',
    format: 'int',
    agg: (rows) => rows.length,
  },
  answeredCalls: {
    fact: 'calls',
    label: 'Answered',
    format: 'int',
    description: 'First-ring answers plus later recoveries (callback or later answered inbound).',
    agg: (rows) => sum(rows, 'answered'),
  },
  firstRingAnswered: {
    fact: 'calls',
    label: 'Answered first ring',
    format: 'int',
    agg: (rows) => sum(rows, 'firstAnswered'),
  },
  missedCalls: {
    fact: 'calls',
    label: 'Still missed',
    format: 'int',
    description: 'Inbound calls never reached by callback or a later answered call.',
    agg: (rows) => sum(rows, 'stillMissed'),
  },
  voicemails: {
    fact: 'calls',
    label: 'Voicemail',
    format: 'int',
    agg: (rows) => sum(rows, 'voicemail'),
  },
  answerRate: {
    fact: 'calls',
    label: 'Answer rate',
    format: 'percent',
    description: 'answered / inbound, in percent. null when there were no inbound calls.',
    agg: (rows) => percent(sum(rows, 'answered'), rows.length),
  },
  firstRingRate: {
    fact: 'calls',
    label: 'First-ring rate',
    format: 'percent',
    description: 'first-ring answered / inbound, in percent. null when there were no inbound calls.',
    agg: (rows) => percent(sum(rows, 'firstAnswered'), rows.length),
  },

  hoursWorked: {
    fact: 'hours',
    label: 'Hours worked',
    format: 'hours',
    description: 'Punched hours (Rippling).',
    agg: (rows) => sum(rows, 'minutes') / 60,
  },
  shifts: {
    fact: 'hours',
    label: 'Shifts',
    format: 'int',
    description: 'Punch count.',
    agg: (rows) => rows.length,
  },
  staffOnDuty: {
    fact: 'hours',
    label: 'Staff on duty',
    format: 'int',
    description: 'Distinct people who punched in during the bucket.',
    agg: (rows) => new Set(rows.map((row) => row.employee).filter(Boolean)).size,
  },

  bonusPayout: {
    fact: 'bonuses',
    label: 'Bonus payout',
    format: 'money',
    description: 'Review bonus + photo bonus earned, placed on the day each review was posted.',
    agg: (rows) => sum(rows, 'payout'),
  },
  reviewBonus: {
    fact: 'bonuses',
    label: 'Review bonus',
    format: 'money',
    agg: (rows) => sum(rows, 'reviewBonus'),
  },
  photoBonus: {
    fact: 'bonuses',
    label: 'Photo bonus',
    format: 'money',
    agg: (rows) => sum(rows, 'photoBonus'),
  },
  bonusReviews: {
    fact: 'bonuses',
    label: 'Reviews credited',
    format: 'decimal',
    description: 'Eligible reviews credited for pay; a review shared by two people counts 0.5 each.',
    agg: (rows) => sum(rows, 'share'),
  },

  reviewsReceived: {
    fact: 'reviews',
    label: 'Reviews',
    format: 'int',
    description: 'Google reviews posted.',
    agg: (rows) => rows.length,
  },
  fiveStarReviews: {
    fact: 'reviews',
    label: '5-star reviews',
    format: 'int',
    agg: (rows) => rows.filter((row) => row.rating === 5).length,
  },
  negativeReviews: {
    fact: 'reviews',
    label: 'Negative reviews',
    format: 'int',
    description: '1- and 2-star reviews.',
    agg: (rows) => rows.filter((row) => row.rating > 0 && row.rating <= 2).length,
  },
  eligibleReviews: {
    fact: 'reviews',
    label: 'Bonus-eligible reviews',
    format: 'int',
    description: 'Reviews that qualify for the review bonus.',
    agg: (rows) => sum(rows, 'eligible'),
  },
  avgRating: {
    fact: 'reviews',
    label: 'Avg rating',
    format: 'decimal',
    description: 'Mean stars. null when no reviews were posted.',
    agg: (rows) => {
      const rated = rows.filter((row) => row.rating > 0);
      return ratio(sum(rated, 'rating'), rated.length);
    },
  },
};

export const METRIC_KEYS = Object.keys(METRICS);

/** Print one metric value. null is "—", never 0. */
export function formatMetricValue(value, format) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (format === 'percent') return `${n.toLocaleString('en-CA', { maximumFractionDigits: 1 })}%`;
  if (format === 'money') return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  if (format === 'hours') {
    const total = Math.max(0, Math.round(n * 60));
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (!hours) return `${mins}m`;
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  }
  if (format === 'decimal') return n.toLocaleString('en-CA', { maximumFractionDigits: 1 });
  return String(Math.round(n));
}

export function metricsForFact(fact) {
  return METRIC_KEYS.filter((key) => METRICS[key].fact === fact);
}

/** Which of the asked dimensions a metric cannot be grouped by. */
export function unsupportedDimensions(metricKey, dimensions) {
  const metric = METRICS[metricKey];
  if (!metric) return dimensions;
  const allowed = new Set(FACTS[metric.fact]?.dimensions || []);
  return (dimensions || []).filter((dim) => !allowed.has(dim));
}

/** The catalog text the model reads: metric key, what it is, and its grain. */
export function metricsCatalogText() {
  const lines = [];
  for (const [factKey, fact] of Object.entries(FACTS)) {
    const keys = metricsForFact(factKey);
    lines.push(
      `${fact.label} (${fact.source}; ${fact.grain}; group by ${fact.dimensions.join(', ')}${fact.note ? `; ${fact.note}` : ''}): ${keys
        .map((key) => {
          const metric = METRICS[key];
          return `${key}${metric.description ? ` = ${metric.description}` : ''}`;
        })
        .join('; ')}`,
    );
  }
  return lines.join('\n');
}
