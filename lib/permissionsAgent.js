/**
 * Permissions assistant for Settings → Permissions. A System Admin says what
 * should change ("Branch Managers in Quebec shouldn't see revenue on Home",
 * "let Sarah filter Transactions", "PMA hours scope to self") and the model
 * acts through tools against a `store` the panel implements, so every write
 * goes through the same lib/permissions.js and lib/permissionRules.js calls
 * the buttons use, and the panel's state updates as the tools run.
 *
 * The model never writes rows itself: it picks a tool, this module validates
 * the arguments against the role, app, feature, and store catalogs, and the
 * store saves. Anything unclear comes back as a question, not a guess.
 */
import {
  AI_SCOPE_CAPABILITIES,
  AI_SCOPE_KEYS,
  AI_SCOPE_LEVELS,
  aiScopesEqual,
  defaultAiScopesForRole,
  normalizeAiScopeLevel,
  resolveAiScopes,
  sanitizeAiScopes,
} from './aiScopes';
import { completeChat } from './llmProviders';
import {
  PERMISSION_FEATURES,
  PERMISSION_FEATURE_KEYS,
  RULE_ROLE_KEYS,
  describeRule,
  knownStoreName,
  roleRulesFor,
  rulesEqual,
  rulesForProfile,
  sanitizeRule,
} from './permissionRules';
import {
  USER_CATEGORIES,
  getCategory,
  hasFullAppAccess,
  normalizeAppRole,
  resolvedAccessForProfile,
  staffDisplayName,
} from './permissions';
import { HOME_PINNED_STORES, STORE_REGIONS } from './storeCatalog';

export const PERMISSIONS_AGENT_MODELS = [
  { key: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
  { key: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
  { key: 'openai/gpt-4.1', label: 'GPT-4.1' },
  { key: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { key: 'x-ai/grok-4.7', label: 'Grok 4.7' },
];
export const DEFAULT_PERMISSIONS_AGENT_MODEL = PERMISSIONS_AGENT_MODELS[0].key;

const MAX_ROUNDS = 5;
const MAX_CALLS_PER_ROUND = 8;
const DIRECTORY_LIMIT = 160;
const HISTORY_TURNS = 16;

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function uniqueStrings(list) {
  const seen = new Set();
  const next = [];
  for (const item of Array.isArray(list) ? list : []) {
    const value = asString(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

function personName(person) {
  return staffDisplayName(person) || person?.aureusLogin || 'Staff';
}

function personLine(person) {
  const category = getCategory(person?.appRole);
  const role = person?.isSystemAdmin ? 'System Admin' : category?.label || 'PMA';
  return `${person.id} | ${personName(person)} | ${role} | ${person.locationName || 'no store'}${person.isActive === false ? ' | disabled' : ''}`;
}

function joinKeys(keys) {
  return keys.length ? keys.join(', ') : 'none';
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function roleCatalogText() {
  return USER_CATEGORIES.map((category) => {
    const tail = category.key === 'system_admin' ? ' Always every app and every feature; cannot be restricted.' : '';
    return `- ${category.key}: ${category.label} (${category.shortLabel}). ${category.description}.${tail}`;
  }).join('\n');
}

function appCatalogText(apps) {
  return (apps || [])
    .map((app) => `- ${app.key}: ${app.label}${app.category ? ` (${app.category})` : ''}`)
    .join('\n');
}

function featureCatalogText() {
  return PERMISSION_FEATURES.map(
    (feature) => `- ${feature.key}: ${feature.label}. ${feature.description} Also called: ${feature.aliases.join(', ')}.`,
  ).join('\n');
}

function scopeCatalogText() {
  return AI_SCOPE_CAPABILITIES.map((capability) => `- ${capability.key}: ${capability.description}`).join('\n');
}

function regionText() {
  return STORE_REGIONS.filter((region) => region.stores.length)
    .map((region) => `${region.label} region = ${region.stores.join(', ')}`)
    .join('; ');
}

function describeScopes(scopes) {
  const next = sanitizeAiScopes(scopes);
  return AI_SCOPE_KEYS.map((key) => `${key} ${next[key]}`).join(', ');
}

function describeRulesList(rules, staffById) {
  if (!rules.length) return 'none';
  return rules.map((rule) => `[${rule.id}] ${describeRule(rule, { staffById })}`).join(' ');
}

function roleStateText(role, snap) {
  const category = getCategory(role);
  if (!category) return '';
  const apps = snap.roleApps?.[role] || [];
  const scopes = snap.roleAi?.[role] || defaultAiScopesForRole(role);
  const rules = roleRulesFor(snap.rules, role);
  return `${category.label} role defaults — apps: ${joinKeys(apps)}. Analytics: ${describeScopes(scopes)}. Rules touching this role: ${describeRulesList(rules, snap.staffById)}`;
}

function personStateText(person, snap) {
  if (!person) return '';
  if (hasFullAppAccess(person)) {
    return `${personName(person)} (id ${person.id}) is a System Admin: every app, Company scope, no rules apply. Nothing about them can be restricted.`;
  }
  const access = resolvedAccessForProfile(person, snap.roleApps, snap.catalogKeys, snap.userApps?.[person.id]);
  const scopes = resolveAiScopes(person, snap.roleAi, snap.userAi?.[person.id]);
  const rules = rulesForProfile(snap.rules, person);
  const category = getCategory(person.appRole);
  return `${personName(person)} (id ${person.id}, ${category?.label || 'PMA'}, store ${person.locationName || 'not set'}${person.isActive === false ? ', access disabled' : ''}) — apps they can open: ${joinKeys(access.visibleApps)} (${access.inherited ? 'role defaults' : 'custom set'}). Filter on: ${joinKeys(access.filterableApps)}. Analytics: ${describeScopes(scopes)} (${snap.userAi?.[person.id] ? 'custom' : 'role defaults'}). Rules in effect for them: ${describeRulesList(rules, snap.staffById)}`;
}

function directoryText(staff) {
  const list = [...(staff || [])].sort((a, b) =>
    personName(a).localeCompare(personName(b), undefined, { sensitivity: 'base' }),
  );
  const shown = list.slice(0, DIRECTORY_LIMIT).map(personLine);
  const more = list.length - shown.length;
  return `${shown.join('\n')}${more > 0 ? `\n… ${more} more. Use find_people for anyone not listed.` : ''}`;
}

/** Short label for the context chip in the chat header. */
export function describeAgentContext(context, snap) {
  if (context?.tab === 'roles') {
    const category = getCategory(context.role);
    return category ? `Roles · ${category.label}` : 'Roles';
  }
  const person = context?.personId ? snap?.staffById?.get(context.personId) : null;
  return person ? `People · ${personName(person)}` : 'People · nobody selected';
}

function contextText(context, snap) {
  if (context?.tab === 'roles') {
    const category = getCategory(context.role);
    if (!category) return 'The admin is on the Role defaults tab with no role in focus.';
    if (category.key === 'system_admin') {
      return 'The admin is on the Role defaults tab with System Admin in focus. That role cannot be changed; ask which other role they mean when a request has no role or person in it.';
    }
    return `The admin is on the Role defaults tab with the ${category.label} role in focus (role key ${category.key}). A request that names no person and no other role is about this role.\n${roleStateText(category.key, snap)}`;
  }
  const person = context?.personId ? snap.staffById.get(context.personId) : null;
  if (!person) {
    return 'The admin is on the People tab with nobody selected. When a request names no person and no role, ask who it is for.';
  }
  return `The admin is on the People tab with ${personName(person)} selected (userId ${person.id}). A request that names no role and no other person is about this person.\n${personStateText(person, snap)}`;
}

function systemPrompt({ context, snap, adminName }) {
  return `You are the permissions assistant inside MyCanadaGold, Settings → Permissions. A System Admin${adminName ? ` (${adminName})` : ''} is talking to you. You change who can open which apps, who can change the store filter inside an app, what the Analytics AI may reveal about people, and which parts of a screen a role or a person can see. You act only through the tools; never describe a change as done unless the tool result says so.

Where the admin is right now:
${contextText(context, snap)}

Roles (key: name):
${roleCatalogText()}

Apps a role or person can open (key: name):
${appCatalogText(snap.apps)}
Home is always visible and cannot be hidden; use the home.* features to trim what it shows. The analytics and dashboards apps only open for General Managers and admins no matter the defaults; triage only opens for Triage Analysts; settings always opens for General Managers.

Filter: the right to change the store inside an app the person can open (other stores' transactions, tills, staff). It is set per person only; roles have no filter setting. On Home, Filter also controls dollar totals and opening other stores, so "they should only see their own store" is filterOff for the apps in question.

Analytics scopes (self = only their own figures, store = people at their allocated store, company = everyone):
${scopeCatalogText()}

Features a rule can hide or show. home.* trims the Home screen; analytics.* blocks a topic in the AI assistants (Analytics app, Dashboards, Messages @ai): the assistant then tells that person their permissions do not include it and refuses to look it up.
${featureCatalogText()}
A rule targets a role, one person, or everyone, and can be limited to people allocated to certain stores: "Branch Managers in Quebec" is target role, role branch_manager, stores ["Quebec"]; "everyone at Laval and Montreal" is target everyone, stores ["Laval", "Montreal"]. A more specific target wins: person beats role with stores beats role beats everyone with stores beats everyone, so "hide revenue for Branch Managers but Sarah can keep it" is a hide rule on the role plus a show rule on Sarah. Store names, as Home spells them: ${HOME_PINNED_STORES.join(', ')}. Regions: ${regionText()}. "Quebec" alone is the Quebec City store; when the admin says Quebec, use that store and mention in a few words that Montreal and Laval can be added if they meant the region.

People directory (id | name | role | store):
${directoryText(snap.staff)}
${snap.rulesUnavailable ? '\nGranular rules are not available until the permission_rules migration is released; say so if a request needs a rule, and still handle apps, filter, and Analytics scopes.\n' : ''}
How to work:
- A clear request gets the tool call right away, then one or two plain sentences saying what changed and for whom. Several changes in one message are several tool calls in the same reply. A request that names several roles or people ("PMA and Branch Manager") is one call per role or person.
- Always pass the target to a tool: role for a whole role, userId for one person (ids come from the directory, the context above, or find_people). Never invent an id or a name.
- "Don't let them ask about X in Analytics", "block X in the AI", "the AI shouldn't answer about X" is add_rule with the matching analytics.* feature and effect hide (phone data → analytics.phone, hours or schedule → analytics.hours, pay or bonuses → analytics.compensation, sales or tickets → analytics.transactions, and so on). Undoing it is remove_rule, or a show rule on a narrower target.
- When a person's name matches more than one entry, or the message could mean two different things, ask one short question instead of calling a tool.
- "Revenue", "sales numbers", "dollar amounts", "money", or "totals" on Home is the feature home.amounts. "See" or "open" an app is app visibility. "Filter", "switch stores", or "other stores" inside an app is the filter setting. "Only their own" for Analytics is scope self; "their store" is store; "everyone" is company.
- When something cannot be done with these tools (a figure inside an app that has no feature key, deleting a person, changing a role or sign-in access), say so in one sentence and offer the closest available change. Roles and sign-in access are changed with the buttons on this screen, not here.
- Greetings or thanks get a short friendly reply with no tool call.
- Plain sentences only: no markdown, no bullet lists, no headings, no sign-off. Keep it short and kind; you are a colleague helping, not writing a report. Do not use the admin's name.`;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TARGET_PROPERTIES = {
  role: {
    type: 'string',
    enum: RULE_ROLE_KEYS,
    description: 'Role key when the change is for a whole role.',
  },
  userId: {
    type: 'string',
    description: 'Person id (from the directory, the context, or find_people) when the change is for one person.',
  },
};

const APP_KEY_LIST = { type: 'array', items: { type: 'string' }, description: 'App keys from the catalog.' };

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'find_people',
      description: 'Search staff by name, email, login, store, or role. Use when a name is not in the directory above or could match several people.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_access',
      description: 'Current apps, filter rights, Analytics scopes, and rules for a role or a person.',
      parameters: { type: 'object', properties: TARGET_PROPERTIES },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_app_access',
      description:
        'Show or hide apps for a role (its defaults) or one person (a custom set), and for a person turn the store filter on or off inside apps. Lists may be empty. A newly shown app gets filter on.',
      parameters: {
        type: 'object',
        properties: {
          ...TARGET_PROPERTIES,
          show: APP_KEY_LIST,
          hide: APP_KEY_LIST,
          filterOn: { ...APP_KEY_LIST, description: 'Person only: apps they may change the store in.' },
          filterOff: { ...APP_KEY_LIST, description: 'Person only: apps locked to their own store.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_analytics_scope',
      description: 'Set Analytics AI scopes for a role or one person. Only the capabilities given change.',
      parameters: {
        type: 'object',
        properties: {
          ...TARGET_PROPERTIES,
          scopes: {
            type: 'object',
            properties: Object.fromEntries(
              AI_SCOPE_KEYS.map((key) => [key, { type: 'string', enum: AI_SCOPE_LEVELS }]),
            ),
          },
        },
        required: ['scopes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reset_person_to_role_defaults',
      description: 'Drop a person’s custom apps and/or Analytics scopes so they follow their role again.',
      parameters: {
        type: 'object',
        properties: {
          userId: TARGET_PROPERTIES.userId,
          what: { type: 'string', enum: ['apps', 'analytics', 'both'] },
        },
        required: ['userId', 'what'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_rule',
      description:
        'Hide (or show again) one screen feature for a role, one person, or everyone, optionally only at certain stores. Saved immediately.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['role', 'user', 'everyone'] },
          ...TARGET_PROPERTIES,
          stores: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only people allocated to these stores. Omit for every store.',
          },
          feature: { type: 'string', enum: PERMISSION_FEATURE_KEYS },
          effect: { type: 'string', enum: ['hide', 'show'] },
          note: { type: 'string', description: 'The admin’s request in their words, one line.' },
        },
        required: ['target', 'feature', 'effect'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_rule',
      description: 'Delete a rule by id (ids appear in brackets in rule lists).',
      parameters: {
        type: 'object',
        properties: { ruleId: { type: 'string' } },
        required: ['ruleId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_rules',
      description: 'Rules for a role, a person, or (with no arguments) every rule.',
      parameters: { type: 'object', properties: TARGET_PROPERTIES },
    },
  },
];

function parseToolArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw || '{}'));
  } catch {
    return null;
  }
}

function roleLabel(role) {
  return getCategory(role)?.label || role;
}

function resolveTarget(args, snap, context) {
  const userId = asString(args?.userId);
  if (userId) {
    const person = snap.staffById.get(userId);
    if (!person) return { error: `No person has the id ${userId}. Use the directory or find_people.` };
    return { kind: 'user', person };
  }
  const roleKey = asString(args?.role);
  if (roleKey) {
    const role = normalizeAppRole(roleKey);
    if (!role) return { error: `Unknown role ${roleKey}. Roles: ${RULE_ROLE_KEYS.join(', ')}.` };
    if (role === 'system_admin') return { error: 'System Admin always has everything and cannot be changed.' };
    return { kind: 'role', role };
  }
  if (context?.tab === 'roles' && context.role && context.role !== 'system_admin') {
    return { kind: 'role', role: context.role };
  }
  if (context?.tab === 'people' && context.personId && snap.staffById.has(context.personId)) {
    return { kind: 'user', person: snap.staffById.get(context.personId) };
  }
  return { error: 'Say who this is for: pass role or userId.' };
}

function catalogKeys(list, snap) {
  const allowed = snap.catalogKeys instanceof Set ? snap.catalogKeys : new Set(snap.catalogKeys || []);
  const unknown = [];
  const keys = [];
  for (const item of uniqueStrings(list)) {
    if (allowed.has(item)) keys.push(item);
    else unknown.push(item);
  }
  return { keys, unknown };
}

function searchPeople(staff, query) {
  const q = asString(query).toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  return (staff || []).filter((person) => {
    const category = getCategory(person.appRole);
    const haystack = [
      personName(person),
      person.email,
      person.aureusLogin,
      person.locationName,
      person.employeeType,
      category?.label,
      category?.shortLabel,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

async function runTool(name, args, { store, context }) {
  const snap = store.snapshot();

  if (name === 'find_people') {
    const matches = searchPeople(snap.staff, args.query).slice(0, 12);
    return {
      result: matches.length
        ? { people: matches.map(personLine) }
        : { people: [], note: 'Nobody matches. People appear after their first sign-in.' },
    };
  }

  if (name === 'get_access' || name === 'list_rules') {
    if (name === 'list_rules' && !asString(args?.role) && !asString(args?.userId)) {
      return {
        result: {
          rules: snap.rules.map((rule) => `[${rule.id}] ${describeRule(rule, { staffById: snap.staffById })}`),
          note: snap.rulesUnavailable ? 'Rules are unavailable until the permission_rules migration is released.' : undefined,
        },
      };
    }
    const target = resolveTarget(args, snap, context);
    if (target.error) return { result: { error: target.error } };
    if (target.kind === 'role') return { result: { state: roleStateText(target.role, snap) } };
    return { result: { state: personStateText(target.person, snap) } };
  }

  if (name === 'set_app_access') {
    const target = resolveTarget(args, snap, context);
    if (target.error) return { result: { error: target.error } };
    const show = catalogKeys(args.show, snap);
    const hide = catalogKeys(args.hide, snap);
    const filterOn = catalogKeys(args.filterOn, snap);
    const filterOff = catalogKeys(args.filterOff, snap);
    const unknown = [...show.unknown, ...hide.unknown, ...filterOn.unknown, ...filterOff.unknown];
    if (unknown.length) {
      return { result: { error: `Unknown app key${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Use keys from the app list.` } };
    }
    const notes = [];
    if (hide.keys.includes('home')) {
      notes.push('Home cannot be hidden; use a home.* rule to trim what it shows.');
      hide.keys = hide.keys.filter((key) => key !== 'home');
    }

    if (target.kind === 'role') {
      if (filterOn.keys.length || filterOff.keys.length) {
        return { result: { error: 'Filter is set per person, not per role. Name the people, or change which apps the role can open.' } };
      }
      if (!show.keys.length && !hide.keys.length) return { result: { error: 'Nothing to change: pass show or hide.' } };
      const current = snap.roleApps?.[target.role] || [];
      const next = uniqueStrings([...current.filter((key) => !hide.keys.includes(key)), ...show.keys]);
      const added = show.keys.filter((key) => !current.includes(key));
      const removed = hide.keys.filter((key) => current.includes(key));
      if (!added.length && !removed.length) {
        return { result: { ok: true, unchanged: true, note: `${roleLabel(target.role)} defaults already match.`, notes } };
      }
      const saved = await store.setRoleApps(target.role, next);
      const parts = [];
      if (added.length) parts.push(`now opens ${added.join(', ')}`);
      if (removed.length) parts.push(`no longer opens ${removed.join(', ')}`);
      return {
        result: { ok: true, role: target.role, visibleApps: saved, added, removed, notes },
        change: `${roleLabel(target.role)} role ${parts.join(' and ')}.`,
      };
    }

    const person = target.person;
    if (hasFullAppAccess(person)) {
      return { result: { error: `${personName(person)} is a System Admin and always has every app.` } };
    }
    if (!show.keys.length && !hide.keys.length && !filterOn.keys.length && !filterOff.keys.length) {
      return { result: { error: 'Nothing to change: pass show, hide, filterOn, or filterOff.' } };
    }
    const current = resolvedAccessForProfile(person, snap.roleApps, snap.catalogKeys, snap.userApps?.[person.id]);
    const visible = uniqueStrings([...current.visibleApps.filter((key) => !hide.keys.includes(key)), ...show.keys]);
    const visibleSet = new Set(visible);
    const newlyShown = show.keys.filter((key) => !current.visibleApps.includes(key));
    const filterable = uniqueStrings([
      ...current.filterableApps.filter((key) => visibleSet.has(key) && !filterOff.keys.includes(key)),
      ...newlyShown.filter((key) => !filterOff.keys.includes(key)),
      ...filterOn.keys.filter((key) => visibleSet.has(key)),
    ]);
    const filterSkipped = filterOn.keys.filter((key) => !visibleSet.has(key));
    if (filterSkipped.length) {
      notes.push(`Filter was not turned on for ${filterSkipped.join(', ')} because they cannot open those apps; add them to show first.`);
    }
    const saved = await store.setPersonApps(person.id, { visibleApps: visible, filterableApps: filterable });
    const removed = hide.keys.filter((key) => current.visibleApps.includes(key));
    const filterNowOn = filterOn.keys.filter((key) => visibleSet.has(key) && !current.filterableApps.includes(key));
    const filterNowOff = filterOff.keys.filter((key) => current.filterableApps.includes(key));
    const parts = [];
    if (newlyShown.length) parts.push(`can now open ${newlyShown.join(', ')}`);
    if (removed.length) parts.push(`no longer opens ${removed.join(', ')}`);
    if (filterNowOn.length) parts.push(`can filter ${filterNowOn.join(', ')}`);
    if (filterNowOff.length) parts.push(`is locked to their own store in ${filterNowOff.join(', ')}`);
    return {
      result: {
        ok: true,
        userId: person.id,
        visibleApps: saved.visibleApps,
        filterableApps: saved.filterableApps,
        unchanged: !parts.length,
        notes,
      },
      change: parts.length ? `${personName(person)} ${parts.join(', ')}.` : undefined,
    };
  }

  if (name === 'set_analytics_scope') {
    const target = resolveTarget(args, snap, context);
    if (target.error) return { result: { error: target.error } };
    const patch = {};
    const bad = [];
    for (const [key, value] of Object.entries(args?.scopes || {})) {
      if (!AI_SCOPE_KEYS.includes(key)) {
        bad.push(key);
        continue;
      }
      const level = normalizeAiScopeLevel(value);
      if (!level) bad.push(`${key}=${value}`);
      else patch[key] = level;
    }
    if (bad.length) {
      return { result: { error: `Unknown scope or level: ${bad.join(', ')}. Capabilities: ${AI_SCOPE_KEYS.join(', ')}; levels: ${AI_SCOPE_LEVELS.join(', ')}.` } };
    }
    if (!Object.keys(patch).length) return { result: { error: 'Pass at least one capability in scopes.' } };
    const changed = (before, after) => AI_SCOPE_KEYS.filter((key) => before[key] !== after[key]).map((key) => `${key} ${after[key]}`);

    if (target.kind === 'role') {
      const base = sanitizeAiScopes(snap.roleAi?.[target.role], defaultAiScopesForRole(target.role));
      const next = sanitizeAiScopes({ ...base, ...patch }, base);
      const diff = changed(base, next);
      if (!diff.length) return { result: { ok: true, unchanged: true, scopes: next } };
      const saved = await store.setRoleAiScopes(target.role, next);
      return {
        result: { ok: true, role: target.role, scopes: saved },
        change: `${roleLabel(target.role)} Analytics: ${diff.join(', ')}.`,
      };
    }

    const person = target.person;
    if (hasFullAppAccess(person)) {
      return { result: { error: `${personName(person)} is a System Admin and always has Company scope.` } };
    }
    const inherited = sanitizeAiScopes(resolveAiScopes(person, snap.roleAi, null));
    const current = sanitizeAiScopes(resolveAiScopes(person, snap.roleAi, snap.userAi?.[person.id]));
    const next = sanitizeAiScopes({ ...current, ...patch }, current);
    const diff = changed(current, next);
    if (!diff.length) return { result: { ok: true, unchanged: true, scopes: next } };
    if (aiScopesEqual(next, inherited)) {
      await store.resetPersonAi(person.id);
      return {
        result: { ok: true, userId: person.id, scopes: inherited, note: 'Matches the role defaults, so the custom Analytics set was removed.' },
        change: `${personName(person)} Analytics: ${diff.join(', ')} (back on role defaults).`,
      };
    }
    const saved = await store.setPersonAiScopes(person.id, next);
    return {
      result: { ok: true, userId: person.id, scopes: saved },
      change: `${personName(person)} Analytics: ${diff.join(', ')}.`,
    };
  }

  if (name === 'reset_person_to_role_defaults') {
    const target = resolveTarget({ userId: args?.userId }, snap, context);
    if (target.error || target.kind !== 'user') return { result: { error: target.error || 'Pass userId.' } };
    const person = target.person;
    if (hasFullAppAccess(person)) return { result: { error: `${personName(person)} is a System Admin; nothing to reset.` } };
    const what = asString(args?.what) || 'both';
    const done = [];
    if (what === 'apps' || what === 'both') {
      if (snap.userApps?.[person.id]) {
        await store.resetPersonApps(person.id);
        done.push('apps');
      }
    }
    if (what === 'analytics' || what === 'both') {
      if (snap.userAi?.[person.id]) {
        await store.resetPersonAi(person.id);
        done.push('Analytics scopes');
      }
    }
    if (!done.length) return { result: { ok: true, unchanged: true, note: `${personName(person)} already follows ${roleLabel(person.appRole)} defaults.` } };
    return {
      result: { ok: true, userId: person.id, reset: done },
      change: `${personName(person)} follows ${roleLabel(person.appRole)} defaults again for ${done.join(' and ')}.`,
    };
  }

  if (name === 'add_rule') {
    if (snap.rulesUnavailable) {
      return { result: { error: 'Rules are unavailable until the permission_rules migration is released. Apps, filter, and Analytics scopes still work.' } };
    }
    const input = { ...args };
    if (input.target === 'user' && !asString(input.userId) && context?.tab === 'people' && context.personId) {
      input.userId = context.personId;
    }
    if (input.target === 'role' && !asString(input.role) && context?.tab === 'roles' && context.role) {
      input.role = context.role;
    }
    const { rule, error } = sanitizeRule(input);
    if (error) return { result: { error } };
    if (rule.target === 'user') {
      const person = snap.staffById.get(rule.userId);
      if (!person) return { result: { error: `No person has the id ${rule.userId}. Use the directory or find_people.` } };
      if (hasFullAppAccess(person)) return { result: { error: `${personName(person)} is a System Admin; rules never apply to admins.` } };
    }
    const unknownStores = (rule.stores || []).filter((name) => !knownStoreName(name));
    if (unknownStores.length) {
      return { result: { error: `Unknown store: ${unknownStores.join(', ')}. Stores: ${HOME_PINNED_STORES.join(', ')}.` } };
    }
    const existing = snap.rules.find((item) => rulesEqual(item, rule));
    if (existing) {
      return { result: { ok: true, unchanged: true, ruleId: existing.id, rule: describeRule(existing, { staffById: snap.staffById }) } };
    }
    const saved = await store.addRule(rule);
    const line = describeRule(saved, { staffById: snap.staffById });
    return { result: { ok: true, ruleId: saved.id, rule: line }, change: line };
  }

  if (name === 'remove_rule') {
    const id = asString(args?.ruleId);
    const existing = snap.rules.find((rule) => rule.id === id);
    if (!existing) return { result: { error: `No rule has the id ${id}. Call list_rules to see ids.` } };
    await store.removeRule(id);
    return {
      result: { ok: true, removed: id },
      change: `Removed: ${describeRule(existing, { staffById: snap.staffById })}`,
    };
  }

  return { result: { error: `Unknown tool ${name}.` } };
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function fallbackText(changes, failure) {
  const tail = failure ? ` (${failure})` : '';
  if (!changes.length) return failure ? `I could not finish that${tail}.` : '';
  if (changes.length === 1) return `Done. ${changes[0]}${tail}`;
  return `Done. ${changes.join(' ')}${tail}`;
}

/**
 * One admin turn. `store` is the panel's adapter (see PermissionsPanel):
 * snapshot(), setRoleApps, setRoleAiScopes, setPersonApps, resetPersonApps,
 * setPersonAiScopes, resetPersonAi, addRule, removeRule. `context` is
 * { tab: 'people' | 'roles', role?, personId? }.
 */
export async function runPermissionsAgent({ model, turns = [], message, context, store, adminName, signal, onStatus } = {}) {
  const question = asString(message);
  if (!question) throw new Error('Say what should change.');
  if (!model) throw new Error('Pick a model.');
  if (!store?.snapshot) throw new Error('Permissions are still loading.');

  const snap = store.snapshot();
  const history = (turns || [])
    .filter((turn) => (turn?.role === 'user' || turn?.role === 'assistant') && asString(turn.content))
    .slice(-HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: String(turn.content) }));
  const messages = [
    { role: 'system', content: systemPrompt({ context, snap, adminName }) },
    ...history,
    { role: 'user', content: question },
  ];
  const changes = [];
  const trace = [];

  onStatus?.('Reading the request…');
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const reply = await completeChat({ model, messages, tools: TOOLS, toolChoice: 'auto', maxTokens: 1800, signal });
    const calls = Array.isArray(reply?.tool_calls) ? reply.tool_calls.slice(0, MAX_CALLS_PER_ROUND) : [];
    if (!calls.length) {
      const text = asString(reply?.content);
      if (text) return { text, changes, trace };
      break;
    }
    onStatus?.(calls.length > 1 ? `Applying ${calls.length} changes…` : 'Applying the change…');
    messages.push({ role: 'assistant', content: reply.content || '', tool_calls: calls });
    // Sequential on purpose: two writes to the same role row must not race.
    for (const call of calls) {
      const name = call?.function?.name || '';
      const args = parseToolArgs(call?.function?.arguments);
      let outcome;
      if (!args) {
        outcome = { result: { error: 'The arguments were not valid JSON.' } };
      } else {
        try {
          outcome = await runTool(name, args, { store, context });
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw error;
          outcome = { result: { error: error?.message || 'Could not complete that.' } };
        }
      }
      if (outcome.change) changes.push(outcome.change);
      trace.push({ round: round + 1, name, args: args || {}, result: outcome.result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.result) });
    }
  }

  onStatus?.('Writing the reply…');
  let text = '';
  let failure = '';
  try {
    const closing = await completeChat({
      model,
      maxTokens: 600,
      signal,
      messages: [
        ...messages,
        {
          role: 'user',
          content:
            'The tool calls for this turn are finished. In one or two plain sentences, say what changed and for whom (or what could not be done and why). No tool calls, no markdown.',
        },
      ],
    });
    text = asString(closing?.content);
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    failure = error?.message || '';
  }
  if (!text) text = fallbackText(changes, failure);
  if (!text) throw new Error(failure || 'The model sent back an empty reply. Try again or pick another model.');
  return { text, changes, trace };
}
