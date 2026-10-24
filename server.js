// App Soạn Giáo Án — bản độc lập, chạy ngoài Muse.
// Chỉ dùng Node.js chuẩn (không dependency, không npm install).
// Dữ liệu lưu ở data/db.json. Chạy: node server.js  (PORT mặc định 3000)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const adminTokens = new Set();

// ---------- DB ----------
function emptyDb() {
  return { guests: {}, profiles: {}, plans: [], leads: [], orgs: [] };
}
let db = emptyDb();
function loadDb() {
  try {
    if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!db || typeof db !== 'object') db = emptyDb();
    db.guests = db.guests || {}; db.profiles = db.profiles || {};
    db.plans = db.plans || []; db.leads = db.leads || []; db.orgs = db.orgs || [];
  } catch (e) { db = emptyDb(); }
}
function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
loadDb();

// ---------- Helpers ----------
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function sendText(res, status, body, contentType) {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  h.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({ __parseError: true }); }
    });
    req.on('error', reject);
  });
}
// Khách dùng thử: định danh bằng cookie ngẫu nhiên, KHÔNG cần tài khoản.
// Cookie HttpOnly nên phía trình duyệt không đọc được giá trị, chỉ máy chủ đếm được.
function ensureGuest(req, res) {
  const cookies = parseCookies(req);
  let gid = cookies.guest_id;
  if (!gid || !/^[A-Za-z0-9-]+$/.test(gid)) {
    gid = uid();
    res.setHeader('Set-Cookie', `guest_id=${gid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  }
  if (!db.guests[gid]) { db.guests[gid] = { id: gid, planCount: 0, registeredLeadId: null, createdAt: nowIso() }; saveDb(); }
  return gid;
}
function isAdmin(req) {
  if (!ADMIN_PASSWORD) return true; // chưa đặt mật khẩu quản trị: mở tab lead (xem README: phải đặt ADMIN_PASSWORD trên VPS)
  const t = parseCookies(req).admin_token;
  return !!(t && adminTokens.has(t));
}
function requireAdmin(req, res) {
  if (!isAdmin(req)) { sendJson(res, 401, { error: 'ADMIN_LOGIN_REQUIRED' }); return false; }
  return true;
}
function getProfile(gid) {
  return db.profiles[gid] || {
    name: '', school: '', department: '', schoolYear: '', textbook: 'Kết nối tri thức',
    subject: '', grade: '', level: 'Tiểu học', classInfo: '', classSize: '', supportCount: '',
    schoolSample: '', conventions: { sectionOrder: [], fixedTerms: [], signatureBlock: '' },
  };
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); }
function isValidVnPhone(p) { return /^0\d{9}$/.test(String(p || '').trim()); }

// ---------- Sections / scoring / generation ----------
const SECTIONS = [
  { key: 'muc_tieu', label: '1. Yêu cầu cần đạt (Mục tiêu)' },
  { key: 'pham_chat_nang_luc', label: '2. Phẩm chất và năng lực cần hình thành' },
  { key: 'thiet_bi', label: '3. Thiết bị dạy học và học liệu' },
  { key: 'khoi_dong', label: '4. Hoạt động khởi động' },
  { key: 'hinh_thanh', label: '5. Hoạt động hình thành kiến thức mới' },
  { key: 'luyen_tap', label: '6. Hoạt động luyện tập, thực hành' },
  { key: 'van_dung', label: '7. Hoạt động vận dụng, trải nghiệm' },
  { key: 'tien_trinh', label: '8. Tiến trình dạy học (tổng hợp)' },
  { key: 'danh_gia', label: '9. Đánh giá và tiêu chí đánh giá' },
  { key: 'rut_kinh_nghiem', label: '10. Điều chỉnh và rút kinh nghiệm sau tiết dạy' },
];
const SECTION_KEYS = SECTIONS.map((s) => s.key);
const MEASURABLE_VERBS = ['nhận biết', 'phân biệt', 'thực hiện', 'tính', 'giải', 'trình bày', 'vận dụng', 'so sánh', 'mô tả', 'kể', 'đọc', 'viết', 'đo', 'vẽ', 'làm được', 'nêu được', 'chỉ ra'];
function activityTotal(plan) {
  // QUY TẮC QUAN TRỌNG: chỉ cộng thời lượng chính của từng hoạt động.
  // Phút của các bước con (steps) KHÔNG được cộng dồn vào tổng.
  return (plan.activities || []).reduce((sum, a) => sum + (Number(a.duration) || 0), 0);
}
function scorePlan(plan) {
  const issues = [];
  let score = 0;
  const filled = SECTION_KEYS.filter((k) => String(plan.sections?.[k] || '').trim()).length;
  score += Math.round((filled / SECTION_KEYS.length) * 40);
  if (filled < SECTION_KEYS.length) issues.push({ code: 'incomplete', message: `Mới đủ ${filled}/10 mục theo khung 5512.`, suggestion: 'Bổ sung các mục còn trống, đặc biệt là mục tiêu, tiến trình và đánh giá.' });
  const mt = String(plan.sections?.muc_tieu || '').toLowerCase();
  const verbs = MEASURABLE_VERBS.filter((v) => mt.includes(v));
  if (verbs.length >= 2) score += 20;
  else if (verbs.length === 1) { score += 10; issues.push({ code: 'verbs', message: 'Mục tiêu mới có 1 động từ đo lường được.', suggestion: 'Thêm ít nhất 1 động từ đo lường được khác (ví dụ: trình bày, vận dụng, so sánh).' }); }
  else { issues.push({ code: 'verbs', message: 'Mục tiêu chưa có động từ đo lường được.', suggestion: 'Viết lại mục tiêu bằng động từ đo lường được: nhận biết, thực hiện, trình bày, vận dụng…' }); }
  const total = activityTotal(plan);
  const target = Number(plan.lessonMinutes) || 35;
  const diff = Math.abs(total - target);
  if (diff === 0) score += 20;
  else if (diff <= 5) { score += 15; issues.push({ code: 'duration', message: `Tổng thời lượng hoạt động ${total} phút, lệch ${diff} phút so với ${target} phút của tiết học.`, suggestion: 'Điều chỉnh thời lượng 1 hoạt động để tổng khớp đúng thời lượng tiết.' }); }
  else if (diff <= 10) { score += 10; issues.push({ code: 'duration', message: `Tổng thời lượng hoạt động ${total} phút, lệch ${diff} phút so với ${target} phút của tiết học.`, suggestion: 'Cân đối lại thời lượng các hoạt động để tổng khớp thời lượng tiết.' }); }
  else { score += 5; issues.push({ code: 'duration', message: `Tổng thời lượng hoạt động ${total} phút, lệch ${diff} phút so với ${target} phút của tiết học.`, suggestion: 'Xem lại thời lượng từng hoạt động; tổng phải bằng thời lượng tiết.' }); }
  const allText = [...Object.values(plan.sections || {}), ...(plan.activities || []).map((a) => `${a.teacher || ''} ${a.student || ''}`)].join(' ').toLowerCase();
  if (/phân hóa|hỗ trợ|nâng cao|cá nhân hóa|theo năng lực/.test(allText)) score += 10;
  else issues.push({ code: 'differentiation', message: 'Chưa thể hiện phân hóa đối tượng học sinh.', suggestion: 'Thêm dòng phân hóa: học sinh cần hỗ trợ làm gì, học sinh khá/giỏi làm thêm gì.' });
  const dg = String(plan.sections?.danh_gia || '').toLowerCase();
  if (dg.includes('tiêu chí') && dg.trim().length > 20) score += 10;
  else issues.push({ code: 'assessment', message: 'Chưa có tiêu chí đánh giá rõ ràng.', suggestion: 'Thêm tiêu chí đánh giá cụ thể cho từng mức: đạt / chưa đạt, kèm cách quan sát, sản phẩm.' });
  return { score: Math.min(100, score), issues, totalMinutes: total };
}
function scaleActivities(lessonMinutes) {
  if (lessonMinutes >= 45) return [[5, 'Khởi động'], [20, 'Hình thành kiến thức mới'], [15, 'Luyện tập, thực hành'], [5, 'Vận dụng']];
  if (lessonMinutes >= 40) return [[5, 'Khởi động'], [17, 'Hình thành kiến thức mới'], [13, 'Luyện tập, thực hành'], [5, 'Vận dụng']];
  return [[5, 'Khởi động'], [15, 'Hình thành kiến thức mới'], [10, 'Luyện tập, thực hành'], [5, 'Vận dụng']];
}
function generatePlan(input, profile) {
  const level = input.level || profile.level || 'Tiểu học';
  const subject = input.subject || profile.subject || '';
  const grade = input.grade || profile.grade || '';
  const title = input.title || input.lesson || '';
  const textbook = input.textbook || profile.textbook || 'Kết nối tri thức';
  const lessonMinutes = Number(input.lessonMinutes) || 35;
  const isPreschool = level === 'Mầm non';
  const frameworkNote = isPreschool
    ? 'Theo Chương trình Giáo dục mầm non.'
    : 'Theo khung CV 5512 và Chương trình GDPT 2018.';
  const refNote = `GỢI Ý THAM KHẢO — Giáo viên đối chiếu Sách giáo viên bộ “${textbook}” trước khi dùng. Đây KHÔNG phải kho “yêu cầu cần đạt” chính thức theo từng bộ sách/môn/lớp/bài.`;
  const acts = scaleActivities(lessonMinutes).map(([duration, name]) => ({
    name, duration,
    teacher: `Giáo viên tổ chức hoạt động “${name}” cho bài “${title}” (${subject}${grade ? ' — ' + grade : ''}), hướng dẫn, quan sát và hỗ trợ kịp thời.`,
    student: `Học sinh tham gia hoạt động “${name}”, trao đổi nhóm, trình bày và nhận xét sản phẩm của bạn.`,
    // steps có phút riêng chỉ để minh họa chi tiết; tổng điểm CHỈ tính duration chính, không cộng steps.
    steps: [{ text: 'Giáo viên nêu nhiệm vụ, học sinh tiếp nhận nhiệm vụ.', minutes: 2 }, { text: 'Học sinh thực hiện, giáo viên hỗ trợ.', minutes: duration - 2 }],
  }));
  const support = profile.supportCount ? ` Lớp có ${profile.classSize || ''} học sinh, trong đó ${profile.supportCount} em cần hỗ trợ thêm.` : '';
  const sections = {
    muc_tieu: `${refNote}\n- Học sinh nhận biết và trình bày được nội dung trọng tâm của bài “${title}”.\n- Học sinh thực hiện được các nhiệm vụ học tập của bài và vận dụng được kiến thức vào tình huống quen thuộc.\n- Học sinh hợp tác, chia sẻ và tôn trọng ý kiến của bạn trong quá trình học.`,
    pham_chat_nang_luc: `Năng lực: tự chủ và tự học, giao tiếp và hợp tác, giải quyết vấn đề và sáng tạo; năng lực đặc thù môn ${subject || 'học'}. Phẩm chất: chăm chỉ, trung thực, trách nhiệm, nhân ái.`,
    thiet_bi: `Giáo viên: sách giáo khoa bộ ${textbook}, sách giáo viên, tranh ảnh/minh họa bài “${title}”, bảng/phấn hoặc máy chiếu. Học sinh: sách giáo khoa, vở, đồ dùng học tập theo yêu cầu của bài.`,
    khoi_dong: `Tổ chức trò chơi/khởi động ngắn gắn với bài “${title}”, khơi gợi hứng thú và dẫn dắt vào bài mới. Phân hóa: học sinh cần hỗ trợ được gợi ý trước bằng câu hỏi dễ; học sinh khá được giao thêm câu hỏi mở.`,
    hinh_thanh: `Giáo viên giới thiệu tình huống, đặt câu hỏi dẫn dắt; học sinh quan sát, thảo luận và rút ra kiến thức mới của bài “${title}”. Giáo viên chốt kiến thức trọng tâm, học sinh nhắc lại và ghi nhớ.`,
    luyen_tap: `Học sinh luyện tập, thực hành theo nhiệm vụ của bài. Phân hóa: học sinh cần hỗ trợ làm bài cơ bản có gợi ý từng bước; học sinh khá/giỏi làm thêm bài vận dụng nâng cao.${support}`,
    van_dung: `Học sinh vận dụng kiến thức bài “${title}” vào tình huống thực tế gần gũi, chia sẻ sản phẩm và liên hệ với cuộc sống hằng ngày.`,
    tien_trinh: `Tiến trình gồm 4 hoạt động chính với tổng thời lượng ${lessonMinutes} phút (chỉ tính thời lượng chính từng hoạt động, không cộng dồn phút bước con): ${acts.map((a) => `${a.name} (${a.duration} phút)`).join('; ')}. ${frameworkNote}`,
    danh_gia: `Tiêu chí đánh giá: (1) Đạt — học sinh trình bày đúng nội dung trọng tâm và hoàn thành nhiệm vụ; (2) Chưa đạt — học sinh cần hỗ trợ thêm và làm lại nhiệm vụ cơ bản. Cách đánh giá: quan sát, hỏi đáp, sản phẩm học tập và nhận xét của bạn.`,
    rut_kinh_nghiem: `Sau tiết dạy, giáo viên ghi lại: nội dung nào học sinh tiếp thu tốt, nội dung nào cần điều chỉnh, và cách điều chỉnh cho lần dạy sau.`,
  };
  if (profile.conventions?.signatureBlock) sections.rut_kinh_nghiem += `\n\nKhối ký tên theo mẫu của trường:\n${profile.conventions.signatureBlock}`;
  const plan = {
    id: uid(), ownerGuestId: null, title, week: input.week || '', periods: Number(input.periods) || 1,
    level, subject, grade, textbook, lessonMinutes, sections, activities: acts,
    authorName: profile.name || '', authorSchool: profile.school || '',
    isCommunity: false, reuseCount: 0, orgId: '', reviewState: 'none', reviewHistory: [],
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  const s = scorePlan(plan);
  plan.score = s.score; plan.issues = s.issues; plan.totalMinutes = s.totalMinutes;
  return plan;
}
function extractConventions(sample) {
  const text = String(sample || '');
  const synonyms = {
    muc_tieu: ['mục tiêu', 'yêu cầu cần đạt'],
    pham_chat_nang_luc: ['phẩm chất', 'năng lực'],
    thiet_bi: ['thiết bị', 'học liệu', 'đồ dùng'],
    khoi_dong: ['khởi động'],
    hinh_thanh: ['hình thành kiến thức'],
    luyen_tap: ['luyện tập', 'thực hành'],
    van_dung: ['vận dụng'],
    tien_trinh: ['tiến trình'],
    danh_gia: ['đánh giá', 'tiêu chí'],
    rut_kinh_nghiem: ['rút kinh nghiệm', 'điều chỉnh'],
  };
  const lower = text.toLowerCase();
  const order = [];
  for (const s of SECTIONS) {
    const terms = synonyms[s.key] || [];
    let idx = -1;
    for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
    if (idx >= 0) order.push({ key: s.key, idx });
  }
  order.sort((a, b) => a.idx - b.idx);
  const fixedTerms = [];
  ['Giáo viên', 'Tổ trưởng', 'Ban giám hiệu', 'Duyệt', 'Ký tên', 'Hiệu trưởng', 'Phó hiệu trưởng'].forEach((t) => { if (text.includes(t)) fixedTerms.push(t); });
  const lines = text.split('\n');
  const sigLines = lines.filter((l) => /ký|duyệt|giáo viên|tổ trưởng|hiệu trưởng/i.test(l));
  return { sectionOrder: order.map((o) => o.key), fixedTerms, signatureBlock: sigLines.slice(-4).join('\n') };
}
function renderDoc(plan) {
  const rows = (plan.activities || []).map((a) => `<tr><td>${escapeHtml(a.name)} (${a.duration} phút)</td><td>${escapeHtml(a.teacher || '')}</td><td>${escapeHtml(a.student || '')}</td></tr>`).join('');
  const secs = SECTIONS.map((s) => `<h3>${escapeHtml(s.label)}</h3><p>${escapeHtml(plan.sections?.[s.key] || '').replace(/\n/g, '<br>')}</p>`).join('');
  const badge = plan.reviewState === 'approved' ? '<p><b>Tổ đã duyệt ✓</b></p>' : '';
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>body{font-family:"Times New Roman",serif;font-size:13pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:6px;vertical-align:top}</style></head><body><h2 style="text-align:center">GIÁO ÁN</h2><p>Trường: ${escapeHtml(plan.authorSchool || '')} — Giáo viên: ${escapeHtml(plan.authorName || '')}</p><p>Môn: ${escapeHtml(plan.subject || '')} — Lớp: ${escapeHtml(plan.grade || '')} — Bài: ${escapeHtml(plan.title || '')} — Bộ sách: ${escapeHtml(plan.textbook || '')} — Thời lượng: ${plan.lessonMinutes} phút — Điểm tự chấm: ${plan.score}/100</p>${badge}<h3>Tiến trình dạy học (bảng 3 cột)</h3><table><tr><th>Hoạt động</th><th>Hoạt động của giáo viên</th><th>Hoạt động của học sinh</th></tr>${rows}</table>${secs}</body></html>`;
}
function renderTxt(plan) {
  const lines = [`GIÁO ÁN — ${plan.title}`, `Trường: ${plan.authorSchool} — Giáo viên: ${plan.authorName}`, `Môn: ${plan.subject} — Lớp: ${plan.grade} — Bộ sách: ${plan.textbook} — ${plan.lessonMinutes} phút — Điểm tự chấm: ${plan.score}/100`, ''];
  if (plan.reviewState === 'approved') lines.push('Tổ đã duyệt ✓', '');
  lines.push('TIẾN TRÌNH (bảng 3 cột: Hoạt động | Giáo viên | Học sinh)');
  (plan.activities || []).forEach((a) => lines.push(`- ${a.name} (${a.duration} phút) | ${a.teacher} | ${a.student}`));
  lines.push('');
  SECTIONS.forEach((s) => { lines.push(s.label); lines.push(plan.sections?.[s.key] || ''); lines.push(''); });
  return lines.join('\n');
}
function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function templateRewrite(text, mode) {
  const t = String(text || '').trim();
  if (!t) return 'Nội dung đang trống. Hãy viết ý chính của mục này, hệ thống sẽ giúp diễn đạt lại.';
  if (mode === 'shorten') {
    const sents = t.split(/(?<=[.!?])\s+/);
    return sents.slice(0, Math.max(1, Math.ceil(sents.length / 2))).join(' ');
  }
  if (mode === 'game') return t + '\n\nTrò chơi gợi ý: chia lớp thành 2 đội, đội nào trả lời đúng và nhanh hơn về nội dung vừa học sẽ ghi điểm; giáo viên tổng kết và khen ngợi, không tạo áp lực thi đua quá mức.';
  if (mode === 'split') return `Giáo viên: ${t}\nHọc sinh: lắng nghe, trao đổi nhóm, trình bày và nhận xét sản phẩm của bạn theo hướng dẫn của giáo viên.`;
  return t + '\n\nChi tiết thêm: giáo viên nêu ví dụ gần gũi với học sinh, đặt câu hỏi gợi mở từng bước, quan sát và hỗ trợ những em còn lúng túng, sau đó chốt lại ý chính để học sinh nhắc lại bằng lời của mình.';
}
async function aiRewrite(text, mode) {
  if (!process.env.OPENAI_API_KEY) return templateRewrite(text, mode);
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [
        { role: 'system', content: 'Bạn là trợ lý soạn giáo án cho giáo viên Việt Nam. Viết lại ngắn gọn, đúng khung CV 5512, tiếng Việt, không bịa yêu cầu cần đạt chính thức.' },
        { role: 'user', content: `Chế độ: ${mode}. Nội dung gốc:\n${text}` },
      ], temperature: 0.5 }),
    });
    const j = await r.json();
    const out = j?.choices?.[0]?.message?.content?.trim();
    return out || templateRewrite(text, mode);
  } catch (e) { return templateRewrite(text, mode); }
}

// ---------- Routing ----------
function guestCanCreate(gid) {
  const g = db.guests[gid];
  return !!(g && (g.registeredLeadId || g.planCount < 3));
}
function recompute(plan) {
  const s = scorePlan(plan);
  plan.score = s.score; plan.issues = s.issues; plan.totalMinutes = s.totalMinutes; plan.updatedAt = nowIso();
}
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    const gid = ensureGuest(req, res);
    const guest = db.guests[gid];
    const profile = getProfile(gid);

    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
      return sendText(res, 200, html, 'text/html; charset=utf-8');
    }
    if (p === '/favicon.ico') return sendText(res, 204, '', 'text/plain');
    if (!p.startsWith('/api/')) return sendJson(res, 404, { error: 'NOT_FOUND' });

    const body = (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') ? await readBody(req) : {};
    if (body.__parseError) return sendJson(res, 400, { error: 'INVALID_JSON' });

    // Me / profile
    if (p === '/api/me' && req.method === 'GET') {
      return sendJson(res, 200, { guestId: gid, planCount: guest.planCount, remaining: guest.registeredLeadId ? null : Math.max(0, 3 - guest.planCount), registered: !!guest.registeredLeadId, profileName: profile.name || '', adminPasswordSet: !!ADMIN_PASSWORD, admin: isAdmin(req) });
    }
    if (p === '/api/profile' && req.method === 'GET') return sendJson(res, 200, profile);
    if (p === '/api/profile' && req.method === 'PUT') {
      const allowed = ['name', 'school', 'department', 'schoolYear', 'textbook', 'subject', 'grade', 'level', 'classInfo', 'classSize', 'supportCount', 'schoolSample'];
      allowed.forEach((k) => { if (body[k] !== undefined) profile[k] = String(body[k]); });
      if (body.conventions && typeof body.conventions === 'object') profile.conventions = body.conventions;
      db.profiles[gid] = profile; saveDb();
      return sendJson(res, 200, profile);
    }
    if (p === '/api/profile/extract' && req.method === 'POST') {
      const sample = body.sample !== undefined ? String(body.sample) : profile.schoolSample;
      profile.schoolSample = sample;
      profile.conventions = extractConventions(sample);
      db.profiles[gid] = profile; saveDb();
      return sendJson(res, 200, profile.conventions);
    }

    // Register
    if (p === '/api/register' && req.method === 'POST') {
      if (guest.registeredLeadId) {
        const existing = db.leads.find((l) => l.id === guest.registeredLeadId);
        return sendJson(res, 200, { ok: true, alreadyRegistered: true, lead: existing });
      }
      const name = String(body.name || '').trim();
      const phone = String(body.phone || '').trim();
      const email = String(body.email || '').trim();
      const errors = {};
      if (!name) errors.name = 'Vui lòng nhập họ tên.';
      if (!isValidVnPhone(phone)) errors.phone = 'Số điện thoại phải có 10 chữ số và bắt đầu bằng 0.';
      if (!isValidEmail(email)) errors.email = 'Email chưa đúng định dạng.';
      if (Object.keys(errors).length) return sendJson(res, 400, { error: 'VALIDATION', errors });
      const lead = { id: uid(), name, phone, email, level: String(body.level || ''), subject: String(body.subject || ''), plansCreatedAtRegistration: guest.planCount, isHot: guest.planCount >= 3, status: 'Chưa liên hệ', createdAt: nowIso() };
      db.leads.push(lead);
      guest.registeredLeadId = lead.id; saveDb();
      // Không ghi số điện thoại/email ra console.
      return sendJson(res, 200, { ok: true, lead });
    }

    // Rewrite (template, hoặc AI nếu có OPENAI_API_KEY)
    if (p === '/api/rewrite' && req.method === 'POST') {
      const out = await aiRewrite(String(body.text || ''), String(body.mode || 'detail'));
      return sendJson(res, 200, { text: out });
    }

    // Plans
    if (p === '/api/plans' && req.method === 'GET') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const level = u.searchParams.get('level') || '';
      const subject = u.searchParams.get('subject') || '';
      let list = db.plans.filter((x) => x.ownerGuestId === gid);
      if (q) list = list.filter((x) => (x.title + ' ' + x.subject).toLowerCase().includes(q));
      if (level) list = list.filter((x) => x.level === level);
      if (subject) list = list.filter((x) => x.subject === subject);
      return sendJson(res, 200, list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    if (p === '/api/plans' && req.method === 'POST') {
      if (!guestCanCreate(gid)) return sendJson(res, 403, { error: 'NEEDS_REGISTRATION', message: 'Bạn đã soạn đủ 3 giáo án miễn phí. Hãy đăng ký để soạn tiếp.' });
      const plan = generatePlan(body, profile);
      plan.ownerGuestId = gid;
      db.plans.push(plan); guest.planCount += 1; saveDb();
      return sendJson(res, 201, plan);
    }
    if (p === '/api/plans/batch' && req.method === 'POST') {
      const lines = String(body.lines || '').split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return sendJson(res, 400, { error: 'EMPTY' });
      if (lines.length > 15) return sendJson(res, 400, { error: 'TOO_MANY', message: 'Tối đa 15 giáo án/lần.' });
      if (!guest.registeredLeadId && guest.planCount + lines.length > 3) return sendJson(res, 403, { error: 'NEEDS_REGISTRATION', message: 'Số giáo án hàng loạt vượt quá 3 giáo án miễn phí. Hãy đăng ký trước.' });
      const created = []; const errors = [];
      for (const line of lines) {
        const parts = line.split('|').map((s) => s.trim());
        if (parts.length !== 3 || !parts[1]) { errors.push({ lesson: parts[1] || line, error: 'Dòng phải đúng định dạng: Tuần | Tên bài | Số tiết' }); continue; }
        const periods = Number(parts[2]);
        if (!Number.isFinite(periods) || periods < 1) { errors.push({ lesson: parts[1], error: 'Số tiết phải là số từ 1 trở lên.' }); continue; }
        const plan = generatePlan({ ...body, week: parts[0], title: parts[1], periods }, profile);
        plan.ownerGuestId = gid; db.plans.push(plan); created.push(plan);
      }
      guest.planCount += created.length; saveDb();
      return sendJson(res, 200, { created, errors });
    }
    const planMatch = p.match(/^\/api\/plans\/([^/]+)(?:\/(duplicate|share|submit|review|withdraw|download))?$/);
    if (planMatch) {
      const id = decodeURIComponent(planMatch[1]);
      const action = planMatch[2];
      const plan = db.plans.find((x) => x.id === id);
      if (!plan) return sendJson(res, 404, { error: 'PLAN_NOT_FOUND' });
      const isOwner = plan.ownerGuestId === gid;
      if (req.method === 'GET' && !action) {
        if (!isOwner && !plan.isCommunity) return sendJson(res, 403, { error: 'FORBIDDEN' });
        return sendJson(res, 200, plan);
      }
      if (req.method === 'PUT' && !action) {
        if (!isOwner) return sendJson(res, 403, { error: 'FORBIDDEN' });
        if (body.sections) { for (const k of SECTION_KEYS) if (body.sections[k] !== undefined) plan.sections[k] = String(body.sections[k]); }
        if (body.activities) plan.activities = body.activities;
        if (body.title !== undefined) plan.title = String(body.title);
        recompute(plan); saveDb(); return sendJson(res, 200, plan);
      }
      if (req.method === 'DELETE' && !action) {
        if (!isOwner) return sendJson(res, 403, { error: 'FORBIDDEN' });
        db.plans = db.plans.filter((x) => x.id !== id); saveDb(); return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'POST' && action === 'duplicate') {
        const copy = JSON.parse(JSON.stringify(plan));
        copy.id = uid(); copy.ownerGuestId = gid; copy.isCommunity = false; copy.orgId = ''; copy.reviewState = 'none'; copy.reviewHistory = [];
        copy.title = plan.title + ' (bản sao)'; copy.createdAt = nowIso(); copy.updatedAt = nowIso(); copy.isCopyOf = plan.id;
        db.plans.push(copy); saveDb(); return sendJson(res, 201, copy); // nhân bản KHÔNG tính vào 3 giáo án
      }
      if (req.method === 'POST' && action === 'share') {
        if (!isOwner) return sendJson(res, 403, { error: 'FORBIDDEN' });
        plan.isCommunity = true; plan.authorName = profile.name || plan.authorName; plan.authorSchool = profile.school || plan.authorSchool;
        if (plan.reuseCount == null) plan.reuseCount = 0;
        plan.updatedAt = nowIso(); saveDb(); return sendJson(res, 200, plan);
      }
      if (req.method === 'POST' && action === 'submit') {
        if (!isOwner) return sendJson(res, 403, { error: 'FORBIDDEN' });
        const org = db.orgs.find((o) => o.id === String(body.orgId || ''));
        if (!org || !org.members.some((m) => m.guestId === gid)) return sendJson(res, 400, { error: 'NOT_ORG_MEMBER' });
        plan.orgId = org.id; plan.reviewState = 'pending';
        plan.reviewHistory.push({ at: nowIso(), by: profile.name || 'Giáo viên', decision: 'submitted', comment: 'Nộp duyệt' });
        plan.updatedAt = nowIso(); saveDb(); return sendJson(res, 200, plan);
      }
      if (req.method === 'POST' && action === 'review') {
        const org = db.orgs.find((o) => o.id === plan.orgId);
        const member = org?.members.find((m) => m.guestId === gid);
        if (!member || !['Tổ trưởng', 'Ban giám hiệu'].includes(member.role)) return sendJson(res, 403, { error: 'REVIEWER_ONLY' });
        if (plan.reviewState !== 'pending') return sendJson(res, 400, { error: 'NOT_PENDING' });
        const decision = body.decision === 'approve' ? 'approved' : 'needs_edit';
        plan.reviewState = decision;
        plan.reviewHistory.push({ at: nowIso(), by: profile.name || member.role, decision, comment: String(body.comment || '') });
        plan.updatedAt = nowIso(); saveDb(); return sendJson(res, 200, plan);
      }
      if (req.method === 'POST' && action === 'withdraw') {
        if (!isOwner) return sendJson(res, 403, { error: 'FORBIDDEN' });
        plan.reviewState = 'none';
        plan.reviewHistory.push({ at: nowIso(), by: profile.name || 'Giáo viên', decision: 'withdrawn', comment: 'Rút khỏi hàng chờ' });
        plan.updatedAt = nowIso(); saveDb(); return sendJson(res, 200, plan);
      }
      if (req.method === 'GET' && action === 'download') {
        if (!isOwner && !plan.isCommunity) return sendJson(res, 403, { error: 'FORBIDDEN' });
        const format = u.searchParams.get('format') || 'doc';
        if (format === 'txt') return sendText(res, 200, renderTxt(plan), 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="giao-an-${plan.id}.doc"`);
        return sendText(res, 200, renderDoc(plan), 'application/msword; charset=utf-8');
      }
    }

    // Community
    if (p === '/api/community' && req.method === 'GET') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const level = u.searchParams.get('level') || ''; const subject = u.searchParams.get('subject') || '';
      let list = db.plans.filter((x) => x.isCommunity);
      if (q) list = list.filter((x) => (x.title + ' ' + x.subject).toLowerCase().includes(q));
      if (level) list = list.filter((x) => x.level === level);
      if (subject) list = list.filter((x) => x.subject === subject);
      return sendJson(res, 200, list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    const useMatch = p.match(/^\/api\/community\/([^/]+)\/use$/);
    if (useMatch && req.method === 'POST') {
      const orig = db.plans.find((x) => x.id === decodeURIComponent(useMatch[1]) && x.isCommunity);
      if (!orig) return sendJson(res, 404, { error: 'NOT_FOUND' });
      const copy = JSON.parse(JSON.stringify(orig));
      copy.id = uid(); copy.ownerGuestId = gid; copy.isCommunity = false; copy.orgId = ''; copy.reviewState = 'none'; copy.reviewHistory = []; copy.isCopyOf = orig.id;
      copy.createdAt = nowIso(); copy.updatedAt = nowIso();
      db.plans.push(copy); orig.reuseCount = (orig.reuseCount || 0) + 1; saveDb();
      return sendJson(res, 201, copy); // dùng cộng đồng KHÔNG tính vào 3 giáo án
    }

    // Orgs
    if (p === '/api/orgs' && req.method === 'GET') {
      return sendJson(res, 200, db.orgs.filter((o) => o.members.some((m) => m.guestId === gid)));
    }
    if (p === '/api/orgs' && req.method === 'POST') {
      const name = String(body.name || '').trim();
      if (!name) return sendJson(res, 400, { error: 'NAME_REQUIRED' });
      const code = crypto.randomBytes(3).toString('hex').toUpperCase();
      const org = { id: uid(), name, inviteCode: code, members: [{ guestId: gid, role: 'Tổ trưởng', name: profile.name || '' }], createdAt: nowIso() };
      db.orgs.push(org); saveDb(); return sendJson(res, 201, org);
    }
    if (p === '/api/orgs/join' && req.method === 'POST') {
      const code = String(body.code || '').trim().toUpperCase();
      const org = db.orgs.find((o) => o.inviteCode.toUpperCase() === code);
      if (!org) return sendJson(res, 404, { error: 'CODE_NOT_FOUND' });
      if (!org.members.some((m) => m.guestId === gid)) org.members.push({ guestId: gid, role: String(body.role || 'Giáo viên'), name: profile.name || '' });
      saveDb(); return sendJson(res, 200, org);
    }
    const roleMatch = p.match(/^\/api\/orgs\/([^/]+)\/members\/([^/]+)\/role$/);
    if (roleMatch && req.method === 'POST') {
      const org = db.orgs.find((o) => o.id === decodeURIComponent(roleMatch[1]));
      if (!org) return sendJson(res, 404, { error: 'NOT_FOUND' });
      const me = org.members.find((m) => m.guestId === gid);
      if (!me || me.role !== 'Tổ trưởng') return sendJson(res, 403, { error: 'LEADER_ONLY' });
      const member = org.members.find((m) => m.guestId === decodeURIComponent(roleMatch[2]));
      if (!member) return sendJson(res, 404, { error: 'MEMBER_NOT_FOUND' });
      member.role = String(body.role || 'Giáo viên'); saveDb(); return sendJson(res, 200, org);
    }

    const orgPlansMatch = p.match(/^\/api\/orgs\/([^/]+)\/plans$/);
    if (orgPlansMatch && req.method === 'GET') {
      const org = db.orgs.find((o) => o.id === decodeURIComponent(orgPlansMatch[1]));
      if (!org || !org.members.some((m) => m.guestId === gid)) return sendJson(res, 403, { error: 'NOT_ORG_MEMBER' });
      return sendJson(res, 200, db.plans.filter((x) => x.orgId === org.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }

    // Stats
    if (p === '/api/stats' && req.method === 'GET') {
      const orgId = u.searchParams.get('orgId') || '';
      const plans = orgId ? db.plans.filter((x) => x.orgId === orgId) : db.plans;
      const pending = plans.filter((x) => x.reviewState === 'pending').length;
      const approved = plans.filter((x) => x.reviewState === 'approved').length;
      const needsEdit = plans.filter((x) => x.reviewState === 'needs_edit').length;
      const decided = approved + needsEdit;
      const bySubject = {}; const byLevel = {};
      plans.forEach((x) => { bySubject[x.subject || 'Chưa rõ'] = (bySubject[x.subject || 'Chưa rõ'] || 0) + 1; byLevel[x.level || 'Chưa rõ'] = (byLevel[x.level || 'Chưa rõ'] || 0) + 1; });
      const recentReviews = [];
      plans.forEach((x) => (x.reviewHistory || []).forEach((h) => recentReviews.push({ plan: x.title, ...h })));
      recentReviews.sort((a, b) => b.at.localeCompare(a.at));
      return sendJson(res, 200, {
        total: plans.length, submitted: pending + approved + needsEdit, pending, approved, needsEdit,
        approvalRate: decided ? Math.round((approved / decided) * 100) : 0,
        bySubject, byLevel,
        communityReuse: db.plans.filter((x) => x.isCommunity).reduce((s, x) => s + (x.reuseCount || 0), 0),
        communityPlans: db.plans.filter((x) => x.isCommunity).length,
        recentReviews: recentReviews.slice(0, 10),
      });
    }

    // Admin / leads
    if (p === '/api/admin/login' && req.method === 'POST') {
      if (!ADMIN_PASSWORD) return sendJson(res, 200, { ok: true, note: 'Chưa đặt ADMIN_PASSWORD nên tab lead đang mở.' });
      const pw = String(body.password || '');
      const a = Buffer.from(pw); const b = Buffer.from(ADMIN_PASSWORD);
      const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!ok) return sendJson(res, 401, { error: 'WRONG_PASSWORD' });
      const token = crypto.randomBytes(24).toString('hex'); adminTokens.add(token);
      res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/admin/logout' && req.method === 'POST') {
      const t = parseCookies(req).admin_token; if (t) adminTokens.delete(t);
      res.setHeader('Set-Cookie', 'admin_token=; Path=/; HttpOnly; Max-Age=0');
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/leads' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const status = u.searchParams.get('status') || '';
      let list = [...db.leads];
      if (q) list = list.filter((l) => (l.name + ' ' + l.email + ' ' + l.phone).toLowerCase().includes(q));
      if (status) list = list.filter((l) => l.status === status);
      return sendJson(res, 200, list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    const leadMatch = p.match(/^\/api\/leads\/([^/]+)$/);
    if (leadMatch && req.method === 'PATCH') {
      if (!requireAdmin(req, res)) return;
      const lead = db.leads.find((l) => l.id === decodeURIComponent(leadMatch[1]));
      if (!lead) return sendJson(res, 404, { error: 'NOT_FOUND' });
      if (['Chưa liên hệ', 'Đã liên hệ', 'Đã dùng bản đầy đủ'].includes(String(body.status))) lead.status = body.status;
      saveDb(); return sendJson(res, 200, lead);
    }
    if (p === '/api/leads/export' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const header = ['Họ tên', 'Số điện thoại', 'Email', 'Cấp', 'Môn', 'Giáo án lúc đăng ký', 'Khách nóng', 'Trạng thái', 'Ngày đăng ký'];
      const rows = db.leads.map((l) => [l.name, l.phone, l.email, l.level, l.subject, l.plansCreatedAtRegistration, l.isHot ? 'Có' : 'Không', l.status, l.createdAt].map(csvCell).join(','));
      return sendText(res, 200, '\ufeff' + header.join(',') + '\n' + rows.join('\n'), 'text/csv; charset=utf-8');
    }

    return sendJson(res, 404, { error: 'NOT_FOUND' });
  } catch (e) {
    // Không log chi tiết request (có thể chứa thông tin liên hệ).
    return sendJson(res, 500, { error: 'SERVER_ERROR' });
  }
});
server.listen(PORT, () => {
  console.log(`App Soạn Giáo Án đang chạy tại cổng ${PORT}`);
});
