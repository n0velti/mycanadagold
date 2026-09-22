/**
 * Normalise any "person" shape the app passes around (staff profile, DM
 * participant, employee row) into the target ProfileScreen expects. Lives
 * outside components/ProfileScreen so the shell can use it without pulling
 * the whole profile screen into the first bundle.
 */
export function profileTargetFromPerson(person) {
  if (!person) return null;
  const name = String(
    person.name ||
      person.fullName ||
      [person.firstName, person.lastName].filter(Boolean).join(' ') ||
      '',
  ).trim();
  return {
    profileId: String(person.profileId || person.id || '').trim(),
    name,
    avatarUrl: person.avatarUrl || person.photoUrl || '',
    locationName: person.locationName || '',
    email: person.email || '',
    employeeType: person.employeeType || person.posRole || '',
    role: person.role || person.posRole || '',
    teamId: person.teamId || '',
    teamName: person.teamName || '',
  };
}
