/**
 * Animated with `Text` wrapped so motion labels stay on Söhne.
 *
 * This file lives under lib/typography so Metro does not remap its own
 * `react-native` / `react-native-web` imports (same exclusion as actionLog).
 */
import { Animated } from 'react-native';
import AppText from './AppText';

const AppAnimatedText = Animated.createAnimatedComponent(AppText);

const AppAnimated = new Proxy(Animated, {
  get(target, property, receiver) {
    if (property === 'Text') return AppAnimatedText;
    return Reflect.get(target, property, receiver);
  },
  has(target, property) {
    return property === 'Text' || Reflect.has(target, property);
  },
});

export default AppAnimated;
