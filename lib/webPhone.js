/**
 * Native placeholder: the browser softphone (lib/webPhone.web.js) is web only.
 * On iOS / Android calls are answered on the RingCentral app or desk phone.
 */
export const isWebPhoneSupported = false;

export const SIP_ACTION_TIMEOUT_MS = 8_000;

export class SipTimeoutError extends Error {
  constructor(action) {
    super(`The phone did not confirm "${action}" in time.`);
    this.name = 'SipTimeoutError';
    this.code = 'sip_timeout';
  }
}

export function withSipTimeout(promise) {
  return Promise.resolve(promise);
}

export function webPhoneInstanceId() {
  return '';
}

export async function startWebPhone() {
  throw new Error('Answering in the app is available in the web version.');
}
