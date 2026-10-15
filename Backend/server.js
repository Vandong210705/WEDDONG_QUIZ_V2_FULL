require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2/promise');
const mqtt = require('mqtt');
const crypto = require('node:crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'quiz_arena',
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT || 2),
  queueLimit: 0
});

const MQTT_PREFIX = process.env.MQTT_PREFIX || 'lagan50ki/quiz';
const mqttClient = mqtt.connect(process.env.MQTT_URL || 'mqtt://broker.emqx.io');
let active = null; // { session_id, question_index, question, phase, revision }
let submissionQueue = Promise.resolve();
const lobby = new Map();
const lobbyList = () => [...lobby.values()].sort((a,b) => a.stt - b.stt);
const fail = (res, error, status = 500) => res.status(status).json({ success: false, error: String(error.message || error) });
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123'; // Local demo fallback; set environment variable in production.
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || 'local-demo-key-change-before-deploy';
if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_TOKEN_SECRET)) {
  throw new Error('Production requires ADMIN_PASSWORD and ADMIN_TOKEN_SECRET environment variables');
}
const safeEquals = (a,b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const sign = (value) => crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update(value).digest('base64url');
const makeAdminToken = () => {
  const payload = Buffer.from(JSON.stringify({role:'admin',exp:Date.now()+12*60*60*1000,nonce:crypto.randomBytes(16).toString('hex')})).toString('base64url');
  return `${payload}.${sign(payload)}`;
};
const validAdminToken = (token) => {
  if(typeof token !== 'string')return false;
  const [payload,signature] = token.split('.');
  if(!payload || !signature || !safeEquals(sign(payload),signature))return false;
  try {const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));return data.role==='admin' && Number(data.exp)>Date.now();}
  catch{return false;}
};
const requireAdmin = (req,res,next) => {
  const header = req.headers.authorization || '';
  if (!validAdminToken(header.replace(/^Bearer\s+/i,''))) return res.status(401).json({success:false,error:'Chưa đăng nhập quản trị / phiên hết hạn'});
  next();
};
app.post('/api/admin/login',(req,res)=>{
  if(!safeEquals(req.body?.password||'',ADMIN_PASSWORD))return res.status(401).json({success:false,error:'Mật khẩu không đúng'});
  res.json({success:true,token:makeAdminToken()});
});
const wrap = (handler) => (req, res) => Promise.resolve(handler(req, res)).catch(e => { console.error(e); fail(res, e); });
const ids = (x) => Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : null;
const safeAnswer = (x) => typeof x === 'string' && /^[A-D]$/i.test(x) ? x.toUpperCase() : null;
const publish = (topic, value) => mqttClient.connected && mqttClient.publish(`${MQTT_PREFIX}/${topic}`, JSON.stringify(value), {retain: topic==='question'});
const publicQuestion = (q, locked) => locked ? q : (({correct_answer, ...rest}) => rest)(q);
const statePacket = () => active ? {
  session_id: active.session_id, questionIndex: active.question_index, questionData: publicQuestion(active.question, active.phase==='locked'),
  phase: active.phase, revision: active.revision,
  correctAnswer: active.phase === 'locked' ? active.question.correct_answer : null
} : null;
const sendState = () => io.emit('quiz_round_state', statePacket());
const enqueue = (job) => { const promise = submissionQueue.then(job); submissionQueue = promise.catch(err => console.error('Submit queue:', err)); return promise; };

async function setupSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS sessions (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), join_code VARCHAR(50))`,
    `CREATE TABLE IF NOT EXISTS questions (id INT AUTO_INCREMENT PRIMARY KEY, session_id INT, content TEXT, answer_a VARCHAR(255), answer_b VARCHAR(255), answer_c VARCHAR(255), answer_d VARCHAR(255), correct_answer VARCHAR(5))`,
    `CREATE TABLE IF NOT EXISTS answers (id INT AUTO_INCREMENT PRIMARY KEY, session_id INT, question_index INT, player_name VARCHAR(255), source VARCHAR(50), is_correct BOOLEAN)`,
    `CREATE TABLE IF NOT EXISTS hardware_mappings (id INT AUTO_INCREMENT PRIMARY KEY, session_id INT, device_id INT, student_name VARCHAR(255))`,
    `CREATE TABLE IF NOT EXISTS class_students (id INT AUTO_INCREMENT PRIMARY KEY, stt INT, full_name VARCHAR(255), dob VARCHAR(50))`,
    `CREATE TABLE IF NOT EXISTS session_checkins (id INT AUTO_INCREMENT PRIMARY KEY, session_id INT, stt INT, full_name VARCHAR(255), source VARCHAR(50))`,
    `CREATE TABLE IF NOT EXISTS quiz_live_rounds (session_id INT PRIMARY KEY, question_id INT NOT NULL, question_index INT NOT NULL, phase VARCHAR(12) NOT NULL, revision BIGINT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS quiz_locked_questions (session_id INT NOT NULL, question_id INT NOT NULL, PRIMARY KEY(session_id,question_id))`,
    `CREATE TABLE IF NOT EXISTS quiz_responses (session_id INT NOT NULL, question_index INT NOT NULL, source VARCHAR(20) NOT NULL, participant_key VARCHAR(80) NOT NULL, player_name VARCHAR(255) NOT NULL, answer CHAR(1) NOT NULL, is_locked TINYINT(1) NOT NULL DEFAULT 0, is_correct TINYINT(1) DEFAULT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (session_id, question_index, source, participant_key))`
  ];
  for (const sql of statements) await db.query(sql);
  console.log('✅ Đã kiểm tra schema MySQL');
  const [rows] = await db.query(`SELECT r.*, q.content, q.answer_a, q.answer_b, q.answer_c, q.answer_d, q.correct_answer FROM quiz_live_rounds r JOIN questions q ON q.id=r.question_id ORDER BY r.updated_at DESC LIMIT 1`);
  if (rows.length) {
    const r = rows[0];
    active = { session_id: r.session_id, question_index: r.question_index, phase: r.phase, revision: Number(r.revision),
      question: { id: r.question_id, session_id: r.session_id, content: r.content, answer_a: r.answer_a, answer_b: r.answer_b, answer_c: r.answer_c, answer_d: r.answer_d, correct_answer: r.correct_answer } };
  }
}

async function identifyStudent(stt, sessionId) {
  const [students] = await db.query('SELECT stt, full_name, dob FROM class_students WHERE stt=? LIMIT 1', [stt]);
  if (students.length) return students[0];
  if (sessionId) {
    const [mappings] = await db.query('SELECT student_name FROM hardware_mappings WHERE session_id=? AND device_id=? LIMIT 1', [sessionId, stt]);
    if (mappings.length) return { stt, full_name: mappings[0].student_name, dob: '' };
  }
  return { stt, full_name: 'Chưa có trong danh sách lớp', dob: '' };
}

async function acceptAnswer({ sessionId, questionIndex, source, participantKey, playerName, answer, expectedRevision = active?.revision }) {
  if (!active || !['open','closing'].includes(active.phase) || active.revision !== expectedRevision || active.session_id !== sessionId || active.question_index !== questionIndex)
    return { success: false, error: 'Câu hỏi chưa mở hoặc đã CHỐT' };
  const before = active.revision;
  const [result] = await db.query(
    `INSERT INTO quiz_responses (session_id,question_index,source,participant_key,player_name,answer,is_locked,is_correct)
     VALUES (?,?,?,?,?,?,0,NULL) ON DUPLICATE KEY UPDATE player_name=VALUES(player_name),answer=VALUES(answer),updated_at=CURRENT_TIMESTAMP`,
    [sessionId, questionIndex, source, participantKey, playerName, answer]
  );
  // CHỐT waits for every accepted write; never grade here.
  const data = { session_id: sessionId, questionIndex, playerName, source, answer, revision: before };
  io.emit('admin_answer_pending', data);
  return { success: true, status: 'saved', revision: before, message: 'Đã lưu đáp án mới nhất; đợi giáo viên CHỐT' };
}

async function handleOpen(data) {
  const qid = ids(data.questionData?.id);
  if (!qid) return { success:false, error:'Câu hỏi không hợp lệ' };
  const [rows] = await db.query('SELECT * FROM questions WHERE id=? LIMIT 1', [qid]);
  if (!rows.length) return { success:false, error:'Câu hỏi không tồn tại' };
  const q = rows[0];
  const index = Number(data.questionIndex);
  if (!Number.isInteger(index) || index < 0) return { success:false, error:'Chỉ số câu không hợp lệ' };
  if (active?.phase === 'open' && (active.question.id !== qid || active.session_id !== q.session_id))
    return { success:false, error:'Phải CHỐT câu đang mở trước khi PHÁT câu khác' };
  if (active?.phase === 'locked' && active.question.id === qid && active.session_id === q.session_id)
    return { success:false, error:'Câu này đã CHỐT. Hãy chọn câu khác hoặc xóa tiến độ để làm lại.' };
  if (active?.phase === 'closing') return { success:false, error:'Đang CHỐT câu hỏi, vui lòng đợi' };
  const [lockedBefore] = await db.query('SELECT question_id FROM quiz_locked_questions WHERE session_id=? AND question_id=? LIMIT 1',[q.session_id,qid]);
  if(lockedBefore.length) return {success:false,error:'Câu này đã CHỐT. Hãy chọn câu khác hoặc Xóa trắng kết quả để làm lại.'};
  if (active?.phase === 'open' && active.question.id === qid) {
    io.emit('server_broadcast_action', { action:'open_question', questionData:publicQuestion(q,false), questionIndex:index });
    sendState();
    return {success:true, state:statePacket(), reused:true};
  }
  const revision = Math.max(Date.now(), (active?.revision || 0) + 1);
  await db.query(`INSERT INTO quiz_live_rounds (session_id,question_id,question_index,phase,revision)
    VALUES (?,?,?,'open',?) ON DUPLICATE KEY UPDATE question_id=VALUES(question_id),question_index=VALUES(question_index),phase='open',revision=VALUES(revision)`,
    [q.session_id,qid,index,revision]);
  active = { session_id:q.session_id, question:q,question_index:index,phase:'open',revision };
  io.emit('server_broadcast_action',{action:'open_question',questionData:publicQuestion(q,false),questionIndex:index});
  sendState();
  publish('question', { action:'new_question', session_id:q.session_id, question_index:index, question_id:qid, revision });
  return {success:true,state:statePacket()};
}

async function handleClose() {
  if (!active) return { success:false, error:'Chưa PHÁT câu nào' };
  if (active.phase === 'locked') return { success:true, alreadyLocked:true, state:statePacket() };
  if (active.phase !== 'open') return { success:false, error:'Câu đang được CHỐT' };
  const a = active;
  a.phase = 'closing'; // Reject messages received after teacher presses CHỐT.
  await submissionQueue; // Wait all previously accepted submissions.
  const connection = await db.getConnection();
  let rows;
  try {
    await connection.beginTransaction();
    await connection.query(`UPDATE quiz_responses SET is_locked=1,is_correct=(answer=?)
       WHERE session_id=? AND question_index=? AND is_locked=0`,
      [a.question.correct_answer,a.session_id,a.question_index]);
    await connection.query(`UPDATE quiz_live_rounds SET phase='locked' WHERE session_id=? AND revision=?`, [a.session_id,a.revision]);
    await connection.query('INSERT IGNORE INTO quiz_locked_questions (session_id,question_id) VALUES (?,?)',[a.session_id,a.question.id]);
    [rows] = await connection.query(`SELECT source,participant_key,player_name,answer,is_correct,question_index
       FROM quiz_responses WHERE session_id=? AND question_index=? AND is_locked=1`,[a.session_id,a.question_index]);
    await connection.commit();
  } catch(e) { await connection.rollback(); a.phase='open'; throw e; }
  finally { connection.release(); }
  a.phase='locked';
  io.emit('server_broadcast_action',{action:'show_result',correctAnswer:a.question.correct_answer});
  io.emit('admin_round_finalized',{session_id:a.session_id,questionIndex:a.question_index,results:rows});
  sendState();
  publish('question',{action:'question_locked',session_id:a.session_id,question_index:a.question_index,revision:a.revision});
  console.log(`🔒 CHỐT câu ${a.question_index+1}: ${rows.length} học sinh được chấm`);
  return { success:true, locked:rows.length,state:statePacket() };
}

// Existing APIs (preserved; errors no longer silently hidden)
app.get('/api/health', wrap(async(req,res)=> { await db.query('SELECT 1'); res.json({ok:true,mqtt_connected:mqttClient.connected}); }));
app.get('/api/sessions',wrap(async(req,res)=> {const [r]=await db.query('SELECT * FROM sessions ORDER BY id DESC'); res.json(r);}));
app.post('/api/sessions',requireAdmin,wrap(async(req,res)=> {const {name,join_code}=req.body; if(!name?.trim()||!join_code?.trim()) return fail(res,'Thiếu tên hoặc PIN',400); const [r]=await db.query('INSERT INTO sessions (name,join_code) VALUES (?,?)',[name.trim(),join_code.trim().toUpperCase()]); res.json({success:true,id:r.insertId});}));
app.delete('/api/sessions/:id',requireAdmin,wrap(async(req,res)=> {const id=ids(req.params.id);if(!id)return fail(res,'ID không hợp lệ',400);for(const table of ['quiz_responses','quiz_locked_questions','quiz_live_rounds','hardware_mappings','session_checkins','answers','questions','sessions']) await db.query(`DELETE FROM ${table} WHERE ${table==='sessions'?'id':'session_id'}=?`,[id]);if(active?.session_id===id){active=null;sendState();}res.json({success:true});}));
app.get('/api/questions',requireAdmin,wrap(async(req,res)=> {const [r]=await db.query('SELECT * FROM questions WHERE session_id=? ORDER BY id ASC',[ids(req.query.session_id)||1]);res.json(r);}));
app.post('/api/questions/bulk',requireAdmin,wrap(async(req,res)=> {const sid=ids(req.body.session_id);const qs=req.body.questions;if(!sid||!Array.isArray(qs))return fail(res,'Dữ liệu đề không hợp lệ',400);if(!qs.length)return res.json({success:true,inserted:0});for(const q of qs){if(!q.content||!safeAnswer(q.correct_answer)||!['answer_a','answer_b','answer_c','answer_d'].every(k=>q[k])) return fail(res,'Câu hỏi thiếu nội dung hoặc đáp án',400);}const values=qs.map(q=>[sid,q.content,q.answer_a,q.answer_b,q.answer_c,q.answer_d,safeAnswer(q.correct_answer)]);const [r]=await db.query('INSERT INTO questions (session_id,content,answer_a,answer_b,answer_c,answer_d,correct_answer) VALUES ?',[values]);res.json({success:true,inserted:r.affectedRows});}));
app.delete('/api/questions/clear',requireAdmin,wrap(async(req,res)=> {const id=ids(req.body.session_id);if(!id)return fail(res,'ID không hợp lệ',400);if(active?.session_id===id){active=null;sendState();}for(const t of ['quiz_responses','quiz_locked_questions','quiz_live_rounds','answers','questions'])await db.query(`DELETE FROM ${t} WHERE session_id=?`,[id]);res.json({success:true});}));
app.get('/api/hardware/mapping',requireAdmin,wrap(async(req,res)=> {const [r]=await db.query('SELECT * FROM hardware_mappings WHERE session_id=?',[ids(req.query.session_id)]);res.json(r);}));
app.post('/api/hardware/mapping',requireAdmin,wrap(async(req,res)=> {const sid=ids(req.body.session_id), ms=req.body.mappings;if(!sid||!Array.isArray(ms))return fail(res,'Sai dữ liệu',400);await db.query('DELETE FROM hardware_mappings WHERE session_id=?',[sid]);if(ms.length){const v=ms.map(m=>[sid,ids(m.device_id),m.student_name]);await db.query('INSERT INTO hardware_mappings (session_id,device_id,student_name) VALUES ?',[v]);}res.json({success:true});}));
app.get('/api/hardware/lobby',(req,res)=>res.json({devices:lobbyList()}));
app.get('/api/participants',requireAdmin,wrap(async(req,res)=>{
  const sid=ids(req.query.session_id);
  const [rows]=await db.query('SELECT stt,source FROM session_checkins WHERE session_id=? ORDER BY id ASC',[sid]);
  const merged=new Map();for(const r of rows)merged.set(Number(r.stt),{stt:Number(r.stt),source:r.source==='HARDWARE'?'ESP32':r.source});
  for(const item of lobby.values())merged.set(Number(item.stt),{stt:Number(item.stt),source:'ESP32'});
  res.json([...merged.values()]);
}));
app.get('/api/results',requireAdmin,wrap(async(req,res)=>{
  const sid=ids(req.query.session_id);
  const [students]=await db.query('SELECT stt,full_name FROM class_students ORDER BY stt');
  const [responses]=await db.query('SELECT participant_key,source,question_index,answer,is_correct FROM quiz_responses WHERE session_id=? AND is_locked=1 ORDER BY question_index',[sid]);
  const [checks]=await db.query('SELECT stt,source FROM session_checkins WHERE session_id=? ORDER BY id',[sid]);
  const sourceMap=new Map(checks.map(x=>[Number(x.stt),x.source==='HARDWARE'?'ESP32':x.source]));
  for(const item of lobby.values())sourceMap.set(Number(item.stt),'ESP32');
  const output=students.map(st=>{
    const rows=responses.filter(x=>Number(x.participant_key)===Number(st.stt));
    const answers=[];for(const row of rows)answers[row.question_index]=row.answer;
    return {stt:st.stt,full_name:st.full_name,source:sourceMap.get(Number(st.stt))||null,correct:rows.filter(x=>x.is_correct).length,answers};
  });res.json(output);
}));
app.get('/api/progress',requireAdmin,wrap(async(req,res)=> {const [r]=await db.query(`SELECT question_index,player_name,source,is_correct,answer,participant_key FROM quiz_responses WHERE session_id=? AND is_locked=1 ORDER BY question_index,source,participant_key`,[ids(req.query.session_id)]);res.json(r);}));
app.get('/api/round/current',(req,res)=>res.json({state:statePacket()}));
app.get('/api/round/pending',requireAdmin,wrap(async(req,res)=> {const [r]=await db.query(`SELECT source,participant_key,player_name,answer,question_index,updated_at FROM quiz_responses WHERE session_id=? AND question_index=? AND is_locked=0`,[ids(req.query.session_id),Number(req.query.question_index)]);res.json({responses:r});}));
app.delete('/api/progress/clear',requireAdmin,wrap(async(req,res)=> {const id=ids(req.body.session_id);if(!id)return fail(res,'ID không hợp lệ',400);await db.query('DELETE FROM quiz_responses WHERE session_id=?',[id]);await db.query('DELETE FROM quiz_locked_questions WHERE session_id=?',[id]);await db.query('DELETE FROM answers WHERE session_id=?',[id]);await db.query('DELETE FROM quiz_live_rounds WHERE session_id=?',[id]);if(active?.session_id===id){active=null;sendState();}res.json({success:true});}));
app.get('/api/students',requireAdmin,wrap(async(req,res)=> {const [r]=await db.query('SELECT * FROM class_students ORDER BY stt ASC');res.json(r);}));
app.post('/api/students/upload',requireAdmin,wrap(async(req,res)=> {const ss=req.body.students;if(!Array.isArray(ss))return fail(res,'Danh sách phải là mảng',400);const seen=new Set();for(const s of ss){if(!ids(s.stt)||!s.full_name?.trim()||seen.has(Number(s.stt)))return fail(res,'STT bị trùng, thiếu tên hoặc không hợp lệ',400);seen.add(Number(s.stt));}const conn=await db.getConnection();try{await conn.beginTransaction();await conn.query('DELETE FROM class_students');if(ss.length){await conn.query('INSERT INTO class_students (stt,full_name,dob) VALUES ?',[ss.map(s=>[Number(s.stt),s.full_name.trim(),s.dob||''])]);}await conn.commit();}catch(e){await conn.rollback();throw e;}finally{conn.release();} // refresh lobby after roster upload
for(const [id,item] of lobby){const updated=ss.find(s=>Number(s.stt)===id);if(updated)lobby.set(id,{...item,student_name:updated.full_name,dob:updated.dob||''});}
io.emit('hardware_lobby_update',{devices:lobbyList()});res.json({success:true,inserted:ss.length});}));
app.get('/api/students/verify',wrap(async(req,res)=> {const [r]=await db.query('SELECT * FROM class_students WHERE stt=? LIMIT 1',[ids(req.query.stt)]);res.json(r.length?{success:true,student:r[0]}:{success:false,message:'Không tìm thấy STT trong danh sách lớp'});}));
app.post('/api/checkin',wrap(async(req,res)=> {const {session_id,stt,source}=req.body;const s=await identifyStudent(ids(stt),ids(session_id));if(s.full_name==='Chưa có trong danh sách lớp')return fail(res,'Chưa có STT trong danh sách lớp',400);const [r]=await db.query('SELECT id FROM session_checkins WHERE session_id=? AND stt=?',[ids(session_id),ids(stt)]);if(!r.length)await db.query('INSERT INTO session_checkins (session_id,stt,full_name,source) VALUES (?,?,?,?)',[ids(session_id),ids(stt),s.full_name,'WEB']);else await db.query('UPDATE session_checkins SET source=? WHERE session_id=? AND stt=?',['WEB',ids(session_id),ids(stt)]);io.emit('admin_new_checkin',{stt:s.stt,full_name:s.full_name,source});res.json({success:true});}));

io.on('connection',socket=>{
  socket.emit('quiz_round_state',statePacket());
  socket.emit('hardware_lobby_update',{devices:lobbyList()});
  socket.on('admin_send_action',async(data,ack)=>{
    try { if(!validAdminToken(data?.token)){if(typeof ack==='function')ack({success:false,error:'Bạn chưa đăng nhập quản trị'});return;} const result = data?.action === 'open_question' ? await handleOpen(data) : data?.action === 'show_result' ? ((active && active.question.id !== ids(data?.questionData?.id)) ? {success:false,error:'Bạn đang chọn sai câu! Hãy chọn đúng câu đang PHÁT rồi mới CHỐT.'} : await handleClose()) : {success:false,error:'Thao tác không hợp lệ'};if(typeof ack==='function')ack(result);if(!result.success)socket.emit('quiz_error',result.error); }
    catch(e){console.error(e);if(typeof ack==='function')ack({success:false,error:e.message});socket.emit('quiz_error',e.message);}
  });
  socket.on('player_submit_answer',async(data,ack)=>{
    try {
      const sid=ids(data?.sessionId),stt=ids(data?.stt),answer=safeAnswer(data?.answer);
      if(!sid||!stt||!answer){if(typeof ack==='function')ack({success:false,error:'Thiếu STT hoặc đáp án'});return;}
      const idx=Number(data.questionIndex);
      if(!active || active.phase!=='open' || active.session_id!==sid || active.question_index!==idx) {
        if(typeof ack==='function')ack({success:false,error:'Câu hỏi chưa PHÁT hoặc đã CHỐT'});
        return;
      }
      const revision=active.revision;
      const result=await enqueue(async()=>{
        const name=await identifyStudent(stt,sid);
        if(name.full_name==='Chưa có trong danh sách lớp') return {success:false,error:'STT không tồn tại'};
        return acceptAnswer({sessionId:sid,questionIndex:idx,source:'WEB',participantKey:String(stt),playerName:name.full_name,answer,expectedRevision:revision});
      });
      if(typeof ack==='function')ack(result);
    }catch(e){console.error(e);if(typeof ack==='function')ack({success:false,error:e.message});}
  });
});

mqttClient.on('connect',()=>{
  mqttClient.subscribe([`${MQTT_PREFIX}/submit`,`${MQTT_PREFIX}/checkin`],err=>console.log(err?'MQTT subscribe lỗi: '+err.message:'✅ MQTT đã đăng ký submit/checkin'));
});
mqttClient.on('error',e=>console.error('MQTT:',e.message));
mqttClient.on('message',async(topic,message)=>{
  try {
    const data=JSON.parse(message.toString());
    if(topic===`${MQTT_PREFIX}/checkin`){
      const id=ids(data.device_id);if(!id)return;
      if(data.status==='left'||data.status==='leave') {lobby.delete(id);io.emit('hardware_lobby_update',{devices:lobbyList()});console.log('📟 Rời sảnh:',id);return;}
      if(data.status!=='joined')return;
      const student=await identifyStudent(id,active?.session_id);
      lobby.set(id,{device_id:id,stt:id,student_name:student.full_name,dob:student.dob||'',source:'ESP32'});
      if(active?.session_id) await db.query(`INSERT INTO session_checkins(session_id,stt,full_name,source) VALUES(?,?,?,'ESP32') ON DUPLICATE KEY UPDATE source='ESP32'`,[active.session_id,id,student.full_name]).catch(async()=>{await db.query('DELETE FROM session_checkins WHERE session_id=? AND stt=?',[active.session_id,id]);await db.query('INSERT INTO session_checkins(session_id,stt,full_name,source) VALUES(?,?,?,?)',[active.session_id,id,student.full_name,'ESP32']);});
      io.emit('hardware_lobby_update',{devices:lobbyList()});console.log('📟 Vào sảnh:',id,student.full_name);
      return;
    }
    if(topic!==`${MQTT_PREFIX}/submit`)return;
    const id=ids(data.device_id),answer=safeAnswer(data.answer);
    if(!id||!answer)return;
    const reject=(error)=>publish(`response/${id}`,{success:false,error});
    if(!active||active.phase!=='open'){reject('Chưa PHÁT câu hỏi hoặc đã CHỐT');return;}
    const sid=active.session_id,index=active.question_index,revision=active.revision;
    const result=await enqueue(async()=>{
      const student=await identifyStudent(id,sid);
      if(student.full_name==='Chưa có trong danh sách lớp') return {success:false,error:'STT không tồn tại trong danh sách lớp / mapping'};
      return acceptAnswer({sessionId:sid,questionIndex:index,source:'HARDWARE',participantKey:String(id),playerName:student.full_name,answer,expectedRevision:revision});
    });
    publish(`response/${id}`,{...result,question_index:index});
  } catch(e){console.error('MQTT message:',e);}
});

const PORT=Number(process.env.PORT||3000);
if (require.main === module) {
  setupSchema().then(()=>server.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Backend cổng ${PORT}`))).catch(err=>{
    console.error('❌ Không kết nối được database / tạo bảng:',err.message); process.exitCode=1; mqttClient.end(true);
  });
}
module.exports={app,server,setupSchema,acceptAnswer,handleOpen,handleClose};
