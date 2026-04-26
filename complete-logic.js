// =============================================================
// HouseComply — Complete Page Logic
// Hosted on GitHub. Loaded by complete-shell.html in GHL.
// Version: V4 — Lookup field filter uses {field}&"" string coercion,
//                sort param removed (see waiting-logic.js V4 for rationale).
// =============================================================

const AIRTABLE_API_KEY  = window.HC_AIRTABLE_KEY || "";
const AIRTABLE_BASE_ID  = "appRbC8gJAw2w5jeS";
const INSPECTIONS_TABLE = "tblUnK5eZLumF9VXs";
const PROPERTIES_TABLE  = "tblV6jXR4YKX3ZkXg";
const AIRTABLE_API_ROOT = "https://api.airtable.com/v0";
const DASHBOARD_URL     = "https://www.housecomply.co.uk/housecomply-dashboard";

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const params  = new URLSearchParams(window.location.search);
  const accountId    = params.get('account_id');
  let   inspectionId = params.get('inspection_id');

  if (!inspectionId && accountId) {
    inspectionId = await findLatestInspection(accountId);
  }

  if (!inspectionId) {
    showError("We couldn't find your inspection. Please return to the dashboard.");
    return;
  }

  try {
    const inspection = await fetchRecord(INSPECTIONS_TABLE, inspectionId);
    const fields     = inspection.fields || {};

    // Fetch property details
    let propertyAddress = "—";
    const propIds = fields['Linked Property'] || fields['Property'] || [];
    const propId  = Array.isArray(propIds) ? propIds[0] : propIds;
    if (propId) {
      try {
        const prop = await fetchRecord(PROPERTIES_TABLE, propId);
        const pf   = prop.fields || {};
        propertyAddress = [pf['Address'], pf['City'], pf['Postcode']].filter(Boolean).join(', ');
      } catch(e) {}
    }

    const reportUrl      = fields['Report URL'] || fields['Compliance Report'] || null;
    const reportGenerated = fields['Report Generated'] || false;
    const reportDate     = fields['Report Generated Date'] || fields['Submitted At'] || null;
    const inspectorName  = fields['Inspector Name'] || "—";
    const inspectionDate = fields['Inspection Date'] || null;
    const fitnessOutcome = fields['Overall Fitness Outcome'] || "Property Compliant";
    const validationStatus = fields['Validation Status'] || "Passed";

    renderComplete({
      inspectionId,
      propertyAddress,
      reportUrl,
      reportGenerated,
      reportDate,
      inspectorName,
      inspectionDate,
      fitnessOutcome,
      validationStatus
    });

  } catch(e) {
    console.error(e);
    showError("We couldn't load your report. Please try refreshing or return to the dashboard.");
  }
}

// =============================================================
// FIND LATEST INSPECTION BY ACCOUNT ID
// V4 fix: {Account Record ID}&"" coerces the Lookup field to a string
// (Airtable's filterByFormula treats Lookup fields as multipleLookupValues
// arrays and ARRAYJOIN behaviour with that type is inconsistent — &""
// is the documented coercion pattern).
// Sort param removed because we only need one record per account, and a
// stale/missing sort field name silently returns [] from the API.
// =============================================================
async function findLatestInspection(accountId) {
  try {
    const formula = encodeURIComponent(`FIND("${accountId}",{Account Record ID}&"")`);
    const url = `${AIRTABLE_API_ROOT}/${AIRTABLE_BASE_ID}/${encodeURIComponent(INSPECTIONS_TABLE)}?filterByFormula=${formula}&maxRecords=1`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.records?.[0]?.id || null;
  } catch(e) { return null; }
}

// =============================================================
// AIRTABLE FETCH
// =============================================================
async function fetchRecord(table, id) {
  const url = `${AIRTABLE_API_ROOT}/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` } });
  if (!res.ok) throw new Error(`Airtable ${res.status}`);
  return res.json();
}

// =============================================================
// FORMAT DATE
// =============================================================
function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch(e) { return iso; }
}

function formatRef(id) {
  if (!id) return "—";
  return `INS-${id.slice(0, 10)}`;
}

// =============================================================
// RENDER
// =============================================================
function renderComplete({ inspectionId, propertyAddress, reportUrl, reportGenerated, reportDate, inspectorName, inspectionDate, fitnessOutcome, validationStatus }) {
  
  const isCompliant = fitnessOutcome && fitnessOutcome.toLowerCase().includes('compliant');
  const badgeClass  = isCompliant ? 'badge-pass' : 'badge-advisory';
  const badgeText   = isCompliant ? 'Property Compliant' : 'Minor Works Required';

  const html = `
    <div class="success-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12l5 5L19 7"/>
      </svg>
    </div>

    <h1>Inspection complete</h1>
    <p class="sub">Your compliance report has been generated and is ready to download. A copy has been sent to your email.</p>

    <div class="report-card">
      <div class="report-card-header">
        <span class="report-card-title">${escapeHtml(propertyAddress)}</span>
        <span class="report-card-ref">${formatRef(inspectionId)}</span>
      </div>
      <div class="report-card-body">
        <div class="report-row">
          <span class="report-key">Inspection date</span>
          <span class="report-val">${formatDate(inspectionDate)}</span>
        </div>
        <div class="report-row">
          <span class="report-key">Inspector</span>
          <span class="report-val">${escapeHtml(inspectorName)}</span>
        </div>
        <div class="report-row">
          <span class="report-key">Report generated</span>
          <span class="report-val">${formatDate(reportDate)}</span>
        </div>
        <div class="report-row">
          <span class="report-key">Compliance outcome</span>
          <span class="report-val"><span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span></span>
        </div>
      </div>
    </div>

    ${reportUrl ? `
    <a href="${escapeHtml(reportUrl)}" target="_blank" class="btn-download">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download PDF Report
    </a>
    ` : `
    <div style="background:var(--amber-bg);border:1px solid rgba(217,119,6,.2);border-radius:var(--r);padding:14px 16px;margin-bottom:12px;font-size:13.5px;color:var(--amber);">
      Your report is being generated. Refresh this page in a moment or check your email for the download link.
    </div>
    `}

    <a href="${DASHBOARD_URL}" class="btn-dashboard">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      Return to dashboard
    </a>

    <div class="next-steps">
      <div class="next-steps-title">What happens next</div>
      <div class="next-step">
        <div class="next-step-icon">1</div>
        <div class="next-step-text">
          Share the report with your landlord
          <span>Send the PDF to confirm compliance — available from your dashboard at any time</span>
        </div>
      </div>
      <div class="next-step">
        <div class="next-step-icon">2</div>
        <div class="next-step-text">
          Complete any outstanding actions
          <span>Any advisory items are listed in the report — address these to maintain compliance</span>
        </div>
      </div>
      <div class="next-step">
        <div class="next-step-icon">3</div>
        <div class="next-step-text">
          Set renewal reminders
          <span>EICR, Gas Safety and EPC expiry dates are tracked in your dashboard</span>
        </div>
      </div>
    </div>
  `;

  document.getElementById('content').innerHTML = html;
}

// =============================================================
// ERROR
// =============================================================
function showError(message) {
  document.getElementById('content').innerHTML = `
    <div class="error-card">
      <p style="font-weight:600;margin-bottom:8px;">Something went wrong</p>
      <p style="font-size:14px;">${escapeHtml(message)}</p>
      <a href="${DASHBOARD_URL}" style="display:inline-block;margin-top:16px;background:var(--navy);color:#fff;padding:10px 20px;border-radius:var(--r);text-decoration:none;font-size:14px;font-weight:600;">Return to dashboard</a>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
