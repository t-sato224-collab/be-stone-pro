"use client";

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  ClipboardList, History, LogOut, Clock, 
  MapPin, CheckCircle2, PlayCircle, Camera, X, Loader2, Coffee, ArrowLeft, AlertTriangle, BarChart3, Download, Search, Menu
} from 'lucide-react';
import dynamic from 'next/dynamic';

const QrScanner = dynamic(() => import('../../components/QrScanner'), { ssr: false });
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

export default function DashboardPage() {
  const [staff, setStaff] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [attendanceStatus, setAttendanceStatus] = useState<'offline' | 'working' | 'break'>('offline');
  const [currCard, setCurrCard] = useState<any>(null);
  const [activeTask, setActiveTask] = useState<any>(null);
  const [isQrVerified, setIsQrVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [menuChoice, setMenuChoice] = useState("📋 本日の業務");
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const [personalHistory, setPersonalHistory] = useState<any[]>([]);
  const [adminStaffList, setAdminStaffList] = useState<any[]>([]);
  const [adminReport, setAdminReport] = useState<any[]>([]);

  const [filterStaffId, setFilterStaffId] = useState<string>("all");
  const [filterStartDate, setFilterStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterEndDate, setFilterEndDate] = useState(new Date().toISOString().split('T')[0]);

  // --- 時刻変換・計算ロジック ---
  const formatToJSTTime = (isoString: string | null) => {
    if (!isoString) return "---";
    return new Date(isoString).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  // 出勤からの経過時間を計算する関数
  const getElapsedTimeString = () => {
    if (!currCard || !currCard.clock_in_at || attendanceStatus === 'offline') return null;
    const diff = currentTime.getTime() - new Date(currCard.clock_in_at).getTime();
    const hh = Math.floor(diff / 3600000);
    const mm = Math.floor((diff % 3600000) / 60000);
    return `${hh}時間${mm}分`;
  };

  const fetchTasks = useCallback(async () => {
    const today = new Date().toLocaleDateString('sv-SE');
    const { data } = await supabase.from('task_logs').select('*, task_master(*, locations(*))').eq('work_date', today);
    if (data) {
      setTasks(data.sort((a, b) => (a.task_master?.target_hour || 0) - (b.task_master?.target_hour || 0)));
    }
  }, []);

  const syncStatus = useCallback(async (staffId: string) => {
    const { data: tc } = await supabase.from('timecards').select('*').eq('staff_id', staffId).is('clock_out_at', null).maybeSingle();
    if (tc) {
      setCurrCard(tc);
      const { data: br } = await supabase.from('breaks').select('*').eq('staff_id', staffId).is('break_end_at', null).maybeSingle();
      setAttendanceStatus(br ? 'break' : 'working');
    } else {
      setCurrCard(null);
      setAttendanceStatus('offline');
    }
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const init = async () => {
      const savedId = localStorage.getItem('staff_id');
      const savedKey = localStorage.getItem('session_key');
      const savedPage = localStorage.getItem('active_page');
      if (!savedId) { window.location.href = '/'; return; }
      if (savedPage) setMenuChoice(savedPage);

      const { data: staffData } = await supabase.from('staff').select('*').eq('staff_id', savedId).eq("session_key", savedKey).single();
      if (staffData) {
        setStaff(staffData);
        syncStatus(staffData.id);
        if (staffData.role === 'admin') {
          const { data: sList } = await supabase.from('staff').select('id, name');
          if (sList) setAdminStaffList(sList);
        }
      } else { localStorage.clear(); window.location.href = '/'; }
    };
    init();
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    handleResize();
    const clockTimer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => { clearInterval(clockTimer); window.removeEventListener('resize', handleResize); };
  }, [syncStatus]);

  // タスクフィルタ（現在時刻の±30分：右上時計と完全同期）
  const displayTasks = useMemo(() => {
    const currentTotalMins = currentTime.getHours() * 60 + currentTime.getMinutes();
    return tasks.filter(t => {
        const taskMins = (t.task_master?.target_hour || 0) * 60 + (t.task_master?.target_minute || 0);
        return Math.abs(currentTotalMins - taskMins) <= 30;
    });
  }, [tasks, currentTime]);

  const handleClockIn = async () => {
    setLoading(true);
    await supabase.from('timecards').insert({ staff_id: staff.id, staff_name: staff.name, clock_in_at: new Date().toISOString(), work_date: new Date().toLocaleDateString('sv-SE') });
    await syncStatus(staff.id);
    setLoading(false);
  };

  const handleClockOut = async () => {
    if(!confirm("退勤を記録しますか？")) return;
    setLoading(true);
    await supabase.from('timecards').update({ clock_out_at: new Date().toISOString() }).eq('staff_id', staff.id).is('clock_out_at', null);
    await syncStatus(staff.id);
    setLoading(false);
  };

  const handleBreak = async () => {
    setLoading(true);
    if (attendanceStatus === 'working') {
      await supabase.from('breaks').insert({ staff_id: staff.id, timecard_id: currCard?.id, break_start_at: new Date().toISOString(), work_date: new Date().toLocaleDateString('sv-SE') });
    } else {
      await supabase.from('breaks').update({ break_end_at: new Date().toISOString() }).eq('staff_id', staff.id).is('break_end_at', null);
    }
    await syncStatus(staff.id);
    setLoading(false);
  };

  const handleTaskComplete = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setLoading(true);
    const file = e.target.files[0];
    const fileName = `${activeTask.id}-${Date.now()}.jpg`;
    try {
      await supabase.storage.from('task-photos').upload(fileName, file);
      await supabase.from('task_logs').update({ status: 'completed', completed_at: new Date().toISOString(), photo_url: fileName, staff_id: staff.id }).eq('id', activeTask.id);
      setActiveTask(null); fetchTasks();
      alert("完了報告を送信しました。");
    } catch (err) { alert("送信エラー"); }
    finally { setLoading(false); }
  };

  if (!staff) return null;

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col md:flex-row text-black overflow-x-hidden">
      <style jsx global>{`
        header, footer { display: none !important; }
        :root { color-scheme: light !important; }
        .stApp { background: #FFFFFF !important; }
        p, h1, h2, h3, h4, h5, span, label, td, th { color: #000000 !important; font-style: normal !important; }
        .app-card { background: white; padding: 25px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid #edf2f7; margin-bottom: 20px; }
        
        /* ボタン黒靄除去・白文字固定 */
        button {
          background-color: #75C9D7 !important; color: #FFFFFF !important;
          border-radius: 12px !important; font-weight: 900 !important;
          border: none !important; box-shadow: none !important; opacity: 1 !important;
        }
        
        /* 着手ボタン：絶対的視認性（濃紺） */
        .btn-dark { background-color: #1a202c !important; color: white !important; }
        .btn-dark * { color: white !important; }
      `}</style>

      {/* ハンバーガーアイコン */}
      {isMobile && !activeTask && (
        <button onClick={() => setSidebarOpen(true)} className="fixed top-6 left-6 z-50 p-3 bg-white shadow-xl rounded-2xl border border-slate-100 active:scale-90">
          <Menu size={28} color="#ffffff" />
        </button>
      )}

      {/* スライドメニュー */}
      <div className={`fixed inset-0 bg-black/40 z-[140] transition-opacity duration-300 ${sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`fixed md:relative inset-y-0 left-0 z-[150] w-[75vw] md:w-80 bg-white border-r border-slate-100 p-8 shadow-2xl md:shadow-none transition-transform duration-300 transform ${sidebarOpen || !isMobile ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex justify-between items-center mb-10">
          <h1 className="text-3xl font-black italic" style={{color: '#75C9D7'}}>BE STONE</h1>
          {isMobile && <button onClick={() => setSidebarOpen(false)}><X size={32} color="#75C9D7" /></button>}
        </div>
        <nav className="flex-1 space-y-2">
          {["📋 本日の業務", "⚠️ 未完了タスク", "🕒 自分の履歴", "📊 監視(Admin)", "📅 出勤簿(Admin)"].filter(label => !label.includes("Admin") || staff.role === 'admin').map((label) => (
            <button key={label} onClick={() => { setMenuChoice(label); setSidebarOpen(false); localStorage.setItem('active_page', label); }}
              className={`w-full text-left px-6 py-6 rounded-[1rem] font-black text-2xl border-b border-slate-50 ${menuChoice === label ? 'bg-[#75C9D7] text-white' : 'text-black hover:bg-slate-50'}`}>
              <span style={{ color: menuChoice === label ? 'white' : 'black' }}>{label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-10 pt-8 border-t border-slate-100 text-center">
            <p className="font-black text-slate-800 text-lg mb-4">{staff.name} 様</p>
            <button onClick={() => {localStorage.clear(); window.location.href='/';}} className="w-full py-5 bg-[#f8f9fa] text-[#2c3e50] font-black rounded-2xl border border-slate-200">ログアウト</button>
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-12 overflow-y-auto w-full pt-24 md:pt-12">
        <div className="max-w-4xl mx-auto w-full">
            <div className="flex justify-between items-center mb-10">
                <img src="/logo.png" alt="BE STONE" className="w-40" />
                <div className="bg-white px-5 py-2 rounded-full shadow-sm border flex items-center gap-3 font-black text-slate-500 text-sm">
                    <Clock size={16} color="#75C9D7"/>
                    {currentTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>

            {menuChoice === "📋 本日の業務" && (
                <div className="space-y-8">
                    <div className="app-card border-l-8 border-[#75C9D7]">
                        {attendanceStatus === 'offline' ? (
                            <button onClick={handleClockIn} className="w-full py-6 bg-[#75C9D7] text-white font-black rounded-3xl text-2xl shadow-lg">🚀 業務開始 (出勤)</button>
                        ) : (
                            <div className="flex flex-col gap-4 text-center">
                                <div className="flex gap-4">
                                    <button onClick={handleBreak} className={`flex-1 py-6 ${attendanceStatus === 'break' ? 'bg-orange-400' : 'bg-[#1a202c]'} text-white font-black rounded-3xl text-xl`}>
                                        {attendanceStatus === 'break' ? '🏃 業務復帰' : '☕ 休憩入り'}
                                    </button>
                                    <button onClick={handleClockOut} className="flex-1 py-6 bg-white border-2 border-slate-200 text-slate-400 font-black rounded-3xl text-xl">退勤</button>
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-slate-400">出勤時刻：{formatToJSTTime(currCard?.clock_in_at)}</p>
                                    <p className="text-xl font-black brand-turquoise">現在まで：{getElapsedTimeString()}</p>
                                </div>
                            </div>
                        )}
                    </div>
                    {attendanceStatus !== 'offline' && (
                        <div className="space-y-4">
                            <p className="font-black text-slate-400 px-4 uppercase">Target Tasks</p>
                            {displayTasks.map(t => (
                                <div key={t.id} className="app-card flex justify-between items-center border-l-8 border-[#75C9D7]">
                                    <div className="flex-1 pr-4">
                                        <p className="text-[10px] brand-turquoise font-black uppercase mb-1" style={{color:'#75C9D7'}}>{t.task_master?.locations?.name}</p>
                                        <h5 className="text-xl font-bold">{t.task_master?.task_name}</h5>
                                    </div>
                                    {t.status === 'completed' ? <CheckCircle2 className="text-green-500" size={40} /> : 
                                    <button onClick={() => { setActiveTask(t); setIsQrVerified(false); }} disabled={attendanceStatus !== 'working'} className="px-10 py-5 btn-dark">着手</button>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 業務遂行中オーバーレイ */}
            {activeTask && (
                <div className="fixed inset-0 bg-white z-[300] flex flex-col p-6 pt-12 overflow-y-auto">
                    <div className="flex items-center gap-4 mb-8">
                        <button onClick={() => setActiveTask(null)} className="p-3 bg-slate-100 rounded-2xl"><ArrowLeft size={24} color="black"/></button>
                        <h2 className="text-xl font-black">業務遂行中</h2>
                    </div>
                    {!isQrVerified ? (
                        <QrScanner onScanSuccess={(txt) => { if(txt === activeTask.task_master?.locations?.qr_token) setIsQrVerified(true); else alert("場所が違います"); }} />
                    ) : (
                        <div className="text-center space-y-10">
                            <CheckCircle2 size={80} className="text-green-500 mx-auto" />
                            <label className="block w-full">
                                <div className="w-full py-8 bg-[#75C9D7] text-white font-black rounded-[2.5rem] shadow-xl flex items-center justify-center gap-4 text-2xl">
                                    <Camera size={40} color="white"/>
                                    <span style={{color: 'white'}}>完了写真を撮影</span>
                                </div>
                                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleTaskComplete} disabled={loading} />
                            </label>
                        </div>
                    )}
                </div>
            )}
        </div>
      </main>
    </div>
  );
}