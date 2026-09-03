/**
 * FINTRAC Web Reporting (F2R) client. Requests go through the authenticated
 * proxy with the user's own portal token forwarded per call. The token and the
 * LCTR drafts (which contain customer PII) live in secure storage.
 */
import { buildFintracReportActionBody } from './fintracLctr';
import { ProxyError, proxyFetch } from './proxy';
import { readSecureJson, removeSecure, writeSecureJson } from './secureAuthStorage';

export const FINTRAC_REPORT_TYPE_LCTR = 106;
export const FINTRAC_REPORTING_ENTITY_NUMBER = 147954;
export const FINTRAC_PORTAL_ORIGIN = 'https://www142.fintrac-canafe.canada.ca';

export const FINTRAC_STATUS = {
  created: 'created',
  saved: 'saved',
  validated: 'validated',
  submitted: 'submitted',
};

const SESSION_KEY = 'cgold_fintrac_session';
const LINKED_REPORTS_KEY = 'cgold_fintrac_linked_reports';
const MAX_LINKED_REPORTS = 500;

function getErrorMessage(payload, fallback) {
  const raw =
    payload?.error?.message ||
    payload?.message?.en ||
    payload?.message?.fr ||
    payload?.message ||
    payload?.error ||
    fallback;
  return typeof raw === 'string' ? raw : fallback;
}

function explainFintracError(message, { action } = {}) {
  const text = String(message || '').trim();
  if (/not allowed to submit/i.test(text)) {
    return (
      `${text}. ` +
      'Usually the FINTRAC token expired (~1 hour) — reconnect with a fresh Bearer token, then try Submit again. ' +
      'If it still fails, your F2R user may not have LCTR submit permission (Organization → Users), or use Open in FINTRAC to submit there.'
    );
  }
  if (/session expired|unauthorized|401/i.test(text) || action === 'auth') {
    return `${text} Reconnect with a fresh FINTRAC token.`;
  }
  return text || 'FINTRAC request failed.';
}

/** FINTRAC often returns HTTP 200 with a business `code` ≠ 200 in the JSON body. */
function assertFintracOk(payload, fallback) {
  const code = payload?.code;
  if (code != null && Number(code) !== 200) {
    const message = explainFintracError(getErrorMessage(payload, fallback));
    const error = new Error(message);
    error.status = Number(code) || 400;
    error.payload = payload;
    error.fintracCode = Number(code);
    throw error;
  }
  return payload;
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    let json = '';
    if (typeof globalThis.atob === 'function') {
      json = globalThis.atob(padded);
    } else if (typeof globalThis.Buffer !== 'undefined') {
      json = globalThis.Buffer.from(padded, 'base64').toString('utf8');
    } else {
      return null;
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function describeFintracToken(token) {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const expMs = typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  const emails = Array.isArray(payload.emails) ? payload.emails : [];
  return {
    name: payload.name || '',
    email: emails[0] || '',
    expMs,
    expired: expMs != null ? Date.now() >= expMs : false,
    expiresAtLabel:
      expMs != null
        ? new Date(expMs).toLocaleString('en-CA', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : '',
  };
}

export async function loadFintracSession() {
  const session = await readSecureJson(SESSION_KEY, null);
  if (!session?.token) return null;
  const meta = describeFintracToken(session.token);
  if (!meta) return null;
  if (meta.expired) {
    // Portal tokens live ~1 hour; drop expired ones rather than keep them around.
    await removeSecure(SESSION_KEY);
    return null;
  }
  return { ...session, ...meta, expired: false };
}

export async function saveFintracSession({ token }) {
  const cleaned = String(token || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!cleaned) throw new Error('Paste a FINTRAC bearer token to connect.');
  const meta = describeFintracToken(cleaned);
  if (!meta) throw new Error('That does not look like a valid FINTRAC token.');
  if (meta.expired) {
    throw new Error(
      'That FINTRAC token is already expired. Sign in again and paste a fresh one.',
    );
  }
  const session = {
    token: cleaned,
    savedAt: Date.now(),
    name: meta.name,
    email: meta.email,
  };
  await writeSecureJson(SESSION_KEY, session);
  return {
    ...session,
    ...meta,
    expired: false,
  };
}

export async function clearFintracSession() {
  await removeSecure(SESSION_KEY);
}

export async function loadLinkedFintracReports() {
  const parsed = await readSecureJson(LINKED_REPORTS_KEY, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

/** Keep the local link store bounded: oldest submitted reports drop first. */
function pruneLinkedReports(reports) {
  const entries = Object.entries(reports);
  if (entries.length <= MAX_LINKED_REPORTS) return reports;
  entries.sort((a, b) => {
    const aSubmitted = a[1]?.status === FINTRAC_STATUS.submitted ? 0 : 1;
    const bSubmitted = b[1]?.status === FINTRAC_STATUS.submitted ? 0 : 1;
    if (aSubmitted !== bSubmitted) return aSubmitted - bSubmitted;
    return (a[1]?.updatedAt || 0) - (b[1]?.updatedAt || 0);
  });
  return Object.fromEntries(entries.slice(entries.length - MAX_LINKED_REPORTS));
}

export function buildFintracReportPortalUrl(incompleteReportUuid, { page } = {}) {
  const uuid = String(incompleteReportUuid || '');
  if (!uuid) return `${FINTRAC_PORTAL_ORIGIN}/manage-reports`;
  const base = `${FINTRAC_PORTAL_ORIGIN}/report/lctr/${uuid}`;
  if (page === 'validation') return `${base}/validation`;
  if (page === 'edit') return base;
  return base;
}

export async function saveLinkedFintracReport(transactionId, report) {
  const current = await loadLinkedFintracReports();
  const prev = current[transactionId] || {};
  const uuid = report.incompleteReportUuid || prev.incompleteReportUuid;
  const next = {
    ...current,
    [transactionId]: {
      ...prev,
      incompleteReportUuid: uuid,
      reportingEntityNumber:
        report.reportingEntityNumber ??
        prev.reportingEntityNumber ??
        FINTRAC_REPORTING_ENTITY_NUMBER,
      submittingReportingEntityNumber:
        report.submittingReportingEntityNumber ??
        prev.submittingReportingEntityNumber ??
        FINTRAC_REPORTING_ENTITY_NUMBER,
      reportTypeCode: report.reportTypeCode || prev.reportTypeCode || FINTRAC_REPORT_TYPE_LCTR,
      reportingActionCodes:
        report.reportingActionCodes || prev.reportingActionCodes || [],
      reportValidationIndicator:
        report.reportValidationIndicator ?? prev.reportValidationIndicator ?? null,
      validationMessages:
        report.validationMessages ?? prev.validationMessages ?? [],
      status: report.status || prev.status || FINTRAC_STATUS.created,
      reportingEntityReportReference:
        report.reportingEntityReportReference ||
        prev.reportingEntityReportReference ||
        report.reference ||
        prev.reference ||
        '',
      externalReportUuid: report.externalReportUuid || prev.externalReportUuid || null,
      submitDateTime: report.submitDateTime || prev.submitDateTime || null,
      // reportContent is always rebuilt from mappedFields before a save, so it
      // is deliberately not persisted (it duplicates customer PII).
      mappedFields:
        report.mappedFields !== undefined
          ? report.mappedFields
          : prev.mappedFields || null,
      missingFields: Array.isArray(report.missingFields)
        ? report.missingFields
        : prev.missingFields || [],
      personRefId: report.personRefId || prev.personRefId || null,
      irsPaymentIds: report.irsPaymentIds || prev.irsPaymentIds || [],
      aureusMarked: Boolean(report.aureusMarked ?? prev.aureusMarked),
      // Portal URLs are derived from the UUID at render time, never stored.
      updatedAt: Date.now(),
      createdAt: prev.createdAt || Date.now(),
      reference: report.reference || prev.reference || '',
      transactionId,
    },
  };
  const pruned = pruneLinkedReports(next);
  await writeSecureJson(LINKED_REPORTS_KEY, pruned);
  return pruned;
}

function isFormDataBody(body) {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

async function fintracFetch(pathWithQuery, { method = 'GET', token, body, refererPath } = {}) {
  if (!token) throw new Error('Connect FINTRAC first.');

  const headers = { Accept: 'application/json, text/plain, */*' };

  let payloadBody = body;
  if (body != null && !isFormDataBody(body)) {
    headers['Content-Type'] = 'application/json';
    payloadBody = typeof body === 'string' ? body : JSON.stringify(body);
  }
  // FormData: omit Content-Type so fetch sets the multipart boundary.

  if (refererPath) {
    headers['X-Fintrac-Referer'] = `${FINTRAC_PORTAL_ORIGIN}${refererPath}`;
  }

  const clean = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  let response;
  try {
    response = await proxyFetch(`fintrac${clean}`, {
      method,
      headers,
      body: payloadBody,
      upstreamAuthorization: `Bearer ${token}`,
    });
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    throw new Error('Could not reach FINTRAC. Check your connection and try again.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = explainFintracError(
      getErrorMessage(
        payload,
        response.status === 401
          ? 'FINTRAC session expired. Reconnect with a fresh token.'
          : `FINTRAC request failed (${response.status}).`,
      ),
      { action: response.status === 401 ? 'auth' : undefined },
    );
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return assertFintracOk(payload, `FINTRAC request failed (${response.status}).`);
}

function buildSaveReportFormData(reportPayload) {
  const json = JSON.stringify(reportPayload);
  if (typeof FormData === 'undefined') {
    throw new Error('FormData is required to call saveReport.');
  }
  const form = new FormData();
  // FINTRAC SPA: formData.append("file", new Blob([JSON.stringify(payload)], { type: "application/json" }))
  if (typeof Blob !== 'undefined') {
    form.append(
      'file',
      new Blob([json], { type: 'application/json' }),
      'report.json',
    );
  } else {
    form.append('file', json);
  }
  return form;
}

/**
 * Fetches metadata / allowed actions for an incomplete report
 * (same call the portal makes after createReport).
 */
export async function fetchFintracReportMetadata(token, {
  incompleteReportUuid,
  reportTypeCode = FINTRAC_REPORT_TYPE_LCTR,
  reportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
  submittingReportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
} = {}) {
  if (!incompleteReportUuid) {
    throw new Error('incompleteReportUuid is required.');
  }

  const params = new URLSearchParams({
    reportTypeCode: String(reportTypeCode),
    incompleteReportUuid: String(incompleteReportUuid),
    reportingEntityNumber: String(reportingEntityNumber),
    submittingReportingEntityNumber: String(submittingReportingEntityNumber),
  });

  const payload = await fintracFetch(
    `/experiencelayer/experience/reports/reportMetadata?${params}`,
    { method: 'GET', token },
  );

  const meta = payload?.payload?.metadata || {};
  return {
    incompleteReportUuid: meta.incompleteReportUuid || incompleteReportUuid,
    reportValidationIndicator: meta.reportValidationIndicator ?? null,
    reportingActionCodes: Array.isArray(meta.reportingActionCodes)
      ? meta.reportingActionCodes
      : [],
    submitTypeCode: meta.submitTypeCode ?? null,
    previousReportUuid: meta.previousReportUuid ?? null,
    message: payload?.message?.en || 'successfully fetched report content',
    raw: payload,
    portalUrl: buildFintracReportPortalUrl(incompleteReportUuid),
    validationUrl: buildFintracReportPortalUrl(incompleteReportUuid, {
      page: 'validation',
    }),
  };
}

/**
 * Creates an incomplete LCTR draft in FINTRAC Web Reporting
 * (same call as Manage Reports → create report type 106),
 * then confirms it via reportMetadata.
 */
export async function createFintracReport(token, {
  reportTypeCode = FINTRAC_REPORT_TYPE_LCTR,
  reportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
  submittingReportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
} = {}) {
  const params = new URLSearchParams({
    reportTypeCode: String(reportTypeCode),
    reportingEntityNumber: String(reportingEntityNumber),
    submittingReportingEntityNumber: String(submittingReportingEntityNumber),
  });

  const payload = await fintracFetch(
    `/experiencelayer/experience/reports/createReport?${params}`,
    {
      method: 'POST',
      token,
      body: {
        reportTypeCode,
        reportingEntityNumber,
        submittingReportingEntityNumber,
      },
    },
  );

  const meta = payload?.payload?.metadata || {};
  const uuid = meta.incompleteReportUuid;
  if (!uuid) {
    throw new Error(getErrorMessage(payload, 'FINTRAC did not return a report id.'));
  }

  let metadata = null;
  try {
    metadata = await fetchFintracReportMetadata(token, {
      incompleteReportUuid: uuid,
      reportTypeCode,
      reportingEntityNumber: meta.reportingEntityNumber ?? reportingEntityNumber,
      submittingReportingEntityNumber:
        meta.submittingReportingEntityNumber ?? submittingReportingEntityNumber,
    });
  } catch {
    // Draft was created; metadata is best-effort confirmation.
  }

  return {
    incompleteReportUuid: uuid,
    reportTypeCode,
    reportingEntityNumber: meta.reportingEntityNumber ?? reportingEntityNumber,
    submittingReportingEntityNumber:
      meta.submittingReportingEntityNumber ?? submittingReportingEntityNumber,
    reportingActionCodes: metadata?.reportingActionCodes || [],
    reportValidationIndicator: metadata?.reportValidationIndicator ?? null,
    status: FINTRAC_STATUS.created,
    message: payload?.message?.en || 'Successfully created the incomplete report',
    raw: payload,
    metadataRaw: metadata?.raw || null,
    portalUrl: buildFintracReportPortalUrl(uuid),
    validationUrl: buildFintracReportPortalUrl(uuid, { page: 'validation' }),
  };
}

/**
 * Saves incomplete report content (portal Validate step precursor).
 * PUT multipart/form-data → /experiencelayer/experience/reports/saveReport
 *
 * `reportContent` matches the portal payload:
 * { reportDetails, transactions, definitions }
 */
export async function saveFintracReport(token, {
  incompleteReportUuid,
  reportContent,
  reportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
  submittingReportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
  reportingEntityReportReference,
} = {}) {
  if (!incompleteReportUuid) {
    throw new Error('incompleteReportUuid is required.');
  }
  if (!reportContent) {
    throw new Error('reportContent is required to save a FINTRAC report.');
  }

  const reference =
    reportingEntityReportReference ||
    reportContent?.reportDetails?.reportingEntityReportReference ||
    '';

  const reportPayload = {
    metadata: {
      incompleteReportUuid,
      reportTypeCode: FINTRAC_REPORT_TYPE_LCTR,
      reportingEntityReportReference: reference,
      reportingEntityNumber,
      submittingReportingEntityNumber,
    },
    reportContent,
  };

  const payload = await fintracFetch(
    '/experiencelayer/experience/reports/saveReport',
    {
      method: 'PUT',
      token,
      body: buildSaveReportFormData(reportPayload),
      refererPath: `/report/lctr/${incompleteReportUuid}/validation`,
    },
  );

  const meta = payload?.payload?.metadata || {};
  const savedContent = payload?.payload?.reportContent || reportContent;

  return {
    incompleteReportUuid: meta.incompleteReportUuid || incompleteReportUuid,
    reportingEntityReportReference:
      meta.reportingEntityReportReference || reference,
    reportingEntityNumber: meta.reportingEntityNumber ?? reportingEntityNumber,
    submittingReportingEntityNumber:
      meta.submittingReportingEntityNumber ?? submittingReportingEntityNumber,
    reportContent: savedContent,
    status: FINTRAC_STATUS.saved,
    message: payload?.message?.en || 'Successfully saved the incomplete report',
    raw: payload,
    portalUrl: buildFintracReportPortalUrl(incompleteReportUuid),
    validationUrl: buildFintracReportPortalUrl(incompleteReportUuid, {
      page: 'validation',
    }),
  };
}

/**
 * Validates an incomplete report.
 * POST JSON → /experiencelayer/experience/reports/validate
 */
export async function validateFintracReport(token, {
  incompleteReportUuid,
  reportTypeCode = FINTRAC_REPORT_TYPE_LCTR,
  reportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
  submittingReportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
} = {}) {
  const body = buildFintracReportActionBody({
    incompleteReportUuid,
    reportTypeCode,
    reportingEntityNumber,
    submittingReportingEntityNumber,
  });

  const payload = await fintracFetch(
    '/experiencelayer/experience/reports/validate',
    {
      method: 'POST',
      token,
      body,
      refererPath: `/report/lctr/${incompleteReportUuid}/validation`,
    },
  );

  const validationMessages =
    payload?.payload?.validationMessages ||
    payload?.payload?.messages ||
    [];
  const ok =
    payload?.code === 200 &&
    (!Array.isArray(validationMessages) || validationMessages.length === 0);

  return {
    incompleteReportUuid,
    validationMessages: Array.isArray(validationMessages) ? validationMessages : [],
    valid: ok,
    status: ok ? FINTRAC_STATUS.validated : FINTRAC_STATUS.saved,
    message: payload?.message?.en || (ok ? 'Report validated' : 'Validation returned issues'),
    raw: payload,
    portalUrl: buildFintracReportPortalUrl(incompleteReportUuid),
    validationUrl: buildFintracReportPortalUrl(incompleteReportUuid, {
      page: 'validation',
    }),
  };
}

/**
 * Submits a validated incomplete report to FINTRAC.
 * POST JSON → /experiencelayer/experience/reports/submitReport
 */
export async function submitFintracReport(token, {
  incompleteReportUuid,
  reportTypeCode = FINTRAC_REPORT_TYPE_LCTR,
  reportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
  submittingReportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
} = {}) {
  const meta = describeFintracToken(token);
  if (meta?.expired) {
    const error = new Error(
      explainFintracError('FINTRAC session expired.', { action: 'auth' }),
    );
    error.status = 401;
    throw error;
  }

  const body = buildFintracReportActionBody({
    incompleteReportUuid,
    reportTypeCode,
    reportingEntityNumber,
    submittingReportingEntityNumber,
  });

  const payload = await fintracFetch(
    '/experiencelayer/experience/reports/submitReport',
    {
      method: 'POST',
      token,
      body,
      refererPath: `/report/lctr/${incompleteReportUuid}/validation`,
    },
  );

  const result = payload?.payload || {};
  return {
    incompleteReportUuid,
    externalReportUuid: result.externalReportUuid || incompleteReportUuid,
    reportingEntityReportReference: result.reportingEntityReportReference || '',
    submitDateTime: result.submitDateTime || null,
    validationMessages: Array.isArray(result.validationMessages)
      ? result.validationMessages
      : [],
    status: FINTRAC_STATUS.submitted,
    message: payload?.message?.en || 'Report submitted',
    raw: payload,
    portalUrl: buildFintracReportPortalUrl(incompleteReportUuid),
  };
}

/**
 * Full pipeline once SO→LCTR mapping exists:
 * create → save(reportContent) → validate → return for human review before submit.
 */
export async function prepareFintracReportForReview(token, {
  reportContent,
  reportingEntityReportReference,
  reportTypeCode = FINTRAC_REPORT_TYPE_LCTR,
  reportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
  submittingReportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
} = {}) {
  if (!reportContent) {
    throw new Error(
      'SO field mapping is not configured yet — cannot auto-fill and validate.',
    );
  }

  const created = await createFintracReport(token, {
    reportTypeCode,
    reportingEntityNumber,
    submittingReportingEntityNumber,
  });

  const saved = await saveFintracReport(token, {
    incompleteReportUuid: created.incompleteReportUuid,
    reportContent,
    reportingEntityNumber,
    submittingReportingEntityNumber,
    reportingEntityReportReference:
      reportingEntityReportReference ||
      reportContent?.reportDetails?.reportingEntityReportReference,
  });

  const validated = await validateFintracReport(token, {
    incompleteReportUuid: created.incompleteReportUuid,
    reportTypeCode,
    reportingEntityNumber,
    submittingReportingEntityNumber,
  });

  return {
    ...created,
    ...saved,
    ...validated,
    incompleteReportUuid: created.incompleteReportUuid,
    reportContent: saved.reportContent,
    status: validated.valid ? FINTRAC_STATUS.validated : FINTRAC_STATUS.saved,
  };
}
