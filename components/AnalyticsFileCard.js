import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildXlsx, downloadXlsx, safeFileName } from '../lib/xlsx';
import { CANVAS, NAV_TAB_ACTIVE_BG, NAV_TAB_ACTIVE_RADIUS } from '../lib/mobileUi';
import { FONT } from '../lib/typography';

const INK = '#1a1a1a';
const MUTED = '#8e8e93';
const GOLD = '#B8860B';

function formatBytes(count) {
  if (!Number.isFinite(count) || count <= 0) return '';
  if (count < 1024) return `${count} B`;
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(count < 10 * 1024 ? 1 : 0)} KB`;
  return `${(count / (1024 * 1024)).toFixed(1)} MB`;
}

function sheetsReady(chart) {
  return (chart?.sheets || []).every((sheet) => Array.isArray(sheet.rows) && (sheet.rows.length > 0 || !sheet.spec));
}

/**
 * A generated .xlsx in the thread. Rows live on the chart for this session;
 * after a reload the sheets that came from a live source are rebuilt through
 * `onRebuild` before the download starts.
 */
export default function AnalyticsFileCard({ chart, onRebuild }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [size, setSize] = useState(0);

  if (!chart) return null;
  const sheets = Array.isArray(chart.sheets) ? chart.sheets : [];
  const fileName = safeFileName(chart.fileName || chart.title);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      let ready = chart;
      if (!sheetsReady(chart)) {
        if (!onRebuild) throw new Error('Reopen Analytics to rebuild this file.');
        setNote('Rebuilding the data…');
        ready = await onRebuild(chart);
      }
      const bytes = buildXlsx({
        title: chart.fileName || chart.title,
        sheets: (ready.sheets || []).map((sheet) => ({ name: sheet.name, columns: sheet.columns, rows: sheet.rows })),
      });
      setSize(bytes.length);
      if (!downloadXlsx(bytes, fileName)) {
        setNote('Downloads work in the web app. Open Analytics in a browser to save this file.');
        return;
      }
      setNote(`Saved ${fileName}`);
    } catch (error) {
      setNote(error?.message || 'Could not build the file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name="grid-outline" size={18} color={GOLD} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>
            {fileName}
          </Text>
          <Text style={styles.meta} numberOfLines={2}>
            {sheets.length} {sheets.length === 1 ? 'sheet' : 'sheets'}
            {size ? ` · ${formatBytes(size)}` : ''}
            {' · Excel workbook'}
          </Text>
        </View>
        <Pressable
          onPress={download}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Download ${fileName}`}
          style={({ hovered, pressed }) => [styles.button, (hovered || pressed) && !busy && styles.buttonHover, busy && styles.buttonBusy]}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="download-outline" size={15} color="#fff" />}
          <Text style={styles.buttonText}>{busy ? 'Building' : 'Download'}</Text>
        </Pressable>
      </View>
      <View style={styles.tabs}>
        {sheets.map((sheet) => {
          const count = Array.isArray(sheet.rows) && sheet.rows.length ? sheet.rows.length : sheet.total || 0;
          return (
            <View key={sheet.name} style={styles.tab}>
              <Text style={styles.tabName} numberOfLines={1}>
                {sheet.name}
              </Text>
              <Text style={styles.tabCount}>
                {count.toLocaleString('en-CA')} {count === 1 ? 'row' : 'rows'}
                {sheet.total > count ? ` of ${sheet.total.toLocaleString('en-CA')}` : ''}
                {sheet.columns?.length ? ` · ${sheet.columns.length} col` : ''}
              </Text>
            </View>
          );
        })}
      </View>
      {chart.note || note ? <Text style={styles.note}>{[chart.note, note].filter(Boolean).join(' ')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    marginTop: 8,
    padding: 12,
    gap: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: CANVAS,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CANVAS,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: INK,
  },
  meta: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: INK,
    flexShrink: 0,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  buttonHover: {
    backgroundColor: '#3a3a3c',
  },
  buttonBusy: {
    opacity: 0.7,
  },
  buttonText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: '#fff',
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tab: {
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: NAV_TAB_ACTIVE_BG,
    gap: 1,
  },
  tabName: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '500',
    color: INK,
  },
  tabCount: {
    fontFamily: FONT,
    fontSize: 11,
    color: MUTED,
  },
  note: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
});
