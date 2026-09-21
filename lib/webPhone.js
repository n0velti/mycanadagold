/**
 * Native placeholder: the browser softphone (lib/webPhone.web.js) is web only.
 * On iOS / Android calls are answered on the RingCentral app or desk phone and
 * outbound calls use RingOut (the store phone rings first).
 */
export const isWebPhoneSupported = false;

export const SIP_ACTION_TIMEOUT_MS = 8_000;
export const SIP_ANSWER_TIMEOUT_MS = 30_000;

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

export async function ensureMicrophone() {
  throw new Error('Answering in the app is available in the web version.');
}

export function primeCallAudio() {}

export function isMicrophoneFailure(err) {
  return err?.code === 'microphone';
}

export function webPhoneInstanceId() {
  return '';
}

export function toCallSnapshot() {
  return null;
}

export async function startWebPhone() {
  throw new Error('Answering in the app is available in the web version.');
}
