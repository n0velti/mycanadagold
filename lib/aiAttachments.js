/**
 * Files a user drops into the Analytics chat, turned into things a model can
 * read: images (HEIC included) become JPEG data URLs, a video becomes a handful
 * of frames, spreadsheets and Word documents become text, and PDFs are passed
 * through for OpenRouter to parse. Everything runs on the device.
 */
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { strFromU8, unzipSync } from 'fflate';
import { blobToDataUrl, toSupportedImageBlob } from './imageEncode';
import { compressImageDataUrl } from './openrouter';

export const MAX_ATTACHMENTS = 8;
const MAX_IMAGE_EDGE = 1600;
const THUMB_EDGE = 160;
const MAX_VIDEO_FRAMES = 6;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const MAX_SHEET_ROWS = 2_000;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i;
const SHEET_EXT = /\.(xlsx|xlsm|csv|tsv)$/i;
const OLD_SHEET_EXT = /\.xls$/i;
const DOC_EXT = /\.docx$/i;
const OLD_DOC_EXT = /\.doc$/i;
const PDF_EXT = /\.pdf$/i;
const TEXT_EXT = /\.(txt|md|json|log)$/i;

export const ACCEPT_LIST = [
  'image/*',
  'video/*',
  '.heic',
  '.heif',
  '.xlsx',
  '.xlsm',
  '.xls',
  '.csv',
  '.tsv',
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.md',
  '.json',
].join(',');

function newId() {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function kindOf(name, mime) {
  const file = String(name || '');
  const type = String(mime || '').toLowerCase();
  if (PDF_EXT.test(file) || type === 'application/pdf') return 'pdf';
  if (OLD_SHEET_EXT.test(file) || type === 'application/vnd.ms-excel') return 'xls';
  if (SHEET_EXT.test(file) || type.includes('spreadsheetml') || type === 'text/csv') return 'spreadsheet';
  if (OLD_DOC_EXT.test(file) || type === 'application/msword') return 'doc';
  if (DOC_EXT.test(file) || type.includes('wordprocessingml')) return 'document';
  if (VIDEO_EXT.test(file) || type.startsWith('video/')) return 'video';
  if (IMAGE_EXT.test(file) || type.startsWith('image/')) return 'image';
  if (TEXT_EXT.test(file) || type.startsWith('text/')) return 'text';
  return 'unknown';
}

export function formatBytes(count) {
  const n = Number(count) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

function pickWeb() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ACCEPT_LIST;
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    let settled = false;
    const finish = (files) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files || [])));
    // Cancel fires no change event; the window regains focus with no files.
    const onFocus = () => setTimeout(() => finish(Array.from(input.files || [])), 400);
    window.addEventListener('focus', onFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

async function pickNative() {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    type: ['image/*', 'video/*', 'application/pdf', 'text/*', 'application/*'],
  });
  if (result.canceled) return [];
  const files = [];
  for (const asset of result.assets || []) {
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    files.push(Object.assign(blob, { name: asset.name || 'file', lastModified: Date.now(), nativeMime: asset.mimeType || '' }));
  }
  return files;
}

/** Opens the system picker. Resolves to File / Blob objects (possibly empty). */
export async function pickFiles() {
  if (Platform.OS === 'web' && typeof document !== 'undefined') return pickWeb();
  return pickNative();
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function fileName(file) {
  return String(file?.name || 'file');
}

function fileMime(file) {
  return String(file?.type || file?.nativeMime || '');
}

async function thumbnail(dataUrl) {
  try {
    return await compressImageDataUrl(dataUrl, { maxWidth: THUMB_EDGE, quality: 0.7 });
  } catch {
    return '';
  }
}

async function prepareImage(file) {
  const supported = await toSupportedImageBlob(file, { mime: fileMime(file), name: fileName(file) });
  const raw = await blobToDataUrl(supported.blob);
  const dataUrl = await compressImageDataUrl(raw, { maxWidth: MAX_IMAGE_EDGE, quality: 0.86 });
  return {
    kind: 'image',
    images: [dataUrl],
    thumb: await thumbnail(dataUrl),
    summary: 'photo',
  };
}

function waitEvent(target, name, errorName = 'error') {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error('Could not read that video.'));
    };
    const cleanup = () => {
      target.removeEventListener(name, ok);
      target.removeEventListener(errorName, bad);
    };
    target.addEventListener(name, ok, { once: true });
    target.addEventListener(errorName, bad, { once: true });
  });
}

async function prepareVideo(file) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    throw new Error('Video clips can be attached from the web app.');
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await Promise.race([
      waitEvent(video, 'loadedmetadata'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('That video took too long to open.')), 15_000)),
    ]);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const count = duration ? Math.min(MAX_VIDEO_FRAMES, Math.max(2, Math.ceil(duration / 3))) : 1;
    const times = Array.from({ length: count }, (_, index) =>
      duration ? Math.min(duration - 0.05, (duration * (index + 0.5)) / count) : 0,
    );
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames = [];
    for (const time of times) {
      video.currentTime = time;
      await Promise.race([
        waitEvent(video, 'seeked'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Could not decode that video in this browser. Try an MP4.')), 8_000)),
      ]);
      if (!video.videoWidth || !video.videoHeight) throw new Error('Could not decode that video in this browser. Try an MP4.');
      const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.82));
    }
    if (!frames.length) throw new Error('Could not read any frames from that video.');
    return {
      kind: 'video',
      images: frames,
      thumb: await thumbnail(frames[0]),
      summary: `${frames.length} frames${duration ? ` from a ${Math.round(duration)}s clip` : ''}`,
      duration,
    };
  } finally {
    video.removeAttribute('src');
    video.load?.();
    URL.revokeObjectURL(url);
  }
}

// ---- spreadsheets ----------------------------------------------------------

function xmlText(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function innerText(xml) {
  return xmlText(String(xml || '').replace(/<[^>]+>/g, ''));
}

function columnIndex(ref) {
  const letters = String(ref || '').match(/^[A-Z]+/)?.[0] || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function readXlsx(bytes) {
  const files = unzipSync(bytes);
  const read = (path) => (files[path] ? strFromU8(files[path]) : '');
  const sharedXml = read('xl/sharedStrings.xml');
  const shared = [];
  if (sharedXml) {
    for (const match of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const texts = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1]));
      shared.push(texts.join(''));
    }
  }
  const workbook = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  const relTargets = new Map();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = match[0].match(/\bId="([^"]+)"/)?.[1];
    const target = match[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relTargets.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  const sheets = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlText(match[0].match(/\bname="([^"]*)"/)?.[1] || `Sheet${sheets.length + 1}`);
    const rid = match[0].match(/\br:id="([^"]+)"/)?.[1];
    const path = relTargets.get(rid) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = read(path);
    if (!xml) continue;
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1] || '';
        const body = cell[2] || '';
        const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1] || '';
        const type = attrs.match(/\bt="([^"]+)"/)?.[1] || '';
        let value = '';
        if (type === 's') {
          value = shared[Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1])] ?? '';
        } else if (type === 'inlineStr') {
          value = innerText(body.match(/<is>([\s\S]*?)<\/is>/)?.[1] || '');
        } else if (type === 'b') {
          value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] === '1' ? 'TRUE' : 'FALSE';
        } else {
          value = xmlText(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
        }
        const index = ref ? columnIndex(ref) : cells.length;
        while (cells.length < index) cells.push('');
        cells[index] = value;
      }
      if (cells.some((item) => String(item).trim() !== '')) rows.push(cells);
      if (rows.length >= MAX_SHEET_ROWS) break;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

function sheetsToText(sheets, limit) {
  let text = '';
  let truncated = false;
  for (const sheet of sheets) {
    const header = `## Sheet: ${sheet.name} (${sheet.rows.length} rows)\n`;
    text += `${text ? '\n' : ''}${header}`;
    for (const row of sheet.rows) {
      const line = `${row.map(csvCell).join(',')}\n`;
      if (text.length + line.length > limit) {
        truncated = true;
        break;
      }
      text += line;
    }
    if (truncated) break;
  }
  return { text, truncated };
}

async function prepareSpreadsheet(file) {
  const name = fileName(file);
  if (/\.(csv|tsv)$/i.test(name) || /^text\//.test(fileMime(file))) {
    const raw = await file.text();
    const lines = raw.split(/\r?\n/).filter((line) => line.trim());
    const text = lines.slice(0, MAX_SHEET_ROWS).join('\n').slice(0, MAX_TEXT_CHARS);
    return {
      kind: 'spreadsheet',
      text,
      summary: `${Math.min(lines.length, MAX_SHEET_ROWS).toLocaleString('en-CA')} rows`,
      truncated: lines.length > MAX_SHEET_ROWS || text.length < Math.min(raw.length, MAX_TEXT_CHARS) ? true : undefined,
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sheets = readXlsx(bytes);
  if (!sheets.length) throw new Error(`No sheets found in ${name}.`);
  const { text, truncated } = sheetsToText(sheets, MAX_TEXT_CHARS);
  const rows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
  return {
    kind: 'spreadsheet',
    text,
    sheets: sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows.length })),
    summary: `${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'} · ${rows.toLocaleString('en-CA')} rows`,
    truncated: truncated || undefined,
  };
}

// ---- Word ------------------------------------------------------------------

async function prepareDocx(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(bytes);
  const xml = files['word/document.xml'] ? strFromU8(files['word/document.xml']) : '';
  if (!xml) throw new Error(`Could not read ${fileName(file)}.`);
  const body = xml.match(/<w:body>([\s\S]*?)<\/w:body>/)?.[1] || xml;
  const lines = [];
  for (const block of body.matchAll(/<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>/g)) {
    const chunk = block[0];
    if (chunk.startsWith('<w:tbl')) {
      for (const row of chunk.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
        const cells = [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cell) =>
          [...cell[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => xmlText(m[1])).join(''),
        );
        if (cells.some((cell) => cell.trim())) lines.push(cells.join(' | '));
      }
      lines.push('');
      continue;
    }
    const text = chunk
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_, t) => xmlText(t))
      .replace(/<[^>]+>/g, '');
    lines.push(text);
  }
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  return {
    kind: 'document',
    text: text.slice(0, MAX_TEXT_CHARS),
    summary: `${words.toLocaleString('en-CA')} words`,
    truncated: text.length > MAX_TEXT_CHARS ? true : undefined,
  };
}

async function preparePdf(file) {
  if (file.size > MAX_PDF_BYTES) throw new Error(`${fileName(file)} is over ${formatBytes(MAX_PDF_BYTES)}. Split it or export the pages you need.`);
  const dataUrl = await blobToDataUrl(file);
  const fixed = dataUrl.startsWith('data:application/pdf') ? dataUrl : dataUrl.replace(/^data:[^;]*;/, 'data:application/pdf;');
  return { kind: 'pdf', fileData: fixed, summary: formatBytes(file.size) };
}

async function prepareText(file) {
  const raw = await file.text();
  return {
    kind: 'text',
    text: raw.slice(0, MAX_TEXT_CHARS),
    summary: `${raw.split(/\r?\n/).length.toLocaleString('en-CA')} lines`,
    truncated: raw.length > MAX_TEXT_CHARS ? true : undefined,
  };
}

/**
 * Turn one picked file into a chat attachment. Throws with a user-facing
 * message when the type is not supported.
 */
export async function prepareAttachment(file) {
  const name = fileName(file);
  const size = Number(file?.size) || 0;
  if (size > MAX_FILE_BYTES) throw new Error(`${name} is over ${formatBytes(MAX_FILE_BYTES)}.`);
  const kind = kindOf(name, fileMime(file));
  let prepared;
  if (kind === 'image') prepared = await prepareImage(file);
  else if (kind === 'video') prepared = await prepareVideo(file);
  else if (kind === 'spreadsheet') prepared = await prepareSpreadsheet(file);
  else if (kind === 'document') prepared = await prepareDocx(file);
  else if (kind === 'pdf') prepared = await preparePdf(file);
  else if (kind === 'text') prepared = await prepareText(file);
  else if (kind === 'xls') throw new Error(`${name} is an old Excel format. Save it as .xlsx and attach that.`);
  else if (kind === 'doc') throw new Error(`${name} is an old Word format. Save it as .docx and attach that.`);
  else throw new Error(`${name}: that file type is not supported. Use images, video, Excel, CSV, PDF, or Word.`);
  return { id: newId(), name, size, mime: fileMime(file), ...prepared };
}

// ---------------------------------------------------------------------------
// Model input
// ---------------------------------------------------------------------------

export function attachmentLabel(attachment) {
  const kind = attachment?.kind;
  if (kind === 'image') return 'Photo';
  if (kind === 'video') return 'Video';
  if (kind === 'spreadsheet') return 'Spreadsheet';
  if (kind === 'document') return 'Word document';
  if (kind === 'pdf') return 'PDF';
  if (kind === 'text') return 'Text file';
  return 'File';
}

/** Text the model reads for text-like attachments, with a header per file. */
export function attachmentsText(attachments) {
  const blocks = [];
  for (const item of attachments || []) {
    if (!item?.text) continue;
    const note = item.truncated ? ' (trimmed to the first part)' : '';
    blocks.push(`### Attached ${attachmentLabel(item).toLowerCase()}: ${item.name}${note}\n${item.text}`);
  }
  return blocks.join('\n\n');
}

/**
 * OpenAI-style content parts for the user message: the text, then one
 * image_url per photo or video frame, then one file part per PDF.
 */
export function attachmentParts(attachments) {
  const parts = [];
  for (const item of attachments || []) {
    for (const url of item?.images || []) parts.push({ type: 'image_url', image_url: { url } });
    if (item?.kind === 'pdf' && item.fileData) {
      parts.push({ type: 'file', file: { filename: item.name, file_data: item.fileData } });
    }
  }
  return parts;
}

export function hasPdf(attachments) {
  return (attachments || []).some((item) => item?.kind === 'pdf');
}

/** What is kept on the saved turn: no full images or PDFs, just enough to show and refer back. */
export function storableAttachment(attachment) {
  if (!attachment) return null;
  return {
    id: String(attachment.id || newId()),
    name: String(attachment.name || 'file').slice(0, 120),
    kind: String(attachment.kind || 'file'),
    size: Number(attachment.size) || 0,
    summary: String(attachment.summary || '').slice(0, 80),
    thumb: typeof attachment.thumb === 'string' && attachment.thumb.length < 12_000 ? attachment.thumb : '',
    text: typeof attachment.text === 'string' ? attachment.text.slice(0, 20_000) : '',
    truncated: attachment.truncated ? true : undefined,
  };
}
