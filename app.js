// ตั้งค่า URL Web App ใน config.js (ไม่ใส่ token หรือรหัสผ่านใน URL)
const state = {page:'dashboard',persons:[],dashboard:null,selectedPerson:null};
let sessionToken='', bridgeReady=false, bridgeReadyOrigin='', seq=0;
const pending=new Map();
const bridge=document.createElement('iframe');bridge.style.display='none';bridge.title='API bridge';
function bridgeOrigin(){return new URL(window.GAS_WEB_APP_URL).origin;}
function trustedBridgeMessage(e){return e.source===bridge.contentWindow && (e.origin===bridgeOrigin() || /^https:\/\/[a-z0-9-]+\.script\.googleusercontent\.com$/i.test(e.origin));}
let bridgeTimer=null, bridgeStartedAt=0;
function bridgeError(message){const el=document.getElementById('loginError');if(el&&!bridgeReady)el.textContent=message;}
function sendBridgePing(){
  if(bridgeReady||!bridge.contentWindow)return;
  try{bridge.contentWindow.postMessage({type:'lomrak-ping'},'*');}catch(e){}
  if(Date.now()-bridgeStartedAt>12000)bridgeError('ไม่สามารถเชื่อมต่อ Apps Script ได้: ตรวจสอบว่าอัปเดต Bridge.html และ Deploy เวอร์ชันใหม่แล้ว รวมถึงตรวจสอบการบล็อก iframe ในเบราว์เซอร์');
}
function startBridge(){
  if(!window.GAS_WEB_APP_URL||!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(window.GAS_WEB_APP_URL)){
    bridgeError('กรุณาตั้งค่า GAS_WEB_APP_URL ใน config.js ให้เป็น URL /exec');return;
  }
  bridgeStartedAt=Date.now();
  bridge.addEventListener('load',sendBridgePing);
  bridge.addEventListener('error',()=>bridgeError('ไม่สามารถโหลด Google Apps Script iframe ได้'));
  bridge.src=window.GAS_WEB_APP_URL+'?page=bridge';
  document.body.appendChild(bridge);
  sendBridgePing();
  bridgeTimer=setInterval(sendBridgePing,1500);
}
window.addEventListener('message',e=>{
  if(!window.GAS_WEB_APP_URL||!trustedBridgeMessage(e))return;
  const d=e.data||{};
  if(d.type==='lomrak-ready'){
    bridgeReady=true;bridgeReadyOrigin=e.origin;
    if(bridgeTimer){clearInterval(bridgeTimer);bridgeTimer=null;}
    const el=document.getElementById('loginError');if(el)el.textContent='';
  }
  if(d.type==='lomrak-response'){
    const p=pending.get(d.id);if(!p)return;
    pending.delete(d.id);clearTimeout(p.timer);
    d.result?.ok?p.resolve(d.result):p.reject(new Error(d.result?.error||'API error'));
  }
});
function rpc(action,data={},params={}){
  return new Promise((resolve,reject)=>{
    if(!bridgeReady){sendBridgePing();return reject(Error('ยังเชื่อมต่อกับ Apps Script ไม่สำเร็จ กรุณาตรวจสอบ Deployment และ Bridge.html'));}
    const id=++seq;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('API timeout: Google Apps Script ไม่ตอบกลับภายใน 30 วินาที'));},30000);
    pending.set(id,{resolve,reject,timer});
    bridge.contentWindow.postMessage({type:'lomrak-request',id,request:{action,data,params,token:sessionToken}},bridgeReadyOrigin);
  });
}
function apiGet(action,params={}){return rpc(action,{},params);}
function apiPost(action,data){return rpc(action,data);}
async function login(e){e.preventDefault();const form=e.target;const error=document.getElementById('loginError');error.textContent='กำลังตรวจสอบ...';try{const r=await rpc('login',{email:form.email.value,password:form.password.value});sessionToken=r.token;form.password.value='';document.getElementById('loginScreen').classList.add('hidden');document.getElementById('app').classList.remove('hidden');document.getElementById('currentUser').textContent=r.data.name+' ('+r.data.role+')';renderPage();}catch(ex){error.textContent=ex.message;}}
async function logout(){try{await rpc('logout');}catch(e){}sessionToken='';state.persons=[];state.dashboard=null;document.getElementById('app').classList.add('hidden');document.getElementById('loginScreen').classList.remove('hidden');}
document.querySelectorAll('.nav').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));btn.classList.add('active');state.page=btn.dataset.page;renderPage();}));
async function uploadPersonFile(personId,file,category,description){if(file.size>8*1024*1024)throw Error('ไฟล์ใหญ่เกิน 8 MB');const b=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file)});return apiPost('uploadFile',{person_id:personId,file_name:file.name,mime_type:file.type,base64:b,category,description});}
async function refreshPersonFiles(id){const box=document.getElementById('personFiles');if(!box)return;try{const r=await apiGet('files',{person_id:id});box.innerHTML=(r.data||[]).map(f=>`<div class="card" style="margin:8px 0"><b>📎 ${esc(f.file_name)}</b><br><small>${esc(f.category||'อื่น ๆ')}</small> <button type="button" class="btn" data-file-id="${esc(f.file_id)}" onclick="downloadPersonFile(this.dataset.fileId,this)">⬇ ดาวน์โหลด</button></div>`).join('')||'<div class="empty">ยังไม่มีไฟล์แนบ</div>';}catch(e){box.textContent='โหลดไฟล์ไม่สำเร็จ';}}
async function submitPersonFile(e,id){e.preventDefault();const f=e.target.file.files[0];if(!f)return alert('กรุณาเลือกไฟล์');try{await uploadPersonFile(id,f,e.target.category.value,e.target.description.value);e.target.reset();await refreshPersonFiles(id);alert('อัปโหลดเรียบร้อย');}catch(x){alert(x.message);}}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function riskBadge(r){
  const x=String(r||'').toLowerCase();
  const cls=(x==='สูง'||x==='high')?'high':(x==='ปานกลาง'||x==='medium')?'medium':(x==='ต่ำ'||x==='low')?'low':'gray';
  return `<span class="badge ${cls}">${esc(r||'ยังไม่ประเมิน')}</span>`;
}
function moneyDate(v){if(!v)return '-';const d=new Date(v);return isNaN(d)?esc(v):d.toLocaleDateString('th-TH');}

async function loadDashboard(){
  try{
    const r=await apiGet('dashboard'); state.dashboard=r.data;
    if(state.page==='dashboard') renderDashboard();
  }catch(e){showError(e)}
}

async function loadPersons(){
  try{state.persons=(await apiGet('persons')).data||[];renderPersons();}
  catch(e){showError(e)}
}

function renderPage(){
  const titles={dashboard:'ภาพรวมระบบ',persons:'ผู้รับการติดตาม',followup:'แผนการติดตาม 12 เดือน',risk:'ประเมินความเสี่ยง',visits:'เยี่ยมบ้านและติดตาม',points:'คะแนนล้อมรักษ์',reports:'รายงานและสถิติ'};
  document.getElementById('pageTitle').textContent=titles[state.page]||'ระบบล้อมรักษ์';
  if(state.page==='dashboard')loadDashboard();
  else if(state.page==='persons')loadPersons();
  else if(state.page==='risk')renderRisk();
  else if(state.page==='followup')renderFollowup();
  else if(state.page==='visits')renderVisits();
  else if(state.page==='points')renderPoints();
  else renderReports();
}

function renderDashboard(){
  const d=state.dashboard||{counts:{total:0,low:0,medium:0,high:0},ranking:[]};
  const c=d.counts;
  document.getElementById('content').innerHTML=`
    <div class="hero"><h2>ล้อมรักษ์ บ้านนาสาร</h2><p>ระบบติดตาม ดูแล และฟื้นฟูผู้ผ่านการบำบัดยาเสพติด — ดูแลทุกก้าว สร้างโอกาสทุกคน</p></div>
    <div class="grid cards">
      <div class="card stat"><div class="label">ผู้รับการติดตามทั้งหมด</div><div class="num">${c.total||0}</div></div>
      <div class="card stat low"><div class="label">ความเสี่ยงต่ำ</div><div class="num">${c.low||0}</div></div>
      <div class="card stat med"><div class="label">ความเสี่ยงปานกลาง</div><div class="num">${c.medium||0}</div></div>
      <div class="card stat high"><div class="label">ความเสี่ยงสูง</div><div class="num">${c.high||0}</div></div>
      <div class="card stat"><div class="label">การเยี่ยม/ติดตาม</div><div class="num">${d.visits||0}</div></div>
    </div>
    <div class="grid" style="grid-template-columns:1.5fr 1fr">
      <div class="section"><div class="section-head"><h2>ผู้ที่ต้องติดตามใกล้ชิด</h2><button class="btn secondary" onclick="state.page='persons';renderPage()">ดูทั้งหมด</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>ระดับความเสี่ยง</th><th>สถานะ</th></tr></thead><tbody>
        ${(state.persons.filter(p=>['สูง','high'].includes(String(p.risk_level).toLowerCase())).slice(0,5).map(p=>`<tr><td>${esc(p.person_id)}</td><td>${esc(p.first_name)} ${esc(p.last_name)}</td><td>${riskBadge(p.risk_level)}</td><td>${esc(p.case_status||'ติดตาม')}</td></tr>`).join(''))||'<tr><td colspan="4" class="empty">ยังไม่มีข้อมูล</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="section"><div class="section-head"><h2>อันดับคะแนนล้อมรักษ์</h2></div><div class="card">
        ${(d.ranking||[]).map((x,i)=>`<div class="rank"><div class="rank-num">${i+1}</div><div>${esc(x.name||'-')}</div><b>${Number(x.points||0)} แต้ม</b></div>`).join('')||'<div class="empty">ยังไม่มีคะแนน</div>'}
      </div></div>
    </div>`;
  // Load persons in background for dashboard list.
  apiGet('persons').then(r=>{state.persons=r.data||[]; if(state.page==='dashboard')renderDashboard();}).catch(()=>{});
}

function renderPersons(){
  document.getElementById('content').innerHTML=`
    <div class="section-head"><h2>ทะเบียนผู้รับการติดตาม</h2><button class="btn" onclick="openPersonForm()">+ เพิ่มผู้รับการติดตาม</button></div>
    <div class="toolbar"><input id="personSearch" class="input search" placeholder="ค้นหาชื่อ / รหัส / ตำบล" oninput="filterPersons()"></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>ตำบล</th><th>อาชีพ</th><th>ความเสี่ยง</th><th>สถานะ</th><th></th></tr></thead>
    <tbody id="personRows"></tbody></table></div>`;
  drawPersonRows(state.persons);
}
function drawPersonRows(rows){
  document.getElementById('personRows').innerHTML=rows.map(p=>`<tr>
    <td>${esc(p.person_id)}</td><td>${esc(p.prefix)}${esc(p.first_name)} ${esc(p.last_name)}</td><td>${esc(p.subdistrict)}</td><td>${esc(p.occupation)}</td><td>${riskBadge(p.risk_level)}</td><td>${esc(p.case_status||'ติดตาม')}</td>
    <td><button class="btn secondary" onclick="viewPerson('${esc(p.person_id)}')">เปิดแฟ้ม</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">ยังไม่มีข้อมูล</td></tr>';
}
function filterPersons(){
  const q=document.getElementById('personSearch').value.toLowerCase();
  drawPersonRows(state.persons.filter(p=>JSON.stringify(p).toLowerCase().includes(q)));
}

function openPersonForm(){
  openModal('เพิ่มผู้รับการติดตาม',`<form onsubmit="savePerson(event)">
  <div class="form-grid">
    <div class="field"><label>คำนำหน้า</label><input class="input" name="prefix"></div>
    <div class="field"><label>ชื่อ</label><input class="input" name="first_name" required></div>
    <div class="field"><label>นามสกุล</label><input class="input" name="last_name" required></div>
    <div class="field"><label>เลขบัตรประชาชน (แนะนำให้เก็บแบบ Masked)</label><input class="input" name="national_id_masked" placeholder="*************1234"></div>
    <div class="field"><label>เบอร์โทร</label><input class="input" name="phone"></div>
    <div class="field"><label>ตำบล</label><input class="input" name="subdistrict"></div>
    <div class="field"><label>หมู่บ้าน</label><input class="input" name="village"></div>
    <div class="field"><label>อาชีพ</label><input class="input" name="occupation"></div>
    <div class="field"><label>หน่วยบำบัด/สถานพยาบาล</label><input class="input" name="treatment_unit"></div>
    <div class="field"><label>วันสิ้นสุดการบำบัด</label><input type="date" class="input" name="treatment_end_date"></div>
    <div class="field"><label>ผู้รับผิดชอบ</label><input class="input" name="assigned_officer"></div>
    <div class="field"><label>สถานะ</label><select class="select" name="case_status"><option>ติดตาม</option><option>ครบกำหนด</option><option>ส่งต่อ</option><option>ปิดเคส</option></select></div>
    <div class="field full"><label>หมายเหตุ</label><textarea class="textarea" name="notes"></textarea></div>
  </div>
  <div class="actions"><button type="button" class="btn secondary" onclick="closeModal()">ยกเลิก</button><button class="btn">บันทึก</button></div>
  </form>`);
}
async function savePerson(e){
  e.preventDefault(); const f=new FormData(e.target); const data=Object.fromEntries(f.entries());
  try{await apiPost('createPerson',data);closeModal();await loadPersons();alert('บันทึกข้อมูลเรียบร้อย');}
  catch(err){alert(err.message)}
}
async function viewPerson(id){
  try{
    const r=await apiGet('person',{person_id:id});state.selectedPerson=r.data;
    const p=r.data;
    openModal('แฟ้มติดตาม '+p.person_id,`
      <div class="grid cards" style="grid-template-columns:repeat(3,1fr)">
        <div class="card"><small>ชื่อ</small><b>${esc(p.prefix)}${esc(p.first_name)} ${esc(p.last_name)}</b></div>
        <div class="card"><small>ความเสี่ยง</small><div>${riskBadge(p.risk_level)}</div></div>
        <div class="card"><small>คะแนนล้อมรักษ์</small><b>${Number(p.total_points||0)} แต้ม</b></div>
      </div>
      <div class="section"><h3>ข้อมูลพื้นที่</h3><p>ตำบล ${esc(p.subdistrict||'-')} • หมู่บ้าน ${esc(p.village||'-')} • อาชีพ ${esc(p.occupation||'-')}</p></div>
      <div class="section"><h3>ประวัติการติดตาม</h3>${(p.visits||[]).map(v=>`<div class="card" style="margin:8px 0"><b>${moneyDate(v.visit_date)}</b> — ${riskBadge(v.risk_level)}<br>${esc(v.findings||'-')}</div>`).join('')||'<div class="empty">ยังไม่มีข้อมูล</div>'}</div>
      <div class="actions"><button class="btn" onclick="closeModal();openVisitForm('${esc(p.person_id)}')">+ บันทึกเยี่ยมบ้าน</button></div>`);
  }catch(e){alert(e.message)}
}

function personOptions(){
  return state.persons.map(p=>`<option value="${esc(p.person_id)}">${esc(p.first_name)} ${esc(p.last_name)} (${esc(p.person_id)})</option>`).join('');
}
function renderRisk(){
  apiGet('persons').then(r=>{state.persons=r.data||[];document.getElementById('content').innerHTML=`
    <div class="card"><h2>แบบประเมินความเสี่ยง</h2><p>ตัวอย่างระบบให้คะแนน 0–2 ต่อข้อ และจัดระดับ ต่ำ / ปานกลาง / สูง โดยควรปรับรายการคำถามตามแบบประเมินที่หน่วยงานรับรอง</p>
    <button class="btn" onclick="openRiskForm()">เริ่มประเมิน</button></div>`;}).catch(showError);
}
function openRiskForm(){
  openModal('ประเมินความเสี่ยง',`<form onsubmit="saveRisk(event)">
    <div class="field"><label>ผู้รับการติดตาม</label><select class="select" name="person_id" required>${personOptions()}</select></div>
    <div class="form-grid" style="margin-top:14px">
      ${['การกลับไปใช้สารเสพติด','ความสัมพันธ์ในครอบครัว','การมีงาน/รายได้','สุขภาพกายและใจ','เพื่อน/สังคมเสี่ยง','การปฏิบัติตามแผนติดตาม','การดื่มสุรา/พฤติกรรมเสี่ยง','ที่อยู่อาศัย/สิ่งแวดล้อม','แรงจูงใจในการเปลี่ยนแปลง','การเข้าถึงบริการ'].map((q,i)=>`<div class="field"><label>${i+1}. ${q}</label><select class="select risk-item" data-q="${i}" required><option value="0">0 — ไม่มี/ปกติ</option><option value="1">1 — เฝ้าระวัง</option><option value="2">2 — มีความเสี่ยง</option></select></div>`).join('')}
    </div>
    <div class="field" style="margin-top:14px"><label>แผนการช่วยเหลือ</label><textarea class="textarea" name="action_plan"></textarea></div>
    <div class="actions"><button type="button" class="btn secondary" onclick="closeModal()">ยกเลิก</button><button class="btn">บันทึกผล</button></div>
  </form>`);
}
async function saveRisk(e){
  e.preventDefault();const f=new FormData(e.target), items=[...document.querySelectorAll('.risk-item')].map(x=>Number(x.value));
  const score=items.reduce((a,b)=>a+b,0);const risk=score<=6?'ต่ำ':score<=13?'ปานกลาง':'สูง';
  const data=Object.fromEntries(f.entries());data.score=score;data.risk_level=risk;data.category='ภาพรวม';data.items_json=JSON.stringify(items);data.assessor='ผู้ประเมิน';
  try{await apiPost('saveRisk',data);closeModal();alert(`บันทึกแล้ว คะแนน ${score}/20 ระดับ ${risk}`);renderRisk();}catch(err){alert(err.message)}
}

function renderFollowup(){document.getElementById('content').innerHTML=`
  <div class="hero"><h2>แผนการติดตาม 12 เดือน</h2><p>ออกแบบให้เจ้าหน้าที่เห็นภารกิจแต่ละเดือนและสถานะการติดตามอย่างต่อเนื่อง</p></div>
  <div class="card"><h3>แนวทางการติดตาม</h3><ol><li>เดือน 1–3: ติดตามใกล้ชิดและประเมินความเสี่ยง</li><li>เดือน 4–6: เสริมอาชีพ/ครอบครัว/สุขภาพ</li><li>เดือน 7–9: สร้างการมีส่วนร่วมกับชุมชน</li><li>เดือน 10–12: ประเมินความพร้อมและสรุปผล</li></ol></div>
  <div class="section"><button class="btn" onclick="openFollowupForm()">+ บันทึกแผนติดตาม</button></div>`;}
function openFollowupForm(){
  openModal('บันทึกแผนติดตาม',`<form onsubmit="saveFollowup(event)"><div class="form-grid">
  <div class="field"><label>ผู้รับการติดตาม</label><select class="select" name="person_id" required>${personOptions()}</select></div>
  <div class="field"><label>เดือนที่</label><select class="select" name="month_no">${Array.from({length:12},(_,i)=>`<option>${i+1}</option>`).join('')}</select></div>
  <div class="field"><label>กำหนดวันที่</label><input class="input" type="date" name="due_date"></div>
  <div class="field"><label>วิธีติดตาม</label><select class="select" name="method"><option>เยี่ยมบ้าน</option><option>โทรศัพท์</option><option>พบที่หน่วยบริการ</option><option>ประสานชุมชน</option></select></div>
  <div class="field full"><label>ผล/แผนการดำเนินงาน</label><textarea class="textarea" name="result"></textarea></div></div>
  <div class="actions"><button type="button" class="btn secondary" onclick="closeModal()">ยกเลิก</button><button class="btn">บันทึก</button></div></form>`);
}
async function saveFollowup(e){e.preventDefault();const data=Object.fromEntries(new FormData(e.target).entries());data.status='กำหนดการ';data.officer='ผู้รับผิดชอบ';try{await apiPost('saveFollowUp',data);closeModal();alert('บันทึกแล้ว')}catch(err){alert(err.message)}}

function renderVisits(){document.getElementById('content').innerHTML=`
  <div class="section-head"><h2>เยี่ยมบ้านและติดตาม</h2><button class="btn" onclick="openVisitForm()">+ บันทึกการเยี่ยมบ้าน</button></div>
  <div class="card"><p>แบบฟอร์มนี้รองรับการบันทึกวันเยี่ยม ระดับความเสี่ยง ประเด็นที่พบ แผนช่วยเหลือ และนัดหมายครั้งถัดไป</p></div>`;}
function openVisitForm(personId=''){
  if(!state.persons.length) apiGet('persons').then(r=>{state.persons=r.data||[];openVisitForm(personId)}); else openModal('บันทึกเยี่ยมบ้าน',`<form onsubmit="saveVisit(event)"><div class="form-grid">
  <div class="field"><label>ผู้รับการติดตาม</label><select class="select" name="person_id" required>${personOptions()}</select></div>
  <div class="field"><label>วันที่เยี่ยม</label><input class="input" type="date" name="visit_date" required></div>
  <div class="field"><label>ระดับความเสี่ยง</label><select class="select" name="risk_level"><option>ต่ำ</option><option>ปานกลาง</option><option>สูง</option></select></div>
  <div class="field"><label>ประเภท</label><select class="select" name="visit_type"><option>เยี่ยมบ้าน</option><option>โทรติดตาม</option><option>ติดตามที่หน่วยบริการ</option></select></div>
  <div class="field full"><label>ประเด็นที่พบ</label><textarea class="textarea" name="findings"></textarea></div>
  <div class="field full"><label>แผนช่วยเหลือ/การประสานงาน</label><textarea class="textarea" name="action_plan"></textarea></div>
  <div class="field"><label>นัดครั้งถัดไป</label><input class="input" type="date" name="next_visit"></div>
  </div><div class="actions"><button type="button" class="btn secondary" onclick="closeModal()">ยกเลิก</button><button class="btn">บันทึก</button></div></form>`);
}
async function saveVisit(e){e.preventDefault();const data=Object.fromEntries(new FormData(e.target).entries());data.officer='ผู้รับผิดชอบ';try{await apiPost('saveVisit',data);closeModal();alert('บันทึกการติดตามแล้ว')}catch(err){alert(err.message)}}

function renderPoints(){document.getElementById('content').innerHTML=`
  <div class="hero"><h2>⭐ คะแนนล้อมรักษ์</h2><p>เปลี่ยนความก้าวหน้าเล็ก ๆ ให้เป็นกำลังใจและโอกาส</p></div>
  <div class="grid" style="grid-template-columns:repeat(3,1fr)">
    ${[['การติดตาม','มาตามนัด/ร่วมกิจกรรม'],['อาชีพ','มีงาน/ฝึกอาชีพ'],['จิตอาสา','ช่วยเหลือชุมชน'],['สุขภาพ','ดูแลสุขภาพ'],['ครอบครัว','สร้างความสัมพันธ์ที่ดี'],['การศึกษา','เรียนรู้/พัฒนาทักษะ']].map(x=>`<div class="card"><b>${x[0]}</b><p>${x[1]}</p></div>`).join('')}
  </div><div class="section"><button class="btn" onclick="openPointForm()">+ ให้คะแนน</button></div>`;}
function openPointForm(){openModal('เพิ่มคะแนนล้อมรักษ์',`<form onsubmit="savePoint(event)"><div class="form-grid">
  <div class="field"><label>ผู้รับการติดตาม</label><select class="select" name="person_id" required>${personOptions()}</select></div>
  <div class="field"><label>หมวดคะแนน</label><select class="select" name="category"><option>การติดตาม</option><option>อาชีพ</option><option>จิตอาสา</option><option>สุขภาพ</option><option>ครอบครัว</option><option>การศึกษา</option></select></div>
  <div class="field"><label>คะแนน</label><input class="input" type="number" name="points" min="-100" max="100" required></div>
  <div class="field full"><label>รายละเอียด</label><textarea class="textarea" name="description"></textarea></div></div>
  <div class="actions"><button type="button" class="btn secondary" onclick="closeModal()">ยกเลิก</button><button class="btn">บันทึกคะแนน</button></div></form>`);}
async function savePoint(e){e.preventDefault();const data=Object.fromEntries(new FormData(e.target).entries());try{await apiPost('addPoint',data);closeModal();alert('เพิ่มคะแนนแล้ว')}catch(err){alert(err.message)}}

function renderReports(){document.getElementById('content').innerHTML=`
  <div class="grid" style="grid-template-columns:repeat(3,1fr)">
    <div class="card"><h3>รายงานผู้รับการติดตาม</h3><p>จำนวนทั้งหมด / สถานะ / ระดับความเสี่ยง</p></div>
    <div class="card"><h3>รายงานการติดตาม</h3><p>เยี่ยมบ้าน / โทร / นัดหมาย / ค้างติดตาม</p></div>
    <div class="card"><h3>รายงานคะแนน</h3><p>อันดับและความก้าวหน้ารายเดือน</p></div>
  </div>
  <div class="section card"><h3>แนวทางต่อยอด</h3><p>เพิ่มตัวกรองรายเดือน ตำบล หน่วยงาน และผู้รับผิดชอบ รวมถึงส่งออก Excel/PDF จากฝั่ง Apps Script ในระยะถัดไป</p></div>`;}

function openModal(title,body){document.getElementById('modalTitle').textContent=title;document.getElementById('modalBody').innerHTML=body;document.getElementById('modal').classList.remove('hidden')}
function closeModal(){document.getElementById('modal').classList.add('hidden')}
function showError(e){document.getElementById('content').innerHTML=`<div class="card"><h2>เชื่อมต่อข้อมูลไม่ได้</h2><p>${esc(e.message)}</p><p>ตรวจสอบ API_URL และการ Deploy Google Apps Script Web App</p></div>`}

renderPage();
async function openAssignmentManager(){
 try{
  const [users,persons,assigns]=await Promise.all([apiGet('users'),apiGet('persons'),apiGet('assignments')]);
  const options=(users.data||[]).filter(x=>x.role==='officer').map(x=>`<option value="${esc(x.email)}">${esc(x.name||x.email)}</option>`).join('');
  const cases=(persons.data||[]).map(x=>`<option value="${esc(x.person_id)}">${esc(x.first_name)} ${esc(x.last_name)} (${esc(x.person_id)})</option>`).join('');
  openModal('จับคู่ผู้รับผิดชอบ',`<form onsubmit="submitAssignment(event)"><label>ผู้ถูกติดตาม<select name="person_id" required>${cases}</select></label><label>เจ้าหน้าที่<select name="officer_email" required>${options}</select></label><button class="btn" type="submit">บันทึกการมอบหมาย</button></form><h3>รายการที่มอบหมาย</h3>${(assigns.data||[]).filter(x=>String(x.active).toLowerCase()==='true').map(x=>`<div>${esc(x.person_id)} — ${esc(x.officer_email)}</div>`).join('')}`);
 }catch(e){alert(e.message)}
}
async function submitAssignment(e){e.preventDefault();try{await apiPost('assign',Object.fromEntries(new FormData(e.target).entries()));closeModal();alert('มอบหมายแล้ว');}catch(err){alert(err.message);}}


// Each chunk is authorized on the Apps Script backend; no Drive sharing is needed.
async function downloadPersonFile(fileId,button){
  if(!sessionToken){alert('กรุณาเข้าสู่ระบบ');return;}
  const old=button?.textContent;
  if(button){button.disabled=true;button.textContent='กำลังดาวน์โหลด…';}
  try{
    let offset=0,parts=[],metadata=null;
    do{
      const r=await rpc('downloadFile',{file_id:fileId,offset});
      const d=r.data;
      if(!d||d.file_id!==fileId||d.offset!==offset||d.next_offset<=offset)throw Error('ข้อมูลดาวน์โหลดไม่ถูกต้อง');
      if(metadata&&(d.size!==metadata.size||d.file_name!==metadata.file_name))throw Error('ข้อมูลไฟล์เปลี่ยนระหว่างดาวน์โหลด');
      metadata=d;
      const raw=atob(d.base64),bytes=new Uint8Array(raw.length);
      for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      parts.push(bytes);offset=d.next_offset;
      if(offset>8*1024*1024)throw Error('ไฟล์ใหญ่เกินขนาดที่อนุญาต');
      if(d.done)break;
    }while(true);
    if(offset!==metadata.size)throw Error('ดาวน์โหลดไม่ครบ');
    const blob=new Blob(parts,{type:metadata.mime_type||'application/octet-stream'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=metadata.file_name||'document';document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(e){alert('ดาวน์โหลดไม่สำเร็จ: '+e.message);}
  finally{if(button){button.disabled=false;button.textContent=old;}}
}
