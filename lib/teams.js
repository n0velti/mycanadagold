import { getSupabase } from './supabase';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /teams|set_own_team|list_teams/i.test(message);
}

function describeError(error, action = 'load teams') {
  if (!error) return `Could not ${action}.`;
  if (isMissingRelation(error)) {
    return 'Run the Teams SQL in Supabase, then refresh.';
  }
  if (error.code === '23505') return 'A team with that name already exists.';
  return error.message || `Could not ${action}.`;
}

function throwQueryError(error, action) {
  const wrapped = new Error(describeError(error, action));
  wrapped.code = error?.code;
  throw wrapped;
}

function mapMember(row) {
  if (!row?.id) return null;
  const fullName = asString(row.full_name || row.fullName);
  return {
    id: row.id,
    firstName: asString(row.first_name || row.firstName),
    lastName: asString(row.last_name || row.lastName),
    fullName: fullName || 'Teammate',
    avatarUrl: asString(row.avatar_url || row.avatarUrl),
    locationName: asString(row.location_name || row.locationName),
    isTeamIntake: Boolean(row.is_team_intake ?? row.isTeamIntake),
    lastSeenAt: row.last_seen_at || row.lastSeenAt || null,
    isOnline: Boolean(row.is_online ?? row.isOnline),
  };
}

export function teamMemberName(person) {
  if (!person) return 'Teammate';
  return (
    asString(person.fullName) ||
    [person.firstName, person.lastName].filter(Boolean).join(' ') ||
    'Teammate'
  );
}

export function intakeNames(team, limit = 3) {
  const members = Array.isArray(team?.members) ? team.members : [];
  const names = members.filter((person) => person.isTeamIntake).map(teamMemberName);
  if (!names.length) return '';
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} +${names.length - limit}`;
}

function mapTeam(row) {
  if (!row?.id) return null;
  const members = (Array.isArray(row.members) ? row.members : []).map(mapMember).filter(Boolean);
  return {
    id: row.id,
    name: asString(row.name) || 'Team',
    description: asString(row.description),
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    memberCount: Number(row.member_count ?? members.length) || 0,
    intakeCount: Number(row.intake_count ?? members.filter((person) => person.isTeamIntake).length) || 0,
    members,
  };
}

export async function listTeams() {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('list_teams');
  if (error) throwQueryError(error, 'load teams');
  return (data || []).map(mapTeam).filter(Boolean);
}

export async function createTeam({ name, description } = {}) {
  const label = asString(name);
  if (!label) throw new Error('Name this team first.');
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('teams')
    .insert({
      name: label.slice(0, 80),
      description: asString(description).slice(0, 500),
      created_by: user?.id || null,
    })
    .select('id, name, description, created_at, updated_at')
    .single();
  if (error) throwQueryError(error, 'create that team');
  return mapTeam({ ...data, members: [], member_count: 0, intake_count: 0 });
}

export async function updateTeam(teamId, { name, description } = {}) {
  const id = asString(teamId);
  if (!id) throw new Error('Missing team.');
  const patch = { updated_at: new Date().toISOString() };
  if (name != null) {
    const label = asString(name);
    if (!label) throw new Error('Name this team first.');
    patch.name = label.slice(0, 80);
  }
  if (description != null) patch.description = asString(description).slice(0, 500);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('teams')
    .update(patch)
    .eq('id', id)
    .select('id, name, description, created_at, updated_at')
    .single();
  if (error) throwQueryError(error, 'save that team');
  return mapTeam({ ...data, members: [], member_count: 0, intake_count: 0 });
}

export async function deleteTeam(teamId) {
  const id = asString(teamId);
  if (!id) throw new Error('Missing team.');
  const supabase = getSupabase();
  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) throwQueryError(error, 'delete that team');
}

export async function setOwnTeam(teamId, isIntake = false) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('set_own_team', {
    p_team_id: asString(teamId) || null,
    p_is_intake: Boolean(isIntake),
  });
  if (error) throwQueryError(error, 'save your team');
}
