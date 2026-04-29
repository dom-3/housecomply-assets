/* ============================================================================
 * HouseComply — Stage A Inspect Form (office pre-fill)
 * ----------------------------------------------------------------------------
 * Mounts at: /inspect/stage-a (GHL-hosted shell loads this from jsDelivr)
 * Webhook target: window.HC_CONFIG.WEBHOOK_A_URL (Webhook A, CORS, application/json)
 * Data contract: 02_DATA_STRUCTURE_webhook_A_stageA.md (authoritative)
 * Spec contract: Phase1_Stage_A_Form_Spec_v1.1
 * Architecture: System Architecture v3.0 + Amendments A-01..A-20
 *
 * REQUIREMENTS THAT BLOCK CHANGES TO THIS FILE:
 *  - Field names in payload must match the Data Structure exactly. If you
 *    rename any payload key, update the Data Structure in Make first.
 *  - Submit fetch uses CORS + application/json. Make auto-parses the body
 *    against the Data Structure, exposing {{1._meta.*}} etc. downstream.
 *  - Lowercase "yes" / "no" / "unknown" for all yes/no/unknown fields.
 *  - The 6 property single-select dropdowns must use the exact Airtable enum
 *    values (PROPERTY_TYPE_VALUES etc. below).
 * ============================================================================ */

(function () {
  "use strict";

  /* ------------------------------------------------------------------------ */
  /* 1. CONSTANTS                                                              */
  /* ------------------------------------------------------------------------ */

  var FORM_VERSION = "HouseComply-V3-StageA";
  var STAGE = "A";
  var COUNTRY_DEFAULT = "Wales";

  var INSPECTION_TYPES = [
    "Full compliance inspection",
    "Start of tenancy",
    "Mid-tenancy",
    "End of tenancy",
    "Annual / periodic",
    "Pre-tenancy / pre-letting",
    "Move-in",
    "Move-out",
    "Re-inspection (after works)",
    "Complaint follow-up"
  ];

  /* ---- Property single-select enums (Airtable-verified, A-27) ------------- */

  var PROPERTY_TYPE_VALUES = [
    "Terraced House", "Semi-detached House", "Detached House", "End-terrace",
    "Flat Purpose Built", "Flat Conversion", "Maisonette", "Bungalow",
    "HMO", "Other"
  ];
  var CONSTRUCTION_TYPE_VALUES = ["Brick", "Stone", "Timber frame", "Concrete", "Mixed", "Other"];
  var AGE_BAND_VALUES = ["Pre-1900", "1900–1944", "1945–1979", "1980–1999", "2000 onwards"];
  var LISTED_STATUS_VALUES = ["Not listed", "Grade I Listed", "Grade II* Listed", "Grade II Listed", "Unknown"];
  var TENURE_VALUES = ["Private rented", "Owner occupied", "Social Housing association", "Void Unoccupied", "Unknown"];
  var HMO_STATUS_VALUES = ["Yes", "No", "Pending"];

  /* ---- Tenancy enums ------------------------------------------------------ */

  var CONTRACT_TYPE_VALUES = ["Periodic Standard", "Fixed-Term Standard", "Joint", "Other"];
  var EICR_RESULT_VALUES = ["Satisfactory", "Unsatisfactory", "Limited", "Unknown", "Not applicable"];
  var EPC_RATING_VALUES = ["A", "B", "C", "D", "E", "F", "G"];

  var EPC_EXEMPTION_TYPES = [
    "High cost (improvements within cost cap completed)",
    "All improvements made (no further reasonable improvements possible)",
    "Wall insulation (cannot be installed without damage)",
    "Third-party consent refused",
    "Devaluation (improvements would devalue property by 5%+)",
    "Listed building / conservation area constraint",
    "Recent purchase / new tenancy (6-month exemption)",
    "Other — describe"
  ];

  var DEPOSIT_SCHEMES = ["DPS", "MyDeposits", "TDS", "Other"];

  /* ---- Yes/No/Unknown payload values (lowercase per Data Structure) ------- */

  var YN_UNKNOWN = ["yes", "no", "unknown"];
  var YN_NA_UNKNOWN = ["yes", "no", "not applicable", "unknown"];
  var YN_ONLY = ["yes", "no"];
  var YN_NA = ["yes", "no", "not applicable"];

  /* ---- Airtable table IDs ------------------------------------------------- */

  var AIRTABLE_API = "https://api.airtable.com/v0/";

  /* ---- Mount + URL -------------------------------------------------------- */

  var MOUNT_ID = "hc-stage-a-mount";
  var DASHBOARD_URL = "/housecomply-dashboard";
  var LOGIN_URL = "/login";

  /* ------------------------------------------------------------------------ */
  /* 2. STATE                                                                  */
  /* ------------------------------------------------------------------------ */

  var state = {
    // Identity
    accountId: null,
    userId: null,
    propertyId: null,

    // Pre-fetched records
    property: null,        // PROPERTIES row
    account: null,         // ACCOUNTS row
    user: null,            // USERS row
    tenancies: [],         // active TENANCIES for this property
    landlords: [],         // LANDLORDS for this account

    // Current form values (mirrors the payload structure but flat for ease)
    form: {},

    // UI flags
    isDirty: false,
    isSubmitting: false
  };

  /* ------------------------------------------------------------------------ */
  /* 3. ENTRY POINT                                                            */
  /* ------------------------------------------------------------------------ */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    try {
      assertConfig();

      var params = readUrlParams();
      state.accountId = params.accountId;
      state.propertyId = params.propertyId;
      state.userId = params.userId;

      // Persist user_id in case it came from URL (defence for future loads)
      if (state.userId) {
        try { localStorage.setItem("hc_user_id", state.userId); } catch (e) { /* ignore */ }
      }

      bootstrap();
    } catch (err) {
      console.error("[Stage A] init failure:", err);
      showFatalError("The form could not start. " + err.message);
    }
  }

  function assertConfig() {
    if (!window.HC_CONFIG || !window.HC_CONFIG.WEBHOOK_A_URL) {
      throw new Error("Missing window.HC_CONFIG.WEBHOOK_A_URL");
    }
    if (!window.HC_AIRTABLE_KEY) {
      throw new Error("Missing window.HC_AIRTABLE_KEY");
    }
  }

  function readUrlParams() {
    var qs = new URLSearchParams(window.location.search);
    var accountId = qs.get("account_id");
    var propertyId = qs.get("property_id");
    var userId = qs.get("user_id") || (function () {
      try { return localStorage.getItem("hc_user_id"); } catch (e) { return null; }
    })();

    if (!accountId) {
      redirectTo(LOGIN_URL);
      throw new Error("Missing account_id");
    }
    if (!propertyId) {
      redirectTo(DASHBOARD_URL + "?error=missing_property");
      throw new Error("Missing property_id");
    }
    if (!userId) {
      redirectTo(LOGIN_URL + "?error=session_expired");
      throw new Error("Missing user_id");
    }

    return { accountId: accountId, propertyId: propertyId, userId: userId };
  }

  /* ------------------------------------------------------------------------ */
  /* 4. BOOTSTRAP — defence-in-depth + parallel fetch                          */
  /* ------------------------------------------------------------------------ */

  function bootstrap() {
    // Step 1: defence-in-depth — verify user belongs to account
    fetchUser(state.userId)
      .then(function (user) {
        if (!userBelongsToAccount(user, state.accountId)) {
          console.error("[Stage A] session_account_mismatch", {
            user_id: state.userId, account_id: state.accountId
          });
          redirectTo(LOGIN_URL + "?error=session_account_mismatch");
          return Promise.reject(new Error("Account mismatch"));
        }
        state.user = user;
        return loadAllRecords();
      })
      .then(function () {
        renderForm();
        bindEvents();
        applyConditionals();
      })
      .catch(function (err) {
        if (err && err.message === "Account mismatch") return; // already redirected
        console.error("[Stage A] bootstrap failure:", err);
        showFatalError("Failed to load form data. Please reload the page.");
      });
  }

  function loadAllRecords() {
    return Promise.all([
      fetchProperty(state.propertyId),
      fetchAccount(state.accountId),
      fetchActiveTenancies(state.propertyId).catch(function () { return []; }),
      fetchLandlords(state.accountId).catch(function () { return []; })
    ]).then(function (results) {
      state.property = results[0];
      state.account = results[1];
      state.tenancies = results[2] || [];
      state.landlords = results[3] || [];
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 5. AIRTABLE FETCH HELPERS                                                 */
  /* ------------------------------------------------------------------------ */

  function airtableHeaders() {
    return { "Authorization": "Bearer " + window.HC_AIRTABLE_KEY };
  }

  function airtableUrl(tableNameOrId, params) {
    var url = AIRTABLE_API + window.HC_CONFIG.AIRTABLE_BASE_ID + "/" + encodeURIComponent(tableNameOrId);
    if (params) url += "?" + params;
    return url;
  }

  function airtableGetById(tableNameOrId, recordId) {
    return fetch(AIRTABLE_API + window.HC_CONFIG.AIRTABLE_BASE_ID + "/" +
                 encodeURIComponent(tableNameOrId) + "/" + recordId, {
      headers: airtableHeaders()
    }).then(function (r) {
      if (!r.ok) throw new Error("Airtable GET " + tableNameOrId + " " + recordId + " — " + r.status);
      return r.json();
    });
  }

  function fetchProperty(propertyId) {
    return airtableGetById(window.HC_CONFIG.AIRTABLE_PROPERTIES_TBL || "PROPERTIES", propertyId);
  }
  function fetchAccount(accountId) {
    return airtableGetById("ACCOUNTS", accountId);
  }
  function fetchUser(userId) {
    return airtableGetById("USERS", userId);
  }

  /**
   * Active tenancies for this property.
   * Filter formula uses {Property Record ID} lookup field per the project's
   * Airtable workaround pattern (see user memory: linked-record FIND formulas
   * must reference a lookup/formula field, not the linked field directly).
   * If that lookup field doesn't exist, this returns [] silently and the
   * picker defaults to "Create new tenancy".
   */
  function fetchActiveTenancies(propertyId) {
    var today = new Date().toISOString().slice(0, 10);
    var formula = "AND(" +
      "FIND('" + propertyId + "', ARRAYJOIN({Property Record ID}))," +
      "{Active}=TRUE()," +
      "OR({Contract End Date}='', IS_AFTER({Contract End Date}, '" + today + "'))" +
    ")";
    var qs = "filterByFormula=" + encodeURIComponent(formula) +
             "&sort[0][field]=Created&sort[0][direction]=desc";
    return fetch(airtableUrl("TENANCIES", qs), { headers: airtableHeaders() })
      .then(function (r) {
        if (!r.ok) throw new Error("Airtable GET TENANCIES — " + r.status);
        return r.json();
      })
      .then(function (j) { return j.records || []; });
  }

  /** Landlords for this account. Same lookup-field pattern. */
  function fetchLandlords(accountId) {
    var formula = "FIND('" + accountId + "', ARRAYJOIN({Account Record ID}))";
    var qs = "filterByFormula=" + encodeURIComponent(formula) +
             "&sort[0][field]=Name&sort[0][direction]=asc";
    return fetch(airtableUrl("LANDLORDS", qs), { headers: airtableHeaders() })
      .then(function (r) {
        if (!r.ok) throw new Error("Airtable GET LANDLORDS — " + r.status);
        return r.json();
      })
      .then(function (j) { return j.records || []; });
  }

  function userBelongsToAccount(user, accountId) {
    if (!user || !user.fields) return false;
    // Check common link field names — first one that exists wins
    var f = user.fields;
    var candidates = ["Account", "Linked Account", "Accounts", "Account Record ID"];
    for (var i = 0; i < candidates.length; i++) {
      var key = candidates[i];
      if (Array.isArray(f[key])) {
        if (f[key].indexOf(accountId) !== -1) return true;
        if (f[key].length > 0 && typeof f[key][0] === "string" && f[key][0].indexOf(accountId) !== -1) return true;
      } else if (typeof f[key] === "string" && f[key].indexOf(accountId) !== -1) {
        return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------------ */
  /* 6. RENDER                                                                 */
  /* ------------------------------------------------------------------------ */

  function renderForm() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) {
      throw new Error("Mount point #" + MOUNT_ID + " not found");
    }

    var prop = state.property && state.property.fields ? state.property.fields : {};
    var acct = state.account && state.account.fields ? state.account.fields : {};
    var usr = state.user && state.user.fields ? state.user.fields : {};

    var html =
      '<style>' + inlineStyles() + '</style>' +
      '<form class="hc-form" id="hc-stage-a-form" novalidate>' +
        '<div class="hc-form-header">' +
          '<h1 class="hc-form-title">Stage A — Office pre-fill</h1>' +
          '<div class="hc-form-subtitle">' + escapeHtml(prop.Address || prop["Address Line 1"] || "Property") + '</div>' +
        '</div>' +
        renderSectionA(usr) +
        renderSectionB(prop) +
        renderSectionC() +
        renderSectionD() +
        renderSectionE() +
        renderSectionF() +
        renderSectionG(acct, usr) +
        renderSectionH() +
      '</form>';

    mount.innerHTML = html;
  }

  /* ---- Section A: Inspection context -------------------------------------- */

  function renderSectionA(usr) {
    var today = new Date().toISOString().slice(0, 10);
    return section("A", "Inspection context", [
      readonlyField("Account", state.account && state.account.fields["Company Name"] || state.account && state.account.fields.Name || "—"),
      readonlyField("Inspector", usr.Name || usr["Full Name"] || "—"),
      dateField("inspection_date", "Inspection date", today, true),
      selectField("inspection_type", "Inspection type", INSPECTION_TYPES, "", true, "Pick one")
    ].join(""));
  }

  /* ---- Section B: Property (refinement) ----------------------------------- */

  function renderSectionB(prop) {
    var addr = [prop["Address Line 1"] || prop.Address || "",
                prop.City || "", prop.County || "", prop.Postcode || ""]
                .filter(Boolean).join(", ") || "—";

    var fields = [
      // Read-only address block
      '<div class="hc-readonly-block">' +
        '<div class="hc-readonly-label">Address (not editable here)</div>' +
        '<div class="hc-readonly-value">' + escapeHtml(addr) + '</div>' +
      '</div>',

      selectField("property_type", "Property type", PROPERTY_TYPE_VALUES, prop["Property Type"] || "", true),
      selectField("construction_type", "Construction type", CONSTRUCTION_TYPE_VALUES, prop["Construction Type"] || "", false),
      selectField("age_band", "Age band", AGE_BAND_VALUES, prop["Age Band"] || "", false),
      selectField("listed_status", "Listed status", LISTED_STATUS_VALUES, prop["Listed Status"] || "", false),
      ynUnknownField("conservation_area", "Conservation area", caseInsensitiveLower(prop["Conservation Area"] || "")),
      selectField("tenure", "Tenure", TENURE_VALUES, prop.Tenure || "", true),
      selectField("hmo_status", "HMO status", HMO_STATUS_VALUES, prop["HMO Status"] || "", false),
      '<div id="hc-hmo-banner-wrap"></div>',
      numberField("num_bedrooms", "Number of bedrooms", prop["Num Bedrooms"] || prop["Number of Bedrooms"] || "", false, 0, 20)
    ];

    return section("B", "Property", fields.join(""));
  }

  /* ---- Section C: Tenancy ------------------------------------------------- */

  function renderSectionC() {
    var hasActive = state.tenancies.length > 0;

    var pickerOptions = '';
    if (hasActive) {
      pickerOptions = state.tenancies.map(function (t) {
        var f = t.fields || {};
        var label = (f["Tenant Names"] || "Tenancy") +
                    (f["Contract Start Date"] ? " · started " + f["Contract Start Date"] : "");
        return '<option value="' + t.id + '">' + escapeHtml(label) + '</option>';
      }).join("");
    }

    var pickerHtml =
      '<div class="hc-field">' +
        '<div class="hc-field__label">Tenancy</div>' +
        '<div class="hc-radio-row">' +
          '<label class="hc-radio">' +
            '<input type="radio" name="tenancy_picker" value="existing" ' + (hasActive ? "checked" : "disabled") + '> ' +
            'Use existing tenancy' + (hasActive ? "" : " (none on file)") +
          '</label>' +
          '<label class="hc-radio">' +
            '<input type="radio" name="tenancy_picker" value="new" ' + (hasActive ? "" : "checked") + '> ' +
            'Create new tenancy' +
          '</label>' +
        '</div>' +
        (hasActive ?
          '<select id="tenancy_id" name="tenancy_id" class="hc-input">' +
            pickerOptions +
          '</select>'
          : ''
        ) +
      '</div>';

    var formFields =
      '<div id="hc-tenancy-fields">' +
        selectField("occupation_contract_type", "Contract type", CONTRACT_TYPE_VALUES, "", true) +
        dateField("contract_start_date", "Contract date", "", true,
                  "When the occupation contract was dated/signed") +
        dateField("occupation_start_date", "Occupation start date", "", true,
                  "When the contract holder takes possession (drives the 14-day Written Statement deadline)") +
        dateField("contract_end_date", "Contract end date", "", false,
                  "Leave blank if periodic / ongoing") +
        numberField("num_tenants", "Number of tenants", "", false, 0, 50) +
        textareaField("tenant_names", "Tenant names", "", false,
                      "Comma-separated") +
        ynUnknownField("written_statement_prepared", "Written statement prepared", "") +
        '<div id="hc-wss-wrap" class="hc-conditional" style="display:none;">' +
          dateField("written_statement_served_date", "Written statement served date", "", false) +
        '</div>' +
        selectField("inventory_signed", "Inventory signed", YN_NA_UNKNOWN, "", false, "", labelMap(YN_NA_UNKNOWN)) +
      '</div>';

    return section("C", "Tenancy", pickerHtml + formFields);
  }

  /* ---- Section D: Documentation ------------------------------------------- */

  function renderSectionD() {
    var d1 = subsection("D1. EPC (Energy Performance Certificate)",
      ynUnknownField("epc_available", "EPC available", "", true) +
      '<div id="hc-epc-yes" class="hc-conditional" style="display:none;">' +
        selectField("epc_rating", "EPC rating", EPC_RATING_VALUES, "", false) +
        dateField("epc_date", "EPC date", "", false) +
      '</div>' +
      '<div id="hc-epc-exemption" class="hc-conditional" style="display:none;">' +
        selectField("epc_exemption_type", "Exemption type", EPC_EXEMPTION_TYPES, "", false, "Pick one") +
      '</div>'
    );

    var d2 = subsection("D2. EICR (Electrical Installation Condition Report)",
      '<div class="hc-help">Periodic safety report on the existing installation. Required every 5 years for rented properties under Renting Homes (Wales) Regulations 2022.</div>' +
      ynUnknownField("eicr_available", "EICR available", "", true) +
      '<div id="hc-eicr-yes" class="hc-conditional" style="display:none;">' +
        dateField("eicr_issue_date", "Issue date", "", false) +
        dateField("eicr_expiry_date", "Expiry date (auto-calculated, editable)", "", false) +
        selectField("eicr_result", "Result", EICR_RESULT_VALUES, "", false) +
        selectField("eicr_status", "Status", ["Pass", "Fail", "Advisory", "Missing", "Unknown"], "", false, "Pick one") +
      '</div>'
    );

    var d3 = subsection("D3. EIC (Electrical Installation Certificate)",
      '<div class="hc-help">Issued when new electrical work is completed (installation, full rewire, consumer unit replacement). One-off document — most properties only have an EICR.</div>' +
      selectField("eic_available", "EIC available", YN_NA_UNKNOWN, "", true, "", labelMap(YN_NA_UNKNOWN)) +
      '<div id="hc-eic-yes" class="hc-conditional" style="display:none;">' +
        dateField("eic_issue_date", "Issue date", "", false) +
      '</div>'
    );

    var d4 = subsection("D4. Gas Safety",
      ynUnknownField("gas_at_property", "Gas at property", "", true) +
      '<div id="hc-gas-yes" class="hc-conditional" style="display:none;">' +
        ynUnknownField("gas_available", "Gas Safety certificate available", "") +
        '<div id="hc-gas-cert-yes" class="hc-conditional" style="display:none;">' +
          dateField("gas_issue_date", "Issue date", "", false) +
          dateField("gas_expiry_date", "Expiry date (auto-calculated, editable)", "", false) +
          selectField("gas_status", "Status", ["Pass", "Fail", "Missing", "Not applicable", "Unknown"], "", false, "Pick one") +
        '</div>' +
      '</div>'
    );

    var d5 = subsection("D5. Fire Risk Assessment",
      ynUnknownField("fra_applicable", "FRA applicable", "", true) +
      '<div id="hc-fra-yes" class="hc-conditional" style="display:none;">' +
        dateField("fra_date", "FRA date", "", false) +
      '</div>'
    );

    var d6 = subsection("D6. Asbestos",
      selectField("asbestos_survey_held", "Asbestos survey held", YN_NA_UNKNOWN, "", true, "", labelMap(YN_NA_UNKNOWN)) +
      '<div id="hc-asb-yes" class="hc-conditional" style="display:none;">' +
        dateField("asbestos_date", "Survey date", "", false) +
      '</div>'
    );

    var d7 = subsection("D7. Radon",
      ynUnknownField("radon_checked", "Radon checked", "", true) +
      '<div id="hc-radon-yes" class="hc-conditional" style="display:none;">' +
        dateField("radon_date", "Check date", "", false) +
      '</div>'
    );

    var d8 = subsection("D8. Legionella",
      ynUnknownField("legionella_held", "Legionella risk assessment held", "", true) +
      '<div id="hc-leg-yes" class="hc-conditional" style="display:none;">' +
        dateField("legionella_date", "Assessment date", "", false) +
      '</div>'
    );

    return section("D", "Documentation", d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8);
  }

  /* ---- Section E: Financial / regulatory ---------------------------------- */

  function renderSectionE() {
    return section("E", "Financial / regulatory",
      numberField("deposit_amount", "Deposit amount (£)", "0", true, 0, 100000, 0.01) +
      '<div id="hc-deposit-fields" class="hc-conditional" style="display:none;">' +
        ynUnknownField("deposit_protected_within_30_days", "Deposit protected within 30 days", "") +
        selectField("deposit_scheme", "Deposit scheme", DEPOSIT_SCHEMES, "", false) +
        textField("deposit_reference", "Deposit reference", "", false) +
        dateField("deposit_protected_date", "Deposit protected date (for warning check, not submitted)", "", false,
                  "Used client-side only to flag if &gt; 30 days after occupation start.") +
        ynUnknownField("prescribed_information_issued", "Prescribed Information issued", "") +
      '</div>' +
      selectField("tpo_membership_disclosed", "TPO membership disclosed", YN_NA, "", true, "", labelMap(YN_NA)) +
      ynUnknownField("complaints_procedure_issued", "Complaints procedure issued", "", true)
    );
  }

  /* ---- Section F: Landlord ------------------------------------------------ */

  function renderSectionF() {
    var hasLandlords = state.landlords.length > 0;
    var landlordOptions = state.landlords.map(function (l) {
      var f = l.fields || {};
      return '<option value="' + l.id + '">' + escapeHtml(f.Name || "Landlord") + '</option>';
    }).join("");

    var picker =
      '<div class="hc-field">' +
        '<div class="hc-field__label">Landlord</div>' +
        '<div class="hc-radio-row">' +
          '<label class="hc-radio">' +
            '<input type="radio" name="landlord_picker" value="existing" ' +
              (hasLandlords ? "checked" : "disabled") + '> ' +
            'Use existing landlord' + (hasLandlords ? "" : " (none on file)") +
          '</label>' +
          '<label class="hc-radio">' +
            '<input type="radio" name="landlord_picker" value="new" ' +
              (hasLandlords ? "" : "checked") + '> ' +
            'Create new landlord' +
          '</label>' +
        '</div>' +
        (hasLandlords ?
          '<select id="landlord_id" name="landlord_id" class="hc-input">' +
            landlordOptions +
          '</select>' : ''
        ) +
      '</div>';

    var fields =
      '<div id="hc-landlord-fields">' +
        textField("landlord_name", "Landlord name", "", true) +
        textField("landlord_rsw", "RSW registration number", "", true) +
        textField("landlord_email", "Email", "", false, "email") +
        textField("landlord_phone", "Phone", "", false, "tel") +
      '</div>';

    return section("F", "Landlord", picker + fields);
  }

  /* ---- Section G: Agent --------------------------------------------------- */

  function renderSectionG(acct, usr) {
    return section("G", "Agent / Inspector",
      '<div class="hc-help">Account-level fields (Company, RSW Licence) update ACCOUNTS on submit. User-level fields (Inspector name, Memberships) update USERS on submit.</div>' +
      textField("agent_company", "Agent company", acct["Company Name"] || acct.Name || "", true) +
      textField("agent_rsw_licence_number", "RSW licence number", acct["RSW Licence Number"] || acct["RSW Licence"] || "", true) +
      textField("agent_name", "Inspector name", usr.Name || usr["Full Name"] || "", true) +
      textField("agent_professional_body_memberships", "Professional body memberships", usr["Professional Body Memberships"] || "", true,
                "text", "Comma-separated, e.g. MARLA, NRLA")
    );
  }

  /* ---- Section H: Review + submit ----------------------------------------- */

  function renderSectionH() {
    return section("H", "Review and submit",
      '<div id="hc-review-summary" class="hc-review-summary"></div>' +
      '<div class="hc-actions">' +
        '<button type="button" class="hc-button hc-button--secondary" id="hc-cancel-btn">Cancel</button>' +
        '<button type="button" class="hc-button hc-button--primary" id="hc-submit-btn">Submit Stage A</button>' +
      '</div>'
    );
  }

  /* ---- Render helpers ----------------------------------------------------- */

  function section(letter, title, innerHtml) {
    return '<section class="hc-section" id="hc-section-' + letter + '">' +
      '<h2 class="hc-section__title"><span class="hc-section__letter">' + letter + '</span>' + escapeHtml(title) + '</h2>' +
      '<div class="hc-section__body">' + innerHtml + '</div>' +
    '</section>';
  }

  function subsection(title, innerHtml) {
    return '<div class="hc-subsection">' +
      '<h3 class="hc-subsection__title">' + escapeHtml(title) + '</h3>' +
      '<div class="hc-subsection__body">' + innerHtml + '</div>' +
    '</div>';
  }

  function readonlyField(label, value) {
    return '<div class="hc-readonly-field">' +
      '<span class="hc-readonly-field__label">' + escapeHtml(label) + ':</span> ' +
      '<span class="hc-readonly-field__value">' + escapeHtml(String(value)) + '</span>' +
    '</div>';
  }

  function textField(name, label, value, required, type, help) {
    type = type || "text";
    return fieldWrap(name, label, required, help,
      '<input type="' + type + '" name="' + name + '" id="' + name +
      '" class="hc-input" value="' + escapeHtml(String(value || "")) +
      '" ' + (required ? "required" : "") + '>'
    );
  }

  function dateField(name, label, value, required, help) {
    return fieldWrap(name, label, required, help,
      '<input type="date" name="' + name + '" id="' + name +
      '" class="hc-input" value="' + escapeHtml(String(value || "")) +
      '" ' + (required ? "required" : "") + '>'
    );
  }

  function numberField(name, label, value, required, min, max, step) {
    var attrs = "";
    if (min != null) attrs += ' min="' + min + '"';
    if (max != null) attrs += ' max="' + max + '"';
    if (step != null) attrs += ' step="' + step + '"';
    return fieldWrap(name, label, required, null,
      '<input type="number" name="' + name + '" id="' + name +
      '" class="hc-input" value="' + escapeHtml(String(value || "")) +
      '"' + attrs + ' ' + (required ? "required" : "") + '>'
    );
  }

  function textareaField(name, label, value, required, help) {
    return fieldWrap(name, label, required, help,
      '<textarea name="' + name + '" id="' + name +
      '" class="hc-input hc-textarea" rows="2" ' + (required ? "required" : "") + '>' +
      escapeHtml(String(value || "")) + '</textarea>'
    );
  }

  /**
   * @param {string[]} options - submitted values
   * @param {object} [labels] - optional map of value -> display label
   */
  function selectField(name, label, options, value, required, placeholder, labels) {
    placeholder = placeholder || "";
    var opts = '<option value="">' + escapeHtml(placeholder) + '</option>' +
      options.map(function (o) {
        var displayLabel = labels && labels[o] ? labels[o] : o;
        var sel = String(value).toLowerCase() === String(o).toLowerCase() ? " selected" : "";
        return '<option value="' + escapeHtml(o) + '"' + sel + '>' + escapeHtml(displayLabel) + '</option>';
      }).join("");
    return fieldWrap(name, label, required, null,
      '<select name="' + name + '" id="' + name +
      '" class="hc-input"' + (required ? " required" : "") + '>' + opts + '</select>'
    );
  }

  /** Yes/No/Unknown field — submits lowercase, displays capitalised. */
  function ynUnknownField(name, label, value, required) {
    return selectField(name, label, YN_UNKNOWN, value, !!required, "", labelMap(YN_UNKNOWN));
  }

  function fieldWrap(name, label, required, help, inputHtml) {
    var req = required ? '<span class="hc-required">*</span>' : '';
    var helpHtml = help ? '<div class="hc-field__help">' + help + '</div>' : '';
    return '<div class="hc-field" data-field-name="' + name + '">' +
      '<label class="hc-field__label" for="' + name + '">' + escapeHtml(label) + ' ' + req + '</label>' +
      inputHtml +
      helpHtml +
      '<div class="hc-field__error" id="error-' + name + '"></div>' +
    '</div>';
  }

  function labelMap(values) {
    var m = {};
    values.forEach(function (v) {
      m[v] = v.charAt(0).toUpperCase() + v.slice(1);  // "yes" -> "Yes"
    });
    return m;
  }

  /* ------------------------------------------------------------------------ */
  /* 7. EVENT BINDING + CONDITIONAL LOGIC                                      */
  /* ------------------------------------------------------------------------ */

  function bindEvents() {
    var form = document.getElementById("hc-stage-a-form");
    if (!form) return;

    // Track dirty + cascade conditionals on every change/input
    form.addEventListener("input", onFormChange);
    form.addEventListener("change", onFormChange);

    // Tenancy / landlord pickers — toggle field visibility
    form.querySelectorAll('input[name="tenancy_picker"]').forEach(function (r) {
      r.addEventListener("change", onTenancyPickerChange);
    });
    form.querySelectorAll('input[name="landlord_picker"]').forEach(function (r) {
      r.addEventListener("change", onLandlordPickerChange);
    });

    // Tenancy picker dropdown — pre-fill on selection
    var tenancySel = form.querySelector("#tenancy_id");
    if (tenancySel) tenancySel.addEventListener("change", onTenancySelected);

    // Landlord picker dropdown — pre-fill on selection
    var landlordSel = form.querySelector("#landlord_id");
    if (landlordSel) landlordSel.addEventListener("change", onLandlordSelected);

    // EICR / Gas date auto-calc
    var eicrIssue = form.querySelector("#eicr_issue_date");
    if (eicrIssue) eicrIssue.addEventListener("change", function () { autoExpiry("eicr_issue_date", "eicr_expiry_date", 5, "years"); });
    var gasIssue = form.querySelector("#gas_issue_date");
    if (gasIssue) gasIssue.addEventListener("change", function () { autoExpiry("gas_issue_date", "gas_expiry_date", 12, "months"); });

    // Submit + cancel
    document.getElementById("hc-submit-btn").addEventListener("click", onSubmitClick);
    document.getElementById("hc-cancel-btn").addEventListener("click", onCancelClick);

    // beforeunload — warn on dirty close
    window.addEventListener("beforeunload", function (e) {
      if (state.isDirty && !state.isSubmitting) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    });

    // Initial picker state
    onTenancyPickerChange();
    onLandlordPickerChange();
    if (tenancySel && tenancySel.value) onTenancySelected();
    if (landlordSel && landlordSel.value) onLandlordSelected();
  }

  function onFormChange() {
    state.isDirty = true;
    applyConditionals();
    refreshReviewSummary();
  }

  /** Show/hide every conditional block based on current field values. */
  function applyConditionals() {
    // HMO banner
    var hmo = val("hmo_status");
    var bannerWrap = document.getElementById("hc-hmo-banner-wrap");
    if (bannerWrap) {
      if (hmo === "Yes") {
        bannerWrap.innerHTML = '<div class="hc-banner hc-banner--warning">' +
          'HMO inspections require additional scope not covered by this form. ' +
          'This Stage A captures standard PRS context. Manual review recommended.' +
        '</div>';
      } else if (hmo === "Pending") {
        bannerWrap.innerHTML = '<div class="hc-banner hc-banner--info">' +
          'HMO status pending — additional checks may be required once status is determined.' +
        '</div>';
      } else {
        bannerWrap.innerHTML = "";
      }
    }

    // Tenancy WSS conditional
    show("hc-wss-wrap", val("written_statement_prepared") === "yes");

    // EPC
    var epcAvail = val("epc_available");
    var epcRating = val("epc_rating");
    show("hc-epc-yes", epcAvail === "yes");
    var showExemption = (epcAvail === "no") || (epcAvail === "yes" && (epcRating === "F" || epcRating === "G"));
    show("hc-epc-exemption", showExemption);

    // EICR
    show("hc-eicr-yes", val("eicr_available") === "yes");

    // EIC
    show("hc-eic-yes", val("eic_available") === "yes");

    // Gas
    var gasAtProp = val("gas_at_property");
    show("hc-gas-yes", gasAtProp === "yes");
    show("hc-gas-cert-yes", gasAtProp === "yes" && val("gas_available") === "yes");

    // FRA
    show("hc-fra-yes", val("fra_applicable") === "yes");

    // Asbestos
    show("hc-asb-yes", val("asbestos_survey_held") === "yes");

    // Radon
    show("hc-radon-yes", val("radon_checked") === "yes");

    // Legionella
    show("hc-leg-yes", val("legionella_held") === "yes");

    // Deposit
    var amt = parseFloat(val("deposit_amount"));
    show("hc-deposit-fields", !isNaN(amt) && amt > 0);
  }

  function onTenancyPickerChange() {
    var pick = document.querySelector('input[name="tenancy_picker"]:checked');
    var existing = pick && pick.value === "existing";
    var sel = document.getElementById("tenancy_id");
    if (sel) sel.style.display = existing ? "" : "none";
    // Tenancy fields are always editable; pre-fill from selected if existing.
    if (existing && sel) onTenancySelected();
  }

  function onTenancySelected() {
    var sel = document.getElementById("tenancy_id");
    if (!sel) return;
    var rec = state.tenancies.find(function (t) { return t.id === sel.value; });
    if (!rec) return;
    var f = rec.fields || {};
    setValue("occupation_contract_type", f["Contract Type"] || f["Occupation Contract Type"] || "");
    setValue("contract_start_date", f["Contract Start Date"] || "");
    setValue("occupation_start_date", f["Occupation Start Date"] || f["Tenancy Start Date"] || "");
    setValue("contract_end_date", f["Contract End Date"] || "");
    setValue("num_tenants", f["Number of Tenants"] || f["Num Tenants"] || "");
    setValue("tenant_names", f["Tenant Names"] || "");
    setValue("written_statement_prepared", caseInsensitiveLower(f["Written Statement Prepared"] || ""));
    setValue("written_statement_served_date", f["Written Statement Served Date"] || "");
    setValue("inventory_signed", caseInsensitiveLower(f["Inventory Signed"] || ""));
    applyConditionals();
  }

  function onLandlordPickerChange() {
    var pick = document.querySelector('input[name="landlord_picker"]:checked');
    var existing = pick && pick.value === "existing";
    var sel = document.getElementById("landlord_id");
    if (sel) sel.style.display = existing ? "" : "none";
    if (existing && sel) onLandlordSelected();
  }

  function onLandlordSelected() {
    var sel = document.getElementById("landlord_id");
    if (!sel) return;
    var rec = state.landlords.find(function (l) { return l.id === sel.value; });
    if (!rec) return;
    var f = rec.fields || {};
    setValue("landlord_name", f.Name || "");
    setValue("landlord_rsw", f["RSW Registration Number"] || f["RSW Number"] || "");
    setValue("landlord_email", f.Email || "");
    setValue("landlord_phone", f.Phone || "");
  }

  function autoExpiry(srcId, dstId, n, unit) {
    var src = document.getElementById(srcId);
    var dst = document.getElementById(dstId);
    if (!src || !dst || !src.value) return;
    if (dst.value) return; // don't overwrite a manual edit
    var d = new Date(src.value);
    if (unit === "years") d.setFullYear(d.getFullYear() + n);
    else if (unit === "months") d.setMonth(d.getMonth() + n);
    dst.value = d.toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------------------ */
  /* 8. VALIDATION                                                             */
  /* ------------------------------------------------------------------------ */

  function validate() {
    var errors = [];   // blocking
    var warnings = []; // non-blocking
    var unknownCount = 0;

    // Section A
    requireField(errors, "inspection_type", "Inspection type");
    requireField(errors, "inspection_date", "Inspection date");

    // Section B
    requireField(errors, "property_type", "Property type");
    requireField(errors, "tenure", "Tenure");
    var conserv = val("conservation_area");
    if (!conserv) errors.push({ name: "conservation_area", msg: "Conservation area required" });
    if (val("hmo_status") === "") errors.push({ name: "hmo_status", msg: "HMO status required" });

    // Section C — only if creating new tenancy or editing existing
    var pickerEl = document.querySelector('input[name="tenancy_picker"]:checked');
    var creatingTenancy = !pickerEl || pickerEl.value === "new";
    if (creatingTenancy) {
      requireField(errors, "occupation_contract_type", "Contract type");
      requireField(errors, "contract_start_date", "Contract date");
      requireField(errors, "occupation_start_date", "Occupation start date");
      requireField(errors, "num_tenants", "Number of tenants");
      requireField(errors, "tenant_names", "Tenant names");
    }
    if (!val("written_statement_prepared")) {
      errors.push({ name: "written_statement_prepared", msg: "Written statement prepared required" });
    }
    if (val("written_statement_prepared") === "yes" && !val("written_statement_served_date")) {
      errors.push({ name: "written_statement_served_date", msg: "Served date required when prepared = Yes" });
    }
    var cs = val("contract_start_date"), ce = val("contract_end_date");
    if (cs && ce && new Date(ce) < new Date(cs)) {
      errors.push({ name: "contract_end_date", msg: "Contract end date is before contract start" });
    }
    var os = val("occupation_start_date"), wssd = val("written_statement_served_date");
    if (os && wssd) {
      var deadline = new Date(os); deadline.setDate(deadline.getDate() + 14);
      if (new Date(wssd) > deadline) {
        warnings.push("Written Statement may not have been served within the 14-day window required under RHWA 2016 s.31. Captured for the audit trail.");
      }
    }

    // Section D — every availability question must be answered
    var availFields = [
      ["epc_available", "EPC available"],
      ["eicr_available", "EICR available"],
      ["eic_available", "EIC available"],
      ["gas_at_property", "Gas at property"],
      ["fra_applicable", "FRA applicable"],
      ["asbestos_survey_held", "Asbestos survey held"],
      ["radon_checked", "Radon checked"],
      ["legionella_held", "Legionella risk assessment held"]
    ];
    availFields.forEach(function (f) {
      var v = val(f[0]);
      if (!v) errors.push({ name: f[0], msg: f[1] + " required" });
      if (v === "unknown") unknownCount++;
    });

    // EPC F/G no exemption — non-blocking warning
    if (val("epc_available") === "yes" &&
        (val("epc_rating") === "F" || val("epc_rating") === "G") &&
        !val("epc_exemption_type")) {
      warnings.push("EPC rating below E with no exemption recorded. Property may not be lettable under MEES regulations. Manual review recommended.");
    }

    // EICR / Gas expiry in past
    var today = new Date();
    if (val("eicr_expiry_date") && new Date(val("eicr_expiry_date")) < today) {
      warnings.push("EICR expiry date is in the past.");
    }
    if (val("gas_at_property") === "yes" && val("gas_expiry_date") && new Date(val("gas_expiry_date")) < today) {
      warnings.push("Gas Safety expiry date is in the past.");
    }

    // Section E
    var amount = parseFloat(val("deposit_amount"));
    if (isNaN(amount)) errors.push({ name: "deposit_amount", msg: "Deposit amount required (use 0 if none)" });
    if (amount > 0) {
      if (!val("deposit_protected_within_30_days")) {
        errors.push({ name: "deposit_protected_within_30_days", msg: "Deposit protection answer required" });
      }
      if (!val("prescribed_information_issued")) {
        errors.push({ name: "prescribed_information_issued", msg: "Prescribed Information answer required" });
      }
      // 30-day deposit warning (computed client-side, not in payload per Data Structure)
      var dpd = val("deposit_protected_date"), occ = val("occupation_start_date");
      if (dpd && occ) {
        var threshold = new Date(occ); threshold.setDate(threshold.getDate() + 30);
        if (new Date(dpd) > threshold) {
          warnings.push("Deposit may not have been protected within the 30-day statutory window. Captured for the audit trail.");
        }
      }
    }
    if (!val("tpo_membership_disclosed")) {
      errors.push({ name: "tpo_membership_disclosed", msg: "TPO membership disclosure required" });
    }
    if (!val("complaints_procedure_issued")) {
      errors.push({ name: "complaints_procedure_issued", msg: "Complaints procedure answer required" });
    }

    // Section F
    requireField(errors, "landlord_name", "Landlord name");
    requireField(errors, "landlord_rsw", "Landlord RSW registration number");
    if (!val("landlord_email")) {
      warnings.push("Landlord email is blank.");
    }

    // Section G
    requireField(errors, "agent_company", "Agent company");
    requireField(errors, "agent_rsw_licence_number", "Agent RSW licence number");
    requireField(errors, "agent_name", "Inspector name");
    requireField(errors, "agent_professional_body_memberships", "Professional body memberships");

    // Threshold advisory
    if (unknownCount >= 8) {
      warnings.push(unknownCount + " documentation fields marked Unknown. Consider whether more info can be obtained before going on site.");
    }

    return { errors: errors, warnings: warnings, unknownCount: unknownCount };
  }

  function requireField(errors, name, label) {
    if (!val(name)) errors.push({ name: name, msg: label + " required" });
  }

  function refreshReviewSummary() {
    var box = document.getElementById("hc-review-summary");
    if (!box) return;
    var v = validate();
    var html = "";

    if (v.errors.length) {
      html += '<div class="hc-banner hc-banner--error">' +
        '<strong>' + v.errors.length + ' error' + (v.errors.length > 1 ? "s" : "") +
        ' must be fixed before submitting:</strong>' +
        '<ul>' + v.errors.map(function (e) {
          return '<li><a href="#' + e.name + '" class="hc-error-link" data-target="' + e.name + '">' +
            escapeHtml(e.msg) + '</a></li>';
        }).join("") + '</ul>' +
      '</div>';
    }

    if (v.warnings.length) {
      html += '<div class="hc-banner hc-banner--warning">' +
        '<strong>' + v.warnings.length + ' warning' + (v.warnings.length > 1 ? "s" : "") +
        ' (non-blocking):</strong>' +
        '<ul>' + v.warnings.map(function (w) {
          return '<li>' + escapeHtml(w) + '</li>';
        }).join("") + '</ul>' +
      '</div>';
    }

    if (v.unknownCount > 0 && v.unknownCount < 8) {
      html += '<div class="hc-banner hc-banner--info">' +
        v.unknownCount + ' documentation field' + (v.unknownCount > 1 ? "s" : "") + ' marked Unknown — proceed?' +
      '</div>';
    }

    if (!html) {
      html = '<div class="hc-banner hc-banner--ok">All fields complete and valid. Ready to submit.</div>';
    }

    box.innerHTML = html;

    // Wire error link clicks (anchor scrolling)
    box.querySelectorAll(".hc-error-link").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var target = document.getElementById(a.getAttribute("data-target"));
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.focus();
        }
      });
    });

    // Submit button enable/disable
    var submitBtn = document.getElementById("hc-submit-btn");
    if (submitBtn) submitBtn.disabled = (v.errors.length > 0) || state.isSubmitting;
  }

  /* ------------------------------------------------------------------------ */
  /* 9. SUBMIT                                                                 */
  /* ------------------------------------------------------------------------ */

  function onSubmitClick() {
    if (state.isSubmitting) return;
    var v = validate();
    if (v.errors.length) {
      refreshReviewSummary();
      var first = document.getElementById(v.errors[0].name);
      if (first) {
        first.scrollIntoView({ behavior: "smooth", block: "center" });
        first.focus();
      }
      return;
    }

    state.isSubmitting = true;
    var btn = document.getElementById("hc-submit-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Submitting…";
    }

    var payload = buildPayload();

    // CORS + application/json — Make auto-parses body against Data Structure.
    // Response is readable; we still redirect regardless (fire-and-redirect pattern).
    fetch(window.HC_CONFIG.WEBHOOK_A_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function () {
      // Success path — proceed regardless of opaque status.
      try { localStorage.setItem("hc_user_id", state.userId); } catch (e) { /* ignore */ }
      state.isDirty = false; // suppress beforeunload warning
      var addr = (state.property && state.property.fields &&
                  (state.property.fields["Address Line 1"] || state.property.fields.Address)) || "Property";
      var url = DASHBOARD_URL +
        "?stage_a_complete=1" +
        "&property_address=" + encodeURIComponent(addr);
      window.location.href = url;
    }).catch(function (err) {
      console.error("[Stage A] submit network failure:", err);
      state.isSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = "Submit Stage A"; }
      alert("Network error sending the form. Check your connection and try again.");
    });
  }

  function onCancelClick() {
    var msg = "Cancel and return to dashboard? Any unsaved changes will be lost.";
    if (state.isDirty && !confirm(msg)) return;
    state.isDirty = false;
    redirectTo(DASHBOARD_URL);
  }

  /* ---- Payload builder ---------------------------------------------------- */

  function buildPayload() {
    var pickerEl = document.querySelector('input[name="tenancy_picker"]:checked');
    var isNewTenancy = !pickerEl || pickerEl.value === "new";
    var tenancyId = isNewTenancy ? "" :
      ((document.getElementById("tenancy_id") || {}).value || "");

    var landlordPick = document.querySelector('input[name="landlord_picker"]:checked');
    var isNewLandlord = !landlordPick || landlordPick.value === "new";
    var landlordId = isNewLandlord ? "" :
      ((document.getElementById("landlord_id") || {}).value || "");

    var prop = (state.property && state.property.fields) || {};

    var gasAtProp = val("gas_at_property");
    var gasObj;
    if (gasAtProp === "no") {
      gasObj = {
        at_property: "no",
        available: "no",
        issue_date: null,
        expiry_date: null,
        status: "Not applicable"
      };
    } else {
      gasObj = {
        at_property: gasAtProp || "",
        available: val("gas_available") || "",
        issue_date: dateOrNull("gas_issue_date"),
        expiry_date: dateOrNull("gas_expiry_date"),
        status: val("gas_status") || ""
      };
    }

    return {
      _meta: {
        submitted_at: new Date().toISOString(),
        form_version: FORM_VERSION,
        stage: STAGE,
        account_id: state.accountId,
        user_id: state.userId,
        tenancy_id: tenancyId
      },
      property: {
        property_id: state.propertyId,
        address: prop["Address Line 1"] || prop.Address || "",
        city: prop.City || "",
        county: prop.County || "",
        postcode: prop.Postcode || "",
        country: prop.Country || COUNTRY_DEFAULT,
        property_type: val("property_type"),
        construction_type: val("construction_type"),
        age_band: val("age_band"),
        listed_status: val("listed_status"),
        conservation_area: val("conservation_area"),
        tenure: val("tenure"),
        hmo_status: val("hmo_status"),
        num_bedrooms: numOrZero("num_bedrooms")
      },
      tenancy: {
        is_new: isNewTenancy,
        occupation_contract_type: val("occupation_contract_type"),
        contract_start_date: dateOrNull("contract_start_date"),
        occupation_start_date: dateOrNull("occupation_start_date"),
        contract_end_date: dateOrNull("contract_end_date"),
        written_statement_prepared: val("written_statement_prepared"),
        written_statement_served_date: dateOrNull("written_statement_served_date"),
        inventory_signed: val("inventory_signed"),
        num_tenants: numOrZero("num_tenants"),
        tenant_names: val("tenant_names")
      },
      documentation: {
        epc: {
          available: val("epc_available"),
          rating: val("epc_rating"),
          date: dateOrNull("epc_date"),
          certificate_url: "",  // Always empty in v3.0 per A-07
          exemption_type: val("epc_exemption_type") || ""
        },
        eicr: {
          available: val("eicr_available"),
          issue_date: dateOrNull("eicr_issue_date"),
          expiry_date: dateOrNull("eicr_expiry_date"),
          result: val("eicr_result") || "",
          status: val("eicr_status") || ""
        },
        eic: {
          available: val("eic_available"),
          issue_date: dateOrNull("eic_issue_date")
        },
        gas: gasObj,
        fra: {
          applicable: val("fra_applicable"),
          date: dateOrNull("fra_date")
        },
        asbestos: {
          survey_held: val("asbestos_survey_held"),
          date: dateOrNull("asbestos_date")
        },
        radon: {
          checked: val("radon_checked"),
          date: dateOrNull("radon_date")
        },
        legionella: {
          risk_assessment_held: val("legionella_held"),
          date: dateOrNull("legionella_date")
        }
      },
      financial: {
        deposit_amount: numOrZero("deposit_amount"),
        deposit_protected_within_30_days: val("deposit_protected_within_30_days") || "",
        deposit_scheme: val("deposit_scheme") || "",
        deposit_reference: val("deposit_reference") || "",
        prescribed_information_issued: val("prescribed_information_issued") || "",
        tpo_membership_disclosed: val("tpo_membership_disclosed") || "",
        complaints_procedure_issued: val("complaints_procedure_issued") || ""
      },
      landlord: {
        landlord_id: landlordId,
        name: val("landlord_name"),
        rsw_registration_number: val("landlord_rsw"),
        email: val("landlord_email") || "",
        phone: val("landlord_phone") || ""
      },
      agent: {
        name: val("agent_name"),
        company: val("agent_company"),
        rsw_licence_number: val("agent_rsw_licence_number"),
        professional_body_memberships: val("agent_professional_body_memberships")
      },
      inspection_type: val("inspection_type")
    };
  }

  /* ------------------------------------------------------------------------ */
  /* 10. UTILITIES                                                             */
  /* ------------------------------------------------------------------------ */

  function val(name) {
    var el = document.getElementById(name);
    if (!el) return "";
    if (el.type === "checkbox") return el.checked;
    return (el.value || "").toString().trim();
  }

  function setValue(name, v) {
    var el = document.getElementById(name);
    if (!el) return;
    el.value = v == null ? "" : v;
  }

  function numOrZero(name) {
    var n = parseFloat(val(name));
    return isNaN(n) ? 0 : n;
  }

  /**
   * Returns a date string if populated, or null if empty.
   * Make Data Structure date-typed fields reject "" (empty string) — they
   * need either a valid ISO date or null/absent. This prevents the silent-
   * drop bug where the webhook returns 200 but queues nothing.
   */
  function dateOrNull(name) {
    var v = val(name);
    return v ? v : null;
  }

  function show(id, condition) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.display = condition ? "" : "none";
  }

  function caseInsensitiveLower(s) {
    if (!s) return "";
    var t = String(s).toLowerCase().trim();
    if (t === "yes" || t === "no" || t === "unknown") return t;
    if (t === "not applicable" || t === "n/a" || t === "na") return "not applicable";
    return s;  // leave non-yn values alone
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function redirectTo(url) {
    window.location.href = url;
  }

  function showFatalError(msg) {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) {
      alert(msg);
      return;
    }
    mount.innerHTML =
      '<div style="max-width:640px;margin:60px auto;padding:24px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;font-family:system-ui,sans-serif;">' +
        '<h2 style="margin:0 0 8px;font-size:16px;">The form could not load</h2>' +
        '<p style="margin:0 0 8px;font-size:14px;">' + escapeHtml(msg) + '</p>' +
        '<p style="margin:0;font-size:13px;color:#7f1d1d;">Reload the page or contact support if the issue persists.</p>' +
      '</div>';
  }

  /* ------------------------------------------------------------------------ */
  /* 11. INLINE STYLES (Stage A specifics — supplements inspect-styles.css)    */
  /* ------------------------------------------------------------------------ */

  function inlineStyles() {
    return [
      ".hc-form{max-width:880px;margin:24px auto;padding:0 16px;font-family:system-ui,-apple-system,sans-serif;color:#0f172a;}",
      ".hc-form-header{margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;}",
      ".hc-form-title{margin:0 0 4px;font-size:24px;font-weight:600;color:#0f172a;}",
      ".hc-form-subtitle{font-size:14px;color:#64748b;}",
      ".hc-section{background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:16px;overflow:hidden;}",
      ".hc-section__title{margin:0;padding:14px 18px;font-size:16px;font-weight:600;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:10px;}",
      ".hc-section__letter{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:#0f766e;color:#fff;font-size:12px;font-weight:700;}",
      ".hc-section__body{padding:18px;}",
      ".hc-subsection{margin-bottom:18px;padding-bottom:12px;border-bottom:1px dashed #e2e8f0;}",
      ".hc-subsection:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0;}",
      ".hc-subsection__title{margin:0 0 8px;font-size:14px;font-weight:600;color:#334155;}",
      ".hc-field{margin-bottom:14px;}",
      ".hc-field__label{display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:#334155;}",
      ".hc-field__help{margin-top:4px;font-size:12px;color:#64748b;}",
      ".hc-field__error{margin-top:4px;font-size:12px;color:#b91c1c;min-height:0;}",
      ".hc-help{font-size:12px;color:#64748b;margin-bottom:8px;font-style:italic;}",
      ".hc-required{color:#b91c1c;font-weight:700;}",
      ".hc-input{width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;background:#fff;color:#0f172a;}",
      ".hc-input:focus{outline:2px solid #0f766e;outline-offset:0;border-color:transparent;}",
      ".hc-textarea{font-family:inherit;resize:vertical;}",
      ".hc-readonly-block{padding:10px 12px;background:#f1f5f9;border-radius:6px;margin-bottom:14px;}",
      ".hc-readonly-label{font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;margin-bottom:2px;}",
      ".hc-readonly-value{font-size:14px;color:#0f172a;}",
      ".hc-readonly-field{font-size:14px;margin-bottom:6px;}",
      ".hc-readonly-field__label{color:#64748b;}",
      ".hc-readonly-field__value{color:#0f172a;font-weight:500;}",
      ".hc-radio-row{display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap;}",
      ".hc-radio{display:inline-flex;align-items:center;gap:6px;font-size:14px;cursor:pointer;}",
      ".hc-banner{padding:12px 14px;border-radius:6px;font-size:13px;line-height:1.5;margin:8px 0;border-left-width:4px;border-left-style:solid;}",
      ".hc-banner ul{margin:6px 0 0 18px;padding:0;}",
      ".hc-banner--warning{background:#fffbeb;color:#78350f;border-left-color:#f59e0b;}",
      ".hc-banner--error{background:#fef2f2;color:#991b1b;border-left-color:#dc2626;}",
      ".hc-banner--info{background:#eff6ff;color:#1e3a8a;border-left-color:#3b82f6;}",
      ".hc-banner--ok{background:#f0fdf4;color:#166534;border-left-color:#22c55e;}",
      ".hc-conditional{padding-left:12px;border-left:2px solid #e2e8f0;margin-left:4px;}",
      ".hc-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px;}",
      ".hc-button{padding:10px 18px;border-radius:6px;border:1px solid transparent;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}",
      ".hc-button:disabled{opacity:0.6;cursor:not-allowed;}",
      ".hc-button--primary{background:#0f766e;color:#fff;}",
      ".hc-button--primary:hover:not(:disabled){background:#115e59;}",
      ".hc-button--secondary{background:#fff;color:#334155;border-color:#cbd5e1;}",
      ".hc-button--secondary:hover{background:#f8fafc;}",
      ".hc-error-link{color:#991b1b;text-decoration:underline;}",
      ".hc-review-summary{margin-bottom:14px;}",
      "@media(max-width:640px){.hc-form{padding:0 12px;}.hc-section__body{padding:14px;}.hc-radio-row{flex-direction:column;gap:6px;}.hc-actions{flex-direction:column-reverse;}.hc-button{width:100%;}}"
    ].join("");
  }

})();
