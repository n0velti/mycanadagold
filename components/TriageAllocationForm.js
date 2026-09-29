import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  addLineSplit,
  allocatedObjectGrams,
  destinationLabel,
  destinationTotals,
  formatGrams,
  formatObjectWeight,
  formatPureWeight,
  remainingObjectGrams,
  removeLineSplit,
  setLineSplit,
  TRIAGE_DESTINATIONS,
} from '../lib/triageAllocations';
import { FONT, T } from './TriageKit';

function DestChip({ dest, selected, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, selected && styles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={dest.label}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{dest.label}</Text>
    </Pressable>
  );
}

export default function TriageAllocationForm({ draft, onChange, disabled }) {
  const totals = destinationTotals(draft);
  const lines = draft?.lines || [];

  const update = (next) => onChange?.(next);

  return (
    <View>
      <View style={styles.totals}>
        {TRIAGE_DESTINATIONS.map((dest) => {
          const row = totals[dest.id];
          return (
            <View key={dest.id} style={styles.totalCard}>
              <Text style={styles.totalLabel}>{dest.label}</Text>
              <Text style={styles.totalValue}>{formatGrams(row?.objectGrams || 0)} g</Text>
              {row?.fineGrams > 0 ? (
                <Text style={styles.totalFine}>{formatGrams(row.fineGrams)} g pure</Text>
              ) : null}
            </View>
          );
        })}
      </View>

      {lines.length ? (
        lines.map((line) => {
          const remaining = remainingObjectGrams(line);
          const allocated = allocatedObjectGrams(line);
          const object = formatObjectWeight(line.objectGrams);
          const pure = formatPureWeight(line.fineGrams, line.metal);
          return (
            <View key={line.lineIndex} style={styles.lineCard}>
              <Text style={styles.lineName}>{line.name}</Text>
              <Text style={styles.lineMeta}>
                {[object ? `${object} object` : null, pure ? `${pure} pure` : null].filter(Boolean).join(' · ') ||
                  'No weight on this line'}
              </Text>
              <Text style={[styles.lineRemain, remaining > 0.001 && styles.lineRemainOpen]}>
                {remaining > 0.001
                  ? `${formatGrams(remaining)} g left of ${formatGrams(line.objectGrams)} g`
                  : remaining < -0.001
                    ? `${formatGrams(allocated)} g allocated — over by ${formatGrams(Math.abs(remaining))} g`
                    : `${formatGrams(allocated)} g allocated`}
              </Text>

              {(line.splits || []).map((split) => (
                <View key={split.id} style={styles.split}>
                  <TextInput
                    style={styles.weightInput}
                    value={split.objectGrams ? String(split.objectGrams) : ''}
                    onChangeText={(value) =>
                      update(
                        setLineSplit(draft, line.lineIndex, split.id, {
                          objectGrams: value.replace(/[^0-9.]/g, ''),
                        }),
                      )
                    }
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={T.secondary}
                    editable={!disabled}
                    accessibilityLabel={`${line.name} allocated weight`}
                  />
                  <Text style={styles.unit}>g</Text>
                  <View style={styles.chips}>
                    {TRIAGE_DESTINATIONS.map((dest) => (
                      <DestChip
                        key={dest.id}
                        dest={dest}
                        selected={split.destination === dest.id}
                        disabled={disabled}
                        onPress={() =>
                          update(setLineSplit(draft, line.lineIndex, split.id, { destination: dest.id }))
                        }
                      />
                    ))}
                  </View>
                  {(line.splits || []).length > 1 ? (
                    <Pressable
                      onPress={() => update(removeLineSplit(draft, line.lineIndex, split.id))}
                      disabled={disabled}
                      hitSlop={8}
                      accessibilityLabel="Remove split"
                    >
                      <Ionicons name="close" size={18} color={T.secondary} />
                    </Pressable>
                  ) : null}
                </View>
              ))}

              {line.objectGrams > 0 ? (
                <Pressable
                  style={styles.addSplit}
                  onPress={() => update(addLineSplit(draft, line.lineIndex, remaining > 0.001 ? 'rcm' : 'melt'))}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Split ${line.name}`}
                >
                  <Ionicons name="add" size={16} color={T.text} />
                  <Text style={styles.addSplitText}>
                    Split remaining to {destinationLabel(remaining > 0.001 ? 'rcm' : 'melt')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
      ) : (
        <Text style={styles.empty}>No weighted line items to allocate.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  totals: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  totalCard: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: T.fillSoft,
  },
  totalLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '500',
    color: T.secondary,
  },
  totalValue: {
    marginTop: 4,
    fontFamily: FONT,
    fontSize: 20,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
  },
  totalFine: {
    marginTop: 2,
    fontFamily: FONT,
    fontSize: 12,
    color: T.secondary,
    fontVariant: ['tabular-nums'],
  },
  lineCard: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.hairline,
  },
  lineName: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: T.text,
  },
  lineMeta: {
    marginTop: 3,
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
  },
  lineRemain: {
    marginTop: 6,
    marginBottom: 10,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: T.green,
  },
  lineRemainOpen: {
    color: T.orange,
  },
  split: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  weightInput: {
    width: 84,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: T.fillSoft,
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontFamily: FONT,
    fontSize: 14,
    color: T.secondary,
  },
  chips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: T.fillSoft,
  },
  chipOn: {
    backgroundColor: T.text,
  },
  chipText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
  },
  chipTextOn: {
    color: '#fff',
  },
  addSplit: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingVertical: 6,
  },
  addSplitText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
  },
  empty: {
    fontFamily: FONT,
    fontSize: 14,
    color: T.secondary,
  },
});
