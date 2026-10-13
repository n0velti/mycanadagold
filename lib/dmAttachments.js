import { getSupabase } from './supabase';
import { storableAttachment } from './aiAttachments';

export const DM_ATTACHMENT_BUCKET = 'dm-attachments';
const SIGN_SECONDS = 60 * 60 * 6;

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function safeName(name) {
  const cleaned = asString(name)
    .split(/[/\\]/)
    .pop()
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || 'file';
}

function newId() {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function storedDmAttachment(item) {
  if (!item) return null;
  const base = storableAttachment(item) || {};
  return {
    id: asString(base.id || item.id || newId()),
    name: asString(base.name || item.name || 'file').slice(0, 120),
    kind: asString(base.kind || item.kind || 'file'),
    size: Number(base.size || item.size) || 0,
    summary: asString(base.summary || item.summary).slice(0, 80),
    mime: asString(item.mime).slice(0, 120),
    path: asString(item.path),
    thumb: typeof item.thumb === 'string' && item.thumb.length < 12_000 ? item.thumb : base.thumb || '',
  };
}

export async function uploadDmAttachments(conversationId, items) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!list.length) return [];
  const conversation = asString(conversationId);
  if (!conversation) throw new Error('Missing conversation.');
  const supabase = getSupabase();
  const saved = [];
  for (const item of list) {
    const file = item.file;
    const meta = storedDmAttachment(item);
    if (!file || typeof file.arrayBuffer !== 'function') {
      saved.push(meta);
      continue;
    }
    const id = meta.id || newId();
    const path = `${conversation}/${id}-${safeName(meta.name)}`;
    const contentType = asString(item.mime || file.type) || 'application/octet-stream';
    const { error } = await supabase.storage.from(DM_ATTACHMENT_BUCKET).upload(path, file, {
      upsert: false,
      contentType,
      cacheControl: '3600',
    });
    if (error) throw new Error(error.message || `Could not upload ${meta.name}.`);
    saved.push({ ...meta, id, path });
  }
  return saved;
}

export async function signDmAttachmentPaths(paths) {
  const unique = [...new Set((Array.isArray(paths) ? paths : []).map(asString).filter(Boolean))];
  if (!unique.length) return {};
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(DM_ATTACHMENT_BUCKET)
    .createSignedUrls(unique, SIGN_SECONDS);
  if (error) return {};
  const byPath = {};
  (data || []).forEach((row, index) => {
    const path = row?.path || unique[index];
    if (row?.signedUrl && path) byPath[path] = row.signedUrl;
  });
  return byPath;
}

export async function hydrateDmMessages(messages) {
  const rows = Array.isArray(messages) ? messages : [];
  const paths = [];
  rows.forEach((row) => {
    (row.attachments || []).forEach((item) => {
      if (item?.path) paths.push(item.path);
    });
  });
  const urls = await signDmAttachmentPaths(paths);
  return rows.map((row) => {
    const attachments = (row.attachments || []).map((item) => ({
      ...item,
      url: item.path ? urls[item.path] || item.url || '' : item.url || '',
    }));
    const imageUrls = [
      ...(Array.isArray(row.imageUrls) ? row.imageUrls : []),
      ...attachments.filter((item) => item.kind === 'image' && item.url).map((item) => item.url),
    ];
    return { ...row, attachments, imageUrls };
  });
}
