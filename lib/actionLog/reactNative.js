/**
 * `react-native` with app-wide Pressable logging and Söhne text.
 *
 * metro.config.js resolves every `import ... from 'react-native'` inside this
 * project (but not inside node_modules or the wrapper folders) to this file.
 * Everything else is passed straight through to the real module, lazily, so
 * React Native's own on-demand getters keep working.
 */
const ReactNative = require('react-native');
const LoggedPressable = require('./LoggedPressable').default;
const AppText = require('../typography/AppText').default;
const AppTextInput = require('../typography/AppTextInput').default;
const AppAnimated = require('../typography/AppAnimated').default;

const SWAPS = {
  Pressable: LoggedPressable,
  Text: AppText,
  TextInput: AppTextInput,
  Animated: AppAnimated,
};

module.exports = new Proxy(ReactNative, {
  get(target, property, receiver) {
    if (Object.prototype.hasOwnProperty.call(SWAPS, property)) return SWAPS[property];
    return Reflect.get(target, property, receiver);
  },
  has(target, property) {
    return Object.prototype.hasOwnProperty.call(SWAPS, property) || Reflect.has(target, property);
  },
});
