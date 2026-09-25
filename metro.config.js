const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// App-source `react-native` imports are rewritten so Pressable logs presses
// and Text / TextInput / Animated.Text always use Söhne. Third-party code in
// node_modules, plus the wrapper folders themselves, keep the real module.
//
// Native: `import { … } from 'react-native'` → reactNative.js, which swaps
//   those exports and passes everything else through.
// Web: babel-preset-expo rewrites named imports to
//   'react-native-web/dist/exports/<Name>' before resolution, so those paths
//   are redirected to the matching wrapper.
const projectRoot = __dirname;
const actionLogDir = path.join(projectRoot, 'lib', 'actionLog');
const typographyDir = path.join(projectRoot, 'lib', 'typography');
const loggedReactNative = path.join(actionLogDir, 'reactNative.js');
const loggedPressable = path.join(actionLogDir, 'LoggedPressable.js');
const appText = path.join(typographyDir, 'AppText.js');
const appTextInput = path.join(typographyDir, 'AppTextInput.js');
const appAnimated = path.join(typographyDir, 'AppAnimated.js');
const nodeModulesSegment = `${path.sep}node_modules${path.sep}`;
const webExport = (name) => new RegExp(`^react-native-web\\/dist\\/exports\\/${name}(\\/index(\\.js)?)?$`);
const webPressablePattern = webExport('Pressable');
const webTextPattern = webExport('Text');
const webTextInputPattern = webExport('TextInput');
const webAnimatedPattern = webExport('Animated');

function isAppSource(originModulePath) {
  const origin = String(originModulePath || '');
  if (!origin.startsWith(projectRoot + path.sep)) return false;
  if (origin.includes(nodeModulesSegment)) return false;
  if (origin.startsWith(actionLogDir + path.sep)) return false;
  if (origin.startsWith(typographyDir + path.sep)) return false;
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
    if (webTextPattern.test(moduleName)) {
      return { type: 'sourceFile', filePath: appText };
    }
    if (webTextInputPattern.test(moduleName)) {
      return { type: 'sourceFile', filePath: appTextInput };
    }
    if (webAnimatedPattern.test(moduleName)) {
      return { type: 'sourceFile', filePath: appAnimated };
    }
  }
  const next = upstreamResolveRequest || context.resolveRequest;
  return next(context, moduleName, platform);
};

module.exports = config;
