import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  createFolder,
  deleteFile,
  deleteFolder,
  documentUrl,
  ensureFolder,
  formatAdded,
  listFolder,
  pickDocuments,
  renameFolder,
  searchDocuments,
  uploadDocument,
} from '../lib/documents';
import { formatBytes } from '../lib/aiAttachments';
import { useIsMobile } from '../lib/mobileUi';
import { EmptyState, FONT, T } from './TriageKit';

function confirmAction(title, message) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function fileIcon(kind) {
  if (kind === 'spreadsheet' || kind === 'xls') return 'grid-outline';
  if (kind === 'image') return 'image-outline';
  if (kind === 'video') return 'videocam-outline';
  if (kind === 'pdf') return 'document-outline';
  if (kind === 'document' || kind === 'doc' || kind === 'text') return 'document-text-outline';
  return 'document-attach-outline';
}

function uploadStatus(item) {
  if (item.error) return item.error;
  if (item.phase === 'reading') return 'Reading…';
  if (item.phase === 'saving') return 'Saving…';
  return `${Math.max(0, Math.min(100, Math.round((item.progress || 0) * 100)))}%`;
}

function readDirectory(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const next = () => {
      reader.readEntries((batch) => {
        if (!batch?.length) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    };
    next();
  });
}

function fileFromEntry(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

export default function DocumentsScreen({ session }) {
  const isMobile = useIsMobile();
  const [stack, setStack] = useState([]);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renamingId, setRenamingId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [preview, setPreview] = useState(null);
  const dropRef = useRef(null);
  const draggingRef = useRef(false);
  const dropHandler = useRef(async () => {});
  const folderId = stack.length ? stack[stack.length - 1].id : null;
  const folderName = stack.length ? stack[stack.length - 1].name : 'Documents';

  const loadToken = useRef(0);
  const folderRef = useRef(null);
  folderRef.current = folderId;

  const load = useCallback(async (id, quiet) => {
    const token = loadToken.current + 1;
    loadToken.current = token;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const page = await listFolder(id);
      if (loadToken.current !== token) return;
      setFolders(page.folders);
      setFiles(page.files);
    } catch (loadError) {
      if (loadToken.current !== token) return;
      setError(loadError?.message || 'Could not load Documents.');
    } finally {
      if (loadToken.current === token) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    load(folderId);
    return undefined;
  }, [session, folderId, load]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setHits(null);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await searchDocuments(needle);
        if (!cancelled) setHits(rows);
      } catch (searchError) {
        if (!cancelled) setError(searchError?.message || 'Could not search Documents.');
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const startUpload = useCallback(
    async (jobs) => {
      const queue = (jobs || []).filter((job) => job?.file && !String(job.file.name || '').startsWith('.'));
      if (!queue.length) return;
      const pending = queue.map((job) => ({
        id: `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name: job.file.name || 'File',
        folderId: job.folderId ?? null,
        file: job.file,
        phase: 'reading',
        progress: 0,
        error: '',
      }));
      setUploads((current) => [...pending, ...current]);
      const work = [...pending];
      const runOne = async () => {
        while (work.length) {
          const item = work.shift();
          try {
            await uploadDocument({
              file: item.file,
              folderId: item.folderId,
              onProgress: (next) => {
                setUploads((current) =>
                  current.map((row) => (row.id === item.id ? { ...row, ...next, error: '' } : row)),
                );
              },
            });
            setUploads((current) => current.filter((row) => row.id !== item.id));
            if ((item.folderId || null) === (folderRef.current || null)) load(folderRef.current, true);
          } catch (uploadError) {
            setUploads((current) =>
              current.map((row) =>
                row.id === item.id
                  ? { ...row, phase: 'error', error: uploadError?.message || 'Could not upload that file.' }
                  : row,
              ),
            );
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, work.length) }, () => runOne()));
    },
    [load],
  );

  const takeDrop = useCallback(
    async (dataTransfer) => {
      try {
        const items = Array.from(dataTransfer?.items || []);
        const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
        if (!entries.length) {
          const files = Array.from(dataTransfer?.files || []);
          await startUpload(files.map((file) => ({ file, folderId })));
          return;
        }
        const jobs = [];
        const walk = async (entry, parentId) => {
          if (!entry || String(entry.name || '').startsWith('.')) return;
          if (entry.isFile) {
            jobs.push({ file: await fileFromEntry(entry), folderId: parentId });
            return;
          }
          if (!entry.isDirectory) return;
          const folder = await ensureFolder(entry.name, parentId);
          const children = await readDirectory(entry.createReader());
          for (const child of children) await walk(child, folder.id);
        };
        for (const entry of entries) await walk(entry, folderId);
        load(folderId);
        await startUpload(jobs);
      } catch (dropError) {
        setError(dropError?.message || 'Could not add those files.');
      }
    },
    [folderId, load, startUpload],
  );

  useEffect(() => {
    dropHandler.current = takeDrop;
  }, [takeDrop]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const node = dropRef.current;
    if (!node || typeof node.addEventListener !== 'function') return undefined;
    const markDragging = (event) => {
      event.preventDefault();
      if (draggingRef.current) return;
      draggingRef.current = true;
      setDragging(true);
    };
    const leave = (event) => {
      event.preventDefault();
      const next = event.relatedTarget;
      if (next && node.contains(next)) return;
      draggingRef.current = false;
      setDragging(false);
    };
    const drop = (event) => {
      event.preventDefault();
      event.stopPropagation();
      draggingRef.current = false;
      setDragging(false);
      dropHandler.current(event.dataTransfer);
    };
    const stopNavigate = (event) => event.preventDefault();
    node.addEventListener('dragenter', markDragging);
    node.addEventListener('dragover', markDragging);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', drop);
    window.addEventListener('dragover', stopNavigate);
    window.addEventListener('drop', stopNavigate);
    return () => {
      node.removeEventListener('dragenter', markDragging);
      node.removeEventListener('dragover', markDragging);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
      window.removeEventListener('dragover', stopNavigate);
      window.removeEventListener('drop', stopNavigate);
    };
  }, [session]);

  const openFile = async (file) => {
    try {
      const url = await documentUrl(file.storagePath || file.storage_path);
      if (file.kind === 'image') {
        setPreview({ name: file.name, url, kind: 'image' });
        return;
      }
      if (Platform.OS === 'web') window.open(url, '_blank', 'noopener,noreferrer');
      else await Linking.openURL(url);
    } catch (openError) {
      setError(openError?.message || 'Could not open that file.');
    }
  };

  const onCreate = async () => {
    try {
      await createFolder(draftName, folderId);
      setDraftName('');
      setCreating(false);
      load(folderId);
    } catch (createError) {
      setError(createError?.message || 'Could not create that folder.');
    }
  };

  const renameLock = useRef(false);
  const onRename = async (folder) => {
    if (renameLock.current) return;
    renameLock.current = true;
    const next = renameValue.trim();
    setRenamingId('');
    if (!next || next === folder.name) {
      renameLock.current = false;
      return;
    }
    try {
      await renameFolder(folder.id, next);
      setStack((current) => current.map((item) => (item.id === folder.id ? { ...item, name: next } : item)));
      load(folderId);
    } catch (renameError) {
      setError(renameError?.message || 'Could not rename that folder.');
    } finally {
      renameLock.current = false;
    }
  };

  const onDeleteFile = async (file) => {
    const ok = await confirmAction('Delete file', `Delete ${file.name}?`);
    if (!ok) return;
    setBusyId(file.id);
    try {
      await deleteFile({ id: file.id, storagePath: file.storagePath || file.storage_path });
      load(folderId);
      if (hits) {
        const rows = await searchDocuments(query.trim());
        setHits(rows);
      }
    } catch (deleteError) {
      setError(deleteError?.message || 'Could not delete that file.');
    } finally {
      setBusyId('');
    }
  };

  const onDeleteFolder = async (folder) => {
    const ok = await confirmAction('Delete folder', `Delete ${folder.name} and everything inside it?`);
    if (!ok) return;
    setBusyId(folder.id);
    try {
      await deleteFolder(folder.id);
      if (stack.some((item) => item.id === folder.id)) {
        const index = stack.findIndex((item) => item.id === folder.id);
        setStack((current) => current.slice(0, index));
      } else {
        load(folderId);
      }
    } catch (deleteError) {
      setError(deleteError?.message || 'Could not delete that folder.');
    } finally {
      setBusyId('');
    }
  };

  const chooseFiles = async () => {
    try {
      const picked = await pickDocuments();
      await startUpload(picked.map((file) => ({ file, folderId })));
    } catch (pickError) {
      setError(pickError?.message || 'Could not add those files.');
    }
  };

  if (!session) {
    return (
      <View style={styles.emptyWrap}>
        <EmptyState icon="folder-outline" title="Sign in to Documents" body="Log in to upload and open company files." />
      </View>
    );
  }

  const showingSearch = query.trim().length >= 2;
  const rows = showingSearch ? [] : folders;

  return (
    <View ref={dropRef} style={styles.root}>
      <View style={[styles.toolbar, isMobile && styles.toolbarMobile]}>
        <View style={styles.crumbs}>
          <Pressable onPress={() => setStack([])} accessibilityRole="button">
            <Text style={[styles.crumb, !stack.length && styles.crumbCurrent]}>Documents</Text>
          </Pressable>
          {stack.map((folder, index) => (
            <View key={folder.id} style={styles.crumbWrap}>
              <Text style={styles.crumbSep}>/</Text>
              <Pressable
                onPress={() => setStack((current) => current.slice(0, index + 1))}
                accessibilityRole="button"
              >
                <Text style={[styles.crumb, index === stack.length - 1 && styles.crumbCurrent]}>{folder.name}</Text>
              </Pressable>
            </View>
          ))}
        </View>
        <View style={[styles.actions, isMobile && styles.actionsMobile]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search documents"
            placeholderTextColor={T.secondary}
            style={[styles.search, isMobile && styles.searchMobile]}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={styles.action} onPress={() => { setCreating(true); setDraftName(''); }} accessibilityRole="button">
            <Ionicons name="folder-open-outline" size={16} color={T.text} />
            <Text style={styles.actionText}>New folder</Text>
          </Pressable>
          <Pressable style={[styles.action, styles.actionFill]} onPress={chooseFiles} accessibilityRole="button">
            <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
            <Text style={[styles.actionText, styles.actionTextFill]}>Upload</Text>
          </Pressable>
        </View>
      </View>

      {error ? (
        <Pressable style={styles.banner} onPress={() => setError('')} accessibilityRole="button">
          <Text style={styles.bannerText}>{error}</Text>
        </Pressable>
      ) : null}

      {creating ? (
        <View style={styles.createRow}>
          <Ionicons name="folder-outline" size={18} color={T.secondary} />
          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Folder name"
            placeholderTextColor={T.secondary}
            style={styles.createInput}
            autoFocus
            onSubmitEditing={onCreate}
          />
          <Pressable onPress={onCreate} accessibilityRole="button">
            <Text style={styles.link}>Create</Text>
          </Pressable>
          <Pressable onPress={() => setCreating(false)} accessibilityRole="button">
            <Text style={styles.linkMuted}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {uploads.map((item) => (
        <View key={item.id} style={styles.uploadRow}>
          <View style={styles.uploadCopy}>
            <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.rowMeta, item.error && styles.errorText]} numberOfLines={2}>{uploadStatus(item)}</Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.bar,
                  { width: `${Math.round((item.phase === 'saving' ? 1 : item.progress || 0) * 100)}%` },
                ]}
              />
            </View>
          </View>
          {item.error ? (
            <Pressable onPress={() => setUploads((current) => current.filter((row) => row.id !== item.id))} accessibilityLabel="Dismiss">
              <Ionicons name="close" size={18} color={T.secondary} />
            </Pressable>
          ) : null}
        </View>
      ))}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {loading && !folders.length && !files.length && !showingSearch ? (
          <ActivityIndicator color={T.secondary} style={styles.spinner} />
        ) : null}

        {showingSearch ? (
          <Text style={styles.sectionLabel}>{searching ? 'Searching…' : `${hits?.length || 0} results`}</Text>
        ) : null}

        {showingSearch
          ? (hits || []).map((hit) => (
              <FileRow
                key={hit.id}
                name={hit.name}
                kind={hit.kind}
                meta={[hit.folder_path || 'Documents', formatAdded(hit.created_at), formatBytes(hit.size_bytes)].filter(Boolean).join('  ·  ')}
                busy={busyId === hit.id}
                onOpen={() => openFile(hit)}
                onDelete={() => onDeleteFile(hit)}
              />
            ))
          : null}

        {!showingSearch && rows.map((folder) => (
          <View key={folder.id} style={styles.row}>
            <Pressable style={styles.rowMain} onPress={() => setStack((current) => [...current, folder])} accessibilityRole="button">
              <Ionicons name="folder" size={22} color="#8A7340" />
              <View style={styles.rowCopy}>
                {renamingId === folder.id ? (
                  <TextInput
                    value={renameValue}
                    onChangeText={setRenameValue}
                    style={styles.renameInput}
                    autoFocus
                    onSubmitEditing={() => onRename(folder)}
                    onBlur={() => onRename(folder)}
                  />
                ) : (
                  <Text style={styles.rowTitle} numberOfLines={1}>{folder.name}</Text>
                )}
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {['Folder', folder.addedLabel && `Added ${folder.addedLabel}`, folder.addedBy].filter(Boolean).join('  ·  ')}
                </Text>
              </View>
            </Pressable>
            <Pressable
              style={styles.iconButton}
              onPress={() => { setRenamingId(folder.id); setRenameValue(folder.name); }}
              accessibilityLabel={`Rename ${folder.name}`}
            >
              <Ionicons name="pencil-outline" size={16} color={T.secondary} />
            </Pressable>
            <Pressable
              style={styles.iconButton}
              onPress={() => onDeleteFolder(folder)}
              disabled={busyId === folder.id}
              accessibilityLabel={`Delete ${folder.name}`}
            >
              <Ionicons name="trash-outline" size={16} color={T.secondary} />
            </Pressable>
          </View>
        ))}

        {!showingSearch && files.map((file) => (
          <FileRow
            key={file.id}
            name={file.name}
            kind={file.kind}
            meta={[file.addedLabel && `Added ${file.addedLabel}`, file.addedBy, file.sizeLabel].filter(Boolean).join('  ·  ')}
            busy={busyId === file.id}
            onOpen={() => openFile(file)}
            onDelete={() => onDeleteFile(file)}
          />
        ))}

        {!loading && !showingSearch && !folders.length && !files.length ? (
          <Text style={styles.emptyBody}>Drop files here, or upload them into this folder.</Text>
        ) : null}
        {showingSearch && !searching && hits && !hits.length ? (
          <Text style={styles.emptyBody}>Nothing in Documents matches that.</Text>
        ) : null}
      </ScrollView>
      {dragging ? (
        <View pointerEvents="none" style={styles.dropOverlay}>
          <Ionicons name="cloud-upload-outline" size={28} color={T.text} />
          <Text style={styles.dropTitle}>Drop to upload into {folderName}</Text>
          <Text style={styles.rowMeta}>Files land in this folder. A dropped folder is created here.</Text>
        </View>
      ) : null}

      <Modal visible={Boolean(preview)} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.previewBackdrop} onPress={() => setPreview(null)}>
          <View style={styles.previewCard}>
            <Text style={styles.rowTitle} numberOfLines={1}>{preview?.name}</Text>
            {preview?.url ? (
              <Image source={{ uri: preview.url }} style={styles.previewImage} resizeMode="contain" />
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function FileRow({ name, kind, meta, busy, onOpen, onDelete }) {
  return (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={onOpen} accessibilityRole="button">
        <Ionicons name={fileIcon(kind)} size={22} color={T.text} />
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle} numberOfLines={1}>{name}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>
        </View>
      </Pressable>
      <Pressable style={styles.iconButton} onPress={onDelete} disabled={busy} accessibilityLabel={`Delete ${name}`}>
        {busy ? <ActivityIndicator size="small" color={T.secondary} /> : <Ionicons name="trash-outline" size={16} color={T.secondary} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg, minHeight: 0 },
  emptyWrap: { flex: 1, backgroundColor: T.bg, justifyContent: 'center' },
  toolbar: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 12 },
  toolbarMobile: { paddingHorizontal: 16 },
  crumbs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  crumbWrap: { flexDirection: 'row', alignItems: 'center' },
  crumb: { fontFamily: FONT, fontSize: 15, color: T.secondary },
  crumbCurrent: { color: T.text },
  crumbSep: { fontFamily: FONT, fontSize: 15, color: T.tertiary, marginHorizontal: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionsMobile: { flexWrap: 'wrap' },
  search: {
    flex: 1,
    minWidth: 160,
    height: 36,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: T.hairline,
    fontFamily: FONT,
    fontSize: 14,
    color: T.text,
  },
  searchMobile: { minWidth: '100%' },
  action: {
    height: 36,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: T.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionFill: { backgroundColor: '#1a1a1a', borderColor: '#1a1a1a' },
  actionText: { fontFamily: FONT, fontSize: 14, color: T.text },
  actionTextFill: { color: '#fff' },
  banner: { marginHorizontal: 20, marginBottom: 8, padding: 10, borderRadius: 8, backgroundColor: '#FDECEC' },
  bannerText: { fontFamily: FONT, fontSize: 13, color: T.red },
  createRow: {
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: T.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  createInput: { flex: 1, fontFamily: FONT, fontSize: 15, color: T.text, height: 40 },
  link: { fontFamily: FONT, fontSize: 14, color: T.text },
  linkMuted: { fontFamily: FONT, fontSize: 14, color: T.secondary },
  uploadRow: {
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: T.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  uploadCopy: { flex: 1, gap: 4 },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.06)', overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2, backgroundColor: '#1a1a1a' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingBottom: 32 },
  sectionLabel: {
    fontFamily: FONT,
    fontSize: 12,
    color: T.secondary,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 4,
    minHeight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: FONT, fontSize: 15, color: T.text },
  rowMeta: { fontFamily: FONT, fontSize: 12, color: T.secondary },
  errorText: { color: T.red },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  renameInput: {
    fontFamily: FONT,
    fontSize: 15,
    color: T.text,
    borderBottomWidth: 1,
    borderBottomColor: T.text,
    paddingVertical: 0,
  },
  dropOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    bottom: 8,
    left: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#1a1a1a',
    backgroundColor: 'rgba(252,252,251,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dropTitle: { fontFamily: FONT, fontSize: 16, color: T.text },
  spinner: { marginTop: 32 },
  emptyBody: { fontFamily: FONT, fontSize: 14, color: T.secondary, paddingHorizontal: 8, paddingTop: 8 },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  previewCard: { width: '100%', maxWidth: 880, gap: 12 },
  previewImage: { width: '100%', height: 520, backgroundColor: 'transparent' },
});
