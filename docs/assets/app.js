// ============ CONFIG ============
// Use o "raw" do seu repositório público:
const FILES_BASE = "https://raw.githubusercontent.com/<SEU_USUARIO>/<SEU_REPO>/main"; // << EDITAR
// Caminhos de dados e CNDs (sem meses)
const ENC_TXT_PATH = `${FILES_BASE}/data/cnds.txt.enc`;
const BASE_CND_POSITIVA = `${FILES_BASE}/CND/- PENDENCIAS/`; // nome + .pdf ou .jpg
const BASE_CND_NEGATIVA = `${FILES_BASE}/CND/`;              // nome + .pdf

// Atualização automática (ms)
const POLL_MS = 15000;

// ============ STATE ============
const state = { rows: [], sort:{key:'nome',dir:'asc'}, search:'', status:'', timer:null, auto:true, lastPath:ENC_TXT_PATH, password:null };

const $ = (id)=>document.getElementById(id);

function normalizeText(s){ return (s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim(); }
function cleanDigits(v){ return (v||'').replace(/\D+/g,''); }
function escapeHtml(str){ return (str||'').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function isCNPJ(v){ const d=cleanDigits(v); return d.length===14; }
function formatCNPJ(v){ const d=cleanDigits(v); if (d.length!==14) return v||''; return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'); }

const SIT_MAP = {
  positiva:['positiva','regular','nada consta','sem debito','sem debitos','sem débitos','liberada','ok'],
  negativa:['negativa','irregular','com debito','com debitos','com débitos','pendente','vencida','bloqueada']
};

function isSituacao(v){ if (!v) return false; const s=normalizeText(v); return [...SIT_MAP.positiva,...SIT_MAP.negativa].some(w=>s.includes(w)); }
function normalizeSituacao(v){
  const s = normalizeText(v);
  if (!s) return {status:'desconhecida', label:'—'};
  for (const w of SIT_MAP.positiva){ if (s.includes(w)) return {status:'positiva', label:'Positiva'}; }
  for (const w of SIT_MAP.negativa){ if (s.includes(w)) return {status:'negativa', label:'Negativa'}; }
  return {status:'desconhecida', label: v||'—'};
}

function splitSmart(line){
  if (line.includes(';')) return line.split(';');
  if (line.includes('|')) return line.split('|');
  if ((line.match(/,/g)||[]).length<=2) return line.split(',');
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(' - ')) return line.split(' - ');
  return [line];
}

function parse(text){
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  for (let i=0;i<lines.length;i++){
    let raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;
    let parts = splitSmart(raw).map(p=>{
      p = p.trim();
      if ((p.startsWith('"')&&p.endsWith('"')) || (p.startsWith("'")&&p.endsWith("'"))) p = p.slice(1,-1);
      return p;
    }).filter(Boolean);
    let nome='', cnpj='', situacao='';
    if (parts.length>=3){ [nome, cnpj, situacao] = [parts[0], parts[1], parts.slice(2).join(' ')]; }
    else if (parts.length===2){
      const [a,b]=parts; const aIsCnpj=isCNPJ(a), bIsCnpj=isCNPJ(b); const aIsSit=isSituacao(a), bIsSit=isSituacao(b);
      if (aIsCnpj && bIsSit){ cnpj=a; situacao=b; }
      else if (bIsCnpj && aIsSit){ cnpj=b; situacao=a; }
      else if (aIsCnpj){ cnpj=a; nome=b; }
      else if (bIsCnpj){ cnpj=b; nome=a; }
      else if (aIsSit){ situacao=a; nome=b; }
      else if (bIsSit){ situacao=b; nome=a; }
      else { nome=a; situacao=b; }
    } else {
      const m = raw.match(/(.+?)\s*[-–]\s*(.+)$/);
      if (m){ nome=m[1].trim(); situacao=m[2].trim(); } else { nome=raw; }
    }
    if (!cnpj){ const m = raw.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/); if (m) cnpj=m[1]; }
    const norm = normalizeSituacao(situacao);
    out.push({nome, cnpj:formatCNPJ(cnpj), situacao:norm.label, label:norm.label, status:norm.status, raw});
  }
  return out;
}

function filteredSorted(){
  let rows=[...state.rows];
  const q = normalizeText(state.search);
  if (q){
    rows = rows.filter(r => normalizeText(r.nome).includes(q) || (r.cnpj||'').includes(state.search.replace(/\D+/g,'')));
  }
  if (state.status){ rows = rows.filter(r => r.status===state.status); }
  const {key, dir} = state.sort;
  rows.sort((a,b)=>{
    const va=(a[key]||'').toString().toLowerCase();
    const vb=(b[key]||'').toString().toLowerCase();
    if (va<vb) return dir==='asc' ? -1 : 1;
    if (va>vb) return dir==='asc' ? 1 : -1;
    return 0;
  });
  return rows;
}

function render(){
  const tbody = document.querySelector('#table tbody');
  const rows = filteredSorted();
  tbody.innerHTML = rows.map(r=>{
    const pillClass = r.status;
    const btns = buildActions(r);
    return `
      <tr>
        <td>${escapeHtml(r.nome||'')}</td>
        <td>${escapeHtml(r.cnpj||'')}</td>
        <td><span class="pill ${pillClass}">${escapeHtml(r.label||r.situacao||'—')}</span></td>
        <td><div class="row-actions">${btns}</div></td>
      </tr>
    `;
  }).join('');
  $('count').textContent = rows.length;
  $('filePathLabel').textContent = state.lastPath || ENC_TXT_PATH;
}

function buildActions(row){
  const encodedName = encodeURIComponent(row.nome || '').replace(/%20/g, ' ');
  if (row.status === 'negativa'){
    const urlPdf = BASE_CND_NEGATIVA + encodedName + '.pdf';
    return `<a class="link-like" href="${urlPdf}" target="_blank" rel="noopener">Abrir CND (PDF)</a>`;
  } else if (row.status === 'positiva'){
    const base = BASE_CND_POSITIVA + encodedName;
    const pdf = base + '.pdf';
    const jpg = base + '.jpg';
    return `<a class="link-like" href="${pdf}" target="_blank" rel="noopener">Abrir CND (PDF)</a>
            <a class="link-like" href="${jpg}" target="_blank" rel="noopener">Abrir CND (JPG)</a>`;
  } else {
    return `<span class="muted">Sem ação</span>`;
  }
}

function setStatus(msg){ $('status').textContent = msg; }
function updateSortIndicators(){ document.querySelectorAll('th').forEach(th=>{ th.classList.remove('asc','desc'); if (th.dataset.key===state.sort.key){ th.classList.add(state.sort.dir); } }); }
function setSort(key){
  if (state.sort.key===key){ state.sort.dir = state.sort.dir==='asc'?'desc':'asc'; }
  else { state.sort.key=key; state.sort.dir='asc'; }
  updateSortIndicators(); render();
}

// ===== Decrypt (XorShift32 com semente derivada de senha + nonce) =====
function xorshift32(seed){
  let x = seed >>> 0;
  return () => {
    x ^= (x << 13) >>> 0;
    x ^= (x >>> 17) >>> 0;
    x ^= (x << 5) >>> 0;
    return x >>> 0;
  };
}

async function deriveSeed(password, nonceBytes){
  const enc = new TextEncoder();
  const pw = enc.encode(password);
  const input = new Uint8Array(pw.length + nonceBytes.length);
  input.set(pw, 0); input.set(nonceBytes, pw.length);
  const digest = await crypto.subtle.digest('SHA-256', input);
  const d = new Uint8Array(digest);
  // little-endian
  const seed = (d[0] | (d[1]<<8) | (d[2]<<16) | (d[3]<<24)) >>> 0;
  return seed;
}

async function decryptBytes(buffer, password){
  const data = new Uint8Array(buffer);
  if (data.length < 8) throw new Error('Arquivo inválido');
  const magic = String.fromCharCode(data[0],data[1],data[2],data[3]);
  if (magic !== 'CND1') throw new Error('Formato inválido');
  const nonce = data.slice(4,8);
  const ct = data.slice(8);
  const seed = await deriveSeed(password, nonce);
  const prng = xorshift32(seed);
  const out = new Uint8Array(ct.length);
  for (let i=0;i<ct.length;i++){
    const r = prng();
    const k = r & 0xFF;
    out[i] = ct[i] ^ k;
  }
  return out;
}

async function fetchAndDecrypt(){
  if (!state.password) throw new Error('Sem senha');
  setStatus('Baixando e descriptografando…');
  const resp = await fetch(state.lastPath + `?t=${Date.now()}`, {cache:'no-store'});
  if (!resp.ok) throw new Error('HTTP '+resp.status);
  const buf = await resp.arrayBuffer();
  const out = await decryptBytes(buf, state.password);
  try {
    const txt = new TextDecoder('utf-8', {fatal:true}).decode(out);
    return txt;
  } catch(e){
    // fallback permissivo (pode conter caracteres inválidos)
    return new TextDecoder('utf-8').decode(out);
  }
}

// ===== Auto-reload =====
async function load(){
  try{
    const text = await fetchAndDecrypt();
    state.rows = parse(text);
    enableUI(true);
    render();
    setStatus(`Atualizado • ${new Date().toLocaleString()}`);
  }catch(err){
    setStatus('Erro: '+err.message);
  }
}
function startAuto(){ if (state.timer) clearInterval(state.timer); state.timer = setInterval(load, POLL_MS); }
function stopAuto(){ if (state.timer) clearInterval(state.timer); state.timer = null; }

function enableUI(enabled){
  ['search','statusFilter','reload','toggleAuto','downloadCsv'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.disabled = !enabled;
  });
}

// ===== UI events =====
document.addEventListener('DOMContentLoaded', ()=>{
  updateSortIndicators();
  document.querySelectorAll('th').forEach(th=> th.addEventListener('click', ()=> setSort(th.dataset.key)) );
  $('search').addEventListener('input', e=>{ state.search=e.target.value; render(); });
  $('statusFilter').addEventListener('change', e=>{ state.status=e.target.value; render(); });
  $('reload').addEventListener('click', load);
  $('toggleAuto').addEventListener('click', ()=>{
    state.auto = !state.auto;
    if (state.auto){ startAuto(); $('toggleAuto').textContent='Pausar auto'; }
    else { stopAuto(); $('toggleAuto').textContent='Ligar auto'; }
  });
  $('downloadCsv').addEventListener('click', ()=>{
    const rows = filteredSorted();
    const csv = ['Nome;CNPJ;Situacao'].concat(rows.map(r=>[r.nome,r.cnpj,r.label||r.situacao||''].map(v=>`"${(v||'').replace(/"/g,'""')}"`).join(';'))).join('\r\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`cnds_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  });

  // Gate (senha)
  $('unlock').addEventListener('click', async ()=>{
    const pwd = $('pwd').value || '';
    if (!pwd){ $('gateError').textContent = 'Informe a senha.'; return; }
    state.password = pwd;
    try{
      setStatus('Validando senha…');
      const text = await fetchAndDecrypt();
      state.rows = parse(text);
      render();
      setStatus('Desbloqueado.');
      $('gate').classList.add('hidden');
      enableUI(true);
      startAuto();
    }catch(e){
      $('gateError').textContent = 'Falha ao abrir: senha incorreta ou arquivo indisponível.';
      state.password = null;
      setStatus('Bloqueado — verifique senha/arquivo.');
    }
  });
});
