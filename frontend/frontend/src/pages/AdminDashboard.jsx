import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, ChevronLeft, Activity, Check, X, Upload, ArrowRight, ArrowLeft, CheckSquare, Trash2, Lock, Smartphone, Cpu, RotateCcw, Edit, Users, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { io } from 'socket.io-client';
import { API_URL } from '../config';

const socket = io(API_URL);
const adminFetch = (url, options = {}) => fetch(url, {
  ...options,
  headers: {...(options.headers || {}), Authorization: `Bearer ${sessionStorage.getItem('quiz_admin_token') || ''}`}
});

export default function AdminDashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const hardwareFileRef = useRef(null);
  const classFileRef = useRef(null);
  
  const [isAuthenticated, setIsAuthenticated] = useState(!!sessionStorage.getItem('quiz_admin_token'));
  const [password, setPassword] = useState('');
  const loginAdmin = async (event) => {
    event.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/admin/login`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
      const data = await res.json();
      if(!res.ok || !data.success) throw Error(data.error || 'Không đăng nhập được');
      sessionStorage.setItem('quiz_admin_token',data.token);
      setPassword('');
      setIsAuthenticated(true);
    } catch(err) { alert(err.message); }
  }; 

  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [questionsList, setQuestionsList] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [liveProgress, setLiveProgress] = useState({});
  const [pendingAnswers, setPendingAnswers] = useState({});
  const [roster, setRoster] = useState([]);
  const [participation, setParticipation] = useState({});
  const [showResults, setShowResults] = useState(false);
  const [resultRows, setResultRows] = useState([]);
  const [currentRound, setCurrentRound] = useState(null);
  const [adminNotice, setAdminNotice] = useState('');
  const [editor, setEditor] = useState({ isOpen: false, type: '', text: '', title: '' });

  // Trạng thái xem trước màn hình lớp học.
  const [liveScreen, setLiveScreen] = useState({ status: 'idle', questionData: null, correctAnswer: null });

  const loadSessions = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await adminFetch(`${API_URL}/api/sessions`);
      const data = await res.json();
      if (!res.ok || !Array.isArray(data)) throw Error(data.error || 'Không tải được danh sách lớp');
      setSessions(data);
      if (data.length > 0 && (!activeSession || !data.find(s => s.id === activeSession.id))) setActiveSession(data[0]);
      else if (data.length === 0) setActiveSession(null);
    } catch (err) {}
  };

  const loadParticipants = async () => {
    if (!activeSession) return;
    try {
      const [a,b] = await Promise.all([
        adminFetch(`${API_URL}/api/students`),
        adminFetch(`${API_URL}/api/participants?session_id=${activeSession.id}`)
      ]);
      if (a.ok) setRoster(await a.json());
      if (b.ok) {
        const list = await b.json();
        setParticipation(Object.fromEntries(list.map(x => [Number(x.stt), x.source])));
      }
    } catch(e) { console.error('Không tải được người tham gia',e); }
  };
  const openResults = async () => {
    if (!activeSession) return;
    try {
      const res = await adminFetch(`${API_URL}/api/results?session_id=${activeSession.id}`);
      if (!res.ok) throw Error('Không tải được kết quả');
      setResultRows(await res.json()); setShowResults(true);
    } catch(e) { alert(e.message); }
  };
  const exportResults = () => {
    const lines = [['STT','Họ và tên','Thiết bị','Đúng','Tổng câu','Điểm','Đáp án theo câu'],...resultRows.map(r => [r.stt,r.full_name,r.source||'Chưa tham gia',r.correct,questionsList.length,r.correct, r.answers.map(x=>x||'').join(' | ')])];
    const csv = '\uFEFF' + lines.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`ket_qua_lop_${activeSession.id}.csv`;a.click();URL.revokeObjectURL(url);
  };
  const loadQuestionsAndProgress = async (resetIndex = true) => {
    if (!isAuthenticated || !activeSession) {
      setQuestionsList([]); setCurrentIndex(0); setLiveProgress({}); return;
    }
    try {
      const resQ = await adminFetch(`${API_URL}/api/questions?session_id=${activeSession.id}`);
      if (!resQ.ok) throw Error('Không đọc được đề. Phiên quản trị có thể đã hết hạn.');
      setQuestionsList(await resQ.json());
      if (resetIndex) setCurrentIndex(0);
      
      let mappings = [];
      try {
        const resM = await adminFetch(`${API_URL}/api/hardware/mapping?session_id=${activeSession.id}`);
        if (resM.ok) mappings = await resM.json();
      } catch (e) {}

      let historyData = [];
      try {
        const resP = await adminFetch(`${API_URL}/api/progress?session_id=${activeSession.id}`);
        if (resP.ok) historyData = await resP.json();
      } catch (e) {}

      const rebuiltProgress = {};
      if (Array.isArray(mappings)) {
        mappings.forEach(m => {
          const key = `HARDWARE_${m.device_id}`;
          rebuiltProgress[key] = { name: m.student_name, source: null, history: [], stt: Number(m.device_id) };
        });
      }
      if (Array.isArray(historyData)) {
        historyData.forEach(row => {
          const key = `${row.source}_${row.participant_key || row.player_name}`;
          if (!rebuiltProgress[key]) rebuiltProgress[key] = { name: row.player_name, source: row.source, history: [], stt: Number(row.participant_key) };
          rebuiltProgress[key].history[row.question_index] = !!row.is_correct;
        });
      }
      setLiveProgress(rebuiltProgress);
    } catch (err) {}
  };

  useEffect(() => { loadSessions(); }, [isAuthenticated]);
  useEffect(() => { loadQuestionsAndProgress(); loadParticipants(); }, [activeSession, isAuthenticated]);
  useEffect(() => { const refresh=()=>loadParticipants(); socket.on("hardware_lobby_update",refresh);socket.on("admin_new_checkin",refresh);return ()=>{socket.off("hardware_lobby_update",refresh);socket.off("admin_new_checkin",refresh);}; },[activeSession?.id]);

  useEffect(() => {
    const onPending = data => {
      setPendingAnswers(prev => ({...prev, [`${data.session_id}_${data.questionIndex}_${data.source}_${data.playerName}`]: data}));
    };
    const onFinalized = data => {
      setPendingAnswers(prev => Object.fromEntries(Object.entries(prev).filter(([key, item]) => !(item.session_id === data.session_id && item.questionIndex === data.questionIndex))));
      setLiveProgress(prev => {
        const next = {...prev};
        data.results.forEach(row => {
          const key = `${row.source}_${row.participant_key || row.player_name}`;
          const original = next[key] || {name:row.player_name,source:row.source,history:[]};
          const history = [...original.history];
          history[data.questionIndex] = !!row.is_correct;
          next[key] = {...original,history};
        });
        return next;
      });
    };
    const onState = data => {
      setCurrentRound(data);
      if (data?.questionData) setLiveScreen({status:data.phase==='locked'?'result':'question',questionData:data.questionData,correctAnswer:data.correctAnswer});
      else setLiveScreen({status:'idle',questionData:null,correctAnswer:null});
    };
    const onError = error => setAdminNotice('⚠️ '+error);
    socket.on('admin_answer_pending',onPending);
    socket.on('admin_round_finalized',onFinalized);
    socket.on('quiz_round_state',onState);
    socket.on('quiz_error',onError);
    adminFetch(`${API_URL}/api/round/current`).then(r=>r.json()).then(d=>onState(d.state)).catch(()=>{});
    socket.on('connect',()=>{adminFetch(`${API_URL}/api/round/current`).then(r=>r.json()).then(d=>onState(d.state)).catch(()=>{});});
    return () => {
      socket.off('admin_answer_pending',onPending);
      socket.off('admin_round_finalized',onFinalized);
      socket.off('quiz_round_state',onState);
      socket.off('quiz_error',onError);
    };
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    adminFetch(`${API_URL}/api/round/pending?session_id=${activeSession.id}&question_index=${currentIndex}`)
      .then(r=>r.json()).then(data=>{
        const items = {};
        (data.responses||[]).forEach(d => {
          items[`${activeSession.id}_${d.question_index}_${d.source}_${d.player_name}`] = {...d, session_id:activeSession.id,questionIndex:d.question_index,playerName:d.player_name};
        });
        setPendingAnswers(items);
      }).catch(()=>{});
  },[activeSession?.id,currentIndex,currentRound?.revision]);

  const openEditor = async (type) => {
    if (!activeSession && type !== 'class') return alert("Vui lòng chọn phòng thi trước!");
    let text = ""; let title = "";
    try {
      if (type === 'questions') {
        title = "Chỉnh sửa Đề Thi";
        const res = await adminFetch(`${API_URL}/api/questions?session_id=${activeSession.id}`);
        const data = await res.json();
        text = data.map(q => `Câu hỏi: ${q.content}\nA: ${q.answer_a}\nB: ${q.answer_b}\nC: ${q.answer_c}\nD: ${q.answer_d}\nĐáp án: ${q.correct_answer}`).join('\n\n');
      } else if (type === 'hardware') {
        title = "Chỉnh sửa Danh sách Thiết Bị";
        const res = await adminFetch(`${API_URL}/api/hardware/mapping?session_id=${activeSession.id}`);
        const data = await res.json();
        text = data.map(m => `${m.device_id} - ${m.student_name}`).join('\n');
      } else if (type === 'class') {
        title = "Chỉnh sửa Danh sách học sinh Gốc";
        const res = await adminFetch(`${API_URL}/api/students`);
        const data = await res.json();
        text = data.map(s => `${s.stt} - ${s.full_name} - ${s.dob}`).join('\n');
      }
      setEditor({ isOpen: true, type, text, title });
    } catch (e) { alert("Lỗi khi tải dữ liệu!"); }
  };

  const saveEditor = async () => {
    try {
      const checkedFetch = async (...args) => {
        const response = await adminFetch(...args);
        const data = await response.json();
        if (!response.ok || data.success === false) throw Error(data.error || 'Lỗi lưu dữ liệu');
        return data;
      };
      if (editor.type === 'class') {
        if (!window.confirm('Lưu sổ đầu bài sẽ THAY THẾ danh sách lớp gốc hiện tại. Tiếp tục?')) return;
        const students = editor.text.split('\n').filter(l => l.includes('-')).map(l => {
          const parts = l.split('-'); return { stt: parseInt(parts[0].trim()), full_name: parts[1].trim(), dob: parts[2] ? parts[2].trim() : '' };
        });
        await checkedFetch(`${API_URL}/api/students/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ students }) });
        alert(`✅ Đã lưu ${students.length} học sinh!`);
      } else if (editor.type === 'hardware') {
        const mappings = editor.text.split('\n').filter(l => l.includes('-')).map(l => {
          const parts = l.split('-'); return { device_id: parseInt(parts[0].trim()), student_name: parts[1].trim() };
        });
        await checkedFetch(`${API_URL}/api/hardware/mapping`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: activeSession.id, mappings }) });
        alert(`✅ Đã lưu ${mappings.length} thiết bị!`);
      } else if (editor.type === 'questions') {
        const blocks = editor.text.split(/\n\s*\n/);
        const parsedQuestions = blocks.map(block => {
          const lines = block.split('\n').map(l => l.trim()).filter(l => l);
          if (lines.length >= 6) {
            return {
              content: lines[0].replace(/^(Câu hỏi|Q):\s*/i, ''),
              answer_a: lines[1].replace(/^A:\s*/i, ''), answer_b: lines[2].replace(/^B:\s*/i, ''),
              answer_c: lines[3].replace(/^C:\s*/i, ''), answer_d: lines[4].replace(/^D:\s*/i, ''), correct_answer: lines[5].replace(/^(Đáp án|Ans):\s*/i, '').toUpperCase()
            };
          }
          return null;
        }).filter(q => q !== null);
        
        await checkedFetch(`${API_URL}/api/questions/clear`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: activeSession.id }) });
        if (parsedQuestions.length > 0) {
          await checkedFetch(`${API_URL}/api/questions/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questions: parsedQuestions, session_id: activeSession.id }) });
        }
        alert(`✅ Đã lưu ${parsedQuestions.length} câu hỏi!`);
      }
      setEditor({ isOpen: false, type: '', text: '', title: '' });
      loadQuestionsAndProgress();
    } catch (e) { alert("Lỗi khi lưu dữ liệu: " + e.message); }
  };

  const sendAdminAction = (action) => {
    if (!currentQuestion) return;
    setAdminNotice('');
    socket.timeout(12000).emit('admin_send_action', {
      action, questionData:currentQuestion, questionIndex:currentIndex, token:sessionStorage.getItem('quiz_admin_token')
    }, (err, result) => {
      if (err || !result?.success) setAdminNotice('⚠️ '+(result?.error||'Máy chủ không phản hồi'));
      else if (action === 'show_result') setAdminNotice(`🔒 Đã CHỐT: ${result.locked ?? 0} bài được khóa và tính điểm.`);
      else setAdminNotice('✅ Câu hỏi đang mở, có thể gửi hoặc sửa đáp án.');
    });
  };

  const currentQuestion = questionsList[currentIndex];

  const handleCreateSession = async () => {
    const name = prompt("Tên bộ đề mới:"); if (!name) return;
    const join_code = prompt("Mã PIN:"); if (!join_code) return;
    const res = await adminFetch(`${API_URL}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, join_code: join_code.toUpperCase() }) });
    const result = await res.json();
    if (result.success) { setActiveSession({id:result.id,name,join_code:join_code.toUpperCase()}); alert('Tạo thành công và đã chọn lớp mới!'); loadSessions(); } else alert(result.error || 'Không thể tạo lớp');
  };

  const handleDeleteSession = async () => {
    if (!activeSession) return;
    if (!window.confirm(`Xóa lớp học "${activeSession.name}"?`)) return;
    const res = await adminFetch(`${API_URL}/api/sessions/${activeSession.id}`, { method: 'DELETE' });
    if ((await res.json()).success) { alert("Đã xóa phòng!"); loadSessions(); }
  };

  const handleFileUpload = (event, type) => {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => { setEditor({ isOpen: true, type: type, text: e.target.result, title: `Đang nạp file... (Nhấn LƯU để xác nhận)` }); };
    reader.readAsText(file); event.target.value = null;
  };

  const handleResetProgress = async () => {
    if (!activeSession) return;
    if (!window.confirm("Xóa toàn bộ kết quả của lớp học này?")) return;
    const res = await adminFetch(`${API_URL}/api/progress/clear`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: activeSession.id }) });
    if ((await res.json()).success) { alert("Đã làm mới kết quả học tập!"); loadQuestionsAndProgress(); }
  };

  const handleClearQuestions = async () => {
    if (!activeSession || !window.confirm("Xóa sạch đề này?")) return;
    const res = await adminFetch(`${API_URL}/api/questions/clear`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: activeSession.id }) });
    if ((await res.json()).success) { alert("Đã xóa bộ câu hỏi hiện tại!"); loadQuestionsAndProgress(); }
  };

  const calculateStats = (qIndex) => {
    let answered = 0; let correct = 0;
    Object.values(liveProgress).forEach(s => { if (s.history[qIndex] !== undefined) { answered++; if (s.history[qIndex] === true) correct++; } });
    if (answered === 0) return null;
    return { pctCorrect: Math.round((correct / answered) * 100), pctWrong: 100 - Math.round((correct / answered) * 100) };
  };

  if (!isAuthenticated) {
    return (
      <div className="admin-page min-h-screen flex flex-col items-center justify-center p-4 font-sans">
        <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl shadow-indigo-100 border border-slate-100 w-full max-w-sm text-center">
          <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner"><ShieldCheck className="w-10 h-10" /></div>
          <h2 className="text-3xl font-extrabold text-slate-800 mb-2">Không gian giáo viên</h2>
          <p className="mb-6 text-sm font-medium text-slate-500">Đăng nhập để chuẩn bị một giờ học thật hiệu quả.</p>
          <form onSubmit={loginAdmin}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-slate-50 text-slate-800 border-2 border-slate-200 rounded-2xl p-4 mb-6 text-center text-2xl tracking-[0.5em] focus:border-indigo-500 focus:bg-white outline-none" placeholder="••••••" />
            <button type="submit" className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-sky-200 transition-all active:scale-[0.98]">VÀO QUẢN LÝ</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page min-h-screen text-slate-800 font-sans flex flex-col md:flex-row relative">
      
      {/* MODAL TRÌNH SOẠN THẢO */}
      {editor.isOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl rounded-[2rem] shadow-2xl border border-slate-100 flex flex-col h-[85vh] overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-700 flex items-center"><Edit className="w-5 h-5 mr-2 text-indigo-500"/> {editor.title}</h2>
              <button onClick={() => setEditor({ isOpen: false, type: '', text: '', title: '' })} className="text-slate-400 hover:text-rose-500 transition-colors"><X className="w-6 h-6"/></button>
            </div>
            <div className="flex-1 p-6 bg-slate-50/50">
              <textarea value={editor.text} onChange={(e) => setEditor({...editor, text: e.target.value})} className="w-full h-full bg-white text-slate-700 font-mono text-sm leading-relaxed p-5 rounded-2xl border border-slate-200 focus:border-indigo-400 outline-none resize-none shadow-inner" spellCheck="false" />
            </div>
            <div className="p-5 border-t border-slate-100 bg-white flex justify-end space-x-3">
              <button onClick={() => setEditor({ isOpen: false, type: '', text: '', title: '' })} className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-colors">Hủy</button>
              <button onClick={saveEditor} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold flex items-center shadow-lg shadow-indigo-200 transition-all"><Check className="w-5 h-5 mr-2"/> LƯU TÀI LIỆU</button>
            </div>
          </div>
        </div>
      )}

      {/* CỘT MENU TRÁI */}
      <aside className="w-full md:w-72 bg-white border-r border-slate-200 p-5 flex flex-col z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        <div className="flex items-center mb-8 px-2">
          <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center mr-3"><LayoutDashboard className="w-6 h-6" /></div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Lớp Học <span className="text-sky-600">Vui</span></h1>
        </div>
        
        <nav className="space-y-6 flex-1 overflow-y-auto pr-2">
          <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 shadow-sm">
            <h3 className="text-xs text-slate-400 font-bold mb-3 uppercase tracking-wider flex items-center"><Users className="w-4 h-4 mr-1"/> Quản lý Lớp/Phòng</h3>
            <select className="w-full bg-white text-slate-800 border border-slate-200 rounded-xl p-3 mb-4 text-sm font-medium focus:border-indigo-500 outline-none shadow-sm" value={activeSession?.id || ''} onChange={(e) => setActiveSession(sessions.find(s => s.id === parseInt(e.target.value)))}>
              <option value="" disabled>-- Chọn lớp học --</option>
              {sessions.map(s => <option key={s.id} value={s.id}>{s.name} (PIN: {s.join_code})</option>)}
            </select>
            <div className="flex space-x-2">
              <button onClick={handleCreateSession} className="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 p-2.5 rounded-xl font-bold text-sm transition-colors">TẠO MỚI</button>
              <button onClick={handleDeleteSession} disabled={!activeSession} className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-600 disabled:opacity-50 p-2.5 rounded-xl font-bold text-sm transition-colors">XÓA</button>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs text-slate-400 font-bold px-2 uppercase tracking-wider">Dữ liệu & Cấu hình</h3>
            <input type="file" accept=".txt" ref={fileInputRef} onChange={(e) => handleFileUpload(e, 'questions')} className="hidden" />
            <div className="flex space-x-2">
              <button onClick={() => fileInputRef.current.click()} disabled={!activeSession} className="flex-1 flex items-center justify-center p-3 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-600 rounded-xl border border-slate-200 shadow-sm text-sm font-medium transition-all"><Upload className="w-4 h-4 mr-2 text-blue-500" /> Tải danh sách câu hỏi</button>
              <button onClick={() => openEditor('questions')} disabled={!activeSession} className="p-3 bg-white hover:bg-blue-50 text-blue-600 disabled:opacity-50 rounded-xl border border-slate-200 shadow-sm transition-all"><Edit className="w-4 h-4" /></button>
            </div>
            
            <input type="file" accept=".txt" ref={hardwareFileRef} onChange={(e) => handleFileUpload(e, 'hardware')} className="hidden" />
            <div className="flex space-x-2">
              <button onClick={() => hardwareFileRef.current.click()} disabled={!activeSession} className="flex-1 flex items-center justify-center p-3 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-600 rounded-xl border border-slate-200 shadow-sm text-sm font-medium transition-all"><Cpu className="w-4 h-4 mr-2 text-orange-500" /> Ghép STT với thiết bị</button>
              <button onClick={() => openEditor('hardware')} disabled={!activeSession} className="p-3 bg-white hover:bg-orange-50 text-orange-600 disabled:opacity-50 rounded-xl border border-slate-200 shadow-sm transition-all"><Edit className="w-4 h-4" /></button>
            </div>

            <input type="file" accept=".txt" ref={classFileRef} onChange={(e) => handleFileUpload(e, 'class')} className="hidden" />
            <div className="flex space-x-2">
              <button onClick={() => classFileRef.current.click()} className="flex-1 flex items-center justify-center p-3 bg-white hover:bg-slate-50 text-slate-600 rounded-xl border border-slate-200 shadow-sm text-sm font-medium transition-all"><Upload className="w-4 h-4 mr-2 text-pink-500" /> Danh sách học sinh</button>
              <button onClick={() => openEditor('class')} className="p-3 bg-white hover:bg-pink-50 text-pink-600 rounded-xl border border-slate-200 shadow-sm transition-all"><Edit className="w-4 h-4" /></button>
            </div>
          </div>

          <button onClick={openResults} disabled={!activeSession} className="w-full rounded-xl border border-pink-200 bg-pink-50 p-3 font-bold text-pink-700">Kết quả kiểm tra (xem / xuất file)</button>
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <button onClick={handleResetProgress} disabled={!activeSession} className="w-full flex items-center justify-center p-3 text-amber-600 hover:bg-amber-50 disabled:opacity-50 rounded-xl transition-colors font-medium border border-amber-200 bg-amber-50/30"><RotateCcw className="w-4 h-4 mr-2" /> Xóa trắng kết quả</button>
            <button onClick={handleClearQuestions} disabled={!activeSession} className="w-full flex items-center justify-center p-3 text-rose-500 hover:bg-rose-50 disabled:opacity-50 rounded-xl transition-colors font-medium border border-rose-200 bg-rose-50/30"><Trash2 className="w-4 h-4 mr-2" /> Hủy bộ đề hiện tại</button>
          </div>
          <button onClick={() => { sessionStorage.removeItem('quiz_admin_token'); setIsAuthenticated(false); }} className="w-full rounded-xl border border-slate-200 p-3 text-sm font-bold text-slate-500 hover:bg-slate-100">ĐĂNG XUẤT / ĐĂNG NHẬP LẠI</button>
        </nav>
      </aside>

      {showResults && <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl p-6 w-full max-w-5xl max-h-[85vh] overflow-auto">
        <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Kết quả kiểm tra — {activeSession?.name}</h2><button onClick={()=>setShowResults(false)} className="font-bold text-red-600">ĐÓNG ✕</button></div>
        <p className="text-sm mb-3 text-slate-500">Chỉ hiển thị điểm của các câu đã CHỐT. Tải CSV mở bằng Excel.</p>
        <button onClick={exportResults} className="bg-blue-600 text-white px-4 py-2 rounded-xl mb-4">Xuất kết quả (CSV / Excel)</button>
        <table className="w-full text-left text-sm"><thead><tr className="border-b"><th>STT</th><th>Họ tên</th><th>Thiết bị</th><th>Số câu đúng</th><th>Điểm</th><th>Đáp án đã chốt</th></tr></thead><tbody>{resultRows.map(r=><tr key={r.stt} className="border-b"><td className="p-2">{r.stt}</td><td>{r.full_name}</td><td>{r.source||'Chưa tham gia'}</td><td>{r.correct}/{questionsList.length}</td><td>{r.correct}</td><td>{r.answers.map(x=>x||'—').join(' · ')}</td></tr>)}</tbody></table>
      </div></div>}
      {/* KHU VỰC HIỂN THỊ CHÍNH */}
      <main className="flex-1 p-6 md:p-8 overflow-y-auto flex flex-col space-y-6">
        
        {/* BẢNG TIẾN ĐỘ HỌC TẬP */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 flex-1 flex flex-col min-h-[300px]">
          <div className="flex items-center justify-between mb-6 px-2">
            <h2 className="text-xl font-extrabold text-slate-800 flex items-center"><Activity className="w-6 h-6 mr-2 text-emerald-500"/> Danh sách thiết bị tham gia</h2>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-100 flex-1">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-slate-50/80 text-slate-500 text-sm font-bold uppercase tracking-wider">
                  <th className="p-4 border-b border-slate-100 w-16">STT</th><th className="p-4 pl-6 border-b border-slate-100 w-48">Học sinh</th>
                  <th className="p-4 border-b border-slate-100 w-32">Thiết bị</th>
                  <th className="p-4 border-b border-slate-100">Tiến độ bài làm</th>
                  <th className="p-4 border-b border-slate-100 w-24 text-center">Điểm</th>
                </tr>
              </thead>
              <tbody>
                {roster.length === 0 ? <tr><td colSpan="5" className="p-12 text-center text-slate-400 font-medium">Chưa có dữ liệu...</td></tr> : 
                  roster.map((person, i) => {
                    const source = participation[Number(person.stt)] || null;
                    const student = liveProgress[`${source === "ESP32" ? "HARDWARE" : "WEB"}_${person.stt}`] || Object.values(liveProgress).find(x=>x.stt===Number(person.stt)) || {history:[]};
                    return (
                    <tr key={person.stt} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="p-4 font-bold">{person.stt}</td>
                      <td className="p-4 pl-6 font-bold text-slate-700 truncate max-w-[150px]">{person.full_name}</td>
                      <td className="p-4">
                        {source === 'ESP32' ? 
                          <span className="bg-orange-50 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-bold border border-orange-100 flex items-center w-fit"><Cpu className="w-3.5 h-3.5 mr-1.5"/> ESP32</span> : source === "WEB" ? 
                          <span className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-bold border border-blue-100 flex items-center w-fit"><Smartphone className="w-3.5 h-3.5 mr-1.5"/> Web</span> : <span className="text-slate-400">— Chưa tham gia</span>
                        }
                      </td>
                      <td className="p-4 flex flex-wrap gap-1.5">
                        {questionsList.map((_, idx) => {
                          const status = student.history[idx];
                          if (status === undefined) return <div key={idx} className="w-7 h-7 bg-slate-100 rounded-lg border border-slate-200/60"></div>;
                          return status ? 
                            <div key={idx} className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center shadow-sm shadow-emerald-200"><Check className="w-4 h-4 text-white stroke-[3]"/></div> : 
                            <div key={idx} className="w-7 h-7 bg-rose-500 rounded-lg flex items-center justify-center shadow-sm shadow-rose-200"><X className="w-4 h-4 text-white stroke-[3]"/></div>
                        })}
                      </td>
                      <td className="p-4 font-black text-indigo-600 text-center text-lg">{student.history.filter(Boolean).length} <span className="text-sm text-slate-400 font-medium">/ {questionsList.length}</span></td>
                    </tr>
                  )})
                }
              </tbody>
              {roster.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50/50 font-bold text-xs uppercase tracking-wider">
                    <td colSpan="3" className="p-4 pr-6 text-right text-slate-500">Đúng / Sai :</td>
                    <td className="p-4 flex flex-wrap gap-1.5 pt-5 pb-5">
                      {questionsList.map((_, idx) => {
                        const stats = calculateStats(idx);
                        return (
                          <div key={idx} className="w-7 h-12 flex flex-col items-center justify-center bg-white rounded-lg border border-slate-200 shadow-sm">
                            {stats ? (<><span className="text-emerald-500 leading-tight font-extrabold">{stats.pctCorrect}%</span><span className="text-rose-400 leading-tight text-[10px] mt-1 font-bold">{stats.pctWrong}%</span></>) : <span className="text-slate-300">-</span>}
                          </div>
                        )
                      })}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* ======================================================== */}
        {/* TRẠM ĐIỀU KHIỂN & MÀN HÌNH TIVI (BỐ CỤC 2 CỘT HIỆN ĐẠI) */}
        {/* ======================================================== */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          
          {/* Bảng Nút Bấm Thao Tác */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 md:p-8 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-extrabold text-slate-800 flex items-center"><Play className="w-6 h-6 mr-2 text-blue-500"/> Điều khiển bài học</h2>
              <span className="bg-indigo-50 text-indigo-600 px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-widest border border-indigo-100">
                Câu {questionsList.length > 0 ? currentIndex + 1 : 0} / {questionsList.length}
              </span>
            </div>
            
            <div className="bg-slate-50 rounded-[1.5rem] p-6 border border-slate-100 text-center mb-6 min-h-[120px] flex flex-col items-center justify-center shadow-inner relative">
              <span className="absolute top-3 left-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Nội dung chuẩn bị trình chiếu</span>
              <p className="text-lg font-bold text-slate-700 leading-relaxed mt-4">{currentQuestion?.content || "Hãy nạp đề thi để bắt đầu."}</p>
            </div>
            
            <div className="mb-3 rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
              {currentRound && activeSession && currentRound.session_id === activeSession.id ? (currentRound.phase==='locked' ? `🔒 Câu ${currentRound.questionIndex+1} đã CHỐT, không thể sửa đáp án.` : `🟡 Đang PHÁT câu ${currentRound.questionIndex+1}: nhận đáp án mới nhất, chưa tính điểm.`) : 'Chưa PHÁT câu nào của lớp này.'}
            </div>
            {adminNotice && <p className="mb-3 rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-800">{adminNotice}</p>}
            <div className="flex justify-between items-center w-full gap-3">
              <button onClick={() => currentIndex > 0 && setCurrentIndex(currentIndex - 1)} className="p-4 bg-white hover:bg-slate-50 text-slate-500 border border-slate-200 rounded-2xl shadow-sm transition-colors"><ArrowLeft className="w-6 h-6" /></button>
              <div className="flex gap-2 flex-1">
                <button onClick={() => sendAdminAction('open_question')} disabled={!currentQuestion} 
                  className="flex-1 py-4 px-2 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold rounded-2xl flex items-center justify-center transition-all shadow-lg shadow-blue-200 disabled:opacity-50 disabled:shadow-none text-sm md:text-base">
                  <Play className="w-5 h-5 mr-1" /> PHÁT
                </button>
                <button onClick={() => sendAdminAction('show_result')} disabled={!currentQuestion} 
                  className="flex-1 py-4 px-2 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white font-bold rounded-2xl flex items-center justify-center transition-all shadow-lg shadow-amber-200 disabled:opacity-50 disabled:shadow-none text-sm md:text-base">
                  <CheckSquare className="w-5 h-5 mr-1" /> CHỐT
                </button>
              </div>
              <button onClick={() => currentIndex < questionsList.length - 1 && setCurrentIndex(currentIndex + 1)} className="p-4 bg-white hover:bg-slate-50 text-slate-500 border border-slate-200 rounded-2xl shadow-sm transition-colors"><ArrowRight className="w-6 h-6" /></button>
            </div>
          </div>

          {/* Màn hình Tivi Thu Nhỏ */}
          <div className="bg-sky-100 rounded-[2rem] border-[6px] border-white p-2 shadow-2xl shadow-sky-100 flex flex-col relative min-h-[320px]">
            {/* Đèn báo LIVE */}
            <div className="absolute top-4 left-5 flex items-center z-10 bg-white/90 px-3 py-1.5 rounded-full backdrop-blur-md shadow-sm">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse mr-2"></div>
              <span className="text-[10px] text-sky-700 font-bold tracking-widest uppercase">Đang trình chiếu</span>
            </div>

            {/* Khung viền màn hình ảo */}
            <div className="w-full h-full bg-gradient-to-br from-sky-50 to-emerald-50 rounded-[1.2rem] p-6 flex flex-col justify-center items-center text-center relative overflow-hidden">
               {!liveScreen.questionData ? (
                  <span className="text-sky-500 font-bold uppercase tracking-widest animate-pulse mt-4">Sẵn sàng trình chiếu...</span>
               ) : (
                  <div className="w-full flex flex-col h-full justify-center mt-6">
                    <h3 className="text-slate-800 font-extrabold text-lg md:text-xl leading-relaxed mb-6 px-2">{liveScreen.questionData.content}</h3>
                    <div className="grid grid-cols-2 gap-3 w-full max-w-sm mx-auto">
                      {['A', 'B', 'C', 'D'].map(opt => {
                        // Logic tô màu khi chốt đáp án
                        const isCorrect = liveScreen.status === 'result' && liveScreen.correctAnswer === opt;
                        const isWrong = liveScreen.status === 'result' && liveScreen.correctAnswer !== opt;
                        
                        let bgClass = "bg-white border-sky-100 text-slate-700 shadow-sm";
                        if (isCorrect) bgClass = "bg-emerald-500 border-emerald-600 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)] scale-110 z-10 font-black";
                        else if (isWrong) bgClass = "bg-white border-slate-100 text-slate-400 opacity-40";

                        return (
                          <div key={opt} className={`p-3 rounded-xl border-b-4 flex items-center text-left transition-all duration-500 ${bgClass}`}>
                            <div className="w-8 h-8 shrink-0 rounded-lg bg-white/20 flex items-center justify-center font-black mr-3 text-sm">{opt}</div>
                            <span className="text-xs md:text-sm font-bold line-clamp-2">{liveScreen.questionData[`answer_${opt.toLowerCase()}`]}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
               )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
