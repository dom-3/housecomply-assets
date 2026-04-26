// =============================================================
// HouseComply — Clarify Page Logic
// Hosted on GitHub. Loaded by clarify-shell.html in GHL.
// Edit this file in GitHub browser editor (has full search).
// Version: V6 — Unified webhook routing. MAKE_WEBHOOK_URL now points to
//                the MAIN inspection scenario (same as INSPECTION_WEBHOOK_URL),
//                so clarify resubmissions hit Route 2 (Clarify Resubmission)
//                instead of the old dead-end webhook. Route 2 modules:
//                  80 = Airtable Get original inspection
//                  81 = Claude re-validation
//                  82 = JSON Parse Claude response
//                  83 = Airtable Update with new validation status
//                  84 = Router (PASSED → 90-93 PDF+email, NOT PASSED → 85 new token)
//                V5 changes preserved: handleForceReport, Inspector Email
//                V4 changes preserved: {field}&"" string coercion, no sort param
// =============================================================

(function() {
  "use strict";

  // API key injected securely from GHL shell via window.HC_AIRTABLE_KEY
  const CFG = {
    AIRTABLE_API_KEY:         window.HC_AIRTABLE_KEY || "",
    AIRTABLE_BASE_ID:         "appRbC8gJAw2w5jeS",
    AIRTABLE_INSPECTIONS_TBL: "tblUnK5eZLumF9VXs",
    AIRTABLE_PROPERTIES_TBL:  "tblV6jXR4YKX3ZkXg",
    CLOUDINARY_CLOUD_NAME:    "dqf21bf9r",
    CLOUDINARY_UPLOAD_PRESET: "inspection_photos",
    // V6: unified — clarify resubmission goes to main inspection webhook
    // (Route 2 in main scenario picks it up via {{16.inspection_id}} exists filter)
    MAKE_WEBHOOK_URL:         "https://hook.eu1.make.com/8j58i0pjxbyhr9dxqoz3fszi4rt5tq6k",
    // Force-report goes to same webhook (Route 1, force_report=true filter)
    INSPECTION_WEBHOOK_URL:   "https://hook.eu1.make.com/8j58i0pjxbyhr9dxqoz3fszi4rt5tq6k",
    WAITING_PAGE_URL:         "https://www.housecomply.co.uk/inspection/waiting",
    ESCALATED_PAGE_URL:       "https://www.housecomply.co.uk/inspection/escalated",
    MAX_ATTEMPTS:             5,
    PHOTOS_PER_QUESTION_MAX:  10
  };

  const AT_BASE = `https://api.airtable.com/v0/${CFG.AIRTABLE_BASE_ID}`;

  function validateConfig() {
    if (!CFG.AIRTABLE_API_KEY || typeof CFG.AIRTABLE_API_KEY !== "string") {
      return { ok: false, reason: "Airtable API token is missing.", detail: "window.HC_AIRTABLE_KEY is not set in the GHL shell page." };
    }
    CFG.AIRTABLE_API_KEY = CFG.AIRTABLE_API_KEY.trim();
    if (CFG.AIRTABLE_API_KEY === "" || CFG.AIRTABLE_API_KEY === "YOUR_AIRTABLE_TOKEN_HERE") {
      return { ok: false, reason: "Airtable API token has not been set.", detail: "Set window.HC_AIRTABLE_KEY in the GHL shell before the script tag." };
    }
    return { ok: true };
  }

  const PHOTO_KEYWORDS = ["photo","photos","photograph","photographs","image","images","picture","pictures","evidence","visual","document","documented","certificate","receipt","record"];

  const state = {
    inspectionId: null,
    token: null,
    accountId: null,
    record: null,
    property: null,
    attempts: 1,
    answers: new Map()
  };

  // =============================================================
  // UTILITIES
  // =============================================================
  function getParam(name) { return new URL(window.location.href).searchParams.get(name); }
  function $(sel, root=document) { return root.querySelector(sel); }

  function el(tag, attrs={}, children=[]) {
    const node = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) {
      if (k==="class") node.className=v;
      else if (k==="html") node.innerHTML=v;
      else if (k.startsWith("on") && typeof v==="function") node.addEventListener(k.slice(2),v);
      else if (v!==null && v!==undefined) node.setAttribute(k,v);
    }
    (Array.isArray(children)?children:[children]).forEach(c=>{
      if(c==null)return;
      node.appendChild(typeof c==="string"?document.createTextNode(c):c);
    });
    return node;
  }

  function escapeHtml(str) {
    return String(str??"").replace(/[&<>"']/g,c=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function formatDate(isoOrDate) {
    if(!isoOrDate)return"—";
    const d=new Date(isoOrDate);
    if(isNaN(d.getTime()))return String(isoOrDate);
    return d.toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});
  }

  function truncateId(id) {
    if(!id)return"—";
    return"INS-"+id.slice(0,8)+(id.length>8?"…":"");
  }

  function parseArrayField(raw) {
    if(raw==null||raw==="")return[];
    if(Array.isArray(raw))return raw;
    if(typeof raw!=="string")return[];
    const trimmed=raw.trim();
    if(trimmed===""||trimmed==="[]")return[];
    try {
      const parsed=JSON.parse(trimmed);
      if(Array.isArray(parsed))return parsed;
    } catch(e) {}
    let content=trimmed;
    if(content.startsWith("["))content=content.substring(1);
    if(content.endsWith("]"))content=content.substring(0,content.length-1);
    return content.split(",").map(item=>item.trim()).filter(item=>item.length>0);
  }

  function itemText(item) {
    if(typeof item==="string")return item;
    if(item&&typeof item==="object"){
      if(item.description)return item.description;
      if(item.text)return item.text;
      if(item.question)return item.question;
      try{return JSON.stringify(item);}catch{return String(item);}
    }
    return String(item);
  }

  function needsPhotoUpload(text) {
    const lower=text.toLowerCase();
    return PHOTO_KEYWORDS.some(kw=>{
      const re=new RegExp("\\b"+kw.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","i");
      return re.test(lower);
    });
  }

  // =============================================================
  // STATE CARDS
  // =============================================================
  function renderState({type,title,message,actions=[]}) {
    const root=$("#form-root");
    root.innerHTML="";
    const iconMap={
      err:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      warn:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      ok:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    };
    const card=el("div",{class:"state-card",role:"alert"},[
      el("div",{class:`state-icon ${type}`,"aria-hidden":"true",html:iconMap[type]||iconMap.err}),
      el("h2",{class:"state-title"},title),
      el("p",{class:"state-msg"},message),
      ...actions.map(a=>el("button",{class:a.primary?"btn-primary":"btn-secondary",style:"margin:6px;",onclick:a.onClick},a.label))
    ]);
    root.appendChild(card);
    $("#attempt-strip")?.classList.add("hidden");
  }

  // =============================================================
  // AIRTABLE
  // =============================================================
  async function airtableGet(tableId,recordId) {
    const url=`${AT_BASE}/${tableId}/${recordId}`;
    const res=await fetch(url,{headers:{"Authorization":`Bearer ${CFG.AIRTABLE_API_KEY}`}});
    if(!res.ok){
      const err=new Error(`Airtable ${res.status}`);
      err.status=res.status;
      throw err;
    }
    return res.json();
  }

  async function loadInspection() {
    const rec=await airtableGet(CFG.AIRTABLE_INSPECTIONS_TBL,state.inspectionId);
    const f=rec.fields||{};
    state.record={
      id:rec.id,
      validationStatus:     f["Validation Status"]||"",
      attemptCount:         Number(f["Validation Attempt Count"]||1),
      secondaryFormToken:   f["Secondary Form Token"]||"",
      tokenExpiresAt:       f["Token Expires At"]||null,
      claudeSummary:        f["Claude Summary"]||"",
      missingCriticalFields:parseArrayField(f["Missing Critical Fields"]),
      dataConflicts:        parseArrayField(f["Data Conflicts"]),
      evidenceGaps:         parseArrayField(f["Evidence Gaps"]),
      pendingFollowups:     parseArrayField(f["Pending Follow-up Questions"]),
      propertyIds:          f["Linked Property"]||f["Property"]||[],
      inspectorName:        f["Inspector Name"]||"",
      inspectorEmail:       f["Inspector Email"]||"",   // V5: needed for handleForceReport payload
      inspectionDate:       f["Inspection Date"]||null
    };
    state.attempts=state.record.attemptCount||1;
  }

  async function loadProperty() {
    const propId=Array.isArray(state.record.propertyIds)?state.record.propertyIds[0]:state.record.propertyIds;
    if(!propId){state.property={address:"—",city:"",postcode:""};return;}
    try{
      const rec=await airtableGet(CFG.AIRTABLE_PROPERTIES_TBL,propId);
      const f=rec.fields||{};
      state.property={address:f["Address"]||"",city:f["City"]||"",postcode:f["Postcode"]||""};
    }catch(e){
      console.warn("Property fetch failed:",e);
      state.property={address:"—",city:"",postcode:""};
    }
  }

  // =============================================================
  // VALIDATION GATES
  // =============================================================
  function validateToken() {
    const rec=state.record;
    // If no token stored — allow through (account_id flow doesn't use tokens)
    if(!state.token)return true;
    if(!rec.secondaryFormToken||rec.secondaryFormToken!==state.token)return false;
    if(rec.tokenExpiresAt){
      const exp=new Date(rec.tokenExpiresAt);
      if(isNaN(exp.getTime())||exp.getTime()<Date.now())return false;
    }
    return true;
  }

  function hasAnyFindings() {
    return state.record.missingCriticalFields.length
        ||state.record.dataConflicts.length
        ||state.record.evidenceGaps.length;
  }

  // =============================================================
  // ATTEMPT STRIP
  // =============================================================
  function renderAttemptStrip() {
    const strip=$("#attempt-strip");
    if(!strip)return;
    $("#attempt-current").textContent=state.attempts;
    $("#attempt-max").textContent=CFG.MAX_ATTEMPTS;
    const dots=$("#attempt-dots");
    if(dots){
      dots.innerHTML="";
      for(let i=1;i<=CFG.MAX_ATTEMPTS;i++){
        dots.appendChild(el("span",{class:i<=state.attempts?"used":""}));
      }
    }
    strip.classList.remove("hidden");
  }

  // =============================================================
  // RENDER FORM
  // =============================================================
  function renderForm() {
    renderAttemptStrip();
    const root=$("#form-root");
    root.innerHTML="";

    const addressLine=[state.property.address,state.property.city,state.property.postcode].filter(Boolean).join(", ")||"—";

    const hero=el("section",{class:"hero","aria-labelledby":"hero-title"});
    hero.innerHTML=`
      <div class="hero-eyebrow">Inspection review</div>
      <h1 id="hero-title">Additional information needed</h1>
      <p class="hero-subtitle">A few items from your inspection need clarifying before the compliance report can be generated.</p>
      <dl class="hero-meta">
        <div><dt>Property</dt><dd>${escapeHtml(addressLine)}</dd></div>
        <div><dt>Inspector</dt><dd>${escapeHtml(state.record.inspectorName||"—")}</dd></div>
        <div><dt>Inspection date</dt><dd>${escapeHtml(formatDate(state.record.inspectionDate))}</dd></div>
        <div><dt>Reference</dt><dd>${escapeHtml(truncateId(state.inspectionId))}</dd></div>
      </dl>
      ${state.record.claudeSummary?`<div class="hero-quote">${escapeHtml(state.record.claudeSummary)}</div>`:""}
    `;
    root.appendChild(hero);

    if(state.record.missingCriticalFields.length){
      root.appendChild(buildSection({variant:"critical",badge:"A",title:"Critical information required",subtitle:"These items must be provided before your compliance report can be generated.",items:state.record.missingCriticalFields,required:true,alwaysPhoto:false,keyPrefix:"mcf"}));
    }
    if(state.record.dataConflicts.length){
      root.appendChild(buildSection({variant:"conflict",badge:"B",title:"Data conflicts to resolve",subtitle:"These items appear inconsistent. Please clarify or correct.",items:state.record.dataConflicts,required:true,alwaysPhoto:false,keyPrefix:"dc"}));
    }
    if(state.record.evidenceGaps.length){
      root.appendChild(buildSection({variant:"evidence",badge:"C",title:"Evidence gaps",subtitle:"Additional evidence would strengthen this inspection record. Optional but recommended.",items:state.record.evidenceGaps,required:false,alwaysPhoto:true,keyPrefix:"eg"}));
    }

    const notesSection=el("section",{class:"section notes"});
    notesSection.innerHTML=`
      <div class="section-header">
        <div class="section-badge">D</div>
        <div class="section-title-wrap">
          <h2 class="section-title">Additional notes</h2>
          <p class="section-sub">Anything else you want on record for this review. Optional.</p>
        </div>
      </div>
      <div class="section-body">
        <div class="question">
          <label class="q-label" for="additional-notes">Free-text notes<span class="q-optional">OPTIONAL</span></label>
          <textarea id="additional-notes" rows="5" placeholder="Add any additional context for the reviewer…"></textarea>
        </div>
      </div>
    `;
    root.appendChild(notesSection);

    const submitBar=el("div",{class:"submit-bar"});
    submitBar.innerHTML=`
      <div class="submit-hint">All required items must be completed. Your answers will be re-validated and you'll be redirected to the waiting screen.</div>
     <button type="button" id="submit-btn" class="btn-primary"><span id="submit-label">Submit clarification</span></button>
      <button type="button" id="force-btn" class="btn-force">Generate report with current information</button>
    `;
    root.appendChild(submitBar);
    $("#submit-btn").addEventListener("click",handleSubmit);
    $("#force-btn").addEventListener("click",handleForceReport);
  }

  function buildSection({variant,badge,title,subtitle,items,required,alwaysPhoto,keyPrefix}) {
    const section=el("section",{class:`section ${variant}`});
    const header=el("div",{class:"section-header"},[
      el("div",{class:"section-badge","aria-hidden":"true"},badge),
      el("div",{class:"section-title-wrap"},[
        el("h2",{class:"section-title"},title),
        el("p",{class:"section-sub"},subtitle)
      ]),
      el("span",{class:"section-count"},String(items.length))
    ]);
    section.appendChild(header);
    const body=el("div",{class:"section-body"});
    items.forEach((item,idx)=>{
      const text=itemText(item);
      const slotId=`${keyPrefix}-${idx}`;
      const showPhoto=alwaysPhoto||needsPhotoUpload(text);
      state.answers.set(slotId,{section:keyPrefix,originalText:text,originalItem:item,required,answer:"",photos:[]});
      body.appendChild(buildQuestion({slotId,text,required,showPhoto}));
    });
    section.appendChild(body);
    return section;
  }

  function buildQuestion({slotId,text,required,showPhoto}) {
    const rows=required?4:3;
    const q=el("div",{class:"question","data-slot":slotId});
    q.innerHTML=`
      <label class="q-label" for="ta-${slotId}">${escapeHtml(text)}<span class="${required?"q-required":"q-optional"}">${required?"REQUIRED":"OPTIONAL"}</span></label>
      <textarea id="ta-${slotId}" rows="${rows}" aria-required="${required?"true":"false"}" placeholder="${required?"Provide the missing information or correction…":"Add supporting notes (optional)…"}"></textarea>
      <div class="field-error" id="err-${slotId}" role="alert">This field is required.</div>
      ${showPhoto?`<div class="photo-row" id="photo-row-${slotId}">
        <button type="button" class="photo-btn" data-upload="${slotId}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          Add photo evidence
        </button>
        <div class="photo-thumbs" id="thumbs-${slotId}"></div>
      </div>`:""}
    `;
    const ta=q.querySelector(`#ta-${slotId}`);
    ta.addEventListener("input",()=>{
      const slot=state.answers.get(slotId);
      if(slot)slot.answer=ta.value;
      if(ta.value.trim()){ta.classList.remove("invalid");q.querySelector(`#err-${slotId}`)?.classList.remove("show");}
    });
    const uploadBtn=q.querySelector(`[data-upload="${slotId}"]`);
    if(uploadBtn)uploadBtn.addEventListener("click",()=>openCloudinaryWidget(slotId));
    return q;
  }

  // =============================================================
  // CLOUDINARY
  // =============================================================
  const widgets=new Map();

  function openCloudinaryWidget(slotId) {
    if(typeof window.cloudinary==="undefined"){alert("Photo upload is still loading. Please try again.");return;}
    const now=new Date();
    const folder=`inspections/${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,"0")}/${state.inspectionId}/clarify-${state.attempts}`;
    let widget=widgets.get(slotId);
    if(widget){try{widget.destroy({removeThumbnails:true});}catch(_){}widgets.delete(slotId);}
    const slot=state.answers.get(slotId);
    const remaining=CFG.PHOTOS_PER_QUESTION_MAX-slot.photos.length;
    if(remaining<=0){alert(`Maximum ${CFG.PHOTOS_PER_QUESTION_MAX} photos per question.`);return;}
    widget=window.cloudinary.createUploadWidget({
      cloudName:CFG.CLOUDINARY_CLOUD_NAME,uploadPreset:CFG.CLOUDINARY_UPLOAD_PRESET,folder,
      multiple:true,maxFiles:remaining,sources:["local","camera"],
      clientAllowedFormats:["jpg","jpeg","png","heic","webp"],maxFileSize:15*1024*1024
    },(error,result)=>{
      if(error){console.error("Cloudinary error:",error);return;}
      if(result&&result.event==="success"){
        const info=result.info;
        slot.photos.push({url:info.secure_url,publicId:info.public_id,thumb:info.thumbnail_url||info.secure_url});
        renderThumbs(slotId);
      }
    });
    widgets.set(slotId,widget);
    widget.open();
  }

  function renderThumbs(slotId) {
    const container=$(`#thumbs-${slotId}`);
    if(!container)return;
    const slot=state.answers.get(slotId);
    container.innerHTML="";
    slot.photos.forEach((p,i)=>{
      const wrap=el("div",{class:"thumb"});
      const img=el("img",{src:p.thumb,alt:"Evidence photo"});
      const btn=el("button",{type:"button",class:"thumb-remove","aria-label":"Remove photo",onclick:()=>{slot.photos.splice(i,1);renderThumbs(slotId);}},"×");
      wrap.appendChild(img);wrap.appendChild(btn);
      container.appendChild(wrap);
    });
  }

  // =============================================================
  // SUBMIT (regular clarify resubmission — Route 2 in main scenario)
  // V6: now posts to MAIN inspection webhook. Route 2 filter
  // ({{16.inspection_id}} exists, no force_report) picks it up.
  // =============================================================
  async function handleSubmit() {
    const missingSlots=[];
    state.answers.forEach((slot,slotId)=>{if(slot.required&&!slot.answer.trim())missingSlots.push(slotId);});
    if(missingSlots.length){
      missingSlots.forEach(slotId=>{
        $(`#ta-${slotId}`)?.classList.add("invalid");
        $(`#err-${slotId}`)?.classList.add("show");
      });
      $(`#ta-${missingSlots[0]}`)?.scrollIntoView({behavior:"smooth",block:"center"});
      return;
    }

    const additionalNotes=($("#additional-notes")?.value||"").trim();
    const mcfAnswers=[],dcAnswers=[],egAnswers=[];
    state.answers.forEach((slot)=>{
      const photoUrls=slot.photos.map(p=>p.url);
      if(slot.section==="mcf")mcfAnswers.push({question:slot.originalText,answer:slot.answer.trim(),photo_urls:photoUrls});
      else if(slot.section==="dc")dcAnswers.push({conflict:slot.originalText,resolution:slot.answer.trim(),photo_urls:photoUrls});
      else if(slot.section==="eg"&&(slot.answer.trim()||photoUrls.length))egAnswers.push({gap:slot.originalText,notes:slot.answer.trim(),photo_urls:photoUrls});
    });

    const payload={
      inspection_id:state.inspectionId,
      token:state.token,
      account_id:state.accountId,
      attempt_number:state.attempts,
      submitted_at:new Date().toISOString(),
      missing_critical_fields_answers:mcfAnswers,
      data_conflicts_answers:dcAnswers,
      evidence_gaps_answers:egAnswers,
      additional_notes:additionalNotes
    };

    const btn=$("#submit-btn"),lbl=$("#submit-label");
    btn.disabled=true;
    lbl.innerHTML=`<span class="spinner" aria-hidden="true"></span> Submitting…`;

    try{
      const res=await fetch(CFG.MAKE_WEBHOOK_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      if(!res.ok)throw new Error(`Webhook ${res.status}`);
      const wait=new URL(CFG.WAITING_PAGE_URL);
      if(state.inspectionId)wait.searchParams.set("inspection_id",state.inspectionId);
      if(state.token)wait.searchParams.set("token",state.token);
      if(state.accountId)wait.searchParams.set("account_id",state.accountId);
      window.location.href=wait.toString();
    }catch(err){
      console.error("Submit failed:",err);
      btn.disabled=false;
      lbl.textContent="Submit clarification";
      let errNode=$("#submit-error");
      if(!errNode){
        errNode=el("div",{id:"submit-error",style:"width:100%;padding:12px 14px;background:var(--sev-critical-bg);border:1px solid var(--sev-critical-tint);border-radius:var(--r);color:var(--sev-critical);font-size:14px;font-weight:500;"});
        $(".submit-bar")?.prepend(errNode);
      }
      errNode.textContent="Submission failed. Please check your connection and try again.";
    }
  }

  // =============================================================
  // FORCE REPORT (Route 1 in main scenario — bypasses re-validation)
  // V5: implements the previously-undefined handleForceReport function.
  // Sends to MAIN inspection webhook with force_report=true. Per blueprint:
  //   - Module 70 needs: inspection_id
  //   - Module 73 needs: inspection_id
  //   - Module 74 (Resend email) needs: inspector.email, property.address
  //     (nested objects, not flat fields)
  // =============================================================
  async function handleForceReport() {
    const propertyAddress = [state.property.address, state.property.city, state.property.postcode]
      .filter(Boolean).join(", ");

    const confirmMsg =
      "Generate the report using the information already submitted?\n\n" +
      "This will skip the remaining clarification questions and produce a final report. " +
      "Any unresolved items will be flagged as UNCONFIRMED in the report.\n\n" +
      "This action cannot be undone.";
    if (!window.confirm(confirmMsg)) return;

    if (!state.record.inspectorEmail) {
      console.warn("Inspector Email is missing on this inspection — the report email may not deliver.");
    }

    const payload = {
      force_report: true,                            // Route 1 trigger
      inspection_id: state.inspectionId,
      account_id: state.accountId || null,
      token: state.token || null,
      submitted_at: new Date().toISOString(),
      // Nested objects required by Module 74 (Resend email)
      inspector: {
        name: state.record.inspectorName || "",
        email: state.record.inspectorEmail || ""
      },
      property: {
        address: propertyAddress || "",
        city: state.property.city || "",
        postcode: state.property.postcode || ""
      }
    };

    const btn = $("#force-btn");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> Generating report…`;

    // Also disable the submit button so the user can't double-fire
    const submitBtn = $("#submit-btn");
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch(CFG.INSPECTION_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`Webhook ${res.status}`);

      // Redirect to waiting page — it will poll Airtable and forward
      // to /inspection/complete once Module 73 sets the terminal status
      const wait = new URL(CFG.WAITING_PAGE_URL);
      if (state.inspectionId) wait.searchParams.set("inspection_id", state.inspectionId);
      if (state.accountId)    wait.searchParams.set("account_id", state.accountId);
      if (state.token)        wait.searchParams.set("token", state.token);
      window.location.href = wait.toString();
    } catch (err) {
      console.error("Force report failed:", err);
      btn.disabled = false;
      btn.textContent = originalText;
      if (submitBtn) submitBtn.disabled = false;
      let errNode = $("#submit-error");
      if (!errNode) {
        errNode = el("div", {
          id: "submit-error",
          style: "width:100%;padding:12px 14px;background:var(--sev-critical-bg);border:1px solid var(--sev-critical-tint);border-radius:var(--r);color:var(--sev-critical);font-size:14px;font-weight:500;"
        });
        $(".submit-bar")?.prepend(errNode);
      }
      errNode.textContent = "Couldn't generate the report. Please check your connection and try again.";
    }
  }

  // =============================================================
  // BOOT
  // =============================================================
  async function boot() {
    const cfgCheck=validateConfig();
    if(!cfgCheck.ok){renderState({type:"err",title:"Page not configured",message:cfgCheck.reason});return;}

    state.inspectionId=getParam("inspection_id");
    state.token=getParam("token");
    state.accountId=getParam("account_id");

    // Find inspection by account_id if no inspection_id
    // V4 fix: {field}&"" string coercion + sort param removed
    if(!state.inspectionId&&state.accountId){
      try{
        const formula=encodeURIComponent(`FIND("${state.accountId}",{Account Record ID}&"")`);
        const url=`${AT_BASE}/${CFG.AIRTABLE_INSPECTIONS_TBL}?filterByFormula=${formula}&maxRecords=1`;
        const res=await fetch(url,{headers:{"Authorization":`Bearer ${CFG.AIRTABLE_API_KEY}`}});
        if(res.ok){
          const data=await res.json();
          if(data.records&&data.records.length>0)state.inspectionId=data.records[0].id;
        }
      }catch(e){console.warn("Account lookup failed:",e);}
    }

    if(!state.inspectionId){
      renderState({type:"err",title:"Invalid link",message:"This link is missing required information. Please check the URL or contact your coordinator."});
      return;
    }

    try{await loadInspection();}
    catch(e){
      console.error(e);
      if(String(e.message||"").includes("401")||String(e.message||"").includes("403")){
        renderState({type:"err",title:"Can't reach inspection records",message:"Authentication failed. Please contact support.",actions:[{label:"Try again",primary:false,onClick:()=>location.reload()}]});
        return;
      }
      renderState({type:"err",title:"Couldn't load inspection",message:"We couldn't fetch your inspection details. Check your connection and try again.",actions:[{label:"Try again",primary:true,onClick:()=>location.reload()}]});
      return;
    }

    if(!validateToken()){
      renderState({type:"err",title:"Link expired or invalid",message:"This clarification link has expired or is no longer valid."});
      return;
    }

    if(state.record.validationStatus==="Passed"){
      const wait=new URL(CFG.WAITING_PAGE_URL);
      if(state.inspectionId)wait.searchParams.set("inspection_id",state.inspectionId);
      if(state.accountId)wait.searchParams.set("account_id",state.accountId);
      window.location.replace(wait.toString());
      return;
    }

    if(state.record.attemptCount>=CFG.MAX_ATTEMPTS){window.location.replace(CFG.ESCALATED_PAGE_URL);return;}

    await loadProperty();

    if(!hasAnyFindings()){
      renderState({type:"warn",title:"No outstanding items",message:"We couldn't find any outstanding items for this inspection.",actions:[{label:"Return to waiting page",primary:true,onClick:()=>{
        const wait=new URL(CFG.WAITING_PAGE_URL);
        if(state.inspectionId)wait.searchParams.set("inspection_id",state.inspectionId);
        if(state.accountId)wait.searchParams.set("account_id",state.accountId);
        window.location.href=wait.toString();
      }}]});
      return;
    }

    renderForm();
  }

  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",boot);}
  else{boot();}
})();
