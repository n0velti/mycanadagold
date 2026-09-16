/**
 * Native placeholder: the browser softphone (lib/webPhone.web.js) is web only.
 * On iOS / Android calls are answered on the RingCentral app or desk phone.
 */
export const isWebPhoneSupported = false;

export function webPhoneInstanceId() {
  return '';
}

export async function startWebPhone() {
  throw new Error('Answering in the app is available in the web version.');
}
