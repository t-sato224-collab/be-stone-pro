"use client";

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  ClipboardList, History, LogOut, Clock, 
  MapPin, CheckCircle2, PlayCircle, Camera, X, Loader2, Coffee, ArrowLeft, AlertTriangle, BarChart3, Download, Search, Menu,
  Edit, Trash2, Plus, Save
} from 'lucide-react';
import dynamic from 'next/dynamic';

const QrScanner = dynamic(() => import('../../components/QrScanner'), { ssr: false });
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

export default function DashboardPage() {
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
  const [filterStaffId, setFilterStaffId] = useState<string>("all");
  const [filterStartDate, setFilterStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterEndDate, setFilterEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [monitorDate, setMonitorDate] = useState(new Date().toISOString().split('T')[0]);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<any>(null);
  const [editForm, setEditForm] = useState({ staff_id: "", work_date: "", clock_in_time: "", clock_out_time: "" });

  const formatToJSTTime = (isoString: string | null) => {
    if (!isoString) return "---";
    return new Date(isoString).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const calculateTotalBreakMins = (breaks: any[], currentBreakStart: string | null = null) => {
    let total = 0;
    breaks?.forEach((b: any) => { if (b.break_start_at && b.break_end_at) total += Math.floor((new Date(b.break_end_at).getTime() - new Date(b.break_start_at).getTime()) / 60000); });
    if (currentBreakStart) total += Math.floor((currentTime.getTime() - new Date(currentBreakStart).getTime()) / 60000);
    return total;
  };

  const calculateWorkMins = (clockIn: string, clockOut: string | null, breaks: any[]) => {
    if (!clockIn) return 0;
    const end = clockOut ? new Date(clockOut) : currentTime;
    return Math.max(0, Math.floor((end.getTime() - new Date(clockIn).getTime()) / 60000) - calculateTotalBreakMins(breaks));
  };

  const fetchTasks = useCallback(async () => {
    const today = new Date().toLocaleDateString('sv-SE');
    let { data: logs } = await supabase.from('task_logs').select('*, task_master(*, locations(*))').eq('work_date', today);
    
    if (!logs || logs.length === 0) {
      const { data: masters } = await supabase.from('task_master').select('*');
      if (masters && masters.length > 0) {
        const newLogs = masters.map(m => ({ task_id: m.id, work_date: today, status: 'pending' }));
        await supabase.from('task_logs').insert(newLogs);
        const { data: retryLogs } = await supabase.from('task_logs').select('*, task_master(*, locations(*))').eq('work_date', today);
        logs = retryLogs;
      }
    }
    if (logs) setTasks(logs.sort((a, b) => (a.task_master?.target_hour || 0) * 60 + (a.task_master?.target_minute || 0) - ((b.task_master?.target_hour || 0) * 60 + (b.task_master?.target_minute || 0))));
  }, []);

  const fetchAdminMonitorTasks = useCallback(async (date: string) => {
    const { data } = await supabase.from('task_logs').select('*, task_master(*, locations(*))').eq('work_date', date).eq('status', 'completed').order('completed_at', { ascending: false });
    if (data) setAdminTasks(data);
  }, []);

  const syncStatus = useCallback(async (staffId: string) => {
    const { data: tc } = await supabase.from('timecards').select('*').eq('staff_id', staffId).is('clock_out_at', null).maybeSingle();
    if (tc) {
      setCurrCard(tc);
      const { data: brs } = await supabase.from('breaks').select('*').eq('timecard_id', tc.id);
      if (brs) { setBreaksList(brs); const activeBreak = brs.find((b: any) => !b.break_end_at); setAttendanceStatus(activeBreak ? 'break' : 'working'); }
    } else { setCurrCard(null); setBreaksList([]); setAttendanceStatus('offline'); }
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const init = async () => {
      const savedId = localStorage.getItem('staff_id');
      if (!savedId) { window.location.href = '/'; return; }
      const savedPage = localStorage.getItem('active_page') || "📋 本日の業務";
      setMenuChoice(savedPage);
      const { data: staffData } = await supabase.from('staff').select('*').eq('staff_id', savedId).single();
      if (staffData) {
        setStaff(staffData); syncStatus(staffData.id);
        if (staffData.role === 'admin') { const { data: sList } = await supabase.from('staff').select('id, name'); if (sList) setAdminStaffList(sList); }
      } else { localStorage.clear(); window.location.href = '/'; }
    };
    init();
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize); handleResize();
    const clockTimer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => { clearInterval(clockTimer); window.removeEventListener('resize', handleResize); };
  }, [syncStatus]);

  // 【修正】前後30分以内のタスクのみ表示
  const displayTasks = useMemo(() => {
    const currentTotalMins = currentTime.getHours() * 60 + currentTime.getMinutes();
    return tasks.filter(t => {
        const taskMins = (t.task_master?.target_hour || 0) * 60 + (t.task_master?.target_minute || 0);
        return Math.abs(currentTotalMins - taskMins) <= 30;
    });
  }, [tasks, currentTime]);

  // 【修正】未完了タスク（現在のウィンドウより前で終わっていないもの）
  const overdueTasks = useMemo(() => {
    const currentTotalMins = currentTime.getHours() * 60 + currentTime.getMinutes();
    return tasks.filter(t => {
        const taskMins = (t.task_master?.target_hour || 0) * 60 + (t.task_master?.target_minute || 0);
        return taskMins < currentTotalMins - 30 && t.status !== 'completed';
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

  const generateAdminReport = async () => {
    setLoading(true);
    let query = supabase.from('timecards').select('*, breaks(*)').gte('work_date', filterStartDate).lte('work_date', filterEndDate);
    if (filterStaffId !== "all") query = query.eq('staff_id', filterStaffId);
    const { data } = await query.order('work_date', { ascending: false });
    if (data) {
      setAdminReport(data.map((r: any) => ({
        ...r, work_time: `${Math.floor(calculateWorkMins(r.clock_in_at, r.clock_out_at, r.breaks)/60)}h${calculateWorkMins(r.clock_in_at, r.clock_out_at, r.breaks)%60}m`,
        break_time: `${calculateTotalBreakMins(r.breaks)}分`, raw_mins: calculateWorkMins(r.clock_in_at, r.clock_out_at, r.breaks)
      })));
    }
    setLoading(false);
  };

  const downloadCSV = () => {
    const headers = "名前,日付,出勤,退勤,休憩,実働\n";
    const rows = adminReport.map(r => `${r.staff_name},${r.work_date},${formatToJSTTime(r.clock_in_at)},${formatToJSTTime(r.clock_out_at)},${r.break_time},${r.work_time}`).join("\n");
    const blob = new Blob(["\uFEFF" + headers + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Attendance.csv`; link.click();
  };

  const handleTaskComplete = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setLoading(true);
    const fileName = `${activeTask.id}-${Date.now()}.jpg`;
    await supabase.storage.from('task-photos').upload(fileName, e.target.files[0]);
    await supabase.from('task_logs').update({ status: 'completed', completed_at: new Date().toISOString(), photo_url: fileName, staff_id: staff.id }).eq('id', activeTask.id);
    setActiveTask(null); setIsQrVerified(false); fetchTasks();
    setLoading(false);
    alert("完了報告を送信しました。");
  };

  if (!staff) return null;
  const elapsed = () => {
    if (!currCard) return "";
    const diff = currentTime.getTime() - new Date(currCard.clock_in_at).getTime();
    return `${Math.floor(diff/3600000)}時間${Math.floor((diff%3600000)/60000)}分`;
  };

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col md:flex-row text-black overflow-x-hidden">
      <style jsx global>{`
        header, footer { display: none !important; }
        :root { color-scheme: light !important; }
        .stApp { background: #FFFFFF !important; }
        section[data-testid="stSidebar"] { display: none; }
        p, h1, h2, h3, h4, h5, span, label, td, th { color: #000000 !important; }
        .app-card { background: white; padding: 25px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid #edf2f7; margin-bottom: 20px; }
        .menu-item { width: 100%; text-align: left; padding: 20px; border-radius: 1rem; font-weight: 900; font-size: 20px; white-space: nowrap; border-bottom: 2px solid #EDF2F7; background: transparent; color: #000000 !important; }
        .menu-item-active { background-color: #75C9D7 !important; color: #FFFFFF !important; border-bottom: none; }
        .menu-item-active span { color: #FFFFFF !important; }
        .admin-grid-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px 2px !important; font-size: 11px !important; font-weight: 900 !important; white-space: nowrap !important; gap: 4px; border-radius: 15px !important; }
      `}</style>

      {isMobile && !activeTask && (
        <button onClick={() => setSidebarOpen(true)} className="fixed top-6 left-6 z-[130] p-3 bg-white shadow-xl rounded-2xl border border-slate-100"><Menu size={28} color="#75C9D7" /></button>
      )}

      <div className={`fixed inset-0 bg-black/40 z-[140] transition-opacity duration-300 ${sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`fixed md:relative inset-y-0 left-0 z-[150] w-[75vw] md:w-80 bg-white border-r border-slate-100 p-8 shadow-2xl md:shadow-none transition-transform duration-300 transform ${sidebarOpen || !isMobile ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex justify-between items-center mb-10">
          <h1 className="text-3xl font-black italic text-[#75C9D7]">BE STONE Pro</h1>
          {isMobile && <button onClick={() => setSidebarOpen(false)}><X size={32} color="#75C9D7" /></button>}
        </div>
        <nav className="flex-1 space-y-2">
          {["📋 本日の業務", "⚠️ 未完了タスク", "🕒 自分の履歴", "📊 監視(Admin)", "📅 出勤簿(Admin)"].filter(label => !label.includes("Admin") || staff.role === 'admin').map((label) => (
            <button key={label} onClick={() => { setMenuChoice(label); setSidebarOpen(false); localStorage.setItem('active_page', label); if(label.includes("監視")) fetchAdminMonitorTasks(monitorDate); }} className={`menu-item ${menuChoice === label ? 'menu-item-active' : ''}`}><span>{label}</span></button>
          ))}
        </nav>
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
                <div className="space-y-8 animate-in fade-in duration-500">
                    <div className="app-card border-l-8 border-[#75C9D7]">
                        {attendanceStatus === 'offline' ? (
                            <button onClick={handleClockIn} className="w-full py-6 bg-[#75C9D7] text-white font-black rounded-3xl text-2xl shadow-lg">🚀 業務開始 (出勤)</button>
                        ) : (
                            <div className="flex flex-col gap-4 text-center">
                                <div className="flex gap-4">
                                    <button onClick={handleBreak} className={`flex-1 py-6 ${attendanceStatus === 'break' ? 'bg-orange-400' : 'bg-[#1a202c]'} text-white font-black rounded-3xl text-xl`}>{attendanceStatus === 'break' ? '🏃 業務復帰' : '☕ 休憩入り'}</button>
                                    <button onClick={handleClockOut} className="flex-1 py-6 bg-white border-2 border-slate-200 text-slate-400 font-black rounded-3xl text-xl">退勤</button>
                                </div>
                                <p className="text-xl font-black brand-turquoise" style={{color: '#75C9D7'}}>実働中：{elapsed()}</p>
                            </div>
                        )}
                    </div>
                    {attendanceStatus !== 'offline' && (
                        <div className="space-y-4">
                            <p className="font-black text-slate-400 px-4 uppercase">Target Tasks</p>
                            {displayTasks.length > 0 ? displayTasks.map(t => (
                                <div key={t.id} className="app-card flex justify-between items-center border-l-8 border-[#75C9D7]">
                                    <div className="flex-1 pr-4">
                                        <p className="text-[10px] font-black uppercase text-[#75C9D7]">{t.task_master?.locations?.name}</p>
                                        <h5 className="text-xl font-bold">{t.task_master?.task_name}</h5>
                                    </div>
                                    {t.status === 'completed' ? <CheckCircle2 className="text-green-500" size={40} /> : <button onClick={() => { setActiveTask(t); setIsQrVerified(false); }} className="px-10 py-5 bg-[#1a202c] text-white font-black rounded-2xl text-lg shadow-lg">着手</button>}
                                </div>
                            )) : <p className="text-center text-slate-400 py-10 font-bold">現在（±30分）のタスクはありません</p>}
                        </div>
                    )}
                </div>
            )}

            {menuChoice === "⚠️ 未完了タスク" && (
                <div className="space-y-4 animate-in fade-in duration-500">
                    <h3 className="font-black text-red-500 px-2 uppercase">やり残しタスクのリカバリー</h3>
                    {overdueTasks.length > 0 ? overdueTasks.map(t => (
                        <div key={t.id} className="app-card border-l-8 border-red-400 flex justify-between items-center">
                            <div className="flex-1 pr-4">
                                <p className="text-red-500 font-black text-xs uppercase mb-1">【遅延】{t.task_master?.target_hour}:{String(t.task_master?.target_minute || 0).padStart(2,'0')}</p>
                                <h5 className="text-xl font-bold">{t.task_master?.task_name}</h5>
                                <p className="text-xs text-slate-400">{t.task_master?.locations?.name}</p>
                            </div>
                            <button onClick={() => { setActiveTask(t); setIsQrVerified(false); }} className="px-8 py-5 btn-red font-black rounded-2xl shadow-lg bg-[#E53E3E] text-white">リカバリー</button>
                        </div>
                    )) : <p className="text-center text-slate-400 py-10 font-bold">未完了のタスクはありません</p>}
                </div>
            )}

            {menuChoice === "📅 出勤簿(Admin)" && (
                <div className="space-y-6">
                    <div className="app-card">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <select className="p-4 bg-slate-50 rounded-xl font-bold border-none" onChange={(e: any) => setFilterStaffId(e.target.value)}><option value="all">全員を表示</option>{adminStaffList.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                            <input type="date" className="p-4 bg-slate-50 rounded-xl font-bold border-none" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} />
                            <input type="date" className="p-4 bg-slate-50 rounded-xl font-bold border-none" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <button onClick={generateAdminReport} className="admin-grid-btn bg-[#1a202c] text-white"><Search size={18}/>抽出実行</button>
                            <button onClick={downloadCSV} className="admin-grid-btn bg-[#75C9D7] text-white"><Download size={18}/>CSV出力</button>
                            <button onClick={() => { setEditingCard(null); setIsEditModalOpen(true); }} className="admin-grid-btn bg-orange-400 text-white"><Plus size={18}/>新規追加</button>
                        </div>
                    </div>
                    {adminReport.map(r => (
                        <div key={r.id} className="app-card flex justify-between items-center">
                            <div>
                                <p className="font-bold">{r.staff_name} - {r.work_date}</p>
                                <p className="text-sm text-slate-500">{formatToJSTTime(r.clock_in_at)} 〜 {formatToJSTTime(r.clock_out_at)} (実働:{r.work_time})</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => { setEditingCard(r); setEditForm({ staff_id: r.staff_id, work_date: r.work_date, clock_in_time: "", clock_out_time: "" }); setIsEditModalOpen(true); }} className="p-2 bg-slate-100 text-slate-600 rounded-lg"><Edit size={16}/></button>
                                <button onClick={async () => { if(confirm("消去しますか？")) { await supabase.from('timecards').delete().eq('id', r.id); generateAdminReport(); }}} className="p-2 bg-red-50 text-red-500 rounded-lg"><Trash2 size={16}/></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            
            {/* 自分の履歴 */}
            {menuChoice === "🕒 自分の履歴" && (
                <div className="space-y-4 animate-in fade-in duration-500">
                    {personalHistory.map(r => (
                        <div key={r.id} className="app-card flex justify-between items-center">
                            <div>
                                <p className="font-black text-lg">{r.work_date} <span className="text-xs text-slate-400">({formatToJSTTime(r.clock_in_at)}〜{formatToJSTTime(r.clock_out_at)})</span></p>
                                <p className="text-xs text-slate-500 font-bold">実働：<span style={{color: '#75C9D7'}}>{r.work_time}</span> 休憩：{r.break_time}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 監視モニター */}
            {menuChoice === "📊 監視(Admin)" && (
                <div className="space-y-6 animate-in fade-in duration-500">
                    <div className="app-card">
                         <label className="text-sm font-black text-slate-400 block mb-2">確認日付</label>
                         <input type="date" className="p-4 bg-slate-50 rounded-xl font-bold border-none w-full" value={monitorDate} onChange={(e) => { setMonitorDate(e.target.value); fetchAdminMonitorTasks(e.target.value); }} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {adminTasks.map(t => (
                            <div key={t.id} className="app-card p-4 text-center">
                                <img src={`${SUPABASE_URL}/storage/v1/object/public/task-photos/${t.photo_url}`} className="rounded-2xl mb-4 aspect-square object-cover w-full shadow-sm" alt="報告写真" />
                                <p className="text-sm font-black mb-1">{t.task_master.locations.name}</p>
                                <p className="text-[10px] text-slate-400 font-bold">{formatToJSTTime(t.completed_at)} 完了</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
      </main>

      {/* 作業中オーバーレイ */}
      {activeTask && (
        <div className="fixed inset-0 bg-white z-[300] flex flex-col p-6 pt-12 overflow-y-auto text-black text-center">
          <button onClick={() => setActiveTask(null)} className="absolute top-12 left-6 p-3 bg-slate-100 rounded-2xl"><ArrowLeft size={24}/></button>
          <h2 className="text-xl font-black mb-10">業務遂行中</h2>
          {!isQrVerified ? (
            <QrScanner onScanSuccess={(txt) => { if(txt === activeTask.task_master?.locations?.qr_token) setIsQrVerified(true); else alert("場所が違います"); }} />
          ) : (
            <div className="space-y-10">
              <CheckCircle2 size={80} className="text-green-500 mx-auto" />
              <p className="font-bold text-xl">{activeTask.task_master?.task_name}</p>
              <label className="block w-full">
                <div className="w-full py-8 bg-[#75C9D7] text-white font-black rounded-[2.5rem] shadow-xl flex items-center justify-center gap-4 text-2xl active:scale-95 transition-all"><Camera size={40}/>写真を撮影</div>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleTaskComplete} disabled={loading} />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}