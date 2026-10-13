import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';

export function measureWindow(ref, callback) {
  const node = ref?.current;
  if (!node) return false;
  if (typeof node.measureInWindow === 'function') {
    node.measureInWindow((x, y, width, height) => {
      if (width > 0 || height > 0) callback({ x, y, width, height });
    });
    return true;
  }
  const el = typeof node.getBoundingClientRect === 'function'
    ? node
    : node.getNode?.() || node._nativeNode;
  if (el && typeof el.getBoundingClientRect === 'function') {
    const rect = el.getBoundingClientRect();
    callback({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    return true;
  }
  return false;
}

/**
 * Sent bubble lifts out of the composer and springs into the thread. Shared by
 * Analytics and Direct Messages so a sent message moves the same way everywhere.
 */
export default function SendFromInput({ active, originRef, children, onSettled }) {
  const progress = useRef(new Animated.Value(1)).current;
  const destRef = useRef(null);
  const onSettledRef = useRef(onSettled);
  const [delta, setDelta] = useState(null);
  onSettledRef.current = onSettled;

  useEffect(() => {
    if (!active) {
      progress.setValue(1);
      setDelta(null);
      return undefined;
    }
    let cancelled = false;
    const run = () => {
      const finish = (next) => {
        if (!cancelled) setDelta(next);
      };
      const destOk = measureWindow(destRef, (dest) => {
        const originOk = measureWindow(originRef, (origin) => {
          finish({
            x: origin.x + origin.width - dest.x - dest.width,
            y: origin.y + origin.height / 2 - dest.y - dest.height,
          });
        });
        if (!originOk) finish({ x: 36, y: 88 });
      });
      if (!destOk) finish({ x: 36, y: 88 });
    };
    const frame = requestAnimationFrame(() => requestAnimationFrame(run));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [active, originRef, progress]);

  useEffect(() => {
    if (!active || !delta) return undefined;
    progress.setValue(0);
    const animation = Animated.spring(progress, {
      toValue: 1,
      stiffness: 260,
      damping: 26,
      mass: 0.72,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) onSettledRef.current?.();
    });
    return () => animation.stop();
  }, [active, delta, progress]);

  if (!active) return children;

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [delta?.x ?? 36, 0],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [delta?.y ?? 88, 0],
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.62, 1],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.08, 1],
    outputRange: [0, 1, 1],
  });

  return (
    <View ref={destRef} collapsable={false} style={{ alignSelf: 'flex-end', maxWidth: '100%' }}>
      <Animated.View
        pointerEvents="box-none"
        style={{
          opacity: delta ? opacity : 0,
          transform: [{ translateX }, { translateY }, { scale }],
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}
