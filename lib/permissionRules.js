/**
 * Granular screen permissions. A rule hides (or shows again) one named part
 * of a screen for a role, one person, or everyone, optionally only for people
 * allocated to certain stores. Rules sit on top of app visibility: they trim
 * what a screen the person can already open displays, they never grant an app.
 *
 * Written from Settings → Permissions (mostly by the permissions assistant),
 * read by everyone at sign-in and resolved on the client with
 * resolveFeatureFlags(). System Admins are never affected.
 */
import { ANALYTICS_TOPICS } from './analyticsTopics';
import { getCategory, hasFullAppAccess, normalizeAppRole, USER_CATEGORY_KEYS } from './permissions';
import { HOME_PINNED_STORES, canonicalStoreName, storesMatch } from './storeCatalog';
import { getSupabase } from './supabase';

const TABLE = 'permission_rules';

export const RULE_TARGETS = ['role', 'user', 'everyone'];
export const RULE_EFFECTS = ['hide', 'show'];

/** Roles a rule may target. System Admin always sees everything. */
export const RULE_ROLE_KEYS = USER_CATEGORY_KEYS.filter((key) => key !== 'system_admin');

/**
 * Every part of a screen a rule can hide. `phrase` reads inside a sentence
 * ("Branch Managers can't see revenue on Home"). Add a feature here, then
 * gate the screen with useAppAccess().canSee(key). Analytics topics
 * (`analytics.*`, lib/analyticsTopics.js) are appended below; those are
 * enforced inside the AI tools rather than on a screen.
 */
const HOME_FEATURES = [
  {
    key: 'home.amounts',
    area: 'Home',
    label: 'Revenue on Home',
    phrase: 'revenue on Home',
    description:
      'Dollar totals on the Home store list: each store’s sales, purchases and total, the company total, the date hero, and sorting by amount. Transaction counts stay.',
    aliases: ['revenue', 'sales numbers', 'dollar amounts', 'money', 'totals', 'amounts'],
  },
  {
    key: 'home.transactionCounts',
    area: 'Home',
    label: 'Transaction counts on Home',
    phrase: 'transaction counts on Home',
    description: 'The “N transactions · N sales · N purchases” line on each store card.',
    aliases: ['transaction counts', 'ticket counts', 'number of transactions'],
  },
  {
    key: 'home.emailCapture',
    area: 'Home',
    label: 'Email capture on Home',
    phrase: 'email capture on Home',
    description: 'The email capture rate on each store card and its sort option.',
    aliases: ['email capture', 'email rate'],
  },
  {
    key: 'home.phoneAnswerRate',
    area: 'Home',
    label: 'Phone answer rate on Home',
    phrase: 'the phone answer rate on Home',
    description: 'The phone answer rate on each store card and its sort option.',
    aliases: ['phone answer rate', 'phone rate', 'answer rate', 'calls'],
  },
  {
    key: 'home.reviews',
    area: 'Home',
    label: 'Reviews on Home',
    phrase: 'reviews on Home',
    description: 'Google review counts and low-review marks on each store card and the Reviews sort option.',
    aliases: ['reviews', 'google reviews', 'stars'],
  },
  {
    key: 'home.people',
    area: 'Home',
    label: 'Staff faces on Home',
    phrase: 'staff faces on Home',
    description: 'Who is at each store (the row of avatars) on the store cards and the Staff sort option.',
    aliases: ['staff faces', 'avatars', 'who is working', 'people on home'],
  },
  {
    key: 'home.otherStores',
    area: 'Home',
    label: 'Other stores’ details from Home',
    phrase: 'other stores’ details from Home',
    description:
      'Opening a store other than their allocated one from the Home list. Their own store still opens. Only matters for people who can filter Home.',
    aliases: ['other stores', 'open other stores', 'other branches'],
  },
  {
    key: 'home.dateChange',
    area: 'Home',
    label: 'Changing the Home date',
    phrase: 'changing the Home date',
    description: 'The Today / Change / Range date controls on Home. When hidden, Home is locked to today.',
    aliases: ['date picker', 'change the date', 'date range', 'past days'],
  },
];

export const PERMISSION_FEATURES = [
  ...HOME_FEATURES,
  ...ANALYTICS_TOPICS.map((topic) => ({
    key: topic.key,
    area: 'Analytics',
    label: topic.label,
    phrase: topic.phrase,
    description: `${topic.description} Applies to the Analytics app, Dashboards, and Messages @ai: the assistant says their permissions do not include it.`,
    aliases: topic.aliases,
  })),
];

export const PERMISSION_FEATURE_KEYS = PERMISSION_FEATURES.map((feature) => feature.key);

const FEATURE_BY_KEY = new Map(PERMISSION_FEATURES.map((feature) => [feature.key, feature]));

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function featureByKey(key) {
  return FEATURE_BY_KEY.get(asString(key)) || null;
}

export function normalizeFeatureKey(value) {
  const key = asString(value);
  if (FEATURE_BY_KEY.has(key)) return key;
  const lower = key.toLowerCase();
  const byLabel = PERMISSION_FEATURES.find(
    (feature) =>
      feature.label.toLowerCase() === lower ||
      feature.phrase.toLowerCase() === lower ||
      feature.aliases.some((alias) => alias.toLowerCase() === lower),
  );
  return byLabel ? byLabel.key : '';
}

export function normalizeRuleTarget(value) {
  const key = asString(value).toLowerCase();
  if (key === 'person' || key === 'profile' || key === 'staff') return 'user';
  if (key === 'all' || key === 'anyone' || key === 'everybody') return 'everyone';
  return RULE_TARGETS.includes(key) ? key : '';
}

export function normalizeRuleEffect(value) {
  const key = asString(value).toLowerCase();
  if (key === 'deny' || key === 'block' || key === 'remove') return 'hide';
  if (key === 'allow' || key === 'grant' || key === 'restore') return 'show';
  return RULE_EFFECTS.includes(key) ? key : '';
}

/** Store names a rule may be limited to, as the Home list spells them. */
export function normalizeRuleStores(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set();
  const next = [];
  for (const item of list) {
    const canonical = canonicalStoreName(item);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    next.push(canonical);
  }
  return next;
}

export function knownStoreName(value) {
  const canonical = canonicalStoreName(value);
  if (!canonical) return '';
  return HOME_PINNED_STORES.find((name) => storesMatch(name, canonical)) || '';
}

/**
 * Validates a rule from the editor or the assistant. Returns { rule } or
 * { error } so callers can hand the message back to the model.
 */
export function sanitizeRule(input) {
  const target = normalizeRuleTarget(input?.target ?? input?.targetKind ?? input?.target_kind);
  if (!target) return { error: 'Rule target has to be role, user, or everyone.' };
  const feature = normalizeFeatureKey(input?.feature);
  if (!feature) {
    return {
      error: `Unknown feature. Use one of: ${PERMISSION_FEATURE_KEYS.join(', ')}.`,
    };
  }
  const effect = normalizeRuleEffect(input?.effect) || 'hide';
  const role = normalizeAppRole(input?.role);
  const userId = asString(input?.userId ?? input?.user_id);
  if (target === 'role') {
    if (!role) return { error: 'Choose a role for a role rule.' };
    if (role === 'system_admin') return { error: 'System Admin always sees everything; it cannot be restricted.' };
  }
  if (target === 'user' && !userId) return { error: 'Choose a person for a person rule.' };
  const unknownStores = (Array.isArray(input?.stores) ? input.stores : [])
    .map((name) => asString(name))
    .filter((name) => name && !knownStoreName(name));
  if (unknownStores.length) {
    return {
      error: `Unknown store${unknownStores.length === 1 ? '' : 's'}: ${unknownStores.join(', ')}. Stores: ${HOME_PINNED_STORES.join(', ')}.`,
    };
  }
  return {
    rule: {
      id: asString(input?.id) || undefined,
      target,
      role: target === 'role' ? role : '',
      userId: target === 'user' ? userId : '',
      stores: normalizeRuleStores(input?.stores),
      feature,
      effect,
      note: asString(input?.note).slice(0, 400),
    },
  };
}

function mapRuleRow(row) {
  if (!row?.id) return null;
  const target = normalizeRuleTarget(row.target_kind);
  const feature = normalizeFeatureKey(row.feature);
  if (!target || !feature) return null;
  return {
    id: String(row.id),
    target,
    role: normalizeAppRole(row.role),
    userId: asString(row.user_id),
    stores: normalizeRuleStores(row.stores),
    feature,
    effect: normalizeRuleEffect(row.effect) || 'hide',
    note: asString(row.note),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /permission_rules/i.test(message);
}

export const RULES_UNAVAILABLE_MESSAGE =
  'Granular rules need the permission_rules migration (npm run supabase:release). Apps and Analytics scopes still work.';

/**
 * Every rule the caller may read: role / everyone rules for anyone, own
 * person rules, and all rules for a System Admin. Fails open to no rules
 * (nothing extra hidden) with an error message for the editor.
 */
export async function loadPermissionRules() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, target_kind, role, user_id, stores, feature, effect, note, created_at, updated_at')
      .order('updated_at', { ascending: true });
    if (error) throw error;
    return { rules: (data || []).map(mapRuleRow).filter(Boolean), error: null, unavailable: false };
  } catch (error) {
    if (isMissingRelation(error)) {
      return { rules: [], error: RULES_UNAVAILABLE_MESSAGE, unavailable: true };
    }
    return { rules: [], error: error?.message || 'Could not load permission rules.', unavailable: false };
  }
}

export async function savePermissionRule(input, actorId) {
  const { rule, error } = sanitizeRule(input);
  if (error) throw new Error(error);
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const row = {
    target_kind: rule.target,
    role: rule.role || null,
    user_id: rule.userId || null,
    stores: rule.stores,
    feature: rule.feature,
    effect: rule.effect,
    note: rule.note,
    updated_at: now,
    updated_by: actorId || null,
  };
  const query = rule.id
    ? supabase.from(TABLE).update(row).eq('id', rule.id)
    : supabase.from(TABLE).insert({ ...row, created_by: actorId || null });
  const { data, error: saveError } = await query
    .select('id, target_kind, role, user_id, stores, feature, effect, note, created_at, updated_at')
    .maybeSingle();
  if (saveError) {
    if (isMissingRelation(saveError)) throw new Error(RULES_UNAVAILABLE_MESSAGE);
    throw saveError;
  }
  const mapped = mapRuleRow(data);
  if (!mapped) throw new Error('The rule was not saved. Only a System Admin can change rules.');
  return mapped;
}

/** Admin action from the editor or the assistant; the row is archived by the delete guardrails. */
export async function deletePermissionRule(id) {
  const key = asString(id);
  if (!key) throw new Error('Missing rule.');
  const supabase = getSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('id', key);
  if (error) {
    if (isMissingRelation(error)) throw new Error(RULES_UNAVAILABLE_MESSAGE);
    throw error;
  }
}

function profileStore(profile) {
  return asString(profile?.locationName || profile?.location_name);
}

function storesInclude(stores, storeName) {
  if (!Array.isArray(stores) || stores.length === 0) return true;
  if (!storeName) return false;
  return stores.some((name) => storesMatch(name, storeName));
}

/** Does this rule apply to this person right now? */
export function ruleAppliesToProfile(rule, profile) {
  if (!rule || !profile) return false;
  const role = normalizeAppRole(profile.appRole || profile.app_role) || 'precious_metal_analyst';
  const id = asString(profile.id);
  if (rule.target === 'user') {
    if (!id || rule.userId !== id) return false;
  } else if (rule.target === 'role') {
    if (rule.role !== role) return false;
  }
  return storesInclude(rule.stores, profileStore(profile));
}

// Narrower targets win: a person rule beats a role rule, a role rule limited
// to stores beats one for the whole role, and everyone-rules sit underneath.
function ruleSpecificity(rule) {
  const scoped = rule.stores?.length ? 1 : 0;
  if (rule.target === 'user') return 4 + scoped;
  if (rule.target === 'role') return 2 + scoped;
  return scoped;
}

export function rulesForProfile(rules, profile) {
  return (rules || [])
    .filter((rule) => ruleAppliesToProfile(rule, profile))
    .sort((a, b) => {
      const spec = ruleSpecificity(a) - ruleSpecificity(b);
      if (spec) return spec;
      return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
    });
}

/**
 * Hidden features for this person. Applied in order of specificity, so the
 * narrowest (and then newest) rule for a feature has the last word.
 */
export function resolveFeatureFlags(profile, rules) {
  const hidden = new Set();
  if (!profile || hasFullAppAccess(profile)) return { hidden };
  for (const rule of rulesForProfile(rules, profile)) {
    if (rule.effect === 'hide') hidden.add(rule.feature);
    else hidden.delete(rule.feature);
  }
  return { hidden };
}

export function featureVisible(flags, feature) {
  const key = asString(feature);
  if (!key || !flags?.hidden) return true;
  return !flags.hidden.has(key);
}

export function roleRulesFor(rules, role) {
  const key = normalizeAppRole(role);
  return (rules || []).filter(
    (rule) => rule.target === 'everyone' || (rule.target === 'role' && rule.role === key),
  );
}

function joinNames(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

function pluralRoleLabel(role) {
  const category = getCategory(role);
  if (!category) return 'That role';
  if (role === 'hr') return 'HR';
  return `${category.label}s`;
}

/** Plain-English line for a rule, e.g. “Branch Managers at Quebec can’t see revenue on Home.” */
export function describeRule(rule, { staffById } = {}) {
  if (!rule) return '';
  const feature = featureByKey(rule.feature);
  const what = feature?.phrase || rule.feature;
  let who;
  if (rule.target === 'user') {
    const person = staffById?.get?.(rule.userId) || staffById?.[rule.userId];
    who = person?.name || person?.fullName || 'This person';
  } else if (rule.target === 'role') {
    who = pluralRoleLabel(rule.role);
  } else {
    who = 'Everyone';
  }
  const where = rule.stores?.length ? ` at ${joinNames(rule.stores)}` : '';
  const verb = rule.effect === 'hide' ? 'can’t see' : 'can see';
  return `${who}${where} ${verb} ${what}.`;
}

export function rulesEqual(a, b) {
  return (
    a?.target === b?.target &&
    (a?.role || '') === (b?.role || '') &&
    (a?.userId || '') === (b?.userId || '') &&
    a?.feature === b?.feature &&
    a?.effect === b?.effect &&
    JSON.stringify(normalizeRuleStores(a?.stores)) === JSON.stringify(normalizeRuleStores(b?.stores))
  );
}
