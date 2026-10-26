import { Text, View } from 'react-native';
import { FONT } from './TriageKit';

/** Charts draw on web only; nothing to fetch ahead of time here. */
export function warmCharts() {}

export default function AnalyticsChartCard({ chart }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{chart?.title || 'Chart'}</Text>
      <Text style={styles.body}>Open Analytics in the browser to use this chart.</Text>
    </View>
  );
}

const styles = {
  card: {
    marginTop: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f5f5f7',
  },
  title: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  body: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: '#6e6e73',
    marginTop: 4,
  },
};
