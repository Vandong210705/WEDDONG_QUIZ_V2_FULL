import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, GraduationCap, MonitorPlay, Settings2, Sparkles } from 'lucide-react';
import heroImage from '../assets/learning-hero.png';

const roles = [
  { title: 'Học sinh', description: 'Vào lớp bằng mã PIN và chinh phục từng câu hỏi theo nhịp độ của bạn.', action: 'Bắt đầu học', path: '/play', icon: GraduationCap, tone: 'sky' },
  { title: 'Màn hình lớp học', description: 'Trình chiếu câu hỏi và kết quả rõ ràng để cả lớp cùng theo dõi.', action: 'Mở trình chiếu', path: '/screen', icon: MonitorPlay, tone: 'violet' },
  { title: 'Giáo viên', description: 'Chuẩn bị bộ câu hỏi, quản lý lớp và theo dõi tiến độ học tập.', action: 'Vào quản lý', path: '/admin', icon: Settings2, tone: 'coral' },
];

export default function Landing() {
  const navigate = useNavigate();
  return (
    <div className="landing-page min-h-screen font-sans text-slate-800">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-6 md:px-8">
        <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500 text-white shadow-lg shadow-sky-200"><BookOpen className="h-6 w-6" /></span><div><p className="text-xl font-black tracking-tight text-slate-800">Lớp Học Vui</p><p className="text-xs font-semibold text-slate-500">Mỗi câu hỏi, một bước tiến</p></div></div>
        <span className="hidden rounded-full border border-sky-100 bg-white/80 px-4 py-2 text-sm font-bold text-sky-700 shadow-sm sm:flex sm:items-center sm:gap-2"><Sparkles className="h-4 w-4" /> Học tập tích cực mỗi ngày</span>
      </header>
      <main className="mx-auto w-full max-w-7xl px-5 pb-12 md:px-8">
        <section className="hero-panel relative overflow-hidden rounded-[2rem] border border-white/80 shadow-2xl shadow-sky-200/50 md:min-h-[500px]">
          <img src={heroImage} alt="Sách mở và những biểu tượng học tập đầy màu sắc" className="absolute inset-0 h-full w-full object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-r from-sky-50 via-sky-50/95 to-transparent" />
          <div className="relative z-10 flex min-h-[500px] max-w-2xl flex-col justify-center p-7 sm:p-12 lg:p-16">
            <span className="mb-5 flex w-fit items-center gap-2 rounded-full bg-white/85 px-4 py-2 text-sm font-extrabold text-sky-700 shadow-sm backdrop-blur"><Sparkles className="h-4 w-4 text-amber-500" /> Cùng học, cùng tiến bộ</span>
            <h1 className="max-w-xl text-4xl font-black leading-[1.1] tracking-tight text-slate-800 sm:text-5xl lg:text-6xl">Biến mỗi giờ học thành một hành trình <span className="text-sky-600">đầy cảm hứng.</span></h1>
            <p className="mt-6 max-w-lg text-base font-medium leading-relaxed text-slate-600 sm:text-lg">Không gian hỏi đáp trực tiếp giúp học sinh tự tin thể hiện kiến thức, giáo viên dễ dàng theo dõi và cả lớp cùng vui với từng tiến bộ nhỏ.</p>
            <button onClick={() => navigate('/play')} className="mt-8 flex w-fit items-center gap-2 rounded-2xl bg-sky-600 px-6 py-4 font-extrabold text-white shadow-xl shadow-sky-300 transition hover:-translate-y-1 hover:bg-sky-700">Tham gia lớp học <ArrowRight className="h-5 w-5" /></button>
          </div>
        </section>
        <section className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
          {roles.map(({ title, description, action, path, icon: Icon, tone }) => <button key={path} onClick={() => navigate(path)} className={`role-card role-${tone} group text-left`}><span className="role-icon"><Icon className="h-7 w-7" /></span><h2 className="mt-6 text-2xl font-black text-slate-800">{title}</h2><p className="mt-2 min-h-[48px] text-sm font-medium leading-relaxed text-slate-500">{description}</p><span className="mt-6 flex items-center gap-2 text-sm font-extrabold">{action} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span></button>)}
        </section>
      </main>
    </div>
  );
}
