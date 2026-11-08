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
// Cấu trúc mục theo đúng mẫu giáo án sếp gửi 08/11/2026 (LS&ĐL 9 KNTT, Bài 3):
// I. MỤC TIÊU (1. Về kiến thức — 2. Về năng lực: chung + đặc thù môn — 3. Về phẩm chất)
// II. THIẾT BỊ DẠY HỌC VÀ HỌC LIỆU (1. Giáo viên — 2. Học sinh)
// III. TIẾN TRÌNH DẠY HỌC (chi tiết từng hoạt động, xem plan.activities)
// IV. ĐÁNH GIÁ — V. RÚT KINH NGHIỆM (giữ thêm theo CV 5512).
const SECTIONS = [
  { key: 'muc_tieu', label: 'I. MỤC TIÊU' },
  { key: 'thiet_bi', label: 'II. THIẾT BỊ DẠY HỌC VÀ HỌC LIỆU' },
  { key: 'tien_trinh', label: 'III. TIẾN TRÌNH DẠY HỌC' },
  { key: 'danh_gia', label: 'IV. ĐÁNH GIÁ' },
  { key: 'rut_kinh_nghiem', label: 'V. RÚT KINH NGHIỆM SAU TIẾT DẠY' },
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
  if (filled < SECTION_KEYS.length) issues.push({ code: 'incomplete', message: `Mới đủ ${filled}/5 mục theo mẫu giáo án (I. Mục tiêu — II. Thiết bị — III. Tiến trình — IV. Đánh giá — V. Rút kinh nghiệm).`, suggestion: 'Bổ sung các mục còn trống, đặc biệt là mục tiêu, tiến trình và đánh giá.' });
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
  // 5 hoạt động (theo góp ý giáo viên kỳ cựu 30 năm đứng lớp, 26/10/2026):
  // KHÔNG còn hoạt động "Kiểm tra bài cũ" và KHÔNG còn dùng từ "củng cố".
  // Khởi động đã gộp việc gợi nhớ kiến thức bài trước (hát / trò chơi + phép tính, câu hỏi cụ thể).
  // Hoạt động cuối là trò chơi cả lớp tham gia, rồi mới giao bài tập về nhà, dặn dò.
  // Tổng vẫn đúng thời lượng tiết.
  if (lessonMinutes >= 45) return [[5, 'Khởi động'], [16, 'Hình thành kiến thức mới'], [14, 'Luyện tập, thực hành'], [6, 'Vận dụng, trải nghiệm'], [4, 'Trò chơi kết thúc tiết học']];
  if (lessonMinutes >= 40) return [[5, 'Khởi động'], [14, 'Hình thành kiến thức mới'], [12, 'Luyện tập, thực hành'], [5, 'Vận dụng, trải nghiệm'], [4, 'Trò chơi kết thúc tiết học']];
  return [[5, 'Khởi động'], [12, 'Hình thành kiến thức mới'], [10, 'Luyện tập, thực hành'], [5, 'Vận dụng, trải nghiệm'], [3, 'Trò chơi kết thúc tiết học']];
}
function expectedFor(name, title, subject) {
  const base = `Bài “${title}” (${subject || 'môn học'}). Giáo viên điền tên bài tập, số trang SGK thật và sửa lại đáp án cụ thể theo Sách giáo viên trước khi dạy.`;
  if (name === 'Khởi động') return `Câu trả lời dự kiến: HS hát / chơi trò chơi, trả lời đúng 2–3 phép tính (hoặc câu hỏi) cụ thể của bài trước mà GV đưa ra, nêu được dự đoán về bài mới. ${base}`;
  if (name.startsWith('Hình thành')) return `Câu trả lời dự kiến: HS quan sát tình huống trong SGK, trả lời đúng câu hỏi dẫn dắt và rút ra đúng kiến thức mới của bài, trình bày được ý chính bằng lời của mình. ${base}`;
  if (name.startsWith('Luyện tập')) return `Đáp án dự kiến — Bài tập 1 (bảng con, SGK tr. ___): HS viết đúng đáp án lên bảng con và giơ lên cùng lúc. Bài tập 2 (cá nhân vào vở, SGK tr. ___): HS làm đúng yêu cầu, trình bày được cách làm. Bài tập 3 (thảo luận nhóm, SGK tr. ___): HS thảo luận và trình bày đúng kết quả, giải thích được vì sao. GV chấp nhận cách làm khác nếu đúng bản chất. ${base}`;
  if (name.startsWith('Vận dụng')) return `Câu trả lời dự kiến (mở): HS giải quyết đúng tình huống cụ thể GV nêu, đưa ra được cách làm và giải thích được vì sao làm như vậy; GV chấp nhận các cách giải quyết khác nhau nếu đúng bản chất. ${base}`;
  return `Câu trả lời dự kiến: HS tham gia trò chơi cả lớp, qua trò chơi nhắc lại đúng 2–3 ý chính của bài. Bài tập về nhà: hoàn thành bài tập còn lại trong SGK; GV xem lại bài của HS vào đầu tiết sau. ${base}`;
}
// 5 câu trắc nghiệm mẫu cho hoạt động Luyện tập (theo mẫu: trò chơi “Vòng quay may mắn”).
// Câu hỏi hỏi về mục đích / cách học / vận dụng của bài (không bịa sự kiện, số liệu trong SGK);
// đáp án đúng là đáp án phù hợp với nội dung bài đã soạn. GV thay bằng 5 câu hỏi nội
// dung thật trong SGK và đối chiếu đáp án theo SGV trước khi dạy.
function quizFor(T) {
  const qs = [
    { stem: `Nội dung trọng tâm của bài “${T}” là gì?`, opts: ['Những nét chính của bài và cách vận dụng vào thực tế.', 'Chỉ học thuộc tên bài.', 'Chỉ chép lại nội dung trong SGK.', 'Chỉ làm bài tập về nhà.'], correct: 0 },
    { stem: `Khi học bài “${T}”, học sinh cần làm gì trước tiên?`, opts: ['Học thuộc lòng cả bài.', 'Làm bài tập khó nhất trước.', 'Quan sát tình huống trong SGK và trả lời câu hỏi dẫn dắt.', 'Chép bài của bạn.'], correct: 2 },
    { stem: `Kiến thức bài “${T}” giúp ích gì trong cuộc sống?`, opts: ['Chỉ để làm bài tập trên lớp.', 'Vận dụng để giải quyết tình huống thực tế.', 'Không dùng được ngoài lớp học.', 'Chỉ để thi.'], correct: 1 },
    { stem: 'Trong giờ học, khi bạn trả lời chưa đúng, em nên làm gì?', opts: ['Lắng nghe, nhận xét và bổ sung giúp bạn.', 'Cười bạn.', 'Im lặng, không quan tâm.', 'Nói bạn sai rồi, không cần nghe nữa.'], correct: 0 },
    { stem: `Sau bài học “${T}”, em cần làm gì ở nhà?`, opts: ['Không cần làm gì thêm.', 'Chỉ chơi, không ôn bài.', 'Học thuộc lòng bài sau.', 'Hoàn thành bài tập còn lại trong SGK và đọc trước bài sau.'], correct: 3 },
  ];
  const letters = ['A', 'B', 'C', 'D'];
  const text = qs.map((q, i) => `Câu ${i + 1}: ${q.stem}\n${q.opts.map((o, j) => `${letters[j]}. ${o}`).join('\n')}`).join('\n');
  const key = 'Đáp án: ' + qs.map((q, i) => `${i + 1}. ${letters[q.correct]}`).join(', ');
  return { text, key };
}
// Mỗi hoạt động theo đúng mẫu giáo án sếp gửi 08/11/2026:
// a. Mục tiêu — b. Tổ chức thực hiện gồm 4 bước: Chuyển giao nhiệm vụ / Thực hiện nhiệm vụ /
// Báo cáo, thảo luận / Kết luận, nhận định (GV) — và Sản phẩm dự kiến.
// (teacher/student/steps giữ nguyên để bảng tổng hợp 3 cột trong app vẫn dùng được.)
function detailFor(name, title, subject, grade) {
  const who = `${subject}${grade ? ' — ' + grade : ''}`;
  const T = title || 'bài học';
  const pageNote = `GV điền số trang SGK thật (bộ sách đang dùng) vào chỗ “tr. ___” trước khi dạy.`;
  const P = (label, text) => ({ label, text });
  if (name === 'Khởi động') return {
    teacher: `GV ổn định lớp rồi cho cả lớp hát một bài hát ngắn gắn với bài trước, hoặc tổ chức trò chơi “Ai nhanh hơn” gắn với kiến thức bài trước. GV nói rõ ràng: “Cả lớp cùng hát bài… nào. Hát xong, cô / thầy đố các em 3 phép tính (hoặc 3 câu hỏi) của bài trước, bạn nào biết thì giơ bảng con lên.” GV viết 2–3 phép tính / câu hỏi cụ thể của bài trước lên bảng (ví dụ với bài phép cộng: 2 + 3 = ?, 4 + 1 = ?, 5 + 2 = ? — GV thay bằng phép tính / câu hỏi thật của bài trước mà lớp vừa học), HS viết đáp án lên bảng con và giơ lên cùng lúc, GV quan sát nhanh, khen cụ thể: “Bạn trả lời rất nhanh, cả lớp vỗ tay khen bạn nào.” Nếu HS trả lời chưa đúng, GV không chê mà gợi ý: “Bạn đã gần đúng rồi, bạn nào bổ sung giúp bạn nào?” Sau đó GV dẫn dắt rõ ràng: “Các phép tính vừa rồi chính là cầu nối để hôm nay chúng ta học bài mới.” GV viết tên bài “${T}” (${who}) lên bảng, yêu cầu HS đọc tên bài và mở SGK.`,
    student: `Học sinh hát hoặc chơi trò chơi khởi động, nghe phép tính / câu hỏi cụ thể của bài trước, viết đáp án lên bảng con và giơ lên cùng lúc, nhận xét câu trả lời của bạn, đọc tên bài mới và mở SGK theo yêu cầu của GV.`,
    steps: ['GV cho cả lớp hát một bài hát ngắn hoặc chơi trò chơi “Ai nhanh hơn” gắn với kiến thức bài trước.', 'GV viết 2–3 phép tính / câu hỏi cụ thể của bài trước lên bảng, HS viết đáp án lên bảng con và giơ lên cùng lúc.', 'GV khen, gợi ý bổ sung khi HS trả lời chưa đúng, rồi viết tên bài mới lên bảng và dẫn dắt vào bài.'],
    goal: 'Tạo tâm thế hứng thú cho học sinh đi vào tìm hiểu bài mới.',
    phases: [
      P('Chuyển giao nhiệm vụ', `GV cho HS quan sát tranh / hình ảnh và đọc thông tin phần Mở đầu (SGK) để trả lời câu hỏi. GV nêu câu hỏi: “Các em quan sát tranh và cho cô / thầy biết: các em thấy gì? Điều gì khiến các em thắc mắc?” Đồng thời GV viết 2–3 phép tính / câu hỏi cụ thể của bài trước lên bảng (ví dụ với bài phép cộng: 2 + 3 = ?, 4 + 1 = ?, 5 + 2 = ? — GV thay bằng phép tính / câu hỏi thật của bài trước mà lớp vừa học).`),
      P('Thực hiện nhiệm vụ', 'GV hướng dẫn HS tham gia trò chơi / hát bài hát khởi động, trả lời câu hỏi. HS viết đáp án lên bảng con và giơ lên cùng lúc.'),
      P('Báo cáo, thảo luận', 'HS trả lời câu hỏi (dựa vào SGK và kiến thức bài trước), các bạn nhận xét, bổ sung.'),
      P('Kết luận, nhận định (GV)', `GV nhận xét (hoạt động của HS và sản phẩm), chốt kiến thức, chuyển dẫn vào hoạt động hình thành kiến thức mới. GV dẫn vào bài: “Từ những gì các em vừa trả lời, hôm nay chúng ta sẽ cùng tìm hiểu bài “${T}” để hiểu rõ hơn về nội dung này.”`),
    ],
    product: `Câu trả lời dự kiến của HS: trả lời đúng phép tính / câu hỏi cụ thể của bài trước, nêu được dự đoán về bài mới. GV dẫn vào bài: “Từ những gì các em vừa trả lời, hôm nay chúng ta sẽ cùng tìm hiểu bài “${T}”.”`,
  };
  if (name.startsWith('Hình thành')) return {
    teacher: `GV dựa vào tình huống trong SGK: “Các em mở SGK tr. ___ (tình huống mở đầu bài “${T}”), quan sát tranh và đọc thầm tình huống trong sách.” GV đọc to tình huống trong SGK, chỉ vào tranh và hỏi: “Các em thấy gì trong tranh? Tình huống này hỏi chúng ta điều gì?” GV cho HS quan sát 1–2 phút, sau đó đặt câu hỏi dẫn dắt theo từng bước, không hỏi dồn: bước 1 hỏi “Cái gì?”, bước 2 hỏi “Vì sao lại như vậy?”, bước 3 hỏi “Vậy chúng ta rút ra được điều gì?” Khi HS trả lời, GV ghi ý đúng lên bảng theo từng ý, hỏi lại: “Bạn nào có cách nói khác mà vẫn đúng ý này không?” GV chốt kiến thức bằng lời khẳng định rõ ràng: “Như vậy, kiến thức trọng tâm của bài “${T}” là…”, viết khung kiến thức lên bảng, yêu cầu HS đọc lại khung kiến thức 2 lần và ghi vào vở. Với HS còn lúng túng, GV nói riêng: “Bạn cứ nói theo ý hiểu của mình, sai cũng không sao, cô / thầy sẽ giúp bạn sửa.” ${pageNote}`,
    student: `Học sinh mở SGK đúng trang tình huống, quan sát tranh và đọc tình huống trong sách, suy nghĩ và trả lời từng câu hỏi dẫn dắt của GV, thảo luận nhóm 2–4 bạn để thống nhất ý trả lời, trình bày ý của nhóm, nhận xét ý của nhóm bạn, đọc lại khung kiến thức trên bảng và ghi vào vở.`,
    steps: ['GV cho HS mở SGK đúng trang tình huống, đọc to tình huống trong sách và hỏi “Các em thấy gì trong tranh?”.', 'HS quan sát tranh SGK, thảo luận nhóm, trả lời câu hỏi dẫn dắt theo từng bước “Cái gì? Vì sao? Rút ra điều gì?”.', 'GV chốt kiến thức, viết khung kiến thức lên bảng, HS đọc lại và ghi vào vở.'],
    goal: `Học sinh biết được những nét chính về bài “${T}” và rút ra được kiến thức mới của bài.`,
    phases: [
      P('Chuyển giao nhiệm vụ', `GV yêu cầu HS nghiên cứu SGK và tư liệu đã tìm hiểu, chia nhóm (Nhóm 1 / Nhóm 2) theo từng nội dung của bài, giao nhiệm vụ rõ ràng cho từng nhóm. GV nêu câu hỏi dẫn dắt gắn với tình huống trong SGK (SGK tr. ___). ${pageNote}`),
      P('Thực hiện nhiệm vụ', 'GV hướng dẫn HS trả lời câu hỏi dẫn dắt theo từng bước: “Cái gì? Vì sao lại như vậy? Rút ra điều gì?” HS quan sát tranh trong SGK, thảo luận nhóm, kiểm tra lại nội dung, chuẩn bị lên bảng trình bày kết quả.'),
      P('Báo cáo, thảo luận', 'GV gọi đại diện 1 nhóm trình bày, các nhóm khác lắng nghe, nhận xét, bổ sung. HS trả lời câu hỏi của GV.'),
      P('Kết luận, nhận định (GV)', `GV chốt bài: kiến thức trọng tâm của bài “${T}” là…; viết khung kiến thức lên bảng, yêu cầu HS đọc lại 2 lần và ghi vào vở.`),
    ],
    product: `Sản phẩm dự kiến (HS ghi vào vở):\n1. Những nét chính của bài “${T}” (theo tình huống trong SGK tr. ___).\n2. Kiến thức trọng tâm: HS trình bày được ý chính của bài bằng lời của mình.\n3. Ví dụ minh họa trong SGK và liên hệ thực tế.\n${pageNote}`,
  };
  if (name.startsWith('Luyện tập')) {
    const quiz = quizFor(T);
    return {
      teacher: `GV giao từng bài tập một, không giao dồn, mỗi bài nói rõ tên bài, số trang và hình thức làm. Bài tập 1 (SGK tr. ___): “Các em mở SGK tr. ___, làm Bài tập 1. Bài này chúng ta làm bằng bảng con: nghe cô / thầy đọc đề, viết đáp án lên bảng con, giơ lên cùng lúc nhé.” GV đọc đề từng câu, HS giơ bảng con, GV quan sát nhanh cả lớp, chữa ngay câu nào nhiều bạn sai. Bài tập 2 (SGK tr. ___): “Bây giờ làm Bài tập 2, làm cá nhân vào vở. Bạn nào làm xong thì giơ tay, cô / thầy sẽ đến xem bài.” GV đi từng bàn, hướng dẫn riêng HS làm chậm: “Bạn làm từng bước thế này nhé: bước 1…, bước 2… Bạn thử làm lại xem.” Với HS làm nhanh, GV giao thêm Bài tập 3. Bài tập 3 (SGK tr. ___): “Bài tập 3 chúng ta thảo luận nhóm 4 bạn, mỗi nhóm thống nhất một cách làm rồi cử một bạn trình bày.” Hết thời gian, GV gọi HS lên bảng trình bày, hỏi cả lớp: “Bạn làm như vậy đúng hay sai? Vì sao?” GV chữa bài chi tiết từng bước trên bảng, công bố đáp án, yêu cầu HS đối chiếu và tự sửa bài của mình bằng bút khác màu, rồi chốt: “Cách làm đúng của dạng bài này là… Các em nhớ kỹ bước này nhé.” ${pageNote}`,
      student: `Học sinh mở SGK đúng trang từng bài tập, làm Bài tập 1 bằng bảng con (viết đáp án và giơ lên cùng lúc), làm Bài tập 2 cá nhân vào vở (giơ tay khi làm xong hoặc khi gặp khó khăn), làm Bài tập 3 thảo luận nhóm 4 bạn và cử bạn trình bày, lên bảng trình bày cách làm, nhận xét bài của bạn, đối chiếu đáp án và tự sửa bài bằng bút khác màu.`,
      steps: ['Bài tập 1 (SGK tr. ___): làm bằng bảng con — GV đọc đề từng câu, HS viết đáp án lên bảng con và giơ lên cùng lúc, GV chữa ngay câu nhiều bạn sai.', 'Bài tập 2 (SGK tr. ___): làm cá nhân vào vở — GV đi từng bàn, hướng dẫn riêng HS chậm, giao thêm cho HS nhanh.', 'Bài tập 3 (SGK tr. ___): thảo luận nhóm 4 bạn — mỗi nhóm thống nhất một cách làm, cử bạn trình bày, GV chữa từng bước và công bố đáp án.'],
      goal: 'Hệ thống hóa và hoàn thiện nội dung kiến thức đã tìm hiểu ở hoạt động hình thành kiến thức mới.',
      phases: [
        P('Chuyển giao nhiệm vụ', `GV hướng dẫn HS chơi trò chơi “Vòng quay may mắn” và trả lời 5 câu hỏi trắc nghiệm về bài “${T}”. GV nêu luật chơi: quay vòng quay, đọc câu hỏi, HS giơ bảng con chọn đáp án A / B / C / D.\n${quiz.text}`),
        P('Thực hiện nhiệm vụ', 'HS tham gia trò chơi, suy nghĩ và chọn đáp án cho từng câu hỏi.'),
        P('Báo cáo, thảo luận', `HS giơ bảng con đáp án. GV công bố đáp án đúng sau mỗi câu và hỏi: “Bạn nào chọn khác? Vì sao bạn chọn như vậy?”\n${quiz.key}`),
        P('Kết luận, nhận định (GV)', 'GV nhận xét bài làm của HS, chữa câu nhiều HS sai và chốt lại ý chính của bài.'),
      ],
      product: `${quiz.text}\n${quiz.key}\nĐáp án dự kiến — GV đối chiếu SGK/SGV trước khi dạy; có thể thay 5 câu hỏi trên bằng câu hỏi nội dung thật của bài trong SGK.`,
    };
  }
  if (name.startsWith('Vận dụng')) return {
    teacher: `GV nêu một tình huống cụ thể, gần gũi với đời sống của HS: “Bây giờ cô / thầy đố các em một tình huống thật nhé: Mẹ cho Lan 5 quả cam, Lan đã ăn 2 quả. Hỏi Lan còn lại mấy quả cam? Các em dùng kiến thức bài “${T}” vừa học để trả lời nhé.” (GV thay bằng tình huống cụ thể thật, gắn với nội dung bài và đời sống của HS: đi chợ, chia đồ dùng, đếm đồ vật trong lớp, giúp đỡ người thân.) GV chia nhóm, giao nhiệm vụ rõ ràng cho từng nhóm: “Nhóm 1 nêu cách làm, nhóm 2 tính kết quả, nhóm 3 nhận xét xem cách làm đó có đúng không.” GV đi hỗ trợ từng nhóm, gợi ý khi nhóm bí: “Các em thử nghĩ xem, kiến thức vừa học giúp mình làm bước nào trước?” Khi các nhóm trình bày, GV nhận xét cụ thể từng nhóm, không nhận xét chung chung, và kết luận: “Như vậy kiến thức bài hôm nay không chỉ để làm bài tập mà còn dùng được trong cuộc sống hằng ngày.”`,
    student: `Học sinh nghe tình huống cụ thể GV nêu, thảo luận nhóm để tìm cách giải quyết bằng kiến thức vừa học, tính kết quả và trình bày cách làm trước lớp, nhận xét cách làm của nhóm bạn và nêu liên hệ với cuộc sống của mình.`,
    steps: ['GV nêu một tình huống cụ thể, gần gũi (ví dụ: mẹ cho 5 quả cam, ăn 2 quả, còn mấy quả?), giao nhiệm vụ rõ ràng cho từng nhóm.', 'HS thảo luận nhóm, dùng kiến thức vừa học để giải quyết tình huống, GV đi hỗ trợ và gợi ý khi nhóm bí.', 'Các nhóm trình bày cách làm, GV nhận xét cụ thể từng nhóm và kết luận ý nghĩa thực tế của bài học.'],
    goal: 'Giúp HS vận dụng kiến thức mới đã lĩnh hội để giải quyết những vấn đề mới trong học tập, cuộc sống.',
    phases: [
      P('Chuyển giao nhiệm vụ', `GV giao bài tập về nhà: sưu tầm tư liệu (sách, báo, internet) về một nội dung gắn với bài “${T}” và giới thiệu với bạn. GV đọc rõ yêu cầu của bài tập, ví dụ: “Các em hãy tìm một ví dụ thực tế thể hiện nội dung bài học hôm nay và kể lại cho cả lớp nghe vào tiết sau.”`),
      P('Thực hiện nhiệm vụ', 'GV hướng dẫn HS đọc và xác định yêu cầu của bài tập. HS đọc và xác định yêu cầu: cần tìm gì, trình bày như thế nào.'),
      P('Báo cáo, thảo luận', `Gợi ý trả lời: HS trình bày ví dụ thực tế đã tìm được, giải thích vì sao ví dụ đó thể hiện đúng nội dung bài “${T}”; các bạn nhận xét, bổ sung.`),
      P('Kết luận, nhận định (GV)', 'GV dặn dò HS những nội dung cần học ở nhà và chuẩn bị cho bài học sau: đọc trước bài sau, quan sát một số hình ảnh trong bài, sưu tầm tư liệu liên quan.'),
    ],
    product: `Gợi ý trả lời: HS nêu được ví dụ thực tế đúng với nội dung bài “${T}”, giải thích được vì sao ví dụ đó đúng và rút ra được ý nghĩa.\n(GV điền gợi ý trả lời cụ thể theo nội dung bài và SGK trước khi dạy.)`,
  };
  return {
    teacher: `GV tổ chức trò chơi kết thúc tiết học cho cả lớp cùng tham gia, ví dụ trò chơi “Ai nhanh hơn” hoặc “Tiếp sức”: GV nêu luật chơi rõ ràng: “Cô / thầy đọc một phép tính (hoặc một câu hỏi) của bài hôm nay, cả lớp cùng giơ bảng con trả lời, bạn trả lời đúng và nhanh được cộng điểm cho tổ.” GV đọc từng câu hỏi gắn với 2–3 ý chính của bài “${T}”, HS cả lớp cùng trả lời bằng bảng con, GV công bố đáp án sau mỗi câu và khen tổ trả lời nhanh và đúng. Chơi xong, GV nhận xét tiết học cụ thể: “Hôm nay lớp mình làm bài rất tốt ở phần…, phần… còn cần cố gắng thêm.” GV giao bài tập về nhà rõ ràng: “Về nhà các em làm bài tập còn lại trong SGK, đọc trước bài sau và chuẩn bị…” GV dặn dò: “Các em nhớ mang đủ sách vở cho tiết sau nhé.”`,
    student: `Học sinh cả lớp cùng tham gia trò chơi kết thúc tiết học, nghe câu hỏi của GV, viết đáp án lên bảng con và giơ lên cùng lúc, qua trò chơi nhắc lại được 2–3 ý chính của bài, lắng nghe nhận xét của GV, ghi bài tập về nhà và chuẩn bị bài sau, nêu điều còn thắc mắc (nếu có) để GV giải đáp trước khi hết tiết.`,
    steps: ['GV tổ chức trò chơi cả lớp cùng tham gia (“Ai nhanh hơn” / “Tiếp sức”), đọc từng câu hỏi gắn với ý chính của bài.', 'HS cả lớp cùng trả lời bằng bảng con, GV công bố đáp án sau mỗi câu và khen tổ trả lời nhanh, đúng.', 'GV nhận xét tiết học cụ thể, giao bài tập về nhà rõ ràng, HS ghi bài và chuẩn bị bài sau.'],
    goal: 'HS nhắc lại được 2–3 ý chính của bài qua trò chơi cả lớp; GV nhận xét tiết học và giao bài tập về nhà.',
    phases: [
      P('Chuyển giao nhiệm vụ', 'GV tổ chức trò chơi “Ai nhanh hơn” (hoặc “Tiếp sức”) cho cả lớp cùng tham gia: GV đọc một câu hỏi gắn với ý chính của bài, cả lớp cùng giơ bảng con trả lời.'),
      P('Thực hiện nhiệm vụ', 'HS cả lớp cùng tham gia trò chơi, viết đáp án lên bảng con và giơ lên cùng lúc.'),
      P('Báo cáo, thảo luận', 'GV công bố đáp án sau mỗi câu, khen tổ trả lời nhanh và đúng; HS nhắc lại ý chính của bài qua từng câu hỏi.'),
      P('Kết luận, nhận định (GV)', 'GV nhận xét tiết học cụ thể, giao bài tập về nhà rõ ràng: hoàn thành bài tập còn lại trong SGK, đọc trước bài sau; dặn dò HS chuẩn bị sách vở cho tiết sau.'),
    ],
    product: `Kết quả trò chơi: các tổ trả lời đúng 2–3 ý chính của bài “${T}”.\nBài tập về nhà: hoàn thành bài tập còn lại trong SGK; đọc trước bài sau và chuẩn bị sách vở cho tiết sau.`,
  };
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
  const acts = scaleActivities(lessonMinutes).map(([duration, name]) => {
    const d = detailFor(name, title, subject, grade);
    return {
      name, duration,
      teacher: d.teacher,
      student: d.student,
      expected: expectedFor(name, title, subject),
      goal: d.goal || '',
      phases: d.phases || [],
      product: d.product || '',
      // steps có phút riêng chỉ để minh họa chi tiết; tổng điểm CHỈ tính duration chính, không cộng steps.
      steps: d.steps.map((text, i) => ({ text, minutes: Math.max(1, Math.round(duration / d.steps.length)) })),
    };
  });
  const support = profile.supportCount ? ` Lớp có ${profile.classSize || ''} học sinh, trong đó ${profile.supportCount} em cần hỗ trợ thêm.` : '';
  // Đầu trang theo mẫu: Ngày soạn (mặc định hôm nay, giờ Việt Nam), Ngày giảng, Tiết.
  const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
  const dd = String(vnNow.getUTCDate()).padStart(2, '0'), mm = String(vnNow.getUTCMonth() + 1).padStart(2, '0'), yyyy = vnNow.getUTCFullYear();
  const ngaySoan = input.ngaySoan || `${dd}/${mm}/${yyyy}`;
  const ngayGiang = input.ngayGiang || '';
  const tiet = input.tiet || '';
  const sections = {
    // I. MỤC TIÊU theo mẫu: 1. Về kiến thức — 2. Về năng lực (chung + đặc thù môn) — 3. Về phẩm chất.
    muc_tieu: `${refNote}\n1. Về kiến thức\n- Học sinh nêu được những nét chính về bài “${title}”.\n- Học sinh trình bày được nội dung trọng tâm của bài bằng lời của mình.\n2. Về năng lực\n- Năng lực chung:\n+ Hình thành và phát triển năng lực tìm hiểu, nhận thức qua việc sưu tầm tài liệu, tranh, ảnh để tìm hiểu về bài “${title}”.\n+ Hình thành năng lực liên hệ, vận dụng kiến thức của bài học vào thực tiễn cuộc sống, từ đó lí giải được các sự kiện, hiện tượng đang diễn ra (ở mức độ đơn giản).\n+ Hiểu rõ nhiệm vụ của nhóm; đánh giá được khả năng của bản thân và tự nhận công việc phù hợp.\n- Năng lực đặc thù môn ${subject || 'học'}:\n+ Khai thác và sử dụng thông tin của tư liệu, hình ảnh trong SGK để nhận thức về nội dung bài “${title}”.\n+ Vận dụng kiến thức của bài để giải quyết tình huống thực tế và trình bày ý kiến của mình.\n3. Về phẩm chất\n- Học sinh chăm chỉ, trung thực, trách nhiệm trong học tập; hợp tác, chia sẻ và tôn trọng ý kiến của bạn.`,
    // II. THIẾT BỊ DẠY HỌC VÀ HỌC LIỆU theo mẫu: 1. Giáo viên — 2. Học sinh.
    thiet_bi: `1. Giáo viên\n- Máy tính, các hình ảnh liên quan đến bài dạy, máy chiếu, phiếu học tập (giấy A0), nam châm dán phiếu học tập, bút màu, SGK, SGV ${subject || 'môn học'} bộ ${textbook}.\n- Giáo án biên soạn theo định hướng phát triển năng lực và phẩm chất cho HS.\n- Tranh, ảnh, tư liệu về bài “${title}”.\n- Phiếu học tập.\n2. Học sinh\n- SGK, tranh, ảnh, tư liệu sưu tầm liên quan đến nội dung bài học và dụng cụ học tập theo yêu cầu của GV.`,
    tien_trinh: `Tiến trình gồm 5 hoạt động chính với tổng thời lượng ${lessonMinutes} phút (chỉ tính thời lượng chính từng hoạt động, không cộng dồn phút bước con): ${acts.map((a) => `${a.name} (${a.duration} phút)`).join('; ')}. ${frameworkNote}`,
    danh_gia: `Tiêu chí đánh giá: (1) Đạt — học sinh trình bày đúng nội dung trọng tâm và hoàn thành nhiệm vụ; (2) Chưa đạt — học sinh cần hỗ trợ thêm và làm lại nhiệm vụ cơ bản. Cách đánh giá: quan sát, hỏi đáp, sản phẩm học tập và nhận xét của bạn.${support}`,
    rut_kinh_nghiem: `Sau tiết dạy, giáo viên ghi lại: nội dung nào học sinh tiếp thu tốt, nội dung nào cần điều chỉnh, và cách điều chỉnh cho lần dạy sau.`,
  };
  if (profile.conventions?.signatureBlock) sections.rut_kinh_nghiem += `\n\nKhối ký tên theo mẫu của trường:\n${profile.conventions.signatureBlock}`;
  const plan = {
    id: uid(), ownerGuestId: null, title, week: input.week || '', periods: Number(input.periods) || 1,
    level, subject, grade, textbook, lessonMinutes, sections, activities: acts,
    ngaySoan, ngayGiang, tiet,
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
    thiet_bi: ['thiết bị', 'học liệu', 'đồ dùng'],
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
function docDateLine(plan) {
  const m = String(plan.ngaySoan || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  return `Ngày ${m[1]} tháng ${m[2]} năm ${m[3]}`;
}
function docFooter(plan) {
  const d = docDateLine(plan);
  return `${d ? `<p style="text-align:right"><i>${escapeHtml(d)}</i></p>` : ''}<p style="text-align:right"><b>Kí duyệt của tổ chuyên môn</b><br>Tổ trưởng<br><br><br>………………………</p>`;
}
// Xuất .doc theo đúng format mẫu sếp gửi 08/11/2026:
// Đầu trang (Ngày soạn / Ngày giảng / TIẾT: Bài) — I. MỤC TIÊU — II. THIẾT BỊ —
// III. TIẾN TRÌNH (mỗi hoạt động: a. Mục tiêu, b. Tổ chức thực hiện 4 bước;
// Hình thành kiến thức dùng bảng 2 cột “Hoạt động của thầy và trò | Sản phẩm dự kiến”)
// — IV. ĐÁNH GIÁ — V. RÚT KINH NGHIỆM — chữ ký tổ chuyên môn.
function activityDocHtml(a, i) {
  const head = `<h3>HOẠT ĐỘNG ${i + 1}: ${escapeHtml(a.name)} (${a.duration} phút)</h3><p><b>a. Mục tiêu:</b> ${escapeHtml(a.goal || '')}</p><p><b>b. Tổ chức thực hiện:</b></p>`;
  const phasesHtml = (a.phases || []).map((ph) => `<p><b>- ${escapeHtml(ph.label)}:</b> ${escapeHtml(ph.text || '').replace(/\n/g, '<br>')}</p>`).join('');
  const expectedHtml = a.expected ? `<p><i>Câu trả lời / đáp án dự kiến: ${escapeHtml(a.expected)}</i></p>` : '';
  if ((a.name || '').startsWith('Hình thành')) {
    const left = (a.phases || []).map((ph) => `<b>- ${escapeHtml(ph.label)}:</b> ${escapeHtml(ph.text || '').replace(/\n/g, '<br>')}`).join('<br>');
    return `${head}<table><tr><th>Hoạt động của thầy và trò</th><th>Sản phẩm dự kiến</th></tr><tr><td>${left}</td><td>${escapeHtml(a.product || '').replace(/\n/g, '<br>')}</td></tr></table>${expectedHtml}`;
  }
  const productHtml = a.product ? `<p><b>Sản phẩm dự kiến:</b> ${escapeHtml(a.product).replace(/\n/g, '<br>')}</p>` : '';
  return `${head}${phasesHtml}${productHtml}${expectedHtml}`;
}
function renderDoc(plan) {
  const br = (s) => escapeHtml(s || '').replace(/\n/g, '<br>');
  const badge = plan.reviewState === 'approved' ? '<p><b>Tổ đã duyệt ✓</b></p>' : '';
  const acts = (plan.activities || []).map((a, i) => activityDocHtml(a, i)).join('');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>body{font-family:"Times New Roman",serif;font-size:13pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:6px;vertical-align:top}</style></head><body><p>Ngày soạn: ${escapeHtml(plan.ngaySoan || '')}</p><p>Ngày giảng: ${escapeHtml(plan.ngayGiang || '…………')}</p><h2 style="text-align:center">TIẾT ${escapeHtml(plan.tiet || '…')}: ${escapeHtml(plan.title || '')}</h2><p>Trường: ${escapeHtml(plan.authorSchool || '')} — Giáo viên: ${escapeHtml(plan.authorName || '')}</p><p>Môn: ${escapeHtml(plan.subject || '')} — Lớp: ${escapeHtml(plan.grade || '')} — Bộ sách: ${escapeHtml(plan.textbook || '')} — Thời lượng: ${plan.lessonMinutes} phút — Điểm tự chấm: ${plan.score}/100</p>${badge}<h3>I. MỤC TIÊU</h3><p>${br(plan.sections?.muc_tieu)}</p><h3>II. THIẾT BỊ DẠY HỌC VÀ HỌC LIỆU</h3><p>${br(plan.sections?.thiet_bi)}</p><h3>III. TIẾN TRÌNH DẠY HỌC</h3><p>${br(plan.sections?.tien_trinh)}</p>${acts}<h3>IV. ĐÁNH GIÁ</h3><p>${br(plan.sections?.danh_gia)}</p><h3>V. RÚT KINH NGHIỆM SAU TIẾT DẠY</h3><p>${br(plan.sections?.rut_kinh_nghiem)}</p>${docFooter(plan)}</body></html>`;
}
function renderTxt(plan) {
  const lines = [`Ngày soạn: ${plan.ngaySoan || ''}`, `Ngày giảng: ${plan.ngayGiang || '…………'}`, `TIẾT ${plan.tiet || '…'}: ${plan.title}`, `Trường: ${plan.authorSchool} — Giáo viên: ${plan.authorName}`, `Môn: ${plan.subject} — Lớp: ${plan.grade} — Bộ sách: ${plan.textbook} — ${plan.lessonMinutes} phút — Điểm tự chấm: ${plan.score}/100`, ''];
  if (plan.reviewState === 'approved') lines.push('Tổ đã duyệt ✓', '');
  lines.push('I. MỤC TIÊU', plan.sections?.muc_tieu || '', '', 'II. THIẾT BỊ DẠY HỌC VÀ HỌC LIỆU', plan.sections?.thiet_bi || '', '', 'III. TIẾN TRÌNH DẠY HỌC', plan.sections?.tien_trinh || '', '');
  (plan.activities || []).forEach((a, i) => {
    lines.push(`HOẠT ĐỘNG ${i + 1}: ${a.name} (${a.duration} phút)`, `a. Mục tiêu: ${a.goal || ''}`, 'b. Tổ chức thực hiện:');
    if ((a.name || '').startsWith('Hình thành')) {
      lines.push('Bảng: Hoạt động của thầy và trò | Sản phẩm dự kiến');
      (a.phases || []).forEach((ph) => lines.push(`- ${ph.label}: ${ph.text || ''}`));
      lines.push(`Sản phẩm dự kiến: ${a.product || ''}`);
    } else {
      (a.phases || []).forEach((ph) => lines.push(`- ${ph.label}: ${ph.text || ''}`));
      if (a.product) lines.push(`Sản phẩm dự kiến: ${a.product}`);
    }
    if (a.expected) lines.push(`Câu trả lời / đáp án dự kiến: ${a.expected}`);
    lines.push('');
  });
  lines.push('IV. ĐÁNH GIÁ', plan.sections?.danh_gia || '', '', 'V. RÚT KINH NGHIỆM SAU TIẾT DẠY', plan.sections?.rut_kinh_nghiem || '', '');
  const d = docDateLine(plan);
  if (d) lines.push(d, '');
  lines.push('Kí duyệt của tổ chuyên môn', 'Tổ trưởng', '', '………………………');
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
    if (p === '/favicon.svg' || p === '/favicon.ico') {
      try {
        const buf = fs.readFileSync(path.join(PUBLIC_DIR, 'favicon.svg'));
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
        return res.end(buf);
      } catch (e) { return sendText(res, 204, '', 'text/plain'); }
    }
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
