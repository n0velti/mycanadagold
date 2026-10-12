import { Text, View } from 'react-native';
import { FONT } from './TriageKit';

export default function AnalyticsMapCard({ chart }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{chart?.title || 'Map'}</Text>
      <Text style={styles.body}>Open Analytics in the browser to use the map.</Text>
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
