import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppAccess } from '../lib/permissions';
import { findCustomerForReviewer, isAnonymousReviewer } from '../lib/reviewCustomers';

export default function ReviewAuthorLink({
  session,
  review,
  onOpenCustomer,
  style,
  children,
}) {
  const { hasApp } = useAppAccess();
  const [busy, setBusy] = useState(false);
  const [missed, setMissed] = useState(false);
  const name = String(review?.author || '').trim() || 'Anonymous';
  const canOpen = Boolean(session && onOpenCustomer && hasApp('customers') && !isAnonymousReviewer(name));

  if (!canOpen) {
    return (
      <Text style={style} numberOfLines={1}>
        {children || name}
      </Text>
    );
  }

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    setMissed(false);
    try {
      const customer = await findCustomerForReviewer(session, {
        author: review?.author,
        transactionMatch: review?.transactionMatch,
      });
      if (customer) onOpenCustomer(customer);
      else setMissed(true);
    } catch {
      setMissed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => void onPress()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Open ${name} customer profile`}
        style={({ pressed, hovered }) => [styles.hit, (pressed || hovered) && styles.hitHover]}
        {...(Platform.OS === 'web' ? { className: 'cgold-triage-btn' } : null)}
      >
        <Text style={[style, styles.link]} numberOfLines={1}>
          {children || name}
        </Text>
        {busy ? <ActivityIndicator size="small" color="#0F766E" /> : null}
      </Pressable>
      {missed ? <Text style={styles.miss}>No matching customer</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 0,
    flexShrink: 1,
  },
  hit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  hitHover: {
    opacity: 0.72,
  },
  link: {
    color: '#0F766E',
  },
  miss: {
    marginTop: 2,
    fontSize: 11,
    color: '#8e8e93',
  },
});
