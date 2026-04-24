// =============================================================
// HouseComply — Inspection Logic
// Hosted on GitHub. Loaded by inspect-shell.html in GHL.
// Edit this file in GitHub browser editor (has full search).
// Version: V3-Wave4 | account_id fix applied
// =============================================================

const STEPS=[
  {name:'Welcome',sub:'Begin inspection',req:[],badge:'00'},
  {name:'Property Details',sub:'Address & identification',req:['property_id','inspection_date','address','postcode','property_type','tenure'],badge:'01'},
  {name:'Inspector',sub:'Details & context',req:['inspector_name','inspector_email','inspection_time','compliance_context'],badge:'02'},
  {name:'Safety Devices',sub:'Smoke & CO alarms',req:['smoke_alarm_count','co_alarm_count'],badge:'03'},
  {name:'Compliance Docs',sub:'EPC, EICR, Gas Safety',req:['epc_available','epc_status','eicr_available','eicr_status','gas_safety_available'],badge:'04'},
  {name:'Tenancy Docs',sub:'Contract, Deposit, RSW',req:['occupation_contract','deposit_taken','rsw_status'],badge:'05'},
  {name:'Heating & Water',sub:'Physical systems',req:['heating_type','heating_working','heating_all_rooms','water_working','hot_water_working'],badge:'06'},
  {name:'Damp & Ventilation',sub:'Moisture & air quality',req:['damp_signs','vent_kitchen','vent_bathroom','vent_adequate'],badge:'07'},
  {name:'Rooms & Condition',sub:'Walk every area',req:['rooms_not_inspected','internal_summary','external_summary','escape_routes_clear'],badge:'08'},
  {name:'Structure & Energy',sub:'Build & access',req:['age_band','construction_type','full_access'],badge:'09'},
  {name:'Defect Log',sub:'Photograph first',req:['defect_count'],badge:'10'},
  {name:'Immediate Risk',sub:'Assess before leaving',req:['immediate_danger'],badge:'11'},
  {name:'Review & Declaration',sub:'Confirm and submit',req:['declaration_name','declaration_date'],badge:'12'}
];

const IMPACT_TAGS=['safety risk','FFHH concern','energy inefficiency','structural concern','water ingress','damp or mould concern','maintenance issue','cosmetic only'];
const SEVERITIES=['Critical','High','Medium','Low','Advisory'];
const SOURCE_TYPES=['Observed','Reported by tenant','Reported by agent','Documented','Not verified'];

let cur=0,defectCount=0;
const aiResults={};

// =============================================================
// CLOUDINARY CONFIG
// =============================================================
const CLD={
  cloudName:'dqf21bf9r',
  uploadPreset:'inspection_photos',
  folder:'inspections'
};
const cloudinaryStore={};

// =============================================================
// MAKE.COM WEBHOOK URLS
// =============================================================
const HC={
  s:'https://hook.eu1.make.com/8j58i0pjxbyhr9dxqoz3fszi4rt5tq6k',
  a:'https://hook.eu1.make.com/REPLACE_WITH_AI_PROXY_WEBHOOK',
  l:'https://hook.eu1.make.com/REPLACE_WITH_AUTH_WEBHOOK',
  r:'https://hook.eu1.make.com/REPLACE_WITH_SIGNUP_WEBHOOK',
  p:'https://hook.eu1.make.com/REPLACE_WITH_RESET_WEBHOOK'
};

// =============================================================
// INIT
// =============================================================
window.addEventListener('DOMContentLoaded',()=>{init();});

function init(){
  checkDraft();
  renderStep(0);
  document.querySelectorAll('input,select,textarea').forEach(el=>{
    el.addEventListener('change',()=>{if(el.name)autoTick(el.name);saveDraft();});
    el.addEventListener('input',()=>saveDraft());
  });
}

// =============================================================
// STEP NAVIGATION
// =============================================================
function renderStep(n,back=false){
  const prev=document.getElementById('pane-'+cur);
  if(prev){prev.classList.remove('active','going-back');}
  cur=n;
  const pane=document.getElementById('pane-'+n);
  if(!pane)return;
  pane.classList.remove('going-back');
  if(back)pane.classList.add('going-back');
  pane.classList.add('active');
  document.getElementById('pane-container').scrollTop=0;
  const s=STEPS[n];
  document.getElementById('hdr-step').textContent=n===0?'\u2014':n;
  document.getElementById('hdr-total').textContent=STEPS.length-1;
  document.getElementById('nav-step-name').textContent=s.name;
  document.getElementById('nav-step-sub').textContent=s.sub;
  const lbar=document.getElementById('step-label-bar');
  if(n===0){lbar.style.display='none';}
  else{lbar.style.display='flex';document.getElementById('step-badge').textContent=s.badge;document.getElementById('step-name').textContent=s.name;document.getElementById('step-sub').textContent=s.sub;}
  document.getElementById('progress-bar').style.width=(n===0?0:Math.round((n/(STEPS.length-1))*100))+'%';
  const bb=document.getElementById('btn-back'),nb=document.getElementById('btn-next');
  bb.disabled=n===0;
  nb.textContent=n===0?'Start Inspection':n===STEPS.length-1?'Submit':'Next \u2192';
  nb.className='nav-next'+(n===STEPS.length-1?' teal':'');
  if(n===STEPS.length-1)buildReview();
  if(n===11)buildRiskTags();
}

function goNext(){
  if(cur===0){renderStep(1);return;}
  const errs=validateStep(cur);
  if(errs.length>0){showErrors(cur,errs);return;}
  hideErrors(cur);
  if(cur<STEPS.length-1)renderStep(cur+1);
  else submitForm();
}
function goBack(){if(cur>0){hideErrors(cur);renderStep(cur-1,true);}}

// =============================================================
// VALIDATION
// =============================================================
function validateStep(n){
  const missing=[];
  STEPS[n].req.forEach(fname=>{
    const el=document.querySelector(`[name="${fname}"]`);
    if(!el||!el.value||!el.value.trim()){
      missing.push({field:fname,label:el?.closest('.f')?.querySelector('label')?.textContent?.replace('*','').trim()||fname});
    }
  });
  if(n===3){
    const sc=document.querySelector('[name="smoke_alarm_count"]')?.value;
    if(sc==='0'){
      const smokeReasonDropdown=document.querySelector('[name="smoke_alarm_no_reason"]')?.value;
      if(!smokeReasonDropdown)missing.push({field:'smoke_alarm_no_reason',label:'No smoke alarm \u2014 select a reason'});
      if(smokeReasonDropdown==='Other'&&!document.querySelector('[name="smoke_no_reason"]')?.value)missing.push({field:'smoke_no_reason',label:'No smoke alarm \u2014 specify reason'});
    }
    const smokeCount=parseInt(sc)||0;
    if(smokeCount>0){
      if(!document.querySelector('[name="smoke_alarms_tested"]')?.value)missing.push({field:'smoke_alarms_tested',label:'Smoke Alarms Tested \u2014 required'});
      const smokeTested=document.querySelector('[name="smoke_alarms_tested"]')?.value;
      if(['Yes','Partially'].includes(smokeTested)){
        if(!document.querySelector('[name="smoke_alarms_working"]')?.value)missing.push({field:'smoke_alarms_working',label:'Smoke Alarms Working \u2014 required'});
        if(!document.querySelector('[name="smoke_alarm_test_method"]')?.value)missing.push({field:'smoke_alarm_test_method',label:'Smoke Alarm Test Method \u2014 required'});
      }
    }
    const cc=document.querySelector('[name="co_alarm_count"]')?.value;
    const coCount=parseInt(cc)||0;
    if(coCount>0){
      if(!document.querySelector('[name="co_alarms_tested"]')?.value)missing.push({field:'co_alarms_tested',label:'CO Alarms Tested \u2014 required'});
      const coTested=document.querySelector('[name="co_alarms_tested"]')?.value;
      if(coTested==='Yes'){
        if(!document.querySelector('[name="co_alarms_working"]')?.value)missing.push({field:'co_alarms_working',label:'CO Alarms Working \u2014 required'});
        if(!document.querySelector('[name="co_alarm_test_method"]')?.value)missing.push({field:'co_alarm_test_method',label:'CO Alarm Test Method \u2014 required'});
      }
    }
  }
  if(n===4){
    const epcAvail=document.querySelector('[name="epc_available"]')?.value;
    if(epcAvail==='Yes'&&!document.querySelector('[name="epc_date"]')?.value)missing.push({field:'epc_date',label:'EPC Date \u2014 required when sighted'});
    const eicrAvail=document.querySelector('[name="eicr_available"]')?.value;
    if(eicrAvail==='Yes'){
      if(!document.querySelector('[name="eicr_expiry_date"]')?.value)missing.push({field:'eicr_expiry_date',label:'EICR Expiry Date \u2014 required'});
      if(!document.querySelector('[name="eicr_result"]')?.value)missing.push({field:'eicr_result',label:'EICR Result \u2014 required'});
    }
    const gasAvail=document.querySelector('[name="gas_safety_available"]')?.value;
    if(gasAvail==='Yes'){
      if(!document.querySelector('[name="gas_issue_date"]')?.value)missing.push({field:'gas_issue_date',label:'Gas Safety Issue Date \u2014 required when sighted'});
      if(!document.querySelector('[name="gas_expiry_date"]')?.value)missing.push({field:'gas_expiry_date',label:'Gas Safety Expiry Date \u2014 required when sighted'});
    }
    const gasIssue=document.querySelector('[name="gas_issue_date"]')?.value;
    const gasExpiry=document.querySelector('[name="gas_expiry_date"]')?.value;
    if(gasIssue&&gasExpiry&&gasIssue===gasExpiry)missing.push({field:'gas_expiry_date',label:'Gas Expiry Date \u2014 cannot equal issue date'});
  }
  if(n===5){
    const depTaken=document.querySelector('[name="deposit_taken"]')?.value;
    if(depTaken==='Yes'){
      if(!document.querySelector('[name="deposit_date"]')?.value)missing.push({field:'deposit_date',label:'Deposit Date \u2014 required'});
      if(!document.querySelector('[name="deposit_ref"]')?.value)missing.push({field:'deposit_ref',label:'Deposit Reference \u2014 required'});
    }
    const contractPresent=document.querySelector('[name="occupation_contract"]')?.value;
    if(contractPresent==='Yes'&&!document.querySelector('[name="tenant_names_match"]')?.value)missing.push({field:'tenant_names_match',label:'Names Match \u2014 required when contract sighted'});
  }
  if(n===6){
    const hw=document.querySelector('[name="heating_working"]')?.value;
    if(hw==='Pass'&&!document.querySelector('[name="heating_working_note"]')?.value)missing.push({field:'heating_working_note',label:'Heating Working Note \u2014 required'});
    const har=document.querySelector('[name="heating_all_rooms"]')?.value;
    if(har==='Fail'&&hw==='Pass')missing.push({field:'heating_working',label:'Heating cannot be Pass if not reaching all rooms'});
  }
  if(n===7){
    const ds=document.querySelector('[name="damp_signs"]')?.value;
    if(ds==='Pass'&&!document.querySelector('[name="damp_signs_note"]')?.value)missing.push({field:'damp_signs_note',label:'No Damp Note \u2014 required'});
    const vk=document.querySelector('[name="vent_kitchen"]')?.value;
    if(['Advisory','Fail'].includes(vk)&&!document.querySelector('[name="vent_kitchen_detail"]')?.value)missing.push({field:'vent_kitchen_detail',label:'Kitchen Ventilation Detail \u2014 required'});
    const vb=document.querySelector('[name="vent_bathroom"]')?.value;
    if(['Advisory','Fail'].includes(vb)&&!document.querySelector('[name="vent_bathroom_detail"]')?.value)missing.push({field:'vent_bathroom_detail',label:'Bathroom Ventilation Detail \u2014 required'});
  }
  if(n===8){
    const er=document.querySelector('[name="escape_routes_clear"]')?.value;
    if(er==='Pass'&&!document.querySelector('[name="escape_routes_note"]')?.value)missing.push({field:'escape_routes_note',label:'Escape Routes Note \u2014 required'});
    const rni=document.querySelector('[name="rooms_not_inspected"]')?.value;
    if(rni==='Yes'){
      if(!document.querySelector('[name="rooms_not_reason"]')?.value)missing.push({field:'rooms_not_reason',label:'Reason not inspected \u2014 required'});
      if(document.querySelector('[name="rooms_not_reason"]')?.value==='Other'&&!document.querySelector('[name="rooms_not_detail"]')?.value)missing.push({field:'rooms_not_detail',label:'Specify reason \u2014 required'});
    }
  }
  if(n===9){
    const ew=document.querySelector('[name="ext_wall_condition"]')?.value;
    if(['Fair minor defects','Poor significant defects','Critical'].includes(ew)&&!document.querySelector('[name="ext_wall_detail"]')?.value)missing.push({field:'ext_wall_detail',label:'External Wall Detail \u2014 required'});
    const wc=document.querySelector('[name="window_condition"]')?.value;
    if(['Fair','Poor'].includes(wc)&&!document.querySelector('[name="window_detail"]')?.value)missing.push({field:'window_detail',label:'Window Condition Detail \u2014 required'});
    const gc=document.querySelector('[name="gutters_condition"]')?.value;
    if(['Fair minor issue','Poor significant defect'].includes(gc)&&!document.querySelector('[name="gutters_detail"]')?.value)missing.push({field:'gutters_detail',label:'Gutters Detail \u2014 required'});
  }
  if(n===11){
    const id=document.querySelector('[name="immediate_danger"]')?.value;
    if(id==='Fail'&&!document.querySelector('[name="immediate_danger_note"]')?.value)missing.push({field:'immediate_danger_note',label:'Immediate Danger Description \u2014 required'});
    const er=document.querySelector('[name="escape_routes_clear"]')?.value;
    if(er==='Fail'&&id==='Pass'&&!document.querySelector('[name="immediate_danger_justification"]')?.value)missing.push({field:'immediate_danger_justification',label:'Immediate Danger Justification \u2014 required'});
  }
  if(n===12){if(!document.getElementById('decl-confirm')?.checked)missing.push({field:'declaration_confirmed',label:'Inspector declaration must be confirmed'});}
  return missing;
}

function showErrors(n,errs){
  const banner=document.getElementById('err-'+n),list=document.getElementById('err-list-'+n);
  if(!banner||!list)return;
  list.innerHTML=errs.map(e=>`<li>${e.label}</li>`).join('');
  banner.style.display='block';
  errs.forEach(e=>{document.getElementById('f-'+e.field)?.classList.add('has-error');document.querySelector(`[name="${e.field}"]`)?.classList.add('err');});
  banner.scrollIntoView({behavior:'smooth',block:'start'});
}
function hideErrors(n){
  const b=document.getElementById('err-'+n);if(b)b.style.display='none';
  document.querySelectorAll('.has-error').forEach(e=>e.classList.remove('has-error'));
  document.querySelectorAll('.err').forEach(e=>e.classList.remove('err'));
}

// =============================================================
// CLOUDINARY FUNCTIONS
// =============================================================
function openCloudinaryWidget(key,label){
  const widget=cloudinary.createUploadWidget({
    cloudName:CLD.cloudName,uploadPreset:CLD.uploadPreset,folder:CLD.folder+'/'+key,
    sources:['local','camera'],multiple:false,maxFiles:1,maxFileSize:10485760,
    allowedFormats:['jpg','jpeg','png','heic','webp'],showAdvancedOptions:false,cropping:false,
    resourceType:'auto',theme:'minimal',
    styles:{palette:{window:'#FFFFFF',windowBorder:'#DDE3EC',tabIcon:'#0C8A6B',menuIcons:'#5C7089',textDark:'#1C3557',textLight:'#FFFFFF',link:'#0C8A6B',action:'#0C8A6B',inactiveTabIcon:'#94A3B8',error:'#C0392B',inProgress:'#0C8A6B',complete:'#0C8A6B',sourceBg:'#F4F6F9'}}
  },(error,result)=>{
    if(error){console.error('Cloudinary error:',error);hideUploadingState(key);return;}
    if(result.event==='queues-start')showUploadingState(key);
    if(result.event==='success'){
      const info=result.info;
      cloudinaryStore[key]={url:info.secure_url,public_id:info.public_id,format:info.format,filename:(info.original_filename||info.public_id)+(info.format?'.'+info.format:'')};
      updatePhotoZoneUI(key);widget.close();saveDraft();
    }
    if(result.event==='close')hideUploadingState(key);
  });
  widget.open();
}

function showUploadingState(key){document.getElementById('cz-'+key+'-empty')?.classList.add('hidden');document.getElementById('cz-'+key+'-uploading')?.classList.add('visible');}
function hideUploadingState(key){document.getElementById('cz-'+key+'-empty')?.classList.remove('hidden');document.getElementById('cz-'+key+'-uploading')?.classList.remove('visible');}

function updatePhotoZoneUI(key){
  const data=cloudinaryStore[key];
  const zone=document.getElementById('cz-'+key);
  const emptyEl=document.getElementById('cz-'+key+'-empty');
  const uploadingEl=document.getElementById('cz-'+key+'-uploading');
  const previewEl=document.getElementById('cz-'+key+'-preview');
  const thumbEl=document.getElementById('cld-img-'+key);
  const nameEl=document.getElementById('cld-name-'+key);
  if(!data){emptyEl?.classList.remove('hidden');uploadingEl?.classList.remove('visible');previewEl?.classList.remove('visible');zone?.classList.remove('has-photo');return;}
  emptyEl?.classList.add('hidden');uploadingEl?.classList.remove('visible');previewEl?.classList.add('visible');zone?.classList.add('has-photo');
  if(thumbEl){const thumbUrl=data.url.replace('/upload/','/upload/w_80,h_80,c_fill,q_auto,f_jpg/');thumbEl.src=thumbUrl;thumbEl.onerror=()=>{thumbEl.style.display='none';};}
  if(nameEl)nameEl.textContent=data.filename||data.public_id;
}

function removePhoto(key){
  delete cloudinaryStore[key];updatePhotoZoneUI(key);
  document.getElementById('ai-result-'+key)?.classList.remove('visible');
  const errEl=document.getElementById('ai-err-'+key);if(errEl){errEl.textContent='';errEl.classList.remove('visible');}
  saveDraft();
}

async function getBase64FromCloudinaryUrl(url){
  const optimisedUrl=url.replace('/upload/','/upload/w_1200,q_auto,f_jpg/');
  const resp=await fetch(optimisedUrl);
  if(!resp.ok)throw new Error('Could not fetch image (HTTP '+resp.status+')');
  const blob=await resp.blob();
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onloadend=()=>{resolve({b64:reader.result.split(',')[1],mime:blob.type||'image/jpeg'});};
    reader.onerror=reject;reader.readAsDataURL(blob);
  });
}

// =============================================================
// AI ANALYSIS
// =============================================================
const AI_PROMPTS={
  epc:`You are reading a UK EPC. Extract: rating (A-G), date (YYYY-MM-DD). Return ONLY JSON: {"rating":"","date":""}`,
  eicr:`You are reading a UK EICR. Extract: issue_date, next_inspection_date, result. Return ONLY JSON: {"issue_date":"","next_inspection_date":"","result":""}`,
  gas:`You are reading a UK Gas Safety Certificate. Extract: issue_date, expiry_date. Return ONLY JSON: {"issue_date":"","expiry_date":""}`,
  defect:`You are a UK property inspector analysing a defect photo. Return ONLY JSON: {"description":"","issue_type":"","severity":"","impact_tags":[]}`
};

const AI_FIELD_MAP={
  epc:[{label:'EPC Rating',val:r=>r.rating,apply:v=>{const el=document.getElementById('epc_rating');if(el)el.value=v.toUpperCase();showBlock('epc-detail','Yes','Yes');document.getElementById('epc-date-wrap')?.classList.remove('hidden');}},
       {label:'EPC Date',val:r=>r.date,apply:v=>{const el=document.getElementById('epc_date');if(el)el.value=v;}}],
  eicr:[{label:'Issue Date',val:r=>r.issue_date,apply:v=>{const el=document.getElementById('eicr_issue_date');if(el)el.value=v;showBlock('eicr-detail','Yes','Yes');document.getElementById('eicr-expiry-wrap')?.classList.remove('hidden');document.getElementById('eicr-result-wrap')?.classList.remove('hidden');}},
        {label:'Next Inspection',val:r=>r.next_inspection_date,apply:v=>{const el=document.getElementById('eicr_expiry_date');if(el)el.value=v;}},
        {label:'Result',val:r=>r.result,apply:v=>{const el=document.getElementById('eicr_result');if(el)el.value=v;}}],
  gas:[{label:'Issue Date',val:r=>r.issue_date,apply:v=>{const el=document.getElementById('gas_issue_date');if(el)el.value=v;showBlock('gas-detail','Yes','Yes');document.getElementById('gas-expiry-wrap')?.classList.remove('hidden');}},
       {label:'Expiry Date',val:r=>r.expiry_date,apply:v=>{const el=document.getElementById('gas_expiry_date');if(el)el.value=v;}}]
};

async function analyseDoc(key){
  const cldPhoto=cloudinaryStore[key];if(!cldPhoto){showAIErr(key,'Upload a photo first.');return;}
  const btn=document.getElementById('ai-btn-'+key);
  if(btn){btn.classList.add('running');btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0;"><path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/></svg> Analysing...';}
  hideAIErr(key);
  try{
    const {b64,mime}=await getBase64FromCloudinaryUrl(cldPhoto.url);
    const r=await fetch(HC.a,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:key,image:b64,mime,token:''})});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const data=await r.json();if(data.error)throw new Error(data.error);
    aiResults[key]=data;showAIResult(key,data);
  }catch(e){showAIErr(key,'AI analysis failed \u2014 '+e.message);}
  finally{if(btn){btn.classList.remove('running');btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0;"><path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/></svg> Analyse with AI';}}
}

async function analyseDefect(idx){
  const key='defect-'+idx;const cldPhoto=cloudinaryStore[key];
  if(!cldPhoto){showAIErr(key,'Upload a photo first.');return;}
  const btn=document.getElementById('ai-btn-'+key);
  if(btn){btn.classList.add('running');btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0;"><path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/></svg> Analysing...';}
  hideAIErr(key);
  try{
    const {b64,mime}=await getBase64FromCloudinaryUrl(cldPhoto.url);
    const r=await fetch(HC.a,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'defect',image:b64,mime,token:''})});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const data=await r.json();if(data.error)throw new Error(data.error);
    aiResults[key]=data;showDefectAIResult(idx,data);
  }catch(e){showAIErr(key,'AI analysis failed \u2014 '+e.message);}
  finally{if(btn){btn.classList.remove('running');btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0;"><path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/></svg> Analyse with AI';}}
}

function showAIResult(key,result){
  const card=document.getElementById('ai-result-'+key),rows=document.getElementById('ai-rows-'+key);
  if(!card||!rows)return;
  const fields=AI_FIELD_MAP[key]||[];
  rows.innerHTML=fields.map(f=>`<div class="ai-result-row"><span class="ai-result-key">${f.label}</span><span class="ai-result-val">${f.val(result)||'\u2014'}</span></div>`).join('');
  card.classList.add('visible');
}
function showDefectAIResult(idx,result){
  const key='defect-'+idx;const card=document.getElementById('ai-result-'+key),rows=document.getElementById('ai-rows-'+key);
  if(!card||!rows)return;
  rows.innerHTML=`<div class="ai-result-row"><span class="ai-result-key">Description</span><span class="ai-result-val" style="font-size:11px;">${result.description||'\u2014'}</span></div>
  <div class="ai-result-row"><span class="ai-result-key">Issue Type</span><span class="ai-result-val">${result.issue_type||'\u2014'}</span></div>
  <div class="ai-result-row"><span class="ai-result-key">Severity</span><span class="ai-result-val">${result.severity||'\u2014'}</span></div>
  <div class="ai-result-row"><span class="ai-result-key">Tags</span><span class="ai-result-val" style="font-size:11px;">${(result.impact_tags||[]).join(', ')||'\u2014'}</span></div>`;
  card.classList.add('visible');
}
function applyAI(key){
  const result=aiResults[key];if(!result)return;
  const fields=AI_FIELD_MAP[key]||[];
  fields.forEach(f=>{const v=f.val(result);if(v&&v!=='unknown')f.apply(v);});
  document.getElementById('ai-result-'+key)?.classList.remove('visible');saveDraft();
}
function applyDefectAI(idx){
  const key='defect-'+idx;const result=aiResults[key];if(!result)return;
  const descEl=document.querySelector(`[name="defect_${idx}_desc"]`);if(descEl&&result.description)descEl.value=result.description;
  const typeEl=document.querySelector(`[name="defect_${idx}_type"]`);
  if(typeEl&&result.issue_type){const opts=[...typeEl.options];const match=opts.find(o=>o.value===result.issue_type||o.text===result.issue_type);if(match)typeEl.value=match.value;}
  const sevEl=document.querySelector(`[name="defect_${idx}_severity"]`);if(sevEl&&result.severity){sevEl.value=result.severity;cs(sevEl);}
  (result.impact_tags||[]).forEach(tag=>{const cb=document.getElementById(`it${idx}_${tag.replace(/ /g,'_')}`);if(cb)cb.checked=true;});
  document.getElementById('ai-result-'+key)?.classList.remove('visible');saveDraft();
}
function dismissAI(key){document.getElementById('ai-result-'+key)?.classList.remove('visible');}
function showAIErr(key,msg){const el=document.getElementById('ai-err-'+key);if(el){el.textContent=msg;el.classList.add('visible');}}
function hideAIErr(key){const el=document.getElementById('ai-err-'+key);if(el){el.textContent='';el.classList.remove('visible');}}

// =============================================================
// ALARM GENERATION
// =============================================================
function showAlarms(type,count,max){
  const n=parseInt(count)||0;
  const cont=document.getElementById(type+'-alarms-container');
  const noWrap=document.getElementById(type+'-no-reason-wrap');
  const testSection=document.getElementById(type+'-testing-section');
  cont.innerHTML='';
  if(noWrap)noWrap.classList.toggle('hidden',n!==0);
  if(testSection)testSection.classList.toggle('hidden',n===0);
  for(let i=1;i<=n;i++){
    const key=type+'-alarm-'+i;
    const div=document.createElement('div');div.className='alarm-card';
    div.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:.75rem;"><span class="alarm-num">${type.toUpperCase()} ${i}</span></div>
    <div class="defect-photo-section"><div class="defect-photo-title">Photo <span class="tag">TAKE NOW</span></div>
    <div class="cld-zone" id="cz-${key}"><div id="cz-${key}-empty">
    <button type="button" class="cld-upload-btn" onclick="openCloudinaryWidget('${key}','${type.toUpperCase()} Alarm ${i}')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:20px;height:20px;flex-shrink:0;"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M9 5l1.5-2h3L15 5"/></svg>Take Alarm Photo</button></div>
    <div class="cld-uploading" id="cz-${key}-uploading"><div class="cld-spinner"></div>Uploading...</div>
    <div class="cld-preview" id="cz-${key}-preview"><img class="cld-thumb" id="cld-img-${key}" alt="${type} alarm">
    <div class="cld-preview-info"><div class="cld-filename" id="cld-name-${key}"></div>
    <button type="button" class="cld-remove-btn" onclick="removePhoto('${key}')">Remove</button></div></div></div></div>
    <div class="fg fg3">
    <div class="f"><label>${type==='smoke'?'Smoke':'CO'} Alarm ${i} &mdash; Location</label><input type="text" name="${type}_alarm_${i}_loc" placeholder="e.g. First floor landing"/></div>
    <div class="f"><label>Tested?</label><select name="${type}_alarm_${i}_tested" onchange="cs(this)"><option value="">&#8212;</option><option value="Pass">Yes &mdash; tested OK</option><option value="Fail">Tested &mdash; failed</option><option value="Advisory">Present &mdash; not tested</option></select></div>
    <div class="f"><label>Photo ID</label><input type="text" name="${type}_alarm_${i}_photo_id" value="${type.toUpperCase()}-ALARM-00${i}"/></div></div>`;
    cont.appendChild(div);
  }
}

// =============================================================
// DEFECT GENERATION
// =============================================================
function setDefects(count){
  defectCount=parseInt(count)||0;
  const cont=document.getElementById('defects-container');cont.innerHTML='';
  buildRiskTags();
  for(let i=1;i<=defectCount;i++)cont.appendChild(buildDefectCard(i));
}

function buildDefectCard(i){
  const div=document.createElement('div');div.className='defect-card';div.id='defect-card-'+i;
  const defId='D'+String(i).padStart(3,'0');
  const key='defect-'+i;
  const tagHtml=IMPACT_TAGS.map(t=>`<input type="checkbox" class="tc" id="it${i}_${t.replace(/ /g,'_')}" name="defect_${i}_tag_${t.replace(/ /g,'_')}" value="${t}"><label class="tl" for="it${i}_${t.replace(/ /g,'_')}">${t}</label>`).join('');
  div.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:.85rem;"><span class="defect-num">DEFECT ${i} &mdash; ${defId}</span></div>
  <div class="defect-photo-section"><div class="defect-photo-title">Defect Photo <span class="tag">PHOTOGRAPH FIRST</span></div>
  <div class="cld-zone" id="cz-${key}"><div id="cz-${key}-empty">
  <button type="button" class="cld-upload-btn" onclick="openCloudinaryWidget('${key}','Defect ${i}')">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:22px;height:22px;flex-shrink:0;"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M9 5l1.5-2h3L15 5"/></svg>Open Camera &mdash; Photograph Defect</button></div>
  <div class="cld-uploading" id="cz-${key}-uploading"><div class="cld-spinner"></div>Uploading to secure storage...</div>
  <div class="cld-preview" id="cz-${key}-preview"><img class="cld-thumb" id="cld-img-${key}" alt="Defect ${i}" style="width:90px;height:90px;">
  <div class="cld-preview-info"><div class="cld-filename" id="cld-name-${key}"></div>
  <button type="button" class="ai-analyse-btn" id="ai-btn-${key}" onclick="analyseDefect(${i})">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0;"><path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/></svg>Analyse with AI</button>
  <button type="button" class="cld-remove-btn" onclick="removePhoto('${key}')">Remove</button></div></div>
  <div style="padding:0 .75rem .75rem;">
  <div class="ai-result-card" id="ai-result-${key}"><div class="ai-result-header"><span class="ai-result-badge">AI &mdash; Defect ${i}</span></div>
  <div class="ai-result-rows" id="ai-rows-${key}"></div>
  <div class="ai-action-row"><button type="button" class="ai-apply-btn" onclick="applyDefectAI(${i})">Apply to form</button><button type="button" class="ai-dismiss-btn" onclick="dismissAI('${key}')">Dismiss</button></div></div>
  <div class="ai-error" id="ai-err-${key}"></div></div></div></div>
  <div class="fg">
  <div class="f"><label>Photo ID</label><input type="text" name="defect_${i}_photo_id" value="IMG-${String(i).padStart(3,'0')}"/></div>
  <div class="f"><label>Severity</label><select name="defect_${i}_severity" onchange="cs(this)"><option value="">&#8212;</option>${SEVERITIES.map(s=>`<option value="${s}">${s}</option>`).join('')}</select></div>
  <div class="f s2"><label>Description and Location <span class="req">*</span></label><textarea name="defect_${i}_desc" placeholder="Describe exactly what is visible and where."></textarea></div>
  <div class="f"><label>Issue Type</label><select name="defect_${i}_type"><option value="">&#8212;</option><option>Structural crack</option><option>Damp / moisture</option><option>Mould</option><option>Roof defect</option><option>Window / door defect</option><option>Electrical concern</option><option>Plumbing / drainage</option><option>Heating defect</option><option>Ventilation deficiency</option><option>Floor / ceiling defect</option><option>Render / pointing</option><option>Fire safety deficiency</option><option>Security deficiency</option><option>General deterioration</option><option>Other</option></select></div>
  <div class="f"><label>Source Type</label><select name="defect_${i}_source">${SOURCE_TYPES.map(s=>`<option value="${s}">${s}</option>`).join('')}</select></div>
  <div class="f s2"><label>Impact Tags</label><div class="tags-row">${tagHtml}</div></div></div>`;
  return div;
}

// =============================================================
// RISK
// =============================================================
function buildRiskTags(){
  const cont=document.getElementById('risk-defect-tags'),rc=document.getElementById('risk-entries-container');
  if(!cont||!rc)return;cont.innerHTML='';rc.innerHTML='';
  for(let i=1;i<=defectCount;i++){
    const label='D'+String(i).padStart(3,'0');
    cont.innerHTML+=`<input type="checkbox" class="tc" id="rdt${i}" name="risk_rel_${i}" value="${label}" onchange="toggleRiskEntry(${i},this.checked)"><label class="tl" for="rdt${i}">${label}</label>`;
    const re=document.createElement('div');re.id='risk-entry-'+i;re.className='defect-card hidden';
    re.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:.75rem;"><span class="defect-num" style="background:var(--red-bg);color:var(--red);border-color:var(--red-border);">RISK &mdash; Defect ${i}</span></div>
    <div class="fg"><div class="f s2"><label>Risk description &amp; action taken</label><textarea name="risk_${i}_desc" placeholder="Describe risk and action taken on site..."></textarea></div>
    <div class="f s2"><label>Further Action Required</label><textarea name="risk_${i}_action" placeholder="Further action needed and by whom..."></textarea></div></div>`;
    rc.appendChild(re);
  }
}
function toggleRiskEntry(i,show){document.getElementById('risk-entry-'+i)?.classList.toggle('hidden',!show);}

// =============================================================
// REVIEW
// =============================================================
function buildReview(){
  const g=n=>{const el=document.querySelector(`[name="${n}"]`);return el?el.value:'';};
  const pill=v=>{
    if(['Pass','Yes'].includes(v))return`<span class="review-pill rp-pass">${v||'\u2014'}</span>`;
    if(['Fail','No'].includes(v))return`<span class="review-pill rp-fail">${v||'\u2014'}</span>`;
    if(['Advisory','Unknown','Missing'].includes(v))return`<span class="review-pill rp-warn">${v||'\u2014'}</span>`;
    return`<span class="review-pill rp-na">${v||'\u2014'}</span>`;
  };
  const row=(k,v)=>`<div class="review-row"><span class="review-key">${k}</span><span class="review-val">${v||'\u2014'}</span></div>`;
  const photosUploaded=Object.keys(cloudinaryStore).length;
  document.getElementById('review-content').innerHTML=`
  <div class="review-section"><div class="review-sec-hd"><span class="review-sec-title">Property</span>${pill(g('tenure'))}</div>
  ${row('Address',g('address')+', '+g('postcode'))}${row('Property ID',g('property_id'))}${row('Inspector',g('inspector_name'))}
  ${row('Date',g('inspection_date'))}
  ${row('Photos',photosUploaded+' uploaded')}</div>
  <div class="review-section"><div class="review-sec-hd"><span class="review-sec-title">Safety</span></div>
  ${row('Smoke Alarms',g('smoke_alarm_count'))}${row('CO Alarms',g('co_alarm_count'))}</div>
  <div class="review-section"><div class="review-sec-hd"><span class="review-sec-title">Documents</span></div>
  ${row('EPC',`${g('epc_available')} \u2014 ${g('epc_rating')||'no rating'} \u2014 ${g('epc_date')||'no date'}`)}
  ${row('EICR',g('eicr_available'))}${row('Gas Safety',g('gas_safety_available'))}
  ${row('Contract',g('occupation_contract'))}${row('Deposit',g('deposit_protected'))}${row('RSW',g('rsw_status'))}</div>
  <div class="review-section"><div class="review-sec-hd"><span class="review-sec-title">Physical</span></div>
  ${row('Heating',g('heating_working'))}${row('Hot Water',g('hot_water_working'))}
  ${row('Damp',g('damp_signs'))}${row('Kitchen Vent',g('vent_kitchen'))}${row('Escape Routes',g('escape_routes_clear'))}</div>
  <div class="review-section"><div class="review-sec-hd"><span class="review-sec-title">Defects &amp; Risk</span>${pill(g('immediate_danger'))}</div>
  ${row('Defects logged',g('defect_count'))}${row('Immediate danger',g('immediate_danger'))}</div>`;
}

// =============================================================
// PAYLOAD + SUBMIT — account_id FIX APPLIED HERE
// =============================================================
function getPayload(){
  const g=n=>{const el=document.querySelector(`[name="${n}"]`);return el?el.value:'';};
  const gCb=n=>{const el=document.querySelector(`[name="${n}"]`);return el&&el.checked;};
  const rooms=['kitchen','bathroom','lounge','bed1','bed2','bed3','hall','stairs','loft','external','garden','other'];
  const defects=[];
  for(let i=1;i<=defectCount;i++){
    const tags=IMPACT_TAGS.filter(t=>gCb(`defect_${i}_tag_${t.replace(/ /g,'_')}`));
    const key='defect-'+i;const cldPhoto=cloudinaryStore[key];
    defects.push({issue_id:'D'+String(i).padStart(3,'0'),photo_id:g(`defect_${i}_photo_id`),description:g(`defect_${i}_desc`),issue_type:g(`defect_${i}_type`),severity:g(`defect_${i}_severity`),source_type:g(`defect_${i}_source`),impact_tags:tags,risk_linked:gCb(`risk_rel_${i}`),risk_description:g(`risk_${i}_desc`),risk_further_action:g(`risk_${i}_action`),photo_url:cldPhoto?cldPhoto.url:null,photo_public_id:cldPhoto?cldPhoto.public_id:null,ai_analysis:aiResults[key]||null});
  }
  const sc=parseInt(g('smoke_alarm_count'))||0,cc=parseInt(g('co_alarm_count'))||0;
  const smokeAlarms=[],coAlarms=[];
  for(let i=1;i<=sc;i++){const key=`smoke-alarm-${i}`;const cld=cloudinaryStore[key];smokeAlarms.push({n:i,loc:g(`smoke_alarm_${i}_loc`),tested:g(`smoke_alarm_${i}_tested`),photo_id:g(`smoke_alarm_${i}_photo_id`),photo_url:cld?cld.url:null});}
  for(let i=1;i<=cc;i++){const key=`co-alarm-${i}`;const cld=cloudinaryStore[key];coAlarms.push({n:i,loc:g(`co_alarm_${i}_loc`),tested:g(`co_alarm_${i}_tested`),photo_id:g(`co_alarm_${i}_photo_id`),photo_url:cld?cld.url:null});}
  const inspection_photo_urls=Object.entries(cloudinaryStore).map(([key,data])=>({key,url:data.url,public_id:data.public_id,format:data.format,category:key.startsWith('defect-')?'defect':(key.startsWith('smoke-')||key.startsWith('co-'))?'alarm':key}));

  // ---- ACCOUNT_ID FIX: reads from URL parameters ----
  const _urlParams=new URLSearchParams(window.location.search);
  const _accountId=_urlParams.get('account_id')||'';
  const _token=_urlParams.get('token')||'';

  return{
    _meta:{submitted_at:new Date().toISOString(),form_version:'HouseComply-V3-Wave4',pipeline_mode:g('pipeline_mode'),photos_count:inspection_photo_urls.length,account_id:_accountId,token:_token},
    property:{property_id:g('property_id'),address:g('address'),city:g('city'),county:g('county'),postcode:g('postcode'),country:g('country'),property_type:g('property_type'),tenure:g('tenure'),num_tenants:g('num_tenants'),tenancy_start:g('tenancy_start'),occupied_at_inspection:g('occupied_at_inspection'),occupant_present:g('occupant_present'),listed_status:g('listed_status'),conservation_area:g('conservation_area')},
    inspector:{name:g('inspector_name'),email:g('inspector_email'),role:g('inspector_role'),inspection_date:g('inspection_date'),inspection_time:g('inspection_time'),inspection_type:g('inspection_type')},
    compliance_context:g('compliance_context'),
    smoke_alarms:{count:sc,no_reason:g('smoke_no_reason'),no_reason_type:g('smoke_alarm_no_reason'),alarms:smokeAlarms,tested:g('smoke_alarms_tested'),working:g('smoke_alarms_working'),test_method:g('smoke_alarm_test_method')},
    co_alarms:{count:cc,no_reason:g('co_no_reason'),no_reason_specify:g('co_no_reason_specify'),alarms:coAlarms,tested:g('co_alarms_tested'),working:g('co_alarms_working'),test_method:g('co_alarm_test_method')},
    documentation:{epc:{available:g('epc_available'),status:g('epc_status'),rating:g('epc_rating'),date:g('epc_date'),photo_url:cloudinaryStore['epc']?.url||null,ai_extract:aiResults['epc']||null},eicr:{available:g('eicr_available'),status:g('eicr_status'),issue_date:g('eicr_issue_date'),expiry_date:g('eicr_expiry_date'),result:g('eicr_result'),action:g('eicr_action'),photo_url:cloudinaryStore['eicr']?.url||null,ai_extract:aiResults['eicr']||null},gas:{available:g('gas_safety_available'),status:g('gas_safety_status'),issue_date:g('gas_issue_date'),expiry_date:g('gas_expiry_date'),action:g('gas_action'),photo_url:cloudinaryStore['gas']?.url||null,ai_extract:aiResults['gas']||null},contract:{present:g('occupation_contract'),status:g('occupation_contract_status'),start_date:g('contract_start_date'),names_match:g('tenant_names_match'),no_reason:g('contract_no_reason'),actions:g('contract_actions'),photo_url:cloudinaryStore['contract']?.url||null},deposit:{taken:g('deposit_taken'),protected:g('deposit_protected'),scheme:g('deposit_scheme'),date:g('deposit_date'),reference:g('deposit_ref'),action:g('deposit_action')},rsw:{status:g('rsw_status'),compliance:g('rsw_compliance'),valid_until:g('rsw_valid_until'),no_reason:g('rsw_no_reason')}},
    physical:{heating:{type:g('heating_type'),working:g('heating_working'),working_note:g('heating_working_note'),all_rooms:g('heating_all_rooms'),controls:g('heating_controls'),issues:g('heating_issues')},water:{supply:g('water_working'),hot_tested:g('hot_water_tested'),hot_working:g('hot_water_working'),source:g('hot_water_source'),issues:g('water_issues')},damp:{signs:g('damp_signs'),signs_note:g('damp_signs_note'),type:g('damp_type'),location:g('damp_location')},ventilation:{kitchen:g('vent_kitchen'),kitchen_detail:g('vent_kitchen_detail'),bathroom:g('vent_bathroom'),bathroom_detail:g('vent_bathroom_detail'),adequate:g('vent_adequate'),extra:g('vent_bathroom_extra')}},
    rooms:{inspected:rooms.filter(r=>document.getElementById('r_'+r)?.checked),not_inspected:g('rooms_not_inspected'),not_reason:g('rooms_not_reason'),not_detail:g('rooms_not_detail'),extra:g('rooms_extra')},
    condition:{internal:g('internal_summary'),external:g('external_summary'),escape_routes:g('escape_routes_clear'),escape_routes_note:g('escape_routes_note'),escape_detail:g('escape_routes_detail')},
    structure:{age_band:g('age_band'),construction:g('construction_type'),roof:g('roof_type'),ext_wall:g('ext_wall_condition'),ext_wall_detail:g('ext_wall_detail'),windows:g('window_condition'),window_detail:g('window_detail'),gutters:g('gutters_condition'),gutters_detail:g('gutters_detail'),wall_insulation:g('wall_insulation'),insulation_detail:g('insulation_mixed_detail')},
    energy:{windows:g('window_type'),loft:g('loft_insulation'),lighting:g('lighting_type'),draught:g('draught_issues'),upgrade_notes:g('upgrade_notes')},
    access:{full:g('full_access'),restricted_reason:g('access_restricted_reason'),restricted_detail:g('access_restricted_detail'),items_not_checked:g('items_not_checked'),items_not_checked_reason:g('items_not_checked_reason'),items_detail:g('items_not_checked_detail')},
    defects,
    immediate_risk:{danger:g('immediate_danger'),danger_note:g('immediate_danger_note'),danger_justification:g('immediate_danger_justification')},
    sign_off:{declaration_confirmed:document.getElementById('decl-confirm')?.checked,name:g('declaration_name'),date:g('declaration_date'),signature:g('signature_typed'),compliance_position:g('compliance_position'),audit_readiness:g('audit_readiness')},
    inspection_photo_urls
  };
}

async function submitForm(){
  const errs=validateStep(12);if(errs.length>0){showErrors(12,errs);return;}
  if(Object.keys(cloudinaryStore).length===0){showErrors(12,[{field:'declaration_name',label:'At least 1 photo must be uploaded before submitting.'}]);return;}
  const btn=document.getElementById('btn-next');btn.textContent='Submitting\u2026';btn.disabled=true;
  let bodyStr;
  try{bodyStr=JSON.stringify(getPayload());}catch(e){console.error('Payload error:',e);btn.textContent='Submit';btn.disabled=false;showErrors(12,[{field:'declaration_name',label:'Could not build submission \u2014 '+e.message}]);return;}
  console.log('[HouseComply] Submitting | Size:',Math.round(bodyStr.length/1024)+'KB | Photos:',Object.keys(cloudinaryStore).length);
  try{
    await fetch(HC.s,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:bodyStr});
    console.log('[HouseComply] Submitted successfully');
    clearDraft();showSuccess();
  }catch(e){
    console.error('[HouseComply] Submit failed:',e);btn.textContent='Submit';btn.disabled=false;
    showErrors(12,[{field:'declaration_name',label:'Network error \u2014 '+e.message}]);
  }
}

function showSuccess(){
  const _acct=new URLSearchParams(window.location.search).get('account_id')||'';
  setTimeout(()=>{window.location.href='https://www.housecomply.co.uk/inspection/waiting?account_id='+_acct;},500);
  const photoCount=Object.keys(cloudinaryStore).length;
  document.getElementById('pane-12').innerHTML=`<div style="text-align:center;padding:2.5rem 1rem;">
  <div style="width:64px;height:64px;background:var(--teal-bg);border:2px solid var(--teal);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="2.5"><path d="M5 12l5 5L19 7"/></svg></div>
  <div style="font-size:20px;font-weight:600;color:var(--navy);margin-bottom:.5rem;">Inspection Submitted</div>
  <div style="font-size:13px;color:var(--text-muted);line-height:1.6;margin-bottom:1.5rem;">${photoCount} photo${photoCount!==1?'s':''} stored securely. Record submitted.</div>
  <div style="background:var(--surface-alt);border:1px solid var(--border);border-radius:var(--r);padding:.85rem;text-align:left;font-size:12px;color:var(--text-muted);">
  <strong style="color:var(--navy);display:block;margin-bottom:.4rem;">Reference</strong>HC-${Date.now().toString(36).toUpperCase()}</div></div>`;
  document.getElementById('btn-next').style.display='none';document.getElementById('btn-back').style.display='none';
}

// =============================================================
// HELPERS
// =============================================================
function cs(sel){sel.classList.remove('sp','sf','sa','sm');const v=sel.value;if(['Pass','Yes'].includes(v))sel.classList.add('sp');else if(['Fail','No'].includes(v))sel.classList.add('sf');else if(['Advisory'].includes(v))sel.classList.add('sa');else if(['Missing','Unknown'].includes(v))sel.classList.add('sm');}
function checkDangerJustification(){const er=document.querySelector('[name="escape_routes_clear"]')?.value;const id=document.querySelector('[name="immediate_danger"]')?.value;const show=er==='Fail'&&id==='Pass';const section=document.getElementById('danger-justification-section');if(section)section.classList.toggle('hidden',!show);}
function autoCalcGasExpiry(){const issue=document.getElementById('gas_issue_date');const expiry=document.getElementById('gas_expiry_date');const tag=document.getElementById('gas-expiry-auto-tag');if(!issue||!expiry||!issue.value)return;const d=new Date(issue.value);d.setFullYear(d.getFullYear()+1);expiry.value=d.toISOString().split('T')[0];if(tag)tag.style.display='inline';saveDraft();}
function showBlock(id,val,showVal){const el=document.getElementById(id);if(!el)return;el.classList.toggle('hidden',val!==showVal);}
function showBlockMulti(id,val,showVals){const el=document.getElementById(id);if(!el)return;el.classList.toggle('hidden',!showVals.includes(val));}
function toggleCL(item){item.classList.toggle('checked');checkOnsiteComplete(item.closest('.onsite'));}
function checkOnsiteComplete(p){if(!p)return;p.classList.toggle('all-done',[...p.querySelectorAll('.cl-item')].every(i=>i.classList.contains('checked')));}
function autoTick(fname){document.querySelectorAll(`.cl-item[data-field="${fname}"]`).forEach(item=>{const el=document.querySelector(`[name="${fname}"]`);if(el&&el.value&&el.value.trim()){item.classList.add('checked');checkOnsiteComplete(item.closest('.onsite'));}});}

// =============================================================
// DRAFT SAVE / RESTORE
// =============================================================
function saveDraft(){
  try{
    const fields={};
    document.querySelectorAll('input[name],select[name],textarea[name]').forEach(el=>{if(el.type==='checkbox')fields[el.name]=el.checked;else fields[el.name]=el.value;});
    localStorage.setItem('hc_draft',JSON.stringify({fields,step:cur,ts:new Date().toISOString(),defectCount,cloudinaryStore}));
  }catch(e){}
}
function checkDraft(){
  try{const raw=localStorage.getItem('hc_draft');if(!raw)return;const d=JSON.parse(raw);if(!d.fields)return;const age=Math.round((Date.now()-new Date(d.ts).getTime())/60000);document.getElementById('draft-banner-text').textContent=`Incomplete inspection from ${age<60?age+' minutes ago':Math.round(age/60)+' hours ago'}. Continue?`;document.getElementById('draft-banner').style.display='block';}catch(e){}
}
function restoreDraft(){
  try{
    const raw=localStorage.getItem('hc_draft');if(!raw)return;const d=JSON.parse(raw);
    Object.entries(d.fields||{}).forEach(([name,val])=>{document.querySelectorAll(`[name="${name}"]`).forEach(el=>{if(el.type==='checkbox')el.checked=val;else el.value=val;if(el.tagName==='SELECT')cs(el);});});
    if(d.defectCount){setDefects(d.defectCount);}
    if(d.cloudinaryStore){Object.assign(cloudinaryStore,d.cloudinaryStore);Object.keys(cloudinaryStore).forEach(key=>updatePhotoZoneUI(key));}
    document.getElementById('draft-banner').style.display='none';
    if(d.step>0)renderStep(d.step);
  }catch(e){}
}
function discardDraft(){clearDraft();document.getElementById('draft-banner').style.display='none';}
function clearDraft(){try{localStorage.removeItem('hc_draft');}catch(e){}}
