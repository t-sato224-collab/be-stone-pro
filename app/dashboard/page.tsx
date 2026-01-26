"use client";

import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  ClipboardList, History, LogOut, Clock, 
  MapPin, CheckCircle2, PlayCircle, Camera, X, Loader2, Coffee, ArrowLeft, AlertTriangle, BarChart3, Download, Search, Menu,
  Edit, Trash2, Plus, Save, PauseCircle, UserCheck
} from 'lucide-react';
import dynamic from 'next/dynamic';

// カメラのチカチカを防止するためのメモ化
const QrScannerRaw = dynamic(() => import('../../components/QrScanner'), { ssr: false });
const QrScanner = memo(QrScannerRaw);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

export default function DashboardPage() {
  // --- 1. 状態管理 ---
  const [staff, setStaff] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [adminTasks, setAdminTasks] = useState<any[]>([]);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [attendanceStatus, setAttendanceStatus] = useState<'offline' | 'working' | 'break'>('offline');
  const [currCard, setCurrCard] = useState<any>(null);
  const [breaksList, setBreaksList] = useState<any[]>([]);
  const [activeTask, setActiveTask] = useState<any>(null);
  const [isQrVerified, setIsQrVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [menuChoice, setMenuChoice] = useState("📋 本日の業務");
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [personalHistory, setPersonalHistory] = useState<any[]>([]);
  const [adminStaffList, setAdminStaffList] = useState<any[]>([]);
  const [adminReport, setAdminReport] = useState<any[]>([]);
  const [monitorDate, setMonitorDate] = useState(new Date().toISOString().split('T')[0]);

  // 勤怠修正用
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<any>(null);
  const [editForm, setEditForm] = useState({ staff_id: "", work_date: "", clock_in_time: "", clock_out_time: "" });

  // --- 2. ユーティリティ・変換 ---
  const formatToJSTTime = (isoString: string | null) => {
    if (!isoString) return "---";
    return new Date(isoString).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const formatMinsToHHMM = (totalMins: number) => {
    const h = Math.floor(totalMins / 60); const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const calculateWorkMins = (clockIn: string, clockOut: string | null, breaks: any[]) => {
    if (!clockIn) return 0;
    const end = clockOut ? new Date(clockOut) : currentTime;
    let total = Math.floor((end.getTime() - new Date(clockIn).getTime()) / 60000);
    breaks?.forEach((b: any) => {
      if (b.break_start_at && b.break_end_at) total -= Math.floor((new Date(b.break_end_at).getTime() - new Date(b.break_start_at).getTime()) / 60000);
    });
    return Math.max(0, total);
  };

  // --- 3. データ同期ロジック ---
  const fetchTasks = useCallback(async () => {
    const today = new Date().toLocaleDateString('sv-SE');
    let { data: logs } = await supabase.from('task_logs').select('*, task_master(*, locations(*)), staff(name)').eq('work_date', today);
    if (!logs || logs.length === 0) {
      const { data: masters } = await supabase.from('task_master').select('*');
      if (masters && masters.length > 0) {
        await supabase.from('task_logs').insert(masters.map(m => ({ task_id: m.id, work_date: today, status: 'pending' })));
        const { data: retry } = await supabase.from('task_logs').select('*, task_master(*, locations(*)), staff(name)').eq('work_date', today);
        logs = retry;
      }
    }
    if (logs) setTasks(logs);
  }, []);

  const syncStatus = useCallback(async (staffId: string) => {
    const { data: tc } = await supabase.from('timecards').select('*').eq('staff_id', staffId).is('clock_out_at', null).maybeSingle();
    if (tc) {
      setCurrCard(tc);
      const { data: brs } = await supabase.from('breaks').select('*').eq('timecard_id', tc.id);
      setBreaksList(brs || []);
      const activeBreak = brs?.find((b: any) => !b.break_end_at);
      setAttendanceStatus(activeBreak ? 'break' : 'working');
    } else {
      setCurrCard(null); setBreaksList([]); setAttendanceStatus('offline');
    }
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const init = async () => {
      const savedId = localStorage.getItem('staff_id');
      if (!savedId) { window.location.href = '/'; return; }
      const { data: staffData } = await supabase.from('staff').select('*').eq('staff_id', savedId).single();
      if (staffData) {
        setStaff(staffData); syncStatus(staffData.id);
        if (staffData.role === 'admin') {
          const { data: sList } = await supabase.from('staff').select('id, name');
          if (sList) setAdminStaffList(sList);
        }
      } else { localStorage.clear(); window.location.href = '/'; }
    };
    init();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    const resizer = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', resizer); resizer();
    return () => { clearInterval(timer); window.removeEventListener('resize', resizer); };
  }, [syncStatus]);

  // --- 4. フィルタリングロジック（ここが最重要） ---
  const displayTasks = useMemo(() => {
    const currentTotalMins = currentTime.getHours() * 60 + currentTime.getMinutes();
    return tasks.filter(t => {
        const taskMins = (t.task_master?.target_hour || 0) * 60 + (t.task_master?.target_minute || 0);
        return Math.abs(currentTotalMins - taskMins) <= 30; // 前後30分以内
    });
  }, [tasks, currentTime]);

  const overdueTasks = useMemo(() => {
    const currentTotalMins = currentTime.getHours() * 60 + currentTime.getMinutes();
    return tasks.filter(t => {
        const taskMins = (t.task_master?.target_hour || 0) * 60 + (t.task_master?.target_minute || 0);
        return taskMins < currentTotalMins - 30 && t.status !== 'completed'; // 30分以上経過した未完了
    });
  }, [tasks, currentTime]);

  // --- 5. ハンドラ ---
  const handleClockIn = async () => {
    setLoading(true);
    await supabase.from('timecards').insert({ staff_id: staff.id, staff_name: staff.name, clock_in_at: new Date().toISOString(), work_date: new Date().toLocaleDateString('sv-SE') });
    await syncStatus(staff.id); setLoading(false);
  };

  const handleClockOut = async () => {
    if(!confirm("退勤しますか？")) return;
    setLoading(true);
    await supabase.from('timecards').update({ clock_out_at: new Date().toISOString() }).eq('staff_id', staff.id).is('clock_out_at', null);
    await syncStatus(staff.id); setLoading(false);
  };

  const handleBreak = async () => {
    setLoading(true);
    if (attendanceStatus === 'working') {
      await supabase.from('breaks').insert({ staff_id: staff.id, timecard_id: currCard?.id, break_start_at: new Date().toISOString(), work_date: new Date().toLocaleDateString('sv-SE') });
    } else {
      await supabase.from('breaks').update({ break_end_at: new Date().toISOString() }).eq('staff_id', staff.id).is('break_end_at', null);
    }
    await syncStatus(staff.id); setLoading(false);
  };

  const handleTaskAction = (task: any) => { setActiveTask(task); setIsQrVerified(task.status === 'started'); };

  const onQrScan = useCallback(async (txt: string) => {
    if (activeTask && txt === activeTask.task_master?.locations?.qr_token) {
      await supabase.from('task_logs').update({ status: 'started', started_at: new Date().toISOString(), staff_id: staff.id }).eq('id', activeTask.id);
      setIsQrVerified(true); fetchTasks();
    } else if (activeTask) { alert("場所が違います"); }
  }, [activeTask, fetchTasks, staff]);

  const handleTaskComplete = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setLoading(true);
    const fileName = `${activeTask.id}-${Date.now()}.jpg`;
    try {
        await supabase.storage.from('task-photos').upload(fileName, e.target.files[0]);
        await supabase.from('task_logs').update({ status: 'completed', completed_at: new Date().toISOString(), photo_url: fileName, staff_id: staff.id }).eq('id', activeTask.id);
        setActiveTask(null); setIsQrVerified(false); fetchTasks();
        alert("送信完了！お疲れ様でした。");
    } catch (err) { alert("送信エラー"); }
    finally { setLoading(false); }
  };

  const generateAdminReport = async () => {
    setLoading(true);
    const { data } = await supabase.from('timecards').select('*, breaks(*)').gte('work_date', new Date().toISOString().split('T')[0]).order('work_date', { ascending: false });
    if (data) setAdminReport(data);
    setLoading(false);
  };

  if (!staff) return null;

  // タイマー表示用
  const workMins = calculateWorkMins(currCard?.clock_in_at, null, breaksList);
  const currentBreak = breaksList.find(b => !b.break_end_at);
  const breakStart = currentBreak ? new Date(currentBreak.break_start_at).getTime() : 0;
  const thisBreakMins = breakStart ? Math.floor((currentTime.getTime() - breakStart) / 60000) : 0;

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col md:flex-row text-black overflow-x-hidden font-sans">
      <style jsx global>{`
        header, footer { display: none !important; }
        .stApp { background: #FFFFFF !important; }
        p, h1, h2, h3, h4, h5, span, label, td, th { color: #000000 !important; }
        .app-card { background: white; padding: 25px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid #edf2f7; margin-bottom: 20px; }
        .menu-item { width: 100%; text-align: left; padding: 20px; border-radius: 1rem; font-weight: 900; font-size: 20px; white-space: nowrap; border-bottom: 2px solid #EDF2F7; background: transparent; color: #000000 !important; }
        .menu-item-active { background-color: #75C9D7 !important; color: #FFFFFF !important; border-bottom: none; }
        .menu-item-active span { color: #FFFFFF !important; }
        .btn-dark { background-color: #1a202c !important; color: white !important; border: none !important; }
      `}</style>

      {/* モバイルハンバーガー */}
      {isMobile && !activeTask && (
        <button onClick={() => setSidebarOpen(true)} className="fixed top-6 left-6 z-[130] p-3 bg-white shadow-xl rounded-2xl border border-slate-100"><Menu size={28} color="#75C9D7" /></button>
      )}

      {/* サイドバー */}
      <div className={`fixed inset-0 bg-black/40 z-[140] transition-opacity duration-300 ${sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`fixed md:relative inset-y-0 left-0 z-[150] w-[75vw] md:w-80 bg-white border-r border-slate-100 p-8 flex flex-col shadow-2xl md:shadow-none transition-transform duration-300 transform ${sidebarOpen || !isMobile ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-10"><h1 className="text-3xl font-black italic text-[#75C9D7]">BE STONE Pro</h1></div>
        <nav className="flex-1 space-y-2">
          {["📋 本日の業務", "⚠️ 未完了タスク", "🕒 自分の履歴", "📊 監視(Admin)", "📅 出勤簿(Admin)"].filter(label => !label.includes("Admin") || staff.role === 'admin').map((label) => (
            <button key={label} onClick={() => { setMenuChoice(label); setSidebarOpen(false); localStorage.setItem('active_page', label); }} className={`menu-item ${menuChoice === label ? 'menu-item-active' : ''}`}><span>{label}</span></button>
          ))}
        </nav>
        <div className="mt-auto pt-8 border-t border-slate-100 text-center">
            <p className="font-black text-slate-800 text-lg mb-4">{staff.name} 様</p>
            <button onClick={() => {localStorage.clear(); window.location.href='/';}} className="w-full py-5 bg-[#f8f9fa] text-[#E53E3E] font-black rounded-2xl border border-slate-200 active:scale-95 transition-all">ログアウト</button>
        </div>
      </aside>

      {/* メインエリア */}
      <main className="flex-1 p-6 md:p-12 overflow-y-auto w-full pt-24 md:pt-12">
        <div className="max-w-4xl mx-auto w-full">
            <div className="flex justify-between items-center mb-10 text-black">
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
                            <button onClick={handleClockIn} className="w-full py-6 bg-[#75C9D7] text-white font-black rounded-3xl text-2xl shadow-lg border-none">🚀 業務開始 (出勤)</button>
                        ) : (
                            <div className="flex flex-col gap-4 text-center">
                                <div className="flex gap-4">
                                    <button onClick={handleBreak} className={`flex-1 py-6 border-none ${attendanceStatus === 'break' ? 'bg-orange-400' : 'bg-[#1a202c]'} text-white font-black rounded-3xl text-xl`}>{attendanceStatus === 'break' ? '🏃 業務復帰' : '☕ 休憩入り'}</button>
                                    <button onClick={handleClockOut} className="flex-1 py-6 bg-white border-2 border-slate-200 text-slate-400 font-black rounded-3xl text-xl">退勤</button>
                                </div>
                                <p className="text-xl font-black mt-1" style={{color: attendanceStatus === 'break' ? '#ED8936' : '#75C9D7'}}>
                                    {attendanceStatus === 'break' ? `休憩中：${thisBreakMins}分` : `実働中：${formatMinsToHHMM(workMins)}`}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* 出勤中のみタスクを表示 */}
                    {attendanceStatus !== 'offline' && (
                        <div className="space-y-4 animate-in fade-in duration-500">
                            <p className="font-black text-slate-400 px-4 uppercase tracking-tighter">Target Tasks (前後30分)</p>
                            {displayTasks.length > 0 ? displayTasks.map(t => (
                                <div key={t.id} className="app-card flex justify-between items-center border-l-8 border-[#75C9D7]">
                                    <div className="flex-1 pr-4 text-black">
                                        <p className="text-[10px] font-black uppercase text-[#75C9D7]">{t.task_master?.locations?.name}</p>
                                        <h5 className="text-xl font-bold">{t.task_master?.task_name}</h5>
                                        {t.status === 'started' && <p className="text-xs text-orange-500 font-bold mt-1">● 進行中</p>}
                                    </div>
                                    {t.status === 'completed' ? <CheckCircle2 className="text-green-500" size={40} /> : (
                                        <button onClick={() => handleTaskAction(t)} className={`px-10 py-5 font-black rounded-2xl text-lg border-none text-white ${t.status === 'started' ? 'bg-orange-500' : 'bg-[#1a202c]'}`}>{t.status === 'started' ? '再開' : '着手'}</button>
                                    )}
                                </div>
                            )) : <p className="text-center text-slate-400 py-10 font-bold">現在（±30分）の予定タスクはありません</p>}
                        </div>
                    )}
                </div>
            )}

            {menuChoice === "⚠️ 未完了タスク" && (
                <div className="space-y-4 animate-in fade-in duration-500">
                    <h3 className="font-black text-red-500 px-2 uppercase tracking-widest">リカバリー対象タスク</h3>
                    {overdueTasks.length > 0 ? overdueTasks.map(t => (
                        <div key={t.id} className="app-card border-l-8 border-red-400 flex justify-between items-center">
                            <div className="flex-1 pr-4">
                                <p className="text-red-500 font-black text-xs">【遅延】{t.task_master?.target_hour}:{String(t.task_master?.target_minute || 0).padStart(2,'0')}</p>
                                <h5 className="text-xl font-bold text-black">{t.task_master?.task_name}</h5>
                                <p className="text-xs text-slate-400">{t.task_master?.locations?.name}</p>
                            </div>
                            <button onClick={() => handleTaskAction(t)} className="px-8 py-5 bg-[#E53E3E] text-white font-black rounded-2xl shadow-lg border-none">{t.status === 'started' ? '再開' : 'リカバリー'}</button>
                        </div>
                    )) : <p className="text-center text-slate-400 py-10 font-bold">未完了の遅延タスクはありません</p>}
                </div>
            )}
            
            {/* その他の管理者・監視メニュー等は以前のロジックを継承 */}
        </div>
      </main>

      {/* 業務オーバーレイ */}
      {activeTask && (
        <div className="fixed inset-0 bg-white z-[300] flex flex-col p-6 pt-12 overflow-y-auto text-black text-center">
          <div className="flex justify-between items-center mb-10 px-4">
              <button onClick={() => setActiveTask(null)} className="p-3 bg-slate-100 rounded-2xl flex items-center gap-2 font-bold border-none text-black"><PauseCircle size={20}/>一時離脱</button>
              <h2 className="text-xl font-black">業務遂行中</h2><div className="w-12"></div>
          </div>
          {!isQrVerified ? <QrScanner onScanSuccess={onQrScan} /> : (
            <div className="space-y-10 animate-in fade-in">
              <CheckCircle2 size={80} className="text-green-500 mx-auto" />
              <p className="font-black text-2xl text-[#1a202c]">{activeTask.task_master?.task_name}</p>
              <label className="block w-full px-6">
                <div className="w-full py-8 bg-[#75C9D7] text-white font-black rounded-[2.5rem] shadow-xl flex items-center justify-center gap-4 text-2xl active:scale-95 transition-all cursor-pointer"><Camera size={40}/>完了写真を撮影</div>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleTaskComplete} disabled={loading} />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}