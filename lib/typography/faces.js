/**
 * Söhne is the app typeface on web and native.
 *
 * Screens can keep writing `fontFamily: 'Sohne'` (or SohneLeicht / SohneMono).
 * App Text / TextInput wrappers also apply it when a style omits a family, and
 * they remap `fontWeight` onto the matching cut so iOS does not fall back to
 * the system face.
 */
import { Animated, Platform, StyleSheet, Text, TextInput } from 'react-native';

export const FONT = 'Sohne';
export const FONT_LIGHT = 'SohneLeicht';
export const FONT_MONO = 'SohneMono';

const NAMED_CUTS = new Set([
  'Sohne',
  'SohneLeicht',
  'SohneExtraleicht',
  'SohneKraftig',
  'SohneHalbfett',
  'SohneDreiviertelfett',
  'SohneFett',
  'SohneExtrafett',
  'SohneKursiv',
  'SohneMono',
]);

const WEIGHT_FAMILY = {
  100: 'SohneExtraleicht',
  200: 'SohneExtraleicht',
  300: 'SohneLeicht',
  400: 'Sohne',
  500: 'SohneKraftig',
  600: 'SohneHalbfett',
  700: 'SohneDreiviertelfett',
  800: 'SohneFett',
  900: 'SohneExtrafett',
  normal: 'Sohne',
  regular: 'Sohne',
  bold: 'SohneDreiviertelfett',
};

function isAnimatedNode(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (typeof value.__getValue === 'function' || typeof value.addListener === 'function'),
  );
}

function isAnimatedStyle(style) {
  if (style == null || typeof style !== 'object') return false;
  if (Array.isArray(style)) return style.some(isAnimatedStyle);
  if (isAnimatedNode(style)) return true;
  return Object.values(style).some(
    (value) => isAnimatedNode(value) || (Array.isArray(value) && value.some(isAnimatedNode)),
  );
}

function isIconFont(family) {
  if (!family || typeof family !== 'string' || NAMED_CUTS.has(family)) return false;
  return /icon|ionicons|feather|material|awesome|entypo|octicon|zocial|antdesign|foundation|evil/i.test(
    family,
  );
}

function familyForWeight(weight) {
  if (weight == null) return FONT;
  return WEIGHT_FAMILY[weight] || WEIGHT_FAMILY[String(weight)] || FONT;
}

function resolveFamily(flat) {
  const requested = flat.fontFamily;
  if (requested && NAMED_CUTS.has(requested) && requested !== FONT) return requested;
  const italic = flat.fontStyle === 'italic';
  const weight = flat.fontWeight;
  if (
    italic &&
    (weight == null || weight === '400' || weight === 400 || weight === 'normal' || weight === 'regular')
  ) {
    return 'SohneKursiv';
  }
  return familyForWeight(weight);
}

/** Merge Söhne onto a Text / TextInput style without disturbing icon fonts. */
export function applyTypography(style) {
  if (isAnimatedStyle(style)) {
    return [{ fontFamily: FONT }, style];
  }

  const flat = style == null ? {} : StyleSheet.flatten(style) || {};
  if (isIconFont(flat.fontFamily)) return style;

  const family = resolveFamily(flat);
  const next = { ...flat, fontFamily: family };
  delete next.fontWeight;
  if (family === 'SohneKursiv') delete next.fontStyle;
  return next;
}

export const SOHNE_WEB_FONTS = {
  Sohne: '/fonts/Sohne-Buch.otf',
  SohneLeicht: '/fonts/Sohne-Leicht.otf',
  SohneExtraleicht: '/fonts/Sohne-Extraleicht.otf',
  SohneKraftig: '/fonts/Sohne-Kraftig.otf',
  SohneHalbfett: '/fonts/Sohne-Halbfett.otf',
  SohneDreiviertelfett: '/fonts/Sohne-Dreiviertelfett.otf',
  SohneFett: '/fonts/Sohne-Fett.otf',
  SohneExtrafett: '/fonts/Sohne-Extrafett.otf',
  SohneKursiv: '/fonts/Sohne-BuchKursiv.otf',
  SohneMono: '/fonts/SohneMono-Buch.otf',
};

export const SOHNE_NATIVE_FONTS =
  Platform.OS === 'web'
    ? null
    : {
        Sohne: require('../../assets/sohne-font-family/TestSohne-Buch-BF663d89cd32e6a.otf'),
        SohneLeicht: require('../../assets/sohne-font-family/TestSohne-Leicht-BF663d89cd4952e.otf'),
        SohneExtraleicht: require('../../assets/sohne-font-family/TestSohne-Extraleicht-BF663d89cd3f5c5.otf'),
        SohneKraftig: require('../../assets/sohne-font-family/TestSohne-Kraftig-BF663d89cd37e26.otf'),
        SohneHalbfett: require('../../assets/sohne-font-family/TestSohne-Halbfett-BF663d89cd2d67b.otf'),
        SohneDreiviertelfett: require('../../assets/sohne-font-family/TestSohne-Dreiviertelfett-BF663d89ccc5f66.otf'),
        SohneFett: require('../../assets/sohne-font-family/TestSohne-Fett-BF663d89cca89ff.otf'),
        SohneExtrafett: require('../../assets/sohne-font-family/TestSohne-Extrafett-BF663d89cc9f2c0.otf'),
        SohneKursiv: require('../../assets/sohne-font-family/TestSohne-BuchKursiv-BF663d89cd3e887.otf'),
        SohneMono: require('../../assets/sohne-font-family/TestSohneMono-Buch-BF663d89cbcec64.otf'),
      };

const WEB_FACE_RULES = [
  ['Sohne-Extraleicht.otf', 200, 'normal'],
  ['Sohne-Leicht.otf', 300, 'normal'],
  ['Sohne-Buch.otf', 400, 'normal'],
  ['Sohne-BuchKursiv.otf', 400, 'italic'],
  ['Sohne-Kraftig.otf', 500, 'normal'],
  ['Sohne-Halbfett.otf', 600, 'normal'],
  ['Sohne-Dreiviertelfett.otf', 700, 'normal'],
  ['Sohne-Fett.otf', 800, 'normal'],
  ['Sohne-Extrafett.otf', 900, 'normal'],
];

/** Extra @font-face weights for raw HTML (tips, emails) plus a document-wide stack. */
export function ensureSohneCss() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('cgold-sohne-faces')) return;
  const style = document.createElement('style');
  style.id = 'cgold-sohne-faces';
  style.textContent = [
    ...WEB_FACE_RULES.map(
      ([file, weight, fontStyle]) =>
        `@font-face{font-family:Sohne;src:url(/fonts/${file}) format("opentype");font-weight:${weight};font-style:${fontStyle};font-display:swap;}`,
    ),
    '@font-face{font-family:SohneLeicht;src:url(/fonts/Sohne-Leicht.otf) format("opentype");font-weight:300 400;font-style:normal;font-display:swap;}',
    '@font-face{font-family:SohneMono;src:url(/fonts/SohneMono-Buch.otf) format("opentype");font-weight:400;font-style:normal;font-display:swap;}',
    'html,body,input,textarea,button,select,#root{font-family:Sohne,sans-serif;}',
  ].join('');
  document.head.appendChild(style);
}

ensureSohneCss();

let createElementPatched = false;

/** Catch Text created without going through the Metro wrappers (tests, Fast Refresh). */
export function installAppTypography() {
  if (createElementPatched) return;
  const React = require('react');
  if (typeof React.createElement !== 'function') return;
  const targets = new Set([Text, TextInput, Animated.Text]);
  const original = React.createElement;
  React.createElement = (type, props, ...children) => {
    if (type && targets.has(type)) {
      props = { ...props, style: applyTypography(props?.style) };
    }
    return original(type, props, ...children);
  };
  createElementPatched = true;
}

installAppTypography();
