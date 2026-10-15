import { useEffect, useState } from 'react';
import { BookOpen, Clock3, Sparkles, Users, Hash, CheckCircle2, AlertCircle, CalendarDays } from 'lucide-react';
import { io } from 'socket.io-client';
import { API_URL } from '../config';

const socket = io(API_URL);
const options = [
  { key: 'A', field: 'answer_a', style: 'answer-coral' },
  { key: 'B', field: 'answer_b', style: 'answer-sky' },
  { key: 'C', field: 'answer_c', style: 'answer-sun' },
  { key: 'D', field: 'answer_d', style: 'answer-mint' }
];

export default function AudienceView() {
  const [devices, setDevices] = useState([]);
  const [round, setRound] = useState(null);
  const [session, setSession] = useState(null);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const sync = async () => {
      try {
        const [lobby, state] = await Promise.all([
          fetch(`${API_URL}/api/hardware/lobby`).then(r => r.json()),
          fetch(`${API_URL}/api/round/current`).then(r => r.json())
        ]);
        setDevices(Array.isArray(lobby.devices) ? lobby.devices : []);
        if (state.state) setRound(state.state);
      } catch (err) { console.error('Lỗi đồng bộ màn hình:', err); }
    };
    sync();
    const onLobby = data => setDevices(Array.isArray(data.devices) ? data.devices : []);
    const onState = data => setRound(data);
    const onConnect = () => { setConnected(true); sync(); };
    const onDisconnect = () => setConnected(false);
    socket.on('hardware_lobby_update', onLobby);
    socket.on('quiz_round_state', onState);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('hardware_lobby_update', onLobby);
      socket.off('quiz_round_state', onState);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/sessions`).then(r => r.json()).then(list => {
      const all = Array.isArray(list) ? list : [];
      const pin = new URLSearchParams(window.location.search).get('pin');
      const explicit = all.find(s => pin && s.join_code === pin.toUpperCase());
      setSession(explicit || all.find(s => s.id === round?.session_id) || all[0] || null);
    }).catch(() => {});
  }, [round?.session_id]);

  const question = round?.questionData;
  const locked = round?.phase === 'locked';
  return (
    <div className="presentation-page min-h-screen p-5 font-sans text-slate-800 md:p-8">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between rounded-3xl border border-white bg-white/80 px-6 py-4 shadow-lg shadow-sky-100 backdrop-blur md:px-8">
        <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500 text-white"><BookOpen className="h-6 w-6" /></span><div><p className="text-xl font-black">Lớp Học Vui</p><p className="text-xs font-bold text-slate-400">{session?.name || 'Cùng suy nghĩ · Cùng tiến bộ'}</p></div></div>
        <div className="text-right"><span className="inline-block rounded-full bg-sky-50 px-5 py-2 text-lg font-black text-sky-700">PIN: {session?.join_code || 'Chờ giáo viên'}</span><div className={`mt-1 text-xs font-bold ${connected ? 'text-emerald-600' : 'text-rose-600'}`}>{connected ? 'Đã kết nối máy chủ' : 'Mất kết nối máy chủ'}</div></div>
      </header>
      {!question ? (
        <main className="mx-auto flex min-h-[75vh] w-full max-w-6xl flex-col items-center justify-center text-center">
          <div className="mt-6 flex h-24 w-24 items-center justify-center rounded-full bg-white text-sky-500 shadow-xl shadow-sky-100"><Users className="h-12 w-12" /></div>
          <h1 className="mt-7 text-4xl font-black text-slate-800 md:text-5xl">Sảnh chờ kiểm tra</h1>
          <p className="mt-3 text-lg font-medium text-slate-500">Nhập STT trên thiết bị rồi nhấn ENTER để vào sảnh</p>
          <div className="mt-7 flex items-center gap-2 rounded-full bg-white px-5 py-2.5 font-black text-sky-700 shadow-sm"><Users className="h-5 w-5" /> {devices.length} thiết bị đã vào</div>
          <div className="mt-7 w-full rounded-[2rem] border border-sky-100 bg-white/90 p-5 shadow-xl shadow-sky-100/60 md:p-8">
            {devices.length === 0 ? <div className="flex min-h-36 flex-col items-center justify-center text-slate-400"><Clock3 className="mb-3 h-9 w-9" /><p className="font-bold">Chưa có STT nào vào sảnh</p></div> : (
              <div className="space-y-3 text-left">
                <div className="hidden md:grid grid-cols-[90px_minmax(220px,2fr)_minmax(140px,1fr)_110px] gap-4 px-5 text-xs font-bold uppercase tracking-wider text-slate-400"><span>STT</span><span>Họ và tên học sinh</span><span>Ngày sinh</span><span>Trạng thái</span></div>
                {devices.map(d => {
                  const item = typeof d === 'object' ? d : {device_id:d, stt:d, student_name:'', dob:''};
                  const found = item.student_name && item.student_name !== 'Chưa có trong danh sách lớp';
                  return <div key={item.device_id} className="grid grid-cols-1 items-center gap-2 rounded-2xl border border-sky-100 bg-sky-50/80 p-4 shadow-sm md:grid-cols-[90px_minmax(220px,2fr)_minmax(140px,1fr)_110px] md:gap-4 md:px-5">
                    <span className="flex items-center gap-1 font-black text-sky-700"><Hash className="h-4 w-4"/>{item.stt}</span>
                    <span className={`break-words text-lg font-extrabold leading-normal ${found ? 'text-slate-800':'text-amber-700'}`}>{item.student_name || 'Chưa xác định học sinh'}</span>
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-600"><CalendarDays className="h-4 w-4 text-sky-400"/>{item.dob || 'Chưa có ngày sinh'}</span>
                    <span className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${found?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{found?<CheckCircle2 className="h-4 w-4"/>:<AlertCircle className="h-4 w-4"/>}{found?'ĐÃ VÀO':'CHƯA XÁC MINH'}</span>
                  </div>;
                })}
              </div>
            )}
          </div>
          <span className="mt-6 flex items-center gap-2 rounded-full bg-white px-5 py-3 font-bold text-sky-600 shadow-sm"><Sparkles className="h-5 w-5"/> Chờ giáo viên PHÁT câu hỏi</span>
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center py-8 md:py-12">
          <div className="mb-7 rounded-[2rem] border border-sky-100 bg-white p-7 text-center shadow-xl shadow-sky-100/70 md:p-10">
            <span className={`mb-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-extrabold ${locked?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>{locked?'ĐÃ CHỐT — HIỆN ĐÁP ÁN':'ĐANG NHẬN ĐÁP ÁN — CÓ THỂ TRẢ LỜI LẠI'}</span>
            <div className="mb-2 text-sm font-bold text-slate-400">Câu {round.questionIndex + 1}</div>
            <h2 className="text-3xl font-black leading-tight md:text-5xl">{question.content}</h2>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-7">
            {options.map(({key,field,style}) => <div key={key} className={`presentation-answer ${style} ${locked && round.correctAnswer === key?'answer-correct':''} ${locked && round.correctAnswer !== key?'answer-muted':''}`}><span className="answer-letter">{key}</span><span className="text-xl font-extrabold leading-snug md:text-3xl">{question[field]}</span>{locked&&round.correctAnswer===key&&<Sparkles className="ml-auto h-8 w-8 shrink-0"/>}</div>)}
          </div>
        </main>
      )}
    </div>
  );
}
