/**
 * `react-native` with `Pressable` replaced by the ledger-logging version.
 *
 * metro.config.js resolves every `import ... from 'react-native'` inside this
 * project (but not inside node_modules or this folder) to this file. Everything
 * except `Pressable` is passed straight through to the real module, lazily, so
 * React Native's own on-demand getters keep working.
 */
const ReactNative = require('react-native');
const LoggedPressable = require('./LoggedPressable').default;

module.exports = new Proxy(ReactNative, {
  get(target, property, receiver) {
    if (property === 'Pressable') return LoggedPressable;
    return Reflect.get(target, property, receiver);
  },
  has(target, property) {
    return property === 'Pressable' || Reflect.has(target, property);
  },
});
