// Shared helpers for attached documents. Files live in a private Vercel Blob store;
// the database keeps one row per file (table: attachments).
import { del } from '@vercel/blob';

export const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file
export const PREFIX = 'attachments/';

// Only these may open inside the browser. Everything else is always a download.
export const INLINE_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export const extOf = (name) => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
};

// A plain-letters name for the storage path. The original name (accents and all) is kept in the
// database and is what people see and what a download is called.
export function safeFileName(name) {
  let n = String(name || 'file').normalize('NFD').replace(/[̀-ͯ]/g, '');
  n = n.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().replace(/^[._]+/, '');
  if (n.length > 120) {
    const e = extOf(n);
    n = n.slice(0, 110) + (e ? '.' + e : '');
  }
  return n || 'file';
}

export const cleanDisplayName = (name) => {
  const n = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return n.slice(0, 255);
};

// Deletes stored files. Never throws: a leftover file is better than a failed delete.
export async function deleteBlobs(pathnames) {
  const list = (pathnames || []).filter((p) => typeof p === 'string' && p.startsWith(PREFIX));
  if (!list.length) return;
  try {
    await del(list);
  } catch (e) {
    console.error('Could not delete stored files', e && e.message);
  }
}
