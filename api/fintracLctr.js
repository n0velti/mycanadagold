/**
 * LCTR (report type 106) payload helpers for FINTRAC Web Reporting.
 *
 * Mapping verified against Canada Gold submissions:
 * - SO41229 Montreal (location 3)
 * - SO40512 Quebec City (location 4)
 */

export const FINTRAC_REPORT_TYPE_LCTR = 106;
export const FINTRAC_REPORTING_ENTITY_NUMBER = 147954;

/** Dealers in precious metals and stones */
export const FINTRAC_ACTIVITY_SECTOR_CODE = 18;

/** Canada Gold FINTRAC contact on the reporting entity */
export const FINTRAC_REPORTING_ENTITY_CONTACT_ID = 105535;

/** Cash */
export const FINTRAC_METHOD_CODE_CASH = 1;

/** Purchase of precious metals disposition */
export const FINTRAC_DISPOSITION_CODE = 15;

/** Aggregation type from successful filings */
export const FINTRAC_AGGREGATION_TYPE_CODE = 4;

/** Person definition */
export const FINTRAC_DEFINITION_TYPE_PERSON = 3;

/** Conductor is also the beneficiary */
export const FINTRAC_RELATIONSHIP_OF_CONDUCTOR_CODE = 15;

/** Driver’s licence */
export const FINTRAC_IDENTIFIER_TYPE_CODE_DL = 4;

/** Other (person) — requires identifierTypeOther */
export const FINTRAC_IDENTIFIER_TYPE_CODE_OTHER = 3;

/** Passport */
export const FINTRAC_IDENTIFIER_TYPE_CODE_PASSPORT = 2;

/** Birth certificate */
export const FINTRAC_IDENTIFIER_TYPE_CODE_BIRTH = 1;

/** Provincial health card */
export const FINTRAC_IDENTIFIER_TYPE_CODE_HEALTH = 5;

/** Structured Canadian address */
export const FINTRAC_ADDRESS_TYPE_CODE = 1;

export const FINTRAC_CURRENCY_CAD = 'CAD';

export const FINTRAC_DEFAULT_PURPOSE = 'Bought metals for investment';

/**
 * FINTRAC reportingEntityLocationId by store name (not Aureus location_id).
 * 2 Gloucester · 3 Montreal · 4 Quebec City · 5 Halifax · 6 Carlingwood · 7 Laval
 */
export const FINTRAC_LOCATION_IDS = {
  gloucester: '2',
  montreal: '3',
  quebec: '4',
  'quebec city': '4',
  halifax: '5',
  carlingwood: '6',
  'carling wood': '6',
  laval: '7',
};

const PROVINCE_CODES = {
  ab: 'AB',
  alberta: 'AB',
  bc: 'BC',
  'british columbia': 'BC',
  mb: 'MB',
  manitoba: 'MB',
  nb: 'NB',
  'new brunswick': 'NB',
  nl: 'NL',
  newfoundland: 'NL',
  'newfoundland and labrador': 'NL',
  ns: 'NS',
  'nova scotia': 'NS',
  nt: 'NT',
  'northwest territories': 'NT',
  nu: 'NU',
  nunavut: 'NU',
  on: 'ON',
  ontario: 'ON',
  pe: 'PE',
  'prince edward island': 'PE',
  qc: 'QC',
  quebec: 'QC',
  québec: 'QC',
  sk: 'SK',
  saskatchewan: 'SK',
  yt: 'YT',
  yukon: 'YT',
};

const ID_TYPE_CODES = {
  // Aureus short codes
  ot: FINTRAC_IDENTIFIER_TYPE_CODE_OTHER,
  other: FINTRAC_IDENTIFIER_TYPE_CODE_OTHER,
  dl: FINTRAC_IDENTIFIER_TYPE_CODE_DL,
  pp: FINTRAC_IDENTIFIER_TYPE_CODE_PASSPORT,
  passport: FINTRAC_IDENTIFIER_TYPE_CODE_PASSPORT,
  bc: FINTRAC_IDENTIFIER_TYPE_CODE_BIRTH,
  birth: FINTRAC_IDENTIFIER_TYPE_CODE_BIRTH,
  'birth certificate': FINTRAC_IDENTIFIER_TYPE_CODE_BIRTH,
  hc: FINTRAC_IDENTIFIER_TYPE_CODE_HEALTH,
  health: FINTRAC_IDENTIFIER_TYPE_CODE_HEALTH,
  'health card': FINTRAC_IDENTIFIER_TYPE_CODE_HEALTH,
  'provincial health card': FINTRAC_IDENTIFIER_TYPE_CODE_HEALTH,
  // Driver’s licence variants
  'driver license': FINTRAC_IDENTIFIER_TYPE_CODE_DL,
  "driver's license": FINTRAC_IDENTIFIER_TYPE_CODE_DL,
  "driver’s licence": FINTRAC_IDENTIFIER_TYPE_CODE_DL,
  'drivers license': FINTRAC_IDENTIFIER_TYPE_CODE_DL,
  licence: FINTRAC_IDENTIFIER_TYPE_CODE_DL,
  license: FINTRAC_IDENTIFIER_TYPE_CODE_DL,
};

/**
 * Same algorithm FINTRAC Web Reporting uses in its SPA subjects store:
 *   GO = (m) => Array.from(Array(m), () => Math.floor(Math.random() * 10)).join("")
 *   generateRefId = () => GO(10).toString()
 */
export function generateFintracPortalRefId() {
  return Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
}

export function isFintracPortalRefId(value) {
  return /^\d{10}$/.test(String(value || ''));
}

export function buildFintracReportActionBody({
  incompleteReportUuid,
  reportTypeCode = FINTRAC_REPORT_TYPE_LCTR,
  reportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
  submittingReportingEntityNumber = FINTRAC_REPORTING_ENTITY_NUMBER,
} = {}) {
  if (!incompleteReportUuid) {
    throw new Error('incompleteReportUuid is required.');
  }
  return {
    reportTypeCode,
    incompleteReportUuid,
    reportingEntityNumber,
    submittingReportingEntityNumber,
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function offsetLabel(hours) {
  const n = Number(hours);
  const value = Number.isFinite(n) ? n : -4;
  const sign = value <= 0 ? '-' : '+';
  return `${sign}${pad2(Math.abs(value))}:00`;
}

export function buildTwentyFourHourRuleForDate(dateInput, timeZoneOffset = '-04:00') {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid transaction date for 24-hour rule.');
  }
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return {
    aggregationTypeCode: FINTRAC_AGGREGATION_TYPE_CODE,
    periodStart: `${y}-${m}-${d}T00:00:00${timeZoneOffset}`,
    periodEnd: `${y}-${m}-${d}T23:59:59${timeZoneOffset}`,
  };
}

/** Format Aureus "YYYY-MM-DD HH:mm:ss" with store offset for FINTRAC. */
export function formatFintracDateTime(dateInput, timeOffsetHours = -4) {
  const offset = offsetLabel(timeOffsetHours);
  if (typeof dateInput === 'string') {
    const match = dateInput.match(
      /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/,
    );
    if (match) return `${match[1]}T${match[2]}${offset}`;
  }
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  // Interpret local components if Date; prefer string path for Aureus values.
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}${offset}`;
}

/** FINTRAC LCTR amounts are whole dollars (no cents), e.g. "11650". */
export function moneyString(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n));
}

export function normalizeCountryCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw === 'CAN' || raw === 'CA' || raw === 'CANADA') return 'CA';
  if (raw.length === 2) return raw;
  return raw;
}

export function normalizeProvinceCode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return PROVINCE_CODES[raw] || (raw.length === 2 ? raw.toUpperCase() : '');
}

export function mapIdentifierTypeCode(cardIdType) {
  const key = String(cardIdType || '').trim().toLowerCase();
  if (!key) return null;
  return ID_TYPE_CODES[key] || null;
}

/**
 * Quebec-style driver's licence numbers often start with a letter then digits
 * (e.g. A422522098402, M4207-141087-00).
 */
export function looksLikeDriversLicenceNumber(idNumber) {
  const raw = String(idNumber || '').trim().toUpperCase();
  if (!raw) return false;
  // Letter first, then at least one digit (dashes allowed in between).
  return /^[A-Z][0-9-]{0,}\d/.test(raw) && /[0-9]/.test(raw);
}

/**
 * Prefer Aureus card_id_type; if blank and ID looks like letter+digits DL, use DL (code 4).
 */
export function inferIdentifierTypeCode(cardIdType, idNumber) {
  const mapped = mapIdentifierTypeCode(cardIdType);
  if (mapped != null) return mapped;
  if (looksLikeDriversLicenceNumber(idNumber)) {
    return FINTRAC_IDENTIFIER_TYPE_CODE_DL;
  }
  return null;
}

export function mapFintracLocationId(storeName) {
  const key = String(storeName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!key) return '';
  if (FINTRAC_LOCATION_IDS[key]) return FINTRAC_LOCATION_IDS[key];
  // Soft match: "Quebec" / "Quebec City", "Montreal Store", etc.
  for (const [name, id] of Object.entries(FINTRAC_LOCATION_IDS)) {
    if (key === name || key.includes(name) || name.includes(key)) return id;
  }
  return '';
}

/**
 * Address parsing matching FINTRAC form fields (unitNumber max 10 chars):
 * - Normal civic: "17865 rue Beaupre" → buildingNumber + streetAddress
 * - Unit-civic: "1406-365 BOUL DEGUIRE" → unitNumber "1406" + buildingNumber "365" + street
 * - address_2 used as unit when present (truncated/validated to 10)
 */
export function parseFintracAddress(address1, address2 = '') {
  const line = String(address1 || '').trim().replace(/\s+/g, ' ');
  // FINTRAC: definitions[].address.unitNumber max 10 characters — omit if too long.
  const rawUnit2 = String(address2 || '').trim();
  const unitFrom2 = rawUnit2.length > 0 && rawUnit2.length <= 10 ? rawUnit2 : '';

  if (!line) {
    return {
      buildingNumber: '',
      unitNumber: unitFrom2,
      streetAddress: '',
    };
  }

  // "1406-365 BOUL DEGUIRE" / "12 - 345 Main St"
  const compound = line.match(/^(\d+)\s*-\s*(\d+[A-Za-z]?)\s+(.+)$/);
  if (compound) {
    const unitPart = unitFrom2 || String(compound[1]).slice(0, 10);
    return {
      buildingNumber: compound[2],
      unitNumber: unitPart.slice(0, 10),
      streetAddress: compound[3].trim(),
    };
  }

  const civic = line.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (civic) {
    return {
      buildingNumber: civic[1],
      unitNumber: unitFrom2,
      streetAddress: civic[2].trim(),
    };
  }

  return {
    buildingNumber: '',
    unitNumber: unitFrom2,
    streetAddress: line,
  };
}

function cashAmountFromDetail(detail, fallbackAmount) {
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];
  let cash = 0;
  let sawCash = false;
  for (const entry of payments) {
    const payment = entry?.payment || entry || {};
    const isCash =
      payment.payment_type?.is_cash === true ||
      String(payment.payment_type?.name || '')
        .trim()
        .toLowerCase() === 'cash';
    if (!isCash) continue;
    sawCash = true;
    cash += Number(entry?.amount ?? payment.amount) || 0;
  }
  if (sawCash) return Math.round(cash);
  if (typeof fallbackAmount === 'number') return Math.round(fallbackAmount);
  return Math.round(Number(detail?.total_amount) || 0);
}

function pickAddress(detail) {
  const client = detail?.client || {};
  const addresses = Array.isArray(client.addresses) ? client.addresses : [];
  return (
    addresses.find((a) => a.default_for_billing) ||
    addresses.find((a) => a.default_for_shipping) ||
    addresses[0] ||
    detail?.billing_address ||
    detail?.shipping_address ||
    null
  );
}

/**
 * Required FINTRAC inputs (occupation may default to "unknown").
 */
export function validateLctrFieldBag(fields) {
  const missing = [];
  const require = (key, label, value) => {
    const ok =
      value != null &&
      String(value).trim() !== '' &&
      String(value).trim() !== '—';
    if (!ok) missing.push({ field: key, label });
  };

  require('reportingEntityReportReference', 'Transaction number', fields.reportingEntityReportReference);
  require('dateTimeOfTransaction', 'Transaction date and time', fields.dateTimeOfTransaction);
  require('amount', 'Amount (cash)', fields.amount);
  require('reportingEntityLocationId', 'Store / FINTRAC location', fields.reportingEntityLocationId);
  require('clientNumber', 'Client ID', fields.clientNumber);
  require('givenName', 'Given name', fields.givenName);
  require('surname', 'Surname', fields.surname);
  require('telephoneNumber', 'Telephone number', fields.telephoneNumber);
  require('dateOfBirth', 'Date of birth', fields.dateOfBirth);
  require('identificationNumber', 'Government ID #', fields.identificationNumber);
  require(
    'identificationProvinceStateCode',
    'ID jurisdiction (province)',
    fields.identificationProvinceStateCode,
  );
  require('identifierTypeCode', 'Card / ID type', fields.identifierTypeCode);
  require('streetAddress', 'Street name', fields.streetAddress);
  require('city', 'City', fields.city);
  require('provinceStateCode', 'Province', fields.provinceStateCode);
  require('postalZipCode', 'Postal code', fields.postalZipCode);
  require('countryCode', 'Country', fields.countryCode);
  require('purpose', 'Description / purpose', fields.purpose);

  if (Number(fields.identifierTypeCode) === FINTRAC_IDENTIFIER_TYPE_CODE_OTHER) {
    require(
      'identifierTypeOther',
      'ID type — other description',
      fields.identifierTypeOther,
    );
  }

  if (!(Number(fields.amount) >= 10000)) {
    missing.push({
      field: 'amount',
      label: 'Amount (cash) must be ≥ $10,000',
    });
  }

  if (!fields.buildingNumber && !fields.unitNumber) {
    // Street-only addresses are uncommon for LCTR; still allow if street present,
    // but prefer having a building or unit. SO40512 always had buildingNumber.
    // Do not hard-fail — building may be embedded only in street for edge cases.
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

/**
 * Map Aureus order/purchase detail (+ list row) → FINTRAC field bag + reportContent.
 */
export function mapAureusDetailToLctrFields(detail, row = {}) {
  const client = detail?.client || {};
  const address = pickAddress(detail) || {};
  const locationName = detail?.location?.name || row.storeName || '';
  const timeOffset = detail?.location?.time_offset ?? -4;
  const offset = offsetLabel(timeOffset);
  const dateRaw = detail?.date || row.date || '';
  const dateTimeOfTransaction = formatFintracDateTime(dateRaw, timeOffset);
  const cashAmount = cashAmountFromDetail(detail, row.cashAmount ?? row.amount);
  const parsedAddress = parseFintracAddress(address.address_1, address.address_2);
  const idNumber = String(client.card_id_number || '').trim();
  const provinceFromAddress = normalizeProvinceCode(address.state);
  let provinceFromId = normalizeProvinceCode(client.card_id_issuer);
  const idTypeCode = inferIdentifierTypeCode(client.card_id_type, idNumber);
  const idTypeOther =
    idTypeCode === FINTRAC_IDENTIFIER_TYPE_CODE_OTHER
      ? String(client.card_id_type_other || client.card_id_other || '').trim() ||
        (String(client.card_id_type || '').trim().toUpperCase() === 'OT'
          ? 'Other'
          : String(client.card_id_type || '').trim() || 'Other')
      : '';

  // If ID looks like a DL and client lives in Quebec, default issuer to QC when blank.
  if (
    !provinceFromId &&
    provinceFromAddress === 'QC' &&
    (idTypeCode === FINTRAC_IDENTIFIER_TYPE_CODE_DL ||
      looksLikeDriversLicenceNumber(idNumber))
  ) {
    provinceFromId = 'QC';
  }

  const country =
    normalizeCountryCode(address.country_iso2 || address.country) || 'CA';

  const type = row.type || (detail?.items ? 'order' : 'purchase');
  const sourceId = row.sourceId || detail?.id;
  const reportingEntityReportReference =
    type === 'purchase' ? `PO${sourceId}` : `SO${sourceId}`;

  const occupation =
    String(client.customer_employer || '').trim() || 'unknown';

  const fields = {
    reportingEntityReportReference,
    dateTimeOfTransaction,
    amount: cashAmount,
    currencyCode: detail?.currency || row.currency || FINTRAC_CURRENCY_CAD,
    purpose: FINTRAC_DEFAULT_PURPOSE,
    reportingEntityLocationId: mapFintracLocationId(locationName),
    storeName: locationName,
    clientNumber: client.id != null ? String(client.id) : '',
    givenName: String(client.first_name || '').trim(),
    surname: String(client.last_name || '').trim(),
    telephoneNumber: String(client.phone || '').trim(),
    dateOfBirth: String(client.dob || '').trim(),
    countryOfResidenceCode: country,
    occupation,
    identificationNumber: idNumber,
    identificationProvinceStateCode: provinceFromId || provinceFromAddress,
    identificationCountryCode: 'CA',
    identifierTypeCode: idTypeCode,
    identifierTypeOther: idTypeOther,
    buildingNumber: parsedAddress.buildingNumber,
    unitNumber: parsedAddress.unitNumber,
    streetAddress: parsedAddress.streetAddress,
    city: String(address.city || '').trim(),
    provinceStateCode: provinceFromAddress || provinceFromId,
    postalZipCode: String(address.zip || '').trim(),
    countryCode: country,
    timeZoneOffset: offset,
    timeOffsetHours: timeOffset,
  };

  const validation = validateLctrFieldBag(fields);
  return { fields, validation };
}

export function buildLctrReportContentFromFields(fields, { personRefId } = {}) {
  const refId = isFintracPortalRefId(personRefId)
    ? String(personRefId)
    : generateFintracPortalRefId();
  const amountStr = moneyString(fields.amount);
  const txDateTime = fields.dateTimeOfTransaction;
  const txDate = txDateTime ? new Date(txDateTime) : new Date();

  const address = {
    typeCode: FINTRAC_ADDRESS_TYPE_CODE,
    streetAddress: String(fields.streetAddress || ''),
    city: String(fields.city || ''),
    countryCode: String(fields.countryCode || 'CA'),
    provinceStateCode: String(fields.provinceStateCode || ''),
    postalZipCode: String(fields.postalZipCode || ''),
  };
  if (fields.buildingNumber) {
    address.buildingNumber = String(fields.buildingNumber).slice(0, 10);
  }
  const unit = String(fields.unitNumber || '').trim();
  if (unit) {
    // FINTRAC schema: unitNumber max 10 characters
    address.unitNumber = unit.slice(0, 10);
  }

  return {
    reportDetails: {
      reportTypeCode: FINTRAC_REPORT_TYPE_LCTR,
      submitTypeCode: 1,
      reportingEntityNumber: FINTRAC_REPORTING_ENTITY_NUMBER,
      submittingReportingEntityNumber: FINTRAC_REPORTING_ENTITY_NUMBER,
      reportingEntityReportReference: String(
        fields.reportingEntityReportReference || '',
      ),
      twentyFourHourRule: buildTwentyFourHourRuleForDate(
        txDate,
        fields.timeZoneOffset || '-04:00',
      ),
      activitySectorCode: FINTRAC_ACTIVITY_SECTOR_CODE,
      reportingEntityContactId: FINTRAC_REPORTING_ENTITY_CONTACT_ID,
    },
    transactions: [
      {
        reportingEntityLocationId: String(fields.reportingEntityLocationId || ''),
        largeCashTransactionDetails: {
          thresholdIndicator: true,
          dateTimeOfTransaction: txDateTime,
          methodCode: FINTRAC_METHOD_CODE_CASH,
          reportingEntityTransactionReference: String(
            fields.reportingEntityReportReference || '',
          ),
          purpose: String(fields.purpose || FINTRAC_DEFAULT_PURPOSE),
        },
        startingActions: [
          {
            details: {
              amount: amountStr,
              currencyCode: fields.currencyCode || FINTRAC_CURRENCY_CAD,
              sourceOfCashIndicator: false,
              depositToBusinessAccountIndicator: false,
            },
            sourcesOfCash: [],
            conductors: [
              {
                typeCode: FINTRAC_DEFINITION_TYPE_PERSON,
                refId,
                details: {
                  clientNumber: String(fields.clientNumber || ''),
                  onBehalfOfIndicator: false,
                },
                onBehalfOfs: [],
              },
            ],
          },
        ],
        completingActions: [
          {
            details: {
              dispositionCode: FINTRAC_DISPOSITION_CODE,
              currencyCode: fields.currencyCode || FINTRAC_CURRENCY_CAD,
              valueInCanadianDollars: amountStr,
              involvementIndicator: false,
            },
            beneficiaries: [
              {
                typeCode: FINTRAC_DEFINITION_TYPE_PERSON,
                refId,
                details: {
                  clientNumber: String(fields.clientNumber || ''),
                  relationshipOfConductorCode:
                    FINTRAC_RELATIONSHIP_OF_CONDUCTOR_CODE,
                },
              },
            ],
            involvements: [],
          },
        ],
      },
    ],
    definitions: [
      {
        typeCode: FINTRAC_DEFINITION_TYPE_PERSON,
        refId,
        givenName: String(fields.givenName || ''),
        surname: String(fields.surname || ''),
        telephoneNumber: String(fields.telephoneNumber || ''),
        dateOfBirth: String(fields.dateOfBirth || ''),
        countryOfResidenceCode: String(fields.countryOfResidenceCode || 'CA'),
        occupation: String(fields.occupation || 'unknown'),
        identifications: [
          (() => {
            const typeCode =
              fields.identifierTypeCode || FINTRAC_IDENTIFIER_TYPE_CODE_DL;
            const entry = {
              identifierTypeCode: typeCode,
              number: String(fields.identificationNumber || ''),
              jurisdictionOfIssueCountryCode:
                fields.identificationCountryCode || 'CA',
              jurisdictionOfIssueProvinceStateCode: String(
                fields.identificationProvinceStateCode || '',
              ),
            };
            if (Number(typeCode) === FINTRAC_IDENTIFIER_TYPE_CODE_OTHER) {
              entry.identifierTypeOther = String(
                fields.identifierTypeOther || 'Other',
              ).trim() || 'Other';
            }
            return entry;
          })(),
        ],
        addressTypeCode: FINTRAC_ADDRESS_TYPE_CODE,
        address,
      },
    ],
  };
}

/**
 * Full mapper used by Add to FINTRAC.
 * @returns {{ ok, missing, fields, reportContent, personRefId }}
 */
export function buildLctrReportContentFromTransaction(row, detail) {
  if (!detail) {
    return {
      ok: false,
      missing: [{ field: 'detail', label: 'Transaction details' }],
      fields: null,
      reportContent: null,
      personRefId: null,
    };
  }

  const { fields, validation } = mapAureusDetailToLctrFields(detail, row);
  if (!validation.ok) {
    return {
      ok: false,
      missing: validation.missing,
      fields,
      reportContent: null,
      personRefId: null,
    };
  }

  const personRefId = generateFintracPortalRefId();
  const reportContent = buildLctrReportContentFromFields(fields, { personRefId });
  return {
    ok: true,
    missing: [],
    fields,
    reportContent,
    personRefId,
  };
}

/** @deprecated use buildLctrReportContentFromFields */
export function buildLctrReportContent(options = {}) {
  return buildLctrReportContentFromFields(options, {
    personRefId: options.personRefId,
  });
}
