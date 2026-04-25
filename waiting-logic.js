// =============================================================
// HouseComply — Waiting Page Logic
// Hosted on GitHub. Loaded by waiting-shell.html in GHL.
// Edit this file in GitHub browser editor (has full search).
// Version: V1
// =============================================================

const AIRTABLE_API_KEY = window.HC_AIRTABLE_KEY || "";
const AIRTABLE_BASE_ID  = "appRbC8gJAw2w5jeS";
const INSPECTIONS_TABLE = "INSPECTIONS";
const PROPERTIES_TABLE  = "PROPERTIES";
const AIRTABLE_API_ROOT = "https://api.airtable.com/v0";

const SUCCESS_PAGE_URL   = "https://www.housecomply.co.uk/inspection/complete";
const CLARIFY_PAGE_URL   = "https://www.housecomply.co.uk/inspection/clarify";
const ESCALATED_PAGE_URL = "https://www.housecomply.co.uk/inspection/escalated";

const POLL_INTERVAL_MS  = 5000;
const LONG_WAIT_MS      = 30000;
const EXTENDED_ERROR_MS = 90000;

const TERMINAL_ROUTES = {
  "Passed":                       SUCCESS_PAGE_URL,
  "Partial — awaiting inspector": CLARIFY_PAGE_URL,
  "Partial - awaiting inspector": CLARIFY_PAGE_URL,
  "Blocked — awaiting inspector": CLARIFY_PAGE_URL,
  "Blocked - awaiting inspector": CLARIFY_PAGE_URL,
  "Failed after max attempts":    ESCALATED_PAGE_URL,
  "Escalated to manual review":   ESCALATED_PAGE_URL
};

// AI process messages — shown sequentially to explain what is happening
const AI_MESSAGES = [
  { delay: 0,     text: "Receiving your inspection data..." },
  { delay: 4000,  text: "Checking compliance documents — EPC, EICR, Gas Safety..." },
  { delay: 9000,  text: "Reviewing smoke and CO alarm records..." },
  { delay: 14000, text: "Analysing defect log against FFHH standards..." },
  { delay: 19000, text: "Cross-checking heating, water and ventilation data..." },
  { delay: 24000, text: "Running Welsh tenancy compliance checks..." },
  { delay: 29000, text: "Checking for missing documents and data gaps..." },
  { delay: 34000, text: "Generating compliance risk assessment..." },
  { delay: 40000, text: "Finalising validation result..." },
  { delay: 50000, text: "Almost there — complex inspections take a little longer..." },
  { delay: 65000, text: "Still processing — your report will be ready shortly..." }
];

let pollTimer     = null;
let startTime     = 0;
let longWaitShown = false;
let extendedShown = false;
let inspectionId  = null;
let token         = null;
let accountId     = null;
let msgTimers     = [];

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

// =============================================================
// INIT — reads account_id OR inspection_id from URL
// =============================================================
async function init() {
  const params = new URLSearchParams(window.location.search);
  inspectionId = params.get('inspection_id');
  token        = params.get('token');
  accountId    = params.get('account_id');

  // Start AI message sequence immediately
  startAIMessages();

  try {
    // If we have inspection_id use it directly
    // Otherwise find the latest inspection for this account_id
    if (!inspectionId && accountId) {
      inspectionId = await findLatestInspection(accountId);
      if (!inspectionId) {
        // Still processing — show waiting and poll by account
        $('boot').hidden = true;
        $('waiting').hidden = false;
        startPollingByAccount(accountId);
        return;
      }
    }

    if (!inspectionId) {
      showErrorScreen(
        "This link is invalid.",
        "The submission URL is missing required information. Please return to the form and resubmit."
      );
      return;
    }

    const inspection = await fetchInspection(inspectionId);
    await renderContext(inspection);

    const currentStatus = inspection.fields['Validation Status'];
    if (TERMINAL_ROUTES[currentStatus]) {
      redirectTo(TERMINAL_ROUTES[currentStatus]);
      return;
    }

    $('boot').hidden = true;
    $('waiting').hidden = false;
    startPolling();

  } catch (err) {
    console.error('Init error:', err);
    showErrorScreen(
      "Something went wrong.",
      "We couldn't load your inspection. Please refresh, or contact support.",
      err.message || ''
    );
  }
}

// =============================================================
// FIND LATEST INSPECTION BY ACCOUNT ID
// =============================================================
async function findLatestInspection(accountId) {
  const formula = encodeURIComponent(`FIND("${accountId}",ARRAYJOIN({Linked Account}))`);
  const url = `${AIRTABLE_API_ROOT}/${AIRTABLE_BASE_ID}/${encodeURIComponent(INSPECTIONS_TABLE)}?filterByFormula=${formula}&sort[0][field]=Submitted At&sort[0][direction]=desc&maxRecords=1`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.records && data.records.length > 0) {
    return data.records[0].id;
  }
  return null;
}

// =============================================================
// AIRTABLE HELPERS
// =============================================================
async function fetchInspection(id) {
  return airtableGet(INSPECTIONS_TABLE, id);
}

async function fetchProperty(id) {
  return airtableGet(PROPERTIES_TABLE, id);
}

async function airtableGet(table, recordId) {
  const url = `${AIRTABLE_API_ROOT}/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${encodeURIComponent(recordId)}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    const err = new Error(`Airtable GET failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// =============================================================
// RENDER CONTEXT CARD
// =============================================================
async function renderContext(inspection) {
  const fields = inspection.fields || {};
  $('ctx-inspector').textContent = fields['Inspector Name'] || '—';
  if (fields['Inspection Date']) {
    $('ctx-date').textContent = formatDate(fields['Inspection Date']);
  }
  $('ctx-ref').textContent = formatReference(inspection.id);

  const propertyIds = fields['Linked Property'] || fields['Property'];
  if (Array.isArray(propertyIds) && propertyIds.length > 0) {
    try {
      const property = await fetchProperty(propertyIds[0]);
      const pf = property.fields || {};
      const parts = [pf['Address'], pf['City'], pf['Postcode']].filter(Boolean);
      $('ctx-property').textContent = parts.join(', ') || '—';
    } catch (e) {
      $('ctx-property').textContent = '—';
    }
  }
}

function formatDate(isoDate) {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return isoDate; }
}

function formatReference(recordId) {
  if (!recordId) return '—';
  return `INS-${recordId.substring(0, 10)}${recordId.length > 10 ? '…' : ''}`;
}

// =============================================================
// AI MESSAGES — explains what is happening during validation
// =============================================================
function startAIMessages() {
  const el = $('ai-status');
  if (!el) return;
  AI_MESSAGES.forEach(msg => {
    const t = setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => {
        el.textContent = msg.text;
        el.style.opacity = '1';
      }, 300);
    }, msg.delay);
    msgTimers.push(t);
  });
}

function stopAIMessages() {
  msgTimers.forEach(t => clearTimeout(t));
  msgTimers = [];
}

// =============================================================
// POLLING
// =============================================================
function startPolling() {
  startTime = Date.now();
  pollTimer = setInterval(async () => {
    try {
      const inspection = await fetchInspection(inspectionId);
      hideConnectionIssue();
      await renderContext(inspection);
      const status = inspection.fields['Validation Status'];
      if (TERMINAL_ROUTES[status]) {
        clearInterval(pollTimer);
        stopAIMessages();
        redirectTo(TERMINAL_ROUTES[status]);
        return;
      }
      updateElapsedNotices();
    } catch (err) {
      console.warn('Poll error:', err);
      showConnectionIssue();
      updateElapsedNotices();
    }
  }, POLL_INTERVAL_MS);
}

function startPollingByAccount(accountId) {
  startTime = Date.now();
  pollTimer = setInterval(async () => {
    try {
      if (!inspectionId) {
        inspectionId = await findLatestInspection(accountId);
        if (!inspectionId) { updateElapsedNotices(); return; }
      }
      const inspection = await fetchInspection(inspectionId);
      hideConnectionIssue();
      await renderContext(inspection);
      const status = inspection.fields['Validation Status'];
      if (TERMINAL_ROUTES[status]) {
        clearInterval(pollTimer);
        stopAIMessages();
        redirectTo(TERMINAL_ROUTES[status]);
        return;
      }
      updateElapsedNotices();
    } catch (err) {
      console.warn('Poll error:', err);
      showConnectionIssue();
      updateElapsedNotices();
    }
  }, POLL_INTERVAL_MS);
}

function updateElapsedNotices() {
  const elapsed = Date.now() - startTime;
  if (!longWaitShown && elapsed >= LONG_WAIT_MS) {
    $('notice-long').classList.add('show');
    longWaitShown = true;
  }
  if (!extendedShown && elapsed >= EXTENDED_ERROR_MS) {
    $('notice-long').classList.remove('show');
    $('notice-extended').classList.add('show');
    extendedShown = true;
  }
}

// =============================================================
// UI HELPERS
// =============================================================
function showConnectionIssue() { $('conn').classList.add('show'); }
function hideConnectionIssue() { $('conn').classList.remove('show'); }

function redirectTo(targetUrl) {
  if (!targetUrl) return;
  const url = new URL(targetUrl);
  if (inspectionId) url.searchParams.set('inspection_id', inspectionId);
  if (token) url.searchParams.set('token', token);
  if (accountId) url.searchParams.set('account_id', accountId);
  window.location.href = url.toString();
}

function showErrorScreen(title, message, detail) {
  $('boot').hidden = true;
  $('waiting').hidden = true;
  const screen = $('error-screen');
  screen.classList.add('show');
  screen.querySelector('h1').textContent = title;
  $('error-message').textContent = message;
  if (detail) {
    const detailEl = $('error-details');
    detailEl.textContent = detail;
    detailEl.hidden = false;
  }
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btn-refresh') window.location.reload();
});
