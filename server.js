process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SPREADSHEET_ID = '1BF6f9cVh8xw9_k-vwj-_CctotMJbLJrTl3qBySZiuFE';
const SHEET_NAME = '이슈목록';
const SETTINGS_SHEET = '설정값';
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const HISTORY_PATH = path.join(__dirname, 'edit-history.json');

// 이슈링크(M), 이월월(N) 포함
const HEADERS = ['요청월','유형','우선순위','담당자','제목','이슈번호','설계링크','설명','개발담당자','개발예상기간','최신상태','반영여부','이슈링크','이월월'];
const LAST_COL = 'N';

const DEFAULT_SETTINGS = {
  우선순위: ['1순위','2순위','3순위','4순위','5순위'],
  최신상태: ['신규/재개','분석 중','개발 중','테스트 중','반영완료','보류','취소'],
  유형: ['기능','버그','개선','기타'],
};

const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:4000/oauth/callback';

// 클라우드 배포 시 인메모리 토큰 저장
let tokenMemory = null;

function createOAuthClient() {
  let client_id, client_secret;
  if (process.env.GOOGLE_CREDENTIALS) {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    ({ client_id, client_secret } = creds.installed || creds.web);
  } else {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    ({ client_secret, client_id } = credentials.installed || credentials.web);
  }
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
  // 토큰 자동갱신 시 인메모리 업데이트
  oAuth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) tokenMemory = { ...tokenMemory, ...tokens };
    else if (tokenMemory) tokenMemory = { ...tokenMemory, access_token: tokens.access_token };
    if (!process.env.GOOGLE_CREDENTIALS) {
      try { const cur = JSON.parse(fs.readFileSync(TOKEN_PATH)); fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...cur, ...tokens })); } catch {}
    }
  });
  return oAuth2Client;
}

function getAuth() {
  const oAuth2Client = createOAuthClient();
  let token;
  if (tokenMemory) {
    token = tokenMemory;
  } else if (process.env.GOOGLE_TOKEN) {
    token = JSON.parse(process.env.GOOGLE_TOKEN);
    tokenMemory = token;
  } else {
    token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  }
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

// OAuth 인증 시작
app.get('/auth', (req, res) => {
  const oAuth2Client = createOAuthClient();
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  res.redirect(authUrl);
});

// OAuth 콜백
app.get('/oauth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('코드가 없습니다.');
  try {
    const oAuth2Client = createOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);
    tokenMemory = tokens;
    if (!process.env.GOOGLE_CREDENTIALS) fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    cache = null; settingsCache = null;
    res.send('<h1>✅ 인증 완료! 창을 닫고 <a href="/">대시보드로 이동</a>하세요.</h1>');
  } catch (e) {
    res.status(500).send(`인증 실패: ${e.message}`);
  }
});

function rowToObj(row) {
  const obj = {};
  HEADERS.forEach((h, i) => { obj[h] = (row[i] || '').toString().trim(); });
  return obj;
}

// 이력 저장
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch { return []; }
}
function appendHistory(entry) {
  const hist = loadHistory();
  hist.unshift({ ts: new Date().toISOString(), ...entry });
  if (hist.length > 2000) hist.length = 2000;
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(hist, null, 2));
}

// 캐시
let cache = null;
let cacheTime = 0;
let settingsCache = null;
const CACHE_TTL = 30000;

async function getSheetData(forceRefresh = false) {
  if (!forceRefresh && cache && Date.now() - cacheTime < CACHE_TTL) return cache;
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:${LAST_COL}2000`,
  });
  const rows = res.data.values || [];
  const data = rows.slice(1).map((row, i) => ({ _row: i + 2, ...rowToObj(row) }));
  cache = data;
  cacheTime = Date.now();
  return data;
}

async function getSettings(forceRefresh = false) {
  if (!forceRefresh && settingsCache) return settingsCache;
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === SETTINGS_SHEET);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: SETTINGS_SHEET } } }] },
    });
    const keys = Object.keys(DEFAULT_SETTINGS);
    const maxLen = Math.max(...keys.map(k => DEFAULT_SETTINGS[k].length));
    const rows = [keys];
    for (let i = 0; i < maxLen; i++) {
      rows.push(keys.map(k => DEFAULT_SETTINGS[k][i] || ''));
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SETTINGS_SHEET}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
    settingsCache = DEFAULT_SETTINGS;
    return settingsCache;
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SETTINGS_SHEET}!A1:Z100`,
  });
  const rows = res.data.values || [];
  if (rows.length === 0) { settingsCache = DEFAULT_SETTINGS; return settingsCache; }

  const headers = rows[0];
  const settings = {};
  headers.forEach((h, i) => {
    if (h) {
      // '직접입력'은 코드에서 자동 추가하므로 시트 값에서 제거
      settings[h] = rows.slice(1)
        .map(r => (r[i] || '').trim())
        .filter(v => v && v !== '직접입력');
    }
  });
  settingsCache = settings;
  return settingsCache;
}

// API: 전체 이슈
app.get('/api/issues', async (req, res) => {
  try { res.json(await getSheetData()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 설정값
app.get('/api/settings', async (req, res) => {
  try { res.json(await getSettings()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 편집이력
app.get('/api/history', (req, res) => {
  res.json(loadHistory());
});

// API: 이슈 일괄수정
app.put('/api/issues/bulk', async (req, res) => {
  try {
    const { rows, updates } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    for (const rowNum of rows) {
      const curRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A${rowNum}:${LAST_COL}${rowNum}`,
      });
      const curRow = (curRes.data.values || [[]])[0] || [];
      const oldObj = rowToObj(curRow);
      const changes = [];
      HEADERS.forEach((h, i) => {
        if (updates[h] !== undefined && updates[h] !== '' && updates[h] !== oldObj[h]) {
          changes.push({ field: h, from: oldObj[h], to: updates[h] });
          curRow[i] = updates[h];
        }
      });
      while (curRow.length < HEADERS.length) curRow.push('');
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A${rowNum}:${LAST_COL}${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [curRow] },
      });
      if (changes.length > 0) {
        appendHistory({ issueNum: oldObj['이슈번호'], title: oldObj['제목'], row: rowNum, changes, ip });
      }
    }
    cache = null;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 이슈 수정
app.put('/api/issues/:row', async (req, res) => {
  try {
    const rowNum = parseInt(req.params.row);
    const updates = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const curRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A${rowNum}:${LAST_COL}${rowNum}`,
    });
    const curRow = (curRes.data.values || [[]])[0] || [];
    const oldObj = rowToObj(curRow);

    // 변경 내역 기록
    const changes = [];
    HEADERS.forEach((h, i) => {
      if (updates[h] !== undefined && updates[h] !== oldObj[h]) {
        changes.push({ field: h, from: oldObj[h], to: updates[h] });
      }
    });

    HEADERS.forEach((h, i) => { if (updates[h] !== undefined) curRow[i] = updates[h]; });
    while (curRow.length < HEADERS.length) curRow.push('');

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A${rowNum}:${LAST_COL}${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [curRow] },
    });

    if (changes.length > 0) {
      appendHistory({ issueNum: oldObj['이슈번호'] || '', title: oldObj['제목'] || '', row: rowNum, changes, ip });
    }

    cache = null;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 이슈 추가
app.post('/api/issues', async (req, res) => {
  try {
    const issue = req.body;
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const newRow = HEADERS.map(h => issue[h] || '');
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:${LAST_COL}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });
    appendHistory({
      issueNum: issue['이슈번호'] || '',
      title: issue['제목'] || '',
      row: null,
      changes: [{ field: '신규추가', from: '', to: issue['제목'] || '' }],
    });
    cache = null;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 새로고침
app.post('/api/refresh', async (req, res) => {
  try {
    cache = null; settingsCache = null;
    await getSheetData(true);
    await getSettings(true);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ 대시보드 서버 실행 중: http://localhost:${PORT}`);
  console.log(`   네트워크 공유: http://<내 IP 주소>:${PORT}\n`);
});
