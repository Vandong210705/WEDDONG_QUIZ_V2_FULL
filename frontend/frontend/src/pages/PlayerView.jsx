import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Hash, Fingerprint, ArrowLeft, CheckCircle2, Clock3, Send, AlertTriangle } from 'lucide-react';
import { io } from 'socket.io-client';
import { API_URL } from '../config';

const socket = io(API_URL);
const options = ['A','B','C','D'];

export default function PlayerView() {
  const navigate = useNavigate();
  const [pin,setPin] = useState('');
  const [stt,setStt] = useState('');
  const [session,setSession] = useState(null);
  const [student,setStudent] = useState(null);
  const [stage,setStage] = useState('login');
  const [round,setRound] = useState(null);
  const [choice,setChoice] = useState('');
  const [saved,setSaved] = useState('');
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');

  useEffect(()=>{
    const sync = () => fetch(`${API_URL}/api/round/current`).then(r=>r.json()).then(d=>setRound(d.state)).catch(()=>{});
    sync();
    socket.on('connect',sync);
    socket.on('quiz_round_state',setRound);
    return ()=>{socket.off('connect',sync);socket.off('quiz_round_state',setRound);};
  },[]);
  useEffect(()=>{setChoice('');setSaved('');setMessage('');},[round?.revision]);

  const verify = async(e)=>{
    e.preventDefault();setMessage('');
    try {
      const list=await fetch(`${API_URL}/api/sessions`).then(r=>r.json());
      const room=list.find(s=>s.join_code===pin.trim().toUpperCase());
      if(!room)throw Error('Mã PIN không tồn tại');
      const data=await fetch(`${API_URL}/api/students/verify?stt=${encodeURIComponent(stt)}`).then(r=>r.json());
      if(!data.success)throw Error(data.message);
      setSession(room);setStudent(data.student);setStage('verify');
    } catch(err){setMessage(err.message);}
  };
  const checkin=async()=>{
    try {
      const res=await fetch(`${API_URL}/api/checkin`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:session.id,stt:student.stt,full_name:student.full_name,source:'WEB'})});
      const result=await res.json();if(!result.success)throw Error(result.error||'Không thể vào lớp');
      setStage('playing');
    }catch(err){setMessage(err.message);}
  };
  const submit=()=>{
    if(!choice||!round||round.phase!=='open'||round.session_id!==session?.id)return;
    setBusy(true);setMessage('');
    socket.timeout(7000).emit('player_submit_answer',{sessionId:session.id,stt:student.stt,questionIndex:round.questionIndex,answer:choice},(err,result)=>{
      setBusy(false);
      if(err||!result?.success)setMessage(result?.error||'Không gửi được, thử lại');
      else {setSaved(choice);setMessage('Đã lưu đáp án '+choice+'. Bạn có thể đổi và gửi lại trước khi CHỐT.');}
    });
  };
  const live = round?.session_id===session?.id ? round : null;
  const isLocked=live?.phase==='locked';
  const q=live?.questionData;
  return <div className="learning-page min-h-screen flex items-center justify-center p-5 text-slate-800">
    {stage==='login'&&<div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">
      <button className="mb-5 inline-flex items-center gap-1 text-slate-500" onClick={()=>navigate('/')}><ArrowLeft className="h-4 w-4"/> Trở về</button>
      <BookOpen className="mx-auto mb-4 h-12 w-12 text-sky-500"/><h1 className="mb-6 text-center text-3xl font-black">Vào phòng kiểm tra</h1>
      <form onSubmit={verify} className="space-y-4"><label className="block text-sm font-bold">PIN lớp học<input value={pin} onChange={e=>setPin(e.target.value.toUpperCase())} required className="mt-2 w-full rounded-xl border p-4 text-lg" placeholder="VD: DEMO26"/></label><label className="block text-sm font-bold">STT học sinh<input type="number" min="1" value={stt} onChange={e=>setStt(e.target.value)} required className="mt-2 w-full rounded-xl border p-4 text-lg" placeholder="VD: 1"/></label><button className="w-full rounded-xl bg-blue-600 p-4 font-black text-white">TÌM HỌC SINH</button></form>
      {message&&<p className="mt-4 font-bold text-rose-600">{message}</p>}
    </div>}
    {stage==='verify'&&<div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl"><h2 className="mb-3 text-2xl font-black">{student.full_name}</h2><p className="mb-6 text-slate-600">STT {student.stt} · {student.dob||'Chưa có ngày sinh'} · {session.name}</p><div className="flex gap-3"><button className="flex-1 rounded-xl bg-slate-100 p-4 font-bold" onClick={()=>setStage('login')}>Đổi STT</button><button className="flex-1 rounded-xl bg-blue-600 p-4 font-bold text-white" onClick={checkin}>VÀO LỚP</button></div>{message&&<p className="mt-4 text-rose-600">{message}</p>}</div>}
    {stage==='playing'&&<main className="w-full max-w-4xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-5 shadow-sm"><div><p className="text-xl font-black">{student.full_name}</p><p className="text-sm text-slate-500">STT {student.stt} · {session.name}</p></div><span className="rounded-full bg-sky-100 px-4 py-2 text-sm font-bold text-sky-700">{q?'Câu '+(live.questionIndex+1):'Đang chờ giáo viên'}</span></header>
      {!q ? <div className="rounded-3xl bg-white p-12 text-center"><Clock3 className="mx-auto mb-3 h-10 w-10 text-sky-500"/><p className="font-bold">Chờ giáo viên bấm PHÁT</p></div> : <>
        <div className="rounded-3xl bg-white p-8 text-center shadow-sm"><p className={`mb-4 font-bold ${isLocked?'text-emerald-600':'text-amber-600'}`}>{isLocked?'CÂU ĐÃ CHỐT — KHÓA ĐÁP ÁN':'ĐANG NHẬN ĐÁP ÁN — CÓ THỂ SỬA'}</p><h2 className="text-2xl font-extrabold">{q.content}</h2></div>
        <div className="grid gap-4 md:grid-cols-2">{options.map(k=><button key={k} disabled={isLocked} onClick={()=>setChoice(k)} className={`flex min-h-24 items-center gap-4 rounded-2xl border-4 p-5 text-left text-lg font-bold shadow-sm ${choice===k?'border-sky-600 bg-sky-100':'border-white bg-white'} disabled:opacity-80`}><span className="rounded-xl bg-blue-600 px-4 py-3 text-xl text-white">{k}</span>{q['answer_'+k.toLowerCase()]}</button>)}</div>
        {!isLocked ? <div className="rounded-2xl bg-white p-5"><button disabled={!choice||busy} onClick={submit} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 p-4 font-black text-white disabled:opacity-50"><Send className="h-5 w-5"/>{busy?'ĐANG GỬI...':saved?'GỬI LẠI ĐÁP ÁN':'GỬI ĐÁP ÁN'}</button><p className="mt-3 text-center text-sm font-bold text-slate-600">{saved?'Đã gửi: '+saved+' — Có thể chọn đáp án khác rồi gửi lại.':'Chỉ sau khi giáo viên CHỐT mới tính điểm.'}</p></div> : <div className="rounded-2xl bg-white p-6 text-center"><CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500"/><p className="text-lg font-black">Đáp án đúng: {live.correctAnswer}</p><p className="mt-2 font-bold text-slate-600">{saved?`Bạn đã gửi ${saved} — ${saved===live.correctAnswer?'Đúng':'Sai'}`:'Không ghi nhận câu trả lời trong phiên web này'}</p><p className="mt-2 text-sm text-slate-500">Điểm chính thức đã được backend tính khi CHỐT.</p></div>}
      </>}
      {message&&<p className="rounded-xl bg-white p-4 text-center font-bold text-slate-700">{message}</p>}
      {!socket.connected&&<div className="flex items-center gap-2 text-rose-600"><AlertTriangle className="h-4 w-4"/> Mất kết nối máy chủ</div>}
    </main>}
  </div>;
}
