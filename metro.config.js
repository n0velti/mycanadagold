const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Every `Pressable` imported from 'react-native' in app code becomes the
// ledger-logging version in lib/actionLog. Third-party code in node_modules
// and the logging module itself keep the untouched original.
//
// Native: `import { Pressable } from 'react-native'` → reactNative.js, which
//   returns the real module with only `Pressable` swapped.
// Web: babel-preset-expo rewrites that import to
//   'react-native-web/dist/exports/Pressable' before resolution, so that path
//   is redirected straight to LoggedPressable.js.
const projectRoot = __dirname;
const actionLogDir = path.join(projectRoot, 'lib', 'actionLog');
const loggedReactNative = path.join(actionLogDir, 'reactNative.js');
const loggedPressable = path.join(actionLogDir, 'LoggedPressable.js');
const nodeModulesSegment = `${path.sep}node_modules${path.sep}`;
const webPressablePattern = /^react-native-web\/dist\/exports\/Pressable(\/index(\.js)?)?$/;

function isAppSource(originModulePath) {
  const origin = String(originModulePath || '');
  if (!origin.startsWith(projectRoot + path.sep)) return false;
  if (origin.includes(nodeModulesSegment)) return false;
  if (origin.startsWith(actionLogDir + path.sep)) return false;
  return true;
}

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (isAppSource(context.originModulePath)) {
    if (moduleName === 'react-native') {
      return { type: 'sourceFile', filePath: loggedReactNative };
    }
    if (webPressablePattern.test(moduleName)) {
      return { type: 'sourceFile', filePath: loggedPressable };
    }
  }
  const next = upstreamResolveRequest || context.resolveRequest;
  return next(context, moduleName, platform);
};

module.exports = config;
