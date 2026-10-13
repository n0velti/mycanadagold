/**
 * Shared Documents library: folders and files in Supabase, readable by Analytics.
 * File bytes live in the private `staff-documents` bucket. Spreadsheet, Word,
 * and text contents are stored on the row so search does not have to download.
 */
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { formatBytes, indexFile, kindOf, prepareAttachment } from './aiAttachments';
import { getPublishableKey, getSupabase, getSupabaseUrl } from './supabase';

export const DOCUMENT_BUCKET = 'staff-documents';
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
const READ_CHARS = 14000;
const CHAT_OPEN_BYTES = 12 * 1024 * 1024;

const FOLDER_COLUMNS =
  'id, parent_id, name, created_at, created_by, creator:profiles!document_folders_created_by_fkey(full_name)';
const FILE_COLUMNS =
  'id, folder_id, name, storage_path, mime_type, kind, size_bytes, created_at, created_by, text_truncated, creator:profiles!document_files_created_by_fkey(full_name)';

const KINDS = new Set(['spreadsheet', 'document', 'pdf', 'image', 'video', 'text', 'xls', 'doc', 'file']);

function storedKind(kind) {
  return KINDS.has(kind) ? kind : 'file';
}

function friendlyError(error) {
  const message = String(error?.message || error || '').trim();
  if (error?.code === '23505' || /duplicate key|sibling_name/i.test(message)) {
    return 'A folder with that name is already here.';
  }
  if (/cannot contain itself|nested too deep/i.test(message)) return message;
  if (/failed to fetch|network request failed|load failed/i.test(message)) {
    return 'Could not reach Documents. Check your connection and try again.';
  }
  return message || 'Something went wrong in Documents.';
}

export function cleanFolderName(name) {
  const clean = String(name || '')
    .replace(/[/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) throw new Error('Name the folder first.');
  if (clean.length > 120) throw new Error('Folder names can be up to 120 characters.');
  return clean;
}

function cleanFileName(name) {
  const base = String(name || 'file')
    .split(/[/\\]/)
    .pop()
    .replace(/\s+/g, ' ')
    .trim();
  return (base || 'file').slice(0, 240);
}

function storageFileName(name) {
  const cleaned = cleanFileName(name)
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140);
  return cleaned || 'file';
}

function newUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function formatAdded(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function personName(row) {
  return String(row?.creator?.full_name || '').trim();
}

function mapFolder(row) {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    createdAt: row.created_at,
    addedLabel: formatAdded(row.created_at),
    addedBy: personName(row),
  };
}

function mapFile(row) {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    kind: row.kind,
    sizeBytes: Number(row.size_bytes) || 0,
    sizeLabel: formatBytes(row.size_bytes),
    createdAt: row.created_at,
    addedLabel: formatAdded(row.created_at),
    addedBy: personName(row),
    textTruncated: Boolean(row.text_truncated),
  };
}

export async function listFolder(folderId) {
  const supabase = getSupabase();
  let folders = supabase.from('document_folders').select(FOLDER_COLUMNS).order('name', { ascending: true });
  let files = supabase
    .from('document_files')
    .select(FILE_COLUMNS)
    .order('created_at', { ascending: false });
  if (folderId) {
    folders = folders.eq('parent_id', folderId);
    files = files.eq('folder_id', folderId);
  } else {
    folders = folders.is('parent_id', null);
    files = files.is('folder_id', null);
  }
  const [folderResult, fileResult] = await Promise.all([folders, files]);
  if (folderResult.error) throw new Error(friendlyError(folderResult.error));
  if (fileResult.error) throw new Error(friendlyError(fileResult.error));
  return {
    folders: (folderResult.data || []).map(mapFolder),
    files: (fileResult.data || []).map(mapFile),
  };
}

export async function createFolder(name, parentId = null) {
  const clean = cleanFolderName(name);
  const { data, error } = await getSupabase()
    .from('document_folders')
    .insert({ name: clean, parent_id: parentId || null })
    .select(FOLDER_COLUMNS)
    .single();
  if (error) throw new Error(friendlyError(error));
  return mapFolder(data);
}

export async function ensureFolder(name, parentId = null) {
  const clean = cleanFolderName(name);
  const { folders } = await listFolder(parentId);
  const existing = folders.find(
    (folder) => folder.name.localeCompare(clean, undefined, { sensitivity: 'base' }) === 0,
  );
  if (existing) return existing;
  return createFolder(clean, parentId);
}

export async function renameFolder(id, name) {
  const clean = cleanFolderName(name);
  const { error } = await getSupabase().from('document_folders').update({ name: clean }).eq('id', id);
  if (error) throw new Error(friendlyError(error));
}

async function removeStored(paths) {
  const supabase = getSupabase();
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100).filter(Boolean);
    if (!batch.length) continue;
    const { error } = await supabase.storage.from(DOCUMENT_BUCKET).remove(batch);
    if (error) throw new Error(friendlyError(error));
  }
}

export async function deleteFile(file) {
  await removeStored([file.storagePath]);
  const { error } = await getSupabase().from('document_files').delete().eq('id', file.id);
  if (error) throw new Error(friendlyError(error));
}

export async function deleteFolder(folderId) {
  const supabase = getSupabase();
  const [{ data: folders, error: folderError }, { data: files, error: fileError }] = await Promise.all([
    supabase.from('document_folders').select('id, parent_id'),
    supabase.from('document_files').select('folder_id, storage_path'),
  ]);
  if (folderError) throw new Error(friendlyError(folderError));
  if (fileError) throw new Error(friendlyError(fileError));
  const inside = new Set();
  const walk = (id) => {
    inside.add(id);
    for (const folder of folders || []) {
      if (folder.parent_id === id) walk(folder.id);
    }
  };
  walk(folderId);
  const paths = (files || []).filter((file) => inside.has(file.folder_id)).map((file) => file.storage_path);
  await removeStored(paths);
  const { error } = await supabase.from('document_folders').delete().eq('id', folderId);
  if (error) throw new Error(friendlyError(error));
}

function encodeStoragePath(path) {
  return String(path || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function uploadBlob(path, blob, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getSupabaseUrl()}/storage/v1/object/${DOCUMENT_BUCKET}/${encodeStoragePath(path)}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      let message = 'Could not upload that file.';
      try {
        const payload = JSON.parse(xhr.responseText || '{}');
        message = payload.message || payload.error || message;
      } catch {
        // The body was not JSON.
      }
      if (xhr.status === 413 || /maximum allowed size|entity too large|payload too large/i.test(message)) {
        message = `That file is over ${formatBytes(MAX_DOCUMENT_BYTES)}.`;
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Could not upload that file. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        const token = data.session?.access_token;
        if (!token) {
          reject(new Error('Sign in to upload files.'));
          return;
        }
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('apikey', getPublishableKey());
        xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
        xhr.setRequestHeader('cache-control', 'max-age=3600');
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.send(blob);
      })
      .catch((error) => reject(new Error(friendlyError(error))));
  });
}

export async function uploadDocument({ file, folderId = null, onProgress }) {
  const name = cleanFileName(file?.name);
  const size = Number(file?.size) || 0;
  if (size > MAX_DOCUMENT_BYTES) throw new Error(`${name} is over ${formatBytes(MAX_DOCUMENT_BYTES)}.`);
  onProgress?.({ phase: 'reading', progress: 0 });
  const indexed = await indexFile(file);
  const id = newUuid();
  const storagePath = `${id}/${storageFileName(name)}`;
  const mime = (String(file?.type || '').trim() || 'application/octet-stream').slice(0, 200);
  onProgress?.({ phase: 'uploading', progress: 0 });
  await uploadBlob(storagePath, file, mime, (progress) => onProgress?.({ phase: 'uploading', progress }));
  onProgress?.({ phase: 'saving', progress: 1 });
  const fullText = String(indexed.text || '');
  const { error } = await getSupabase().from('document_files').insert({
    id,
    folder_id: folderId || null,
    name,
    storage_path: storagePath,
    mime_type: mime,
    size_bytes: size,
    kind: storedKind(indexed.kind || kindOf(name, mime)),
    extracted_text: fullText ? fullText.slice(0, 60000) : null,
    text_truncated: Boolean(indexed.truncated) || fullText.length > 60000,
  });
  if (error) {
    await getSupabase().storage.from(DOCUMENT_BUCKET).remove([storagePath]);
    throw new Error(friendlyError(error));
  }
  onProgress?.({ phase: 'done', progress: 1 });
}

export async function pickDocuments() {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      let settled = false;
      const finish = (files) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(Array.from(files || []));
      };
      input.addEventListener('change', () => finish(input.files));
      window.addEventListener('focus', () => setTimeout(() => finish(input.files), 400), { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    type: '*/*',
  });
  if (result.canceled) return [];
  const files = [];
  for (const asset of result.assets || []) {
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    files.push(
      Object.assign(blob, {
        name: asset.name || 'file',
        lastModified: Date.now(),
      }),
    );
  }
  return files;
}

export async function documentUrl(storagePath) {
  const { data, error } = await getSupabase()
    .storage.from(DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, 60 * 30);
  if (error || !data?.signedUrl) throw new Error(friendlyError(error) || 'Could not open that file.');
  return data.signedUrl;
}

export async function searchDocuments(query, folder) {
  const { data, error } = await getSupabase().rpc('search_staff_documents', {
    q: String(query || ''),
    folder: folder ? String(folder) : null,
  });
  if (error) throw new Error(friendlyError(error));
  return data || [];
}

function summarizeHit(row) {
  return {
    id: row.id,
    name: row.name,
    folder: row.folder_path || 'Documents',
    added: formatAdded(row.created_at),
    kind: row.kind,
    size: formatBytes(row.size_bytes),
    excerpt: row.excerpt || undefined,
    textTrimmed: row.text_truncated || undefined,
  };
}

export async function searchDocumentsForAssistant(query, folder) {
  const needle = String(query || '').trim();
  if (needle.length < 2) return { error: 'Give at least two characters to search Documents.' };
  const hits = await searchDocuments(needle, folder);
  return {
    modelResult: {
      query: needle,
      folder: folder || undefined,
      count: hits.length,
      files: hits.map(summarizeHit),
      note: hits.length
        ? 'Excerpts are the start of the file. Call read_document with an id for the rest. Photos, video, and PDFs attach when you read them.'
        : 'Nothing in Documents matched.',
    },
  };
}

async function folderPath(folderId) {
  if (!folderId) return 'Documents';
  const { data, error } = await getSupabase().from('document_folders').select('id, parent_id, name');
  if (error) return 'Documents';
  const byId = new Map((data || []).map((row) => [row.id, row]));
  const names = [];
  let walk = folderId;
  for (let depth = 0; walk && depth < 30; depth += 1) {
    const row = byId.get(walk);
    if (!row) break;
    names.push(row.name);
    walk = row.parent_id;
  }
  return names.length ? names.reverse().join(' / ') : 'Documents';
}

async function readById(id) {
  const { data, error } = await getSupabase()
    .from('document_files')
    .select('id, folder_id, name, storage_path, mime_type, kind, size_bytes, created_at, extracted_text, text_truncated')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(friendlyError(error));
  if (!data) return { error: 'That document is not in the library.' };
  const meta = {
    id: data.id,
    name: data.name,
    folder: await folderPath(data.folder_id),
    added: formatAdded(data.created_at),
    kind: data.kind,
    size: formatBytes(data.size_bytes),
  };
  const stored = String(data.extracted_text || '');
  if (stored) {
    return {
      modelResult: {
        ...meta,
        text: stored.slice(0, READ_CHARS),
        trimmed: data.text_truncated || stored.length > READ_CHARS || undefined,
      },
    };
  }
  if ((Number(data.size_bytes) || 0) > CHAT_OPEN_BYTES) {
    return {
      modelResult: {
        ...meta,
        note: 'This file is in Documents but it is too large to open in chat, and it has no extracted text.',
      },
    };
  }
  const downloaded = await getSupabase().storage.from(DOCUMENT_BUCKET).download(data.storage_path);
  if (downloaded.error || !downloaded.data) {
    return { modelResult: { ...meta, note: friendlyError(downloaded.error) || 'Could not open that file.' } };
  }
  const body =
    typeof File === 'function'
      ? new File([downloaded.data], data.name, {
          type: data.mime_type || downloaded.data.type || 'application/octet-stream',
        })
      : Object.assign(downloaded.data, { name: data.name });
  try {
    const prepared = await prepareAttachment(body);
    if (prepared.text) {
      return {
        modelResult: {
          ...meta,
          text: String(prepared.text).slice(0, READ_CHARS),
          trimmed: prepared.truncated || String(prepared.text).length > READ_CHARS || undefined,
        },
      };
    }
    if (prepared.images?.length || prepared.fileData) {
      return {
        modelResult: {
          ...meta,
          note: 'The file is attached with this result. Read it and answer from it.',
        },
        viewAttachments: [prepared],
      };
    }
    return { modelResult: { ...meta, note: 'No readable text was found in this file.' } };
  } catch (openError) {
    return { modelResult: { ...meta, note: openError?.message || 'Could not read that file.' } };
  }
}

export async function readDocumentForAssistant(args) {
  const id = String(args?.id || '').trim();
  const name = String(args?.name || '').trim();
  if (id) return readById(id);
  if (name.length < 2) return { error: 'Pass the document id from search_documents.' };
  const hits = await searchDocuments(name);
  const exact = hits.filter((hit) => hit.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0);
  const chosen = exact.length ? exact : hits;
  if (chosen.length === 1) return readById(chosen[0].id);
  return {
    modelResult: {
      matches: hits.slice(0, 12).map(summarizeHit),
      note: hits.length
        ? 'Several files match. Call read_document with the id you want.'
        : 'No document with that name.',
    },
  };
}
