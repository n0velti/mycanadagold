import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const INK = '#B91C1C';

/** Red star with a line through it, plus the 1- and 2-star review count. */
export default function LowReviewMark({ count = 0, size = 13, countSize = 13 }) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  const icon = Math.max(11, size);
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.starBox, { width: icon, height: icon }]}>
        <Ionicons name="star" size={icon} color={INK} />
        <View
          pointerEvents="none"
          style={[styles.slash, styles.slashGap, { top: icon / 2 - 1.75 }]}
        />
        <View
          pointerEvents="none"
          style={[styles.slash, styles.slashInk, { top: icon / 2 - 0.875 }]}
        />
      </View>
      <Text style={[styles.count, { fontSize: countSize, lineHeight: countSize + 2 }]}>{String(n)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 5,
    flexShrink: 0,
  },
  starBox: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  slash: {
    position: 'absolute',
    left: -1,
    right: -1,
    borderRadius: 1,
  },
  slashGap: {
    height: 3.5,
    backgroundColor: '#fff',
  },
  slashInk: {
    height: 1.75,
    backgroundColor: INK,
  },
  count: {
    color: INK,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
});
