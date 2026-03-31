// ===== 상태 =====
let allIssues = [];
let settings = {};
let selectedMonth = null;
let charts = {};
let editingRow = null;
let checkedRows = new Set();
let monthHistory = {}; // issueNum -> [{from, to, ts}, ...]

const isDone     = s => s && (s === '반영완료' || s === '운영반영 완료' || s.endsWith('반영완료'));
const isWaiting  = s => s && ['신규/재개','요청','보류'].includes(s);
const isProgress = s => s && !isDone(s) && !isWaiting(s) && s !== '취소';

const STATUS_CLASS = {'신규/재개':'s-new','분석 중':'s-analyzing','개발 중':'s-developing','테스트 중':'s-testing','반영완료':'s-done','보류':'s-hold','취소':'s-cancel'};
const STATUS_COLOR = {'신규/재개':'#3b82f6','분석 중':'#8b5cf6','개발 중':'#f97316','테스트 중':'#eab308','반영완료':'#22c55e','보류':'#94a3b8','취소':'#ef4444','운영반영 완료':'#16a34a','운영반영 대기':'#f59e0b','개발 시작':'#f97316','개발 완료':'#84cc16','테스트 요청':'#06b6d4','테스트 완료':'#10b981'};
const PRIORITY_CLASS = {'1순위':'p1','2순위':'p2','3순위':'p3','4순위':'p4','5순위':'p5'};
const PRIORITY_ORDER = {'1순위':1,'2순위':2,'3순위':3,'4순위':4,'5순위':5};

// ===== API =====
const API_BASE = window.location.hostname === 'hyunjoo-bak.github.io'
  ? 'https://dashboard.smboard.cloud'
  : '';

async function api(path, method='GET', body=null) {
  const opts = { method, headers: {'Content-Type':'application/json'} };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch(e) {
    if (e.message.startsWith('HTTP ')) throw e;
    throw new Error(`HTTP ${res.status}: ${text.slice(0,200)}`);
  }
}

// ===== 초기 로드 =====
async function loadData(force=false) {
  showLoading(true);
  try {
    if (force) await api('/api/refresh','POST');
    [allIssues, settings] = await Promise.all([api('/api/issues'), api('/api/settings')]);
    await loadMonthHistory();
    updateSyncTime();
    populateModalSelects();
    renderAll();
  } catch(e) { showToast('데이터 로드 실패: '+e.message, true); }
  showLoading(false);
}

async function loadMonthHistory() {
  try {
    const hist = await api('/api/history');
    monthHistory = {};
    hist.forEach(h => {
      (h.changes||[]).forEach(c => {
        if (c.field === '요청월' && h.issueNum) {
          if (!monthHistory[h.issueNum]) monthHistory[h.issueNum] = [];
          monthHistory[h.issueNum].push({ from: c.from, to: c.to, ts: h.ts });
        }
      });
    });
  } catch(e) { /* 이력 로드 실패는 무시 */ }
}

function updateSyncTime() {
  const n = new Date();
  document.getElementById('syncTime').textContent =
    `최신화: ${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')}`;
}

function populateModalSelects() {
  fillModalSelect('modalPriority', settings['우선순위']||[]);
  fillModalSelect('modalStatus',   settings['최신상태']||[]);
  fillModalSelect('modalType',     settings['유형']    ||[]);
  populateReqMonthYears();
}

// 요청월 년도 옵션 생성
function populateReqMonthYears() {
  const cy = new Date().getFullYear();
  const sel = document.getElementById('reqMonthYear');
  const cur = sel.value;
  sel.innerHTML = '<option value="">년도</option>';
  for (let y = 2020; y <= cy + 1; y++) {
    sel.innerHTML += `<option value="${y}">${y}년</option>`;
  }
  if (cur) sel.value = cur;
}

// 모달 요청월 hidden 입력 갱신
function updateReqMonthHidden() {
  const year  = document.getElementById('reqMonthYear').value;
  const month = document.getElementById('reqMonthMonth').value;
  document.getElementById('reqMonthHidden').value = (year && month) ? `${year}년 ${month}월` : '';
}

function fillModalSelect(id, options) {
  const sel = document.getElementById(id);
  const filtered = options.filter(o => o !== '직접입력');
  sel.innerHTML = filtered.map(o=>`<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('')
    + `<option value="__custom__">직접입력</option>`;
}

function renderAll() {
  renderDashboard();
  renderMonthlyTab();
  renderAllTab();
}

// ===== 대시보드 =====
function renderDashboard() {
  const issues = allIssues;
  const total      = issues.length;
  const done       = issues.filter(i=>isDone(i['최신상태'])).length;
  const inProgress = issues.filter(i=>isProgress(i['최신상태'])).length;
  const waiting    = issues.filter(i=>isWaiting(i['최신상태'])).length;

  document.getElementById('summaryCards').innerHTML = `
    <div class="summary-card indigo"><div class="label">전체 이슈</div><div class="value">${total}</div><div class="sub">건</div></div>
    <div class="summary-card green"><div class="label">반영완료</div><div class="value">${done}</div><div class="sub">완료율 ${total?Math.round(done/total*100):0}%</div></div>
    <div class="summary-card orange"><div class="label">진행 중</div><div class="value">${inProgress}</div><div class="sub">개발/테스트 등</div></div>
    <div class="summary-card blue"><div class="label">대기</div><div class="value">${waiting}</div><div class="sub">요청·신규·보류</div></div>
  `;

  const monthMap = groupBy(issues, '요청월');
  const months = sortMonths(Object.keys(monthMap)).reverse().slice(0,4);
  document.getElementById('monthGrid').innerHTML = months.map(m => {
    const items = monthMap[m], sc = countBy(items,'최신상태'), t = items.length;
    const segs = Object.entries(sc).map(([s,c])=>`<div class="status-bar-seg" style="flex:${c};background:${STATUS_COLOR[s]||'#94a3b8'}" title="${s}: ${c}건"></div>`).join('');
    const badges = Object.entries(sc).map(([s,c])=>{const col=STATUS_COLOR[s]||'#94a3b8';return `<span class="status-badge" style="background:${col}22;color:${col}">${s} ${c}</span>`;}).join('');
    return `<div class="month-card" onclick="goToMonth('${m}')">
      <div class="month-label">${m||'요청월 없음'}</div>
      <div class="month-total">${t}<span>건</span></div>
      <div class="status-bar">${segs}</div>
      <div class="status-legend">${badges}</div>
    </div>`;
  }).join('');

  renderCharts(issues);
  renderPriorityProgress(issues);
}

function renderCharts(issues) {
  const sc = countBy(issues,'최신상태');
  renderDoughnut('chartStatus', sc, STATUS_COLOR);
  const pc = countBy(issues,'우선순위');
  renderDoughnut('chartPriority', pc, {'1순위':'#dc2626','2순위':'#ea580c','3순위':'#ca8a04','4순위':'#16a34a','5순위':'#0284c7'});
  renderDelayed(issues);
}

// 지연 이슈 현황 차트
function parseYearMonth(str) {
  const m = (str||'').match(/(\d{4})년\s*(\d{1,2})월/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2])-1, 1);
}

function renderDelayed(issues) {
  const now = new Date();
  const delayed = issues.filter(i => {
    if (!i['요청월']) return false;
    const d = parseYearMonth(i['요청월']);
    if (!d) return false;
    const diff = (now.getFullYear()-d.getFullYear())*12 + now.getMonth()-d.getMonth();
    return diff > 3 && !isDone(i['최신상태']) && i['최신상태'] !== '취소';
  });

  const badge = document.getElementById('delayedBadge');
  const empty = document.getElementById('delayedEmpty');
  const canvas = document.getElementById('chartDelayed');

  if (delayed.length === 0) {
    badge.textContent = '0건';
    badge.style.background = '#f0fdf4'; badge.style.color = '#16a34a';
    empty.style.display = 'block';
    canvas.style.display = 'none';
    if (charts['chartDelayed']) { charts['chartDelayed'].destroy(); delete charts['chartDelayed']; }
    return;
  }

  badge.textContent = `${delayed.length}건 지연`;
  badge.style.background = '#fef2f2'; badge.style.color = '#dc2626';
  empty.style.display = 'none';
  canvas.style.display = 'block';

  // 요청월별 그룹, 오래된 순 정렬
  const byMonth = countBy(delayed, '요청월');
  const months = sortMonths(Object.keys(byMonth)); // 오래된 것 먼저
  const counts = months.map(m => byMonth[m]);
  const colors = months.map(m => {
    const d = parseYearMonth(m);
    const diff = (now.getFullYear()-d.getFullYear())*12 + now.getMonth()-d.getMonth();
    if (diff > 12) return '#dc2626';
    if (diff > 6)  return '#f97316';
    return '#eab308';
  });

  const ctx = document.getElementById('chartDelayed').getContext('2d');
  if (charts['chartDelayed']) charts['chartDelayed'].destroy();
  charts['chartDelayed'] = new Chart(ctx, {
    type: 'bar',
    data: { labels: months, datasets: [{ data: counts, backgroundColor: colors, borderRadius: 6 }] },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        afterLabel: (ctx) => {
          const m = months[ctx.dataIndex];
          const d = parseYearMonth(m);
          const diff = (now.getFullYear()-d.getFullYear())*12 + now.getMonth()-d.getMonth();
          return `${diff}개월 경과`;
        }
      }}},
      scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { ticks: { font: { size: 11 } } } }
    }
  });
}

function renderDoughnut(id, dataMap, colorMap) {
  const ctx = document.getElementById(id).getContext('2d');
  if (charts[id]) charts[id].destroy();
  const labels = Object.keys(dataMap), data = Object.values(dataMap);
  charts[id] = new Chart(ctx, {
    type:'doughnut',
    data:{labels, datasets:[{data, backgroundColor:labels.map(l=>colorMap[l]||'#94a3b8'), borderWidth:2, borderColor:'#fff'}]},
    options:{plugins:{legend:{position:'bottom',labels:{font:{size:11},padding:10}}},cutout:'65%'}
  });
}

// 긴급·우선 이슈 진행현황
function renderPriorityProgress(issues) {
  const targets = [
    { label: '1순위 (긴급)', key: '1순위', color: '#dc2626' },
    { label: '2순위 (우선)', key: '2순위', color: '#ea580c' },
  ];
  const html = targets.map(t => {
    const group = issues.filter(i=>i['우선순위']===t.key);
    if (group.length===0) return `<div class="prio-block"><div class="prio-header" style="border-color:${t.color}"><span class="prio-label" style="color:${t.color}">${t.label}</span><span class="prio-total">0건</span></div><p style="color:#aaa;font-size:12px;padding:12px 0">해당 이슈 없음</p></div>`;
    const sc = countBy(group,'최신상태'), total = group.length;
    const doneCount = group.filter(i=>isDone(i['최신상태'])).length;
    const pct = Math.round(doneCount/total*100);
    const statusOrder = [...new Set(issues.map(i=>i['최신상태']).filter(Boolean))];
    const barSegs = statusOrder.map(s=>{const c=sc[s]||0;if(!c)return '';const col=STATUS_COLOR[s]||'#94a3b8';return `<div style="flex:${c};background:${col};height:100%" title="${s}: ${c}건"></div>`;}).join('');
    const badges = Object.entries(sc).map(([s,c])=>{const col=STATUS_COLOR[s]||'#94a3b8';return `<span class="badge-status" style="background:${col}22;color:${col}">${s} <strong>${c}</strong></span>`;}).join('');
    const rows = group.slice(0,8).map(i=>{const sCol=STATUS_COLOR[i['최신상태']]||'#94a3b8';return `<tr><td>${i['이슈번호']||'-'}</td><td class="prio-issue-title" title="${escHtml(i['제목'])}">${escHtml(i['제목'])||'-'}</td><td>${i['담당자']||'-'}</td><td><span class="badge-status" style="background:${sCol}22;color:${sCol}">${i['최신상태']||'-'}</span></td></tr>`;}).join('');
    const more = group.length>8?`<tr><td colspan="4" style="text-align:center;color:#aaa;font-size:12px;padding:8px">외 ${group.length-8}건</td></tr>`:'';
    return `<div class="prio-block">
      <div class="prio-header" style="border-color:${t.color}"><span class="prio-label" style="color:${t.color}">${t.label}</span><span class="prio-total">${total}건 · 완료 ${doneCount}건 (${pct}%)</span></div>
      <div style="display:flex;height:10px;border-radius:6px;overflow:hidden;gap:2px;margin:10px 0 8px">${barSegs}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${badges}</div>
      <table class="person-table"><thead><tr><th>이슈번호</th><th>제목</th><th>담당자</th><th>최신상태</th></tr></thead><tbody>${rows}${more}</tbody></table>
    </div>`;
  }).join('');
  document.getElementById('priorityProgress').innerHTML = `<div class="prio-grid">${html}</div>`;
}

// ===== 요청월별 이슈 탭 =====
function renderMonthlyTab() {
  const allMonths = sortMonths([...new Set(allIssues.map(i=>i['요청월']))]);
  const hasNoMonth = allIssues.some(i=>!i['요청월']);
  const recentMonths = [...allMonths].reverse().slice(0,6);
  const olderMonths  = [...allMonths].reverse().slice(6);
  if (!selectedMonth) selectedMonth = recentMonths[0] || allMonths[allMonths.length-1] || '';

  const chips = document.getElementById('monthChips');
  let chipHtml = recentMonths.map(m=>`<button class="month-chip ${m===selectedMonth?'active':''}" onclick="selectMonth('${m}')">${m}</button>`).join('');
  if (hasNoMonth) chipHtml += `<button class="month-chip ${selectedMonth===''?'active':''}" onclick="selectMonth('')">요청월 없음</button>`;
  chips.innerHTML = chipHtml;

  const dd = document.getElementById('monthDropdown');
  if (olderMonths.length > 0) {
    dd.style.display = '';
    dd.innerHTML = `<option value="">이전 요청월...</option>`
      + olderMonths.map(m=>`<option value="${m}" ${m===selectedMonth?'selected':''}>${m}</option>`).join('');
  } else {
    dd.style.display = 'none';
  }
  renderMonthlyTable();
}

function selectMonth(m) {
  selectedMonth = m;
  document.querySelectorAll('.month-chip').forEach(c=>c.classList.toggle('active', c.textContent===(m||'요청월 없음')));
  const dd = document.getElementById('monthDropdown');
  const olderMonths = [...dd.options].slice(1).map(o=>o.value);
  dd.value = olderMonths.includes(m) ? m : '';
  renderMonthlyTable();
}

function goToMonth(m) { switchTab('monthly'); selectMonth(m); }

function renderMonthlyTable() {
  const filtered = allIssues
    .filter(i=>(i['요청월']===(selectedMonth||'')) || (i['이월월']===(selectedMonth||'')))
    .sort((a,b)=>(PRIORITY_ORDER[a['우선순위']]||9)-(PRIORITY_ORDER[b['우선순위']]||9));
  const tbody = document.getElementById('monthlyTbody');
  if (filtered.length===0) { tbody.innerHTML=`<tr class="empty-row"><td colspan="11">해당 요청월의 이슈가 없습니다.</td></tr>`; return; }
  tbody.innerHTML = filtered.map(i=>issueRow(i,false)).join('');
}

// ===== 전체 이슈 탭 =====
function renderAllTab() {
  fillSelectOptions('filterPriority', [...new Set(allIssues.map(i=>i['우선순위']))].filter(Boolean).sort((a,b)=>(PRIORITY_ORDER[a]||9)-(PRIORITY_ORDER[b]||9)));
  fillSelectOptions('filterStatus',   [...new Set(allIssues.map(i=>i['최신상태']))].filter(Boolean));
  fillSelectOptions('filterAssignee', [...new Set(allIssues.map(i=>i['담당자']))].filter(Boolean).sort());
  applyAllFilters();
}

function applyAllFilters() {
  const search   = document.getElementById('searchInput').value.toLowerCase();
  const priority = document.getElementById('filterPriority').value;
  const status   = document.getElementById('filterStatus').value;
  const assignee = document.getElementById('filterAssignee').value;

  let filtered = allIssues.filter(i=>{
    if (priority && i['우선순위']!==priority) return false;
    if (status   && i['최신상태']!==status)   return false;
    if (assignee && i['담당자']!==assignee)   return false;
    if (search) {
      const t=[i['제목'],i['이슈번호'],i['담당자'],i['개발담당자'],i['요청월']].join(' ').toLowerCase();
      if (!t.includes(search)) return false;
    }
    return true;
  }).sort((a,b) => {
    // 요청월 있는 것 우선
    const aHas = a['요청월'] ? 0 : 1;
    const bHas = b['요청월'] ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    // 요청월 내림차순 (최신 먼저)
    const ap = parseYearMonth(a['요청월']), bp = parseYearMonth(b['요청월']);
    if (ap && bp && ap.getTime() !== bp.getTime()) return bp - ap;
    // 우선순위
    return (PRIORITY_ORDER[a['우선순위']]||9) - (PRIORITY_ORDER[b['우선순위']]||9);
  });

  const tbody = document.getElementById('allTbody');
  if (filtered.length===0) { tbody.innerHTML=`<tr class="empty-row"><td colspan="12">검색 결과가 없습니다.</td></tr>`; return; }
  tbody.innerHTML = filtered.map(i=>issueRow(i,true)).join('');
}

// ===== 이슈 행 렌더링 =====
function issueRow(issue, showMonth) {
  const issueNum = issue['이슈번호']||'-';
  const issueCell = issue['이슈링크']?.trim()
    ? `<a class="issue-link" href="${escHtml(issue['이슈링크'])}" target="_blank">#${issueNum}</a>`
    : `<span style="font-weight:600;color:#555;">#${issueNum}</span>`;

  const rawLink = (issue['설계링크']||'').trim();
  const designLink = /^https?:\/\/.+/i.test(rawLink)
    ? `<a class="issue-link" href="${escHtml(rawLink)}" target="_blank" title="${escHtml(rawLink)}">🔗 링크</a>`
    : rawLink ? `<span style="color:#aaa;font-size:12px;">${escHtml(rawLink)}</span>` : '-';

  const carryBadge = issue['이월월']
    ? `<span class="badge-carryover" title="이월됨">↪${issue['이월월'].replace(/\d{4}년\s*/,'')}</span>` : '';

  const desc = (issue['설명']||'').trim();
  const titleCell = `<div class="title-wrap">
    <span class="title-text" title="${escHtml(issue['제목'])}">${escHtml(issue['제목'])||'-'}</span>
    ${carryBadge}
    ${desc?`<span class="desc-icon" data-desc="${escHtml(desc)}" onmouseenter="showTooltip(this)" onmouseleave="hideTooltip()">ℹ</span>`:''}
  </div>`;

  const priorityCell = inlineSelect(issue,'우선순위', settings['우선순위']||[]);
  const statusCell   = inlineSelect(issue,'최신상태', settings['최신상태']||[]);
  const typeCell     = inlineSelect(issue,'유형',     settings['유형']    ||[]);

  const r = issue['반영여부'];
  const rCls = r==='Y'?'r-y':r==='N'?'r-n':r?'r-part':'';
  const checked = checkedRows.has(issue._row);

  // 요청월 셀 (전체이슈 탭) - 인라인 편집 + 이력 툴팁
  let monthTd = '';
  if (showMonth) {
    const hist = monthHistory[issue['이슈번호']] || [];
    const histTooltip = hist.length > 0
      ? hist.map(h=>`${h.from||'없음'} → ${h.to} (${new Date(h.ts).toLocaleDateString('ko-KR')})`).join('\n')
      : '';
    const histIcon = hist.length > 0
      ? `<span class="month-hist-icon" data-desc="${escHtml(histTooltip)}" onmouseenter="showTooltip(this)" onmouseleave="hideTooltip()">⏱</span>` : '';

    // 년/월 select 옵션 생성
    const cy = new Date().getFullYear();
    const parsed = parseYearMonth(issue['요청월']);
    const curY = parsed ? parsed.getFullYear() : 0;
    const curM = parsed ? parsed.getMonth() + 1 : 0;
    let yOpts = '<option value="">년도</option>';
    for (let y = 2020; y <= cy + 1; y++) {
      yOpts += `<option value="${y}"${y === curY ? ' selected' : ''}>${y}년</option>`;
    }
    let mOpts = '<option value="">월</option>';
    for (let m = 1; m <= 12; m++) {
      mOpts += `<option value="${m}"${m === curM ? ' selected' : ''}>${m}월</option>`;
    }

    monthTd = `<td>
      <div class="month-edit-wrap">
        <span class="month-val${!issue['요청월'] ? ' empty' : ''}" onclick="startMonthEdit(this,${issue._row})">${escHtml(issue['요청월']) || '-'}</span>
        <div class="month-sel-inline">
          <select class="month-year-sel">${yOpts}</select>
          <select class="month-month-sel">${mOpts}</select>
          <button class="btn-month-ok" onclick="saveMonthSelEdit(this,${issue._row})">✓</button>
          <button class="btn-month-cancel" onclick="cancelMonthSelEdit(this)">✕</button>
        </div>
        ${histIcon}
      </div>
    </td>`;
  }

  return `
    <tr class="${checked?'row-checked':''}">
      <td class="col-chk"><input type="checkbox" class="row-chk" data-row="${issue._row}" ${checked?'checked':''} onchange="toggleRowCheck(this)"></td>
      ${monthTd}
      <td>${issueCell}</td>
      <td>${priorityCell}</td>
      <td>${typeCell}</td>
      <td>${issue['담당자']||'-'}</td>
      <td class="title-cell">${titleCell}</td>
      <td>${issue['개발담당자']||'-'}</td>
      <td>${designLink}</td>
      <td>${statusCell}</td>
      <td>${r?`<span class="badge-reflect ${rCls}">${r}</span>`:'-'}</td>
      <td><button class="btn-edit" onclick="openEdit(${issue._row})">편집</button></td>
    </tr>`;
}

// 요청월 인라인 편집
function startMonthEdit(span, row) {
  const wrap = span.closest('.month-edit-wrap');
  span.style.display = 'none';
  wrap.querySelector('.month-sel-inline').classList.add('open');
}

function cancelMonthSelEdit(btn) {
  const wrap = btn.closest('.month-edit-wrap');
  wrap.querySelector('.month-sel-inline').classList.remove('open');
  wrap.querySelector('.month-val').style.display = '';
}

async function saveMonthSelEdit(btn, row) {
  const wrap  = btn.closest('.month-edit-wrap');
  const year  = wrap.querySelector('.month-year-sel').value;
  const month = wrap.querySelector('.month-month-sel').value;
  if (!year || !month) { showToast('년도와 월을 모두 선택해 주세요.', true); return; }
  const newVal = `${year}년 ${parseInt(month)}월`;
  const issue = allIssues.find(i=>i._row===row);
  if (!issue) { cancelMonthSelEdit(btn); return; }
  const oldVal = issue['요청월'] || '';
  if (newVal === oldVal) { cancelMonthSelEdit(btn); return; }
  try {
    await api(`/api/issues/${row}`, 'PUT', {'요청월': newVal});
    if (issue['이슈번호']) {
      if (!monthHistory[issue['이슈번호']]) monthHistory[issue['이슈번호']] = [];
      monthHistory[issue['이슈번호']].push({ from: oldVal, to: newVal, ts: new Date().toISOString() });
    }
    issue['요청월'] = newVal;
    showToast('요청월 저장됨');
    applyAllFilters();
  } catch(e) { showToast('저장 실패: '+e.message, true); cancelMonthSelEdit(btn); }
}

// ===== 인라인 select =====
function inlineSelect(issue, field, options) {
  const cur = issue[field]||'';
  const filtered = options.filter(o=>o!=='직접입력');
  const allOpts = filtered.includes(cur) ? filtered : (cur?[cur,...filtered]:filtered);
  const optsHtml = allOpts.map(o=>`<option value="${escHtml(o)}" ${o===cur?'selected':''}>${escHtml(o)}</option>`).join('')
    + `<option value="__custom__">직접입력</option>`;
  return `<div class="inline-wrap" data-row="${issue._row}" data-field="${field}">
    <select class="inline-sel" onchange="handleInlineSel(this)">${optsHtml}</select>
    <input class="inline-txt" type="text" style="display:none" placeholder="직접입력"
      onkeydown="if(event.key==='Enter'){event.preventDefault();saveInlineTxt(this);}"
      onblur="saveInlineTxt(this)">
  </div>`;
}

function handleInlineSel(sel) {
  const wrap = sel.closest('.inline-wrap'), txt = wrap.querySelector('.inline-txt');
  if (sel.value==='__custom__') { txt.style.display='block'; txt.value=''; txt.focus(); }
  else { txt.style.display='none'; saveInlineField(+wrap.dataset.row, wrap.dataset.field, sel.value, wrap); }
}

function saveInlineTxt(txt) {
  const wrap = txt.closest('.inline-wrap'), val = txt.value.trim();
  if (!val) { txt.style.display='none'; return; }
  saveInlineField(+wrap.dataset.row, wrap.dataset.field, val, wrap);
}

async function saveInlineField(row, field, value, wrap) {
  try {
    await api(`/api/issues/${row}`,'PUT',{[field]:value});
    const issue = allIssues.find(i=>i._row===row);
    if (issue) issue[field] = value;
    const sel = wrap.querySelector('.inline-sel');
    let opt = [...sel.options].find(o=>o.value===value);
    if (!opt) { opt=new Option(value,value); sel.insertBefore(opt,sel.options[0]); }
    sel.value = value;
    wrap.querySelector('.inline-txt').style.display='none';
    showToast('저장됨');
  } catch(e) { showToast('저장 실패: '+e.message,true); }
}

// ===== 편집 모달 =====
function handleModalSelectChange(sel) {
  const wrap = sel.closest('.modal-select-wrap'), txt = wrap?.querySelector('.modal-custom-txt');
  if (!txt) return;
  if (sel.value==='__custom__') { txt.style.display='block'; txt.focus(); } else txt.style.display='none';
}

function openEdit(rowNum) {
  const issue = allIssues.find(i=>i._row===rowNum);
  if (!issue) return;
  editingRow = rowNum;
  document.getElementById('modalTitle').textContent='이슈 편집';
  fillForm(issue);
  document.getElementById('modalOverlay').classList.add('show');
}

function openAdd() {
  editingRow = null;
  document.getElementById('modalTitle').textContent='이슈 추가';
  document.getElementById('issueForm').reset();
  document.querySelectorAll('.modal-custom-txt').forEach(t=>t.style.display='none');
  populateReqMonthYears();
  if (selectedMonth) {
    const m = selectedMonth.match(/(\d{4})년\s*(\d{1,2})월/);
    if (m) {
      document.getElementById('reqMonthYear').value  = m[1];
      document.getElementById('reqMonthMonth').value = String(parseInt(m[2]));
    }
  }
  updateReqMonthHidden();
  document.getElementById('modalOverlay').classList.add('show');
}

function closeModal() { document.getElementById('modalOverlay').classList.remove('show'); }

function fillForm(issue) {
  const form = document.getElementById('issueForm');

  // 요청월: 년/월 select 별도 처리
  populateReqMonthYears();
  const ym = (issue['요청월']||'').match(/(\d{4})년\s*(\d{1,2})월/);
  document.getElementById('reqMonthYear').value  = ym ? ym[1] : '';
  document.getElementById('reqMonthMonth').value = ym ? String(parseInt(ym[2])) : '';
  updateReqMonthHidden();

  const fields = ['이슈번호','이슈링크','유형','우선순위','담당자','개발담당자','제목','설명','설계링크','개발예상기간','최신상태','반영여부'];
  fields.forEach(f=>{
    const el = form.querySelector(`[name="${f}"]`);
    if (!el) return;
    const val = issue[f]||'';
    if (el.tagName==='SELECT') {
      const exists = [...el.options].some(o=>o.value===val);
      if (!exists && val) el.insertBefore(new Option(val,val), el.options[0]);
      el.value = val||el.options[0]?.value;
      const wrap = el.closest('.modal-select-wrap');
      if (wrap) wrap.querySelector('.modal-custom-txt').style.display='none';
    } else { el.value = val; }
  });
}

async function saveIssue(e) {
  e.preventDefault();
  const form = document.getElementById('issueForm');
  const data = {};
  new FormData(form).forEach((v,k)=>{ data[k]=v; });
  ['유형','우선순위','최신상태'].forEach(f=>{
    const sel = form.querySelector(`[name="${f}"]`);
    if (sel?.value==='__custom__') {
      const txt = sel.closest('.modal-select-wrap')?.querySelector('.modal-custom-txt');
      data[f] = txt?.value?.trim()||'';
    }
  });
  try {
    if (editingRow) { await api(`/api/issues/${editingRow}`,'PUT',data); showToast('저장되었습니다.'); }
    else { await api('/api/issues','POST',data); showToast('이슈가 추가되었습니다.'); }
    closeModal();
    await loadData();
  } catch(e) { showToast('저장 실패: '+e.message,true); }
}

// ===== 체크박스 =====
function toggleRowCheck(chk) {
  const row = +chk.dataset.row;
  if (chk.checked) checkedRows.add(row); else checkedRows.delete(row);
  chk.closest('tr')?.classList.toggle('row-checked', chk.checked);
  updateBulkBtns();
}

function toggleCheckAll(tab, checked) {
  const tbodyId = tab==='monthly'?'monthlyTbody':'allTbody';
  document.querySelectorAll(`#${tbodyId} .row-chk`).forEach(c=>{
    c.checked = checked;
    const row = +c.dataset.row;
    if (checked) checkedRows.add(row); else checkedRows.delete(row);
    c.closest('tr')?.classList.toggle('row-checked', checked);
  });
  updateBulkBtns();
}

function updateBulkBtns() {
  const show = checkedRows.size > 0;
  document.getElementById('btnCarryover').style.display    = show?'':'none';
  document.getElementById('btnBulkChange').style.display   = show?'':'none';
}

// ===== 이월 =====
function openCarryover() {
  document.getElementById('carryoverCount').textContent = checkedRows.size;
  const yearSel = document.getElementById('carryoverYear');
  const cy = new Date().getFullYear();
  yearSel.innerHTML = [cy-1,cy,cy+1].map(y=>`<option value="${y}" ${y===cy?'selected':''}>${y}년</option>`).join('');
  const nm = new Date().getMonth()+2; document.getElementById('carryoverMonthSel').value = (nm>12?1:nm).toString().padStart(2,'0');
  document.getElementById('carryoverOverlay').classList.add('show');
}

function closeCarryover() { document.getElementById('carryoverOverlay').classList.remove('show'); }

async function confirmCarryover() {
  const year = document.getElementById('carryoverYear').value;
  const month = document.getElementById('carryoverMonthSel').value;
  const monthStr = `${year}년 ${parseInt(month)}월`;
  const cnt = checkedRows.size;
  try {
    await api('/api/issues/bulk','PUT',{ rows:[...checkedRows], updates:{'이월월': monthStr} });
    [...checkedRows].forEach(row=>{ const i=allIssues.find(x=>x._row===row); if(i) i['이월월']=monthStr; });
    checkedRows.clear(); updateBulkBtns(); closeCarryover();
    showToast(`${cnt}건이 ${monthStr}으로 이월되었습니다.`);
    await loadData();
  } catch(e) { showToast('이월 실패: '+e.message,true); }
}

// ===== 일괄변경 =====
function openBulk() {
  document.getElementById('bulkCount').textContent = checkedRows.size;
  const fill = (id, opts) => {
    document.getElementById(id).innerHTML = `<option value="">변경 안 함</option>`
      + opts.filter(o=>o!=='직접입력').map(o=>`<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('');
  };
  fill('bulkPriority', settings['우선순위']||[]);
  fill('bulkType',     settings['유형']    ||[]);
  fill('bulkStatus',   settings['최신상태']||[]);
  document.getElementById('bulkOverlay').classList.add('show');
}

function closeBulk() { document.getElementById('bulkOverlay').classList.remove('show'); }

async function confirmBulk() {
  const updates = {};
  const p=document.getElementById('bulkPriority').value, t=document.getElementById('bulkType').value, s=document.getElementById('bulkStatus').value;
  if (p) updates['우선순위']=p; if (t) updates['유형']=t; if (s) updates['최신상태']=s;
  if (Object.keys(updates).length===0) { showToast('변경할 항목을 선택하세요.',true); return; }
  const cnt = checkedRows.size;
  try {
    await api('/api/issues/bulk','PUT',{ rows:[...checkedRows], updates });
    [...checkedRows].forEach(row=>{ const i=allIssues.find(x=>x._row===row); if(i) Object.assign(i,updates); });
    checkedRows.clear(); updateBulkBtns(); closeBulk();
    showToast(`${cnt}건에 일괄변경 적용됨`);
    await loadData();
  } catch(e) { showToast('일괄변경 실패: '+e.message,true); }
}

// ===== 편집이력 =====
async function loadHistory() {
  try {
    const hist = await api('/api/history');
    renderHistory(hist);
  } catch(e) { showToast('이력 로드 실패',true); }
}

function renderHistory(hist) {
  const search = (document.getElementById('historySearch')?.value||'').toLowerCase();
  const filtered = search
    ? hist.filter(h=>[h.issueNum,h.title,...(h.changes||[]).map(c=>c.field+c.from+c.to)].join(' ').toLowerCase().includes(search))
    : hist;
  const tbody = document.getElementById('historyTbody');
  if (filtered.length===0) { tbody.innerHTML=`<tr class="empty-row"><td colspan="7">이력이 없습니다.</td></tr>`; return; }
  tbody.innerHTML = filtered.map(h => {
    const ts = new Date(h.ts);
    const timeStr = `${ts.getFullYear()}-${pad(ts.getMonth()+1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}`;
    const ipStr = (h.ip||'').replace('::ffff:','').replace('::1','localhost') || '-';
    return (h.changes||[]).map((c,ci)=>`<tr>
      ${ci===0?`<td rowspan="${h.changes.length}" class="hist-time">${timeStr}</td>
        <td rowspan="${h.changes.length}" class="hist-ip">${ipStr}</td>
        <td rowspan="${h.changes.length}" class="hist-issue">${h.issueNum||'-'}</td>
        <td rowspan="${h.changes.length}" class="hist-title" title="${escHtml(h.title)}">${escHtml(h.title)||'-'}</td>`:''}
      <td><span class="badge-field">${escHtml(c.field)}</span></td>
      <td class="hist-from">${escHtml(c.from)||'(없음)'}</td>
      <td class="hist-to">${escHtml(c.to)||'(없음)'}</td>
    </tr>`).join('');
  }).join('');
}

function pad(n) { return n.toString().padStart(2,'0'); }

// ===== 툴팁 =====
function showTooltip(el) {
  const box = document.getElementById('tooltipBox');
  box.textContent = el.dataset.desc;
  const r = el.getBoundingClientRect();
  box.style.left = Math.min(r.left, window.innerWidth-300)+'px';
  box.style.top  = (r.bottom+6+window.scrollY)+'px';
  box.classList.add('show');
}
function hideTooltip() { document.getElementById('tooltipBox').classList.remove('show'); }

// ===== 유틸 =====
function groupBy(arr, key) { return arr.reduce((acc,i)=>{ const k=i[key]||''; if(!acc[k])acc[k]=[]; acc[k].push(i); return acc; },{}); }
function countBy(arr, key) { return arr.reduce((acc,i)=>{ const k=i[key]||'미설정'; acc[k]=(acc[k]||0)+1; return acc; },{}); }
function sortMonths(months) {
  return months.sort((a,b)=>{ const p=m=>{const r=m.match(/(\d{4})년\s*(\d{1,2})월/);return r?+r[1]*100+ +r[2]:0;}; return p(a)-p(b); });
}
function fillSelectOptions(id, options) {
  const sel=document.getElementById(id), cur=sel.value, first=sel.options[0].outerHTML;
  sel.innerHTML=first+options.map(o=>`<option value="${o}">${o}</option>`).join('');
  if (cur) sel.value=cur;
}
function escHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showLoading(v) { document.getElementById('loading').classList.toggle('show',v); }
function showToast(msg, isError=false) {
  let t=document.querySelector('.toast');
  if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t);}
  t.textContent=msg; t.style.background=isError?'#dc2626':'#1a1a2e';
  t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000);
}

// ===== 탭 전환 =====
function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.toggle('active',c.id===`tab-${tab}`));
  if (tab==='history') loadHistory();
}

// ===== 이벤트 =====
document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
document.getElementById('btnRefresh').addEventListener('click',()=>loadData(true));
document.getElementById('btnAddIssue').addEventListener('click',openAdd);
document.getElementById('btnAddIssue2').addEventListener('click',openAdd);
document.getElementById('modalClose').addEventListener('click',closeModal);
document.getElementById('btnCancel').addEventListener('click',closeModal);
document.getElementById('issueForm').addEventListener('submit',saveIssue);
document.getElementById('modalOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal();});
document.getElementById('btnCarryover').addEventListener('click',openCarryover);
document.getElementById('carryoverOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeCarryover();});
document.getElementById('btnBulkChange').addEventListener('click',openBulk);
document.getElementById('bulkOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeBulk();});
document.getElementById('monthDropdown').addEventListener('change',e=>{if(e.target.value)selectMonth(e.target.value);});
document.getElementById('searchInput').addEventListener('input',applyAllFilters);
document.getElementById('filterPriority').addEventListener('change',applyAllFilters);
document.getElementById('filterStatus').addEventListener('change',applyAllFilters);
document.getElementById('filterAssignee').addEventListener('change',applyAllFilters);
document.getElementById('historySearch').addEventListener('input',async()=>{const h=await api('/api/history');renderHistory(h);});

loadData();
