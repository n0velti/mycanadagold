import { zipSync } from 'fflate';
import { mergeEmployeesWithProfiles } from './aureusEmployees';
import { mergeStaffWithEmployeeRoster } from './employeeRoster';
import { listStaffProfiles, staffDisplayName } from './permissions';
import { HOME_PINNED_STORES, canonicalStoreName } from './storeCatalog';
import { getSupabase } from './supabase';
import { buildXlsx, safeDownloadName } from './xlsx';

const AVATAR_BUCKET = 'avatars';

const EMPLOYEE_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'aureusLogin', label: 'Aureus login' },
  { key: 'location', label: 'Store' },
  { key: 'role', label: 'Role' },
  { key: 'employeeType', label: 'Employee type' },
  { key: 'phone', label: 'Phone' },
  { key: 'active', label: 'Active' },
  { key: 'lastLogin', label: 'Last login' },
  { key: 'photoFile', label: 'Photo file' },
];

function locationOf(person) {
  const name = canonicalStoreName(person?.locationName) || String(person?.locationName || '').trim();
  return name || 'No location';
}

function sortStoreNames(names) {
  return [...names].sort((a, b) => {
    if (a === 'No location') return 1;
    if (b === 'No location') return -1;
    const ai = HOME_PINNED_STORES.findIndex((store) => store.toLowerCase() === a.toLowerCase());
    const bi = HOME_PINNED_STORES.findIndex((store) => store.toLowerCase() === b.toLowerCase());
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

function formatLastLogin(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return String(value || '').trim();
  return new Date(time).toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function slugPart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function photoStem(person) {
  const name = slugPart(staffDisplayName(person));
  const login = slugPart(person?.aureusLogin);
  return [name, login].filter(Boolean).join('-') || slugPart(person?.id) || 'employee';
}

function folderName(store) {
  return slugPart(store) || 'store';
}

function extensionFrom(url, contentType) {
  const type = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  const path = String(url || '').split('?')[0];
  const match = path.match(/\.(jpe?g|png|webp|gif)$/i);
  return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

function avatarUrlOf(person) {
  return String(person?.avatarUrl || person?.photoUrl || '').trim();
}

function avatarStoragePath(url) {
  const match = String(url || '').match(/\/storage\/v1\/object\/public\/avatars\/(.+?)(?:\?|$)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

async function bytesFromBlob(blob, url) {
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!bytes.length) return null;
  return { bytes, ext: extensionFrom(url, blob.type) };
}

async function fetchPhotoFromStorage(url) {
  const path = avatarStoragePath(url);
  if (!path) return null;
  const { data, error } = await getSupabase().storage.from(AVATAR_BUCKET).download(path);
  if (error || !data) return null;
  return bytesFromBlob(data, url);
}

async function fetchPhoto(url) {
  try {
    const fromStorage = await fetchPhotoFromStorage(url);
    if (fromStorage) return fromStorage;
  } catch {
    // Public URL next.
  }
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error('Empty photo');
  return { bytes, ext: extensionFrom(url, response.headers.get('content-type')) };
}

/** Live `profiles` rows (names, logins, avatar URLs), plus the roster overlay. */
export async function fetchEmployeeExportSnapshot() {
  const profiles = await listStaffProfiles();
  const rows = mergeStaffWithEmployeeRoster(mergeEmployeesWithProfiles([], profiles));
  if (!rows.length) throw new Error('No employees found.');
  return rows;
}

async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return out;
}

function employeeRow(person, photoFile) {
  return {
    name: staffDisplayName(person),
    email: String(person?.email || '').trim(),
    aureusLogin: String(person?.aureusLogin || '').trim(),
    location: locationOf(person),
    role: String(person?.role || person?.posRole || '').trim(),
    employeeType: String(person?.employeeType || '').trim(),
    phone: String(person?.phone || '').trim(),
    active: person?.isActive === false || person?.profileActive === false ? 'No' : 'Yes',
    lastLogin: formatLastLogin(person?.lastLoginAt),
    photoFile: photoFile || '',
  };
}

function uniquePhotoPath(store, person, ext, taken) {
  const folder = folderName(store);
  const stem = photoStem(person);
  let name = `${stem}.${ext}`;
  let n = 2;
  while (taken.has(`${folder}/${name}`.toLowerCase())) {
    name = `${stem}-${n}.${ext}`;
    n += 1;
  }
  const path = `photos/${folder}/${name}`;
  taken.add(`${folder}/${name}`.toLowerCase());
  return path;
}

export async function buildEmployeeAvatarExport(people) {
  const rows = Array.isArray(people) ? people.filter(Boolean) : [];
  const withPhotos = rows.filter((person) => avatarUrlOf(person));
  const photos = await mapPool(withPhotos, 6, async (person) => {
    try {
      const photo = await fetchPhoto(avatarUrlOf(person));
      return { person, ...photo };
    } catch {
      return { person, bytes: null, ext: '' };
    }
  });
  const photoById = new Map();
  const taken = new Set();
  const zipFiles = {};
  for (const photo of photos) {
    if (!photo?.bytes) continue;
    const store = locationOf(photo.person);
    const path = uniquePhotoPath(store, photo.person, photo.ext, taken);
    zipFiles[path] = photo.bytes;
    photoById.set(photo.person.id, path);
  }

  const sheetRows = rows.map((person) => employeeRow(person, photoById.get(person.id) || ''));
  const byStore = new Map();
  for (const row of sheetRows) {
    const store = row.location || 'No location';
    if (!byStore.has(store)) byStore.set(store, []);
    byStore.get(store).push(row);
  }
  const sheets = [{ name: 'All stores', columns: EMPLOYEE_COLUMNS, rows: sheetRows }];
  for (const store of sortStoreNames(byStore.keys())) {
    sheets.push({ name: store, columns: EMPLOYEE_COLUMNS, rows: byStore.get(store) || [] });
  }
  zipFiles['employees.xlsx'] = buildXlsx({ title: 'Employees', sheets });
  return zipSync(zipFiles, { level: 6 });
}

export function employeeExportFilename(when = new Date()) {
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(
    when.getDate(),
  ).padStart(2, '0')}`;
  return safeDownloadName(`employees-avatars-${stamp}`, 'zip');
}
