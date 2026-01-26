"use client";

import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  ClipboardList, History, LogOut, Clock, 
  MapPin, CheckCircle2, PlayCircle, Camera, X, Loader2, Coffee, ArrowLeft, AlertTriangle, BarChart3, Download, Search, Menu,
  Edit, Trash2, Plus, Save, PauseCircle, UserCheck
} from 'lucide-react';
import dynamic from 'next/dynamic';

// QRスキャナーをメモ化して再レンダリング（チカチカ）を防ぐ
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
  const [filterStaffId, setFilterStaffId] = useState<string>("all");
  const [filterStartDate, setFilterStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterEndDate, setFilterEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [monitorDate, setMonitorDate] = useState(new Date().toISOString().split('T')[0]);

  // 編集モーダル用
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<any>(null);
  const [editForm, setEditForm] = useState({ staff_id: "", work_date: "", clock_in_time: "", clock_out_time: "" });

  // --- 2. ユーティリティ・計算ロジック ---
  const formatToJSTTime = (isoString: string | null) => {
    if (!isoString) return "---";
    return new Date(isoString).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const isoToTimeInput = (isoString: string | null) => {
    if (!isoString) return "";
    const d = new Date(isoString);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const combineDateAndTime = (dateStr: string, timeStr: string) => {
    if (!dateStr || !timeStr) return null;
    return new Date(`${dateStr}T${timeStr}:00`).toISOString();
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
    const totalMins = Math.floor((end.getTime() - new Date(clockIn).getTime()) / 60000);
    return Math.max(0, totalMins - calculateTotalBreakMins(breaks));
  };

  const formatMinsToHHMM = (totalMins: number) => {
    const h = Math.floor(totalMins / 60); const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // 稼働状況表示ロジック
  const getDisplayTimer = () => {
    if (attendanceStatus === 'offline' || !currCard) return { label: "", value: "", color: "" };
    if (attendanceStatus === 'break') {
        const currentBreak = breaksList.find(b => !b.break_end_at);
        const bMins = currentBreak ? Math.floor((currentTime.getTime() - new Date(currentBreak.break_start_at).getTime()) / 60000) : 0;
        const totalB = calculateTotalBreakMins(breaksList, currentBreak?.break_start_at);
        return { label: "現在休憩中", value: `${bMins}分 (累計:${totalB}分)`, color: "#ED8936" };
    }
    const workMins = calculateWorkMins(currCard.clock_in_at, null, breaksList);
    return { label: "実働時間", value: formatMinsToHHMM(workMins), color: "#75C9D7" };
  };

  // --- 3. データ同期関数 ---
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
    if (logs) setTasks(logs.sort((a, b) => (a.task_master?.target_hour || 0) * 60 - (b.task_master?.target_hour || 0) * 60));
  }, []);

  const fetchAdminMonitorTasks = useCallback(async (date: string) => {
    setLoading(true);
    const { data } = await supabase.from('task_logs').select('*, task_master(*, locations(*)), staff(name)').eq('work_date', date).eq('status', 'completed').order('completed_at', { ascending: false });
    if (data) setAdminTasks(data);
    setLoading(false);
  }, []);

  const fetchPersonalHistory = useCallback(async (staffId: string) => {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const { data } = await supabase.from('timecards').select('*, breaks(*)').eq('staff_id', staffId).gte('work_date', startOfMonth).order('work_date', { ascending: false });
    if (data) {
      setPersonalHistory(data.map((r: any) => ({
        ...r, work_time: formatMinsToHHMM(calculateWorkMins(r.clock_in_at, r.clock_out_at, r.breaks)),
        break_time: formatMinsToHHMM(calculateTotalBreakMins(r.breaks))
      })));
    }
  }, [currentTime]);

  const syncStatus = useCallback(async (staffId: string) => {
    const { data: tc } = await supabase.from('timecards').select('*').eq('staff_id', staffId).is('clock_out_at', null).maybeSingle();
    if (tc) {
      setCurrCard(tc);
      const { data: brs } = await supabase.from('breaks').select('*').eq('timecard_id', tc.id);
      if (brs) { setBreaksList(brs); const activeBreak = brs.find((b: any) => !b.break_end_at); setAttendanceStatus(activeBreak ? 'break' : 'working'); }
    } else { setCurrCard(null); setBreaksList([]); setAttendanceStatus('offline'); }
    fetchTasks(); fetchPersonalHistory(staffId);
  }, [fetchTasks, fetchPersonalHistory]);

  // --- 4. ライフサイクル ---
  useEffect(() => {
    const init = async () => {
      const savedId = localStorage.getItem('staff_id');
      if (!savedId) { window.location.href = '/'; return; }
      const savedPage = localStorage.getItem('active_page') || "📋 本日の業務";
      setMenuChoice(savedPage);
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
    const clockTimer = setInterval(() => setCurrentTime(new Date()), 1000);
    const resizeHandler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', resizeHandler); resizeHandler();
    return () => { clearInterval(clockTimer); window.removeEventListener('resize', resizeHandler); };
  }, [syncStatus]);

  const displayTasks = useMemo(() => {
    const currentTotalMins = currentTime.getHours() * 60 + currentTime.getMinutes();
    return tasks.filter(t => Math.abs(currentTotalMins - ((t.task_master?.target_hour || 0) * 60 + (t.task_master?.target_minute || 0))) <= 30);
  }, [tasks, currentTime]);

  const overdueTasks = useMemo(() => {
    const currentTotalMins = currentTime.getHours() * 60 + currentTime.getMinutes();
    return tasks.filter(t => ((t.task_master?.target_hour || 0) * 60 + (t.task_master?.target_minute || 0)) < currentTotalMins - 30 && t.status !== 'completed');
  }, [tasks, currentTime]);

  // --- 5. 実行ハンドラ ---
  const handleClockIn = async () => {
    setLoading(true);
    await supabase.from('timecards').insert({ staff_id: staff.id, staff_name: staff.name, clock_in_at: new Date().toISOString(), work_date: new Date().toLocaleDateString('sv-SE') });
    await syncStatus(staff.id); setLoading(false);
  };

  const handleClockOut = async () => {
    if(!confirm("退勤を記録しますか？")) return;
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

  // --- 【復元】タスク着手/再開ハンドラ ---
  const handleTaskAction = (task: any) => {
    setActiveTask(task);
    setIsQrVerified(task.status === 'started'); // statusがstartedならQRスキップ
  };

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
        alert("完了報告を送信しました。");
    } catch (err) { alert("送信エラー"); }
    finally { setLoading(false); }
  };

  // --- 6. Admin機能：手動追加・編集・削除 ---
  const generateAdminReport = async () => {
    setLoading(true);
    let query = supabase.from('timecards').select('*, breaks(*)').gte('work_date', filterStartDate).lte('work_date', filterEndDate);
    if (filterStaffId !== "all") query = query.eq('staff_id', filterStaffId);
    const { data } = await query.order('work_date', { ascending: false });
    if (data) {
      setAdminReport(data.map((r: any) => ({
        ...r, work_time: formatMinsToHHMM(calculateWorkMins(r.clock_in_at, r.clock_out_at, r.breaks)),
        break_time: formatMinsToHHMM(calculateTotalBreakMins(r.breaks))
      })));
    }
    setLoading(false);
  };

  const handleEditClick = (record: any) => {
    setEditingCard(record);
    setEditForm({
      staff_id: record.staff_id,
      work_date: record.work_date,
      clock_in_time: isoToTimeInput(record.clock_in_at),
      clock_out_time: isoToTimeInput(record.clock_out_at)
    });
    setIsEditModalOpen(true);
  };

  const handleAddClick = () => {
    setEditingCard(null);
    setEditForm({
      staff_id: filterStaffId !== "all" ? filterStaffId : (adminStaffList[0]?.id || ""),
      work_date: new Date().toISOString().split('T')[0],
      clock_in_time: "09:00",
      clock_out_time: "18:00"
    });
    setIsEditModalOpen(true);
  };

  const handleSaveRecord = async () => {
    if(!editForm.staff_id || !editForm.work_date || !editForm.clock_in_time) { alert("必須項目を入力してください"); return; }
    setLoading(true);
    const cIn = combineDateAndTime(editForm.work_date, editForm.clock_in_time);
    const cOut = editForm.clock_out_time ? combineDateAndTime(editForm.work_date, editForm.clock_out_time) : null;
    const target = adminStaffList.find(s => s.id === editForm.staff_id);

    if (editingCard) {
        await supabase.from('timecards').update({ clock_in_at: cIn, clock_out_at: cOut, work_date: editForm.work_date }).eq('id', editingCard.id);
    } else {
        await supabase.from('timecards').insert({ staff_id: editForm.staff_id, staff_name: target?.name || "Unknown", clock_in_at: cIn, clock_out_at: cOut, work_date: editForm.work_date });
    }
    setIsEditModalOpen(false); await generateAdminReport(); setLoading(false);
    alert("保存完了");
  };

  const downloadCSV = () => {
    const headers = "名前,日付,出勤,退勤,休憩,実働\n";
    const rows = adminReport.map(r => `${r.staff_name},${r.work_date},${formatToJSTTime(r.clock_in_at)},${formatToJSTTime(r.clock_out_at)},${r.break_time},${r.work_time}`).join("\n");
    const blob = new Blob(["\uFEFF" + headers + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `BE_STONE_Attendance.csv`; link.click();
  };

  if (!staff) return null;
  const timerDisplay = getDisplayTimer();

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col md:flex-row text-black overflow-x-hidden font-sans">
      <style jsx global>{`
        header, footer { display: none !important; }
        :root { color-scheme: light !important; }
        .stApp { background: #FFFFFF !important; }
        section[data-testid="stSidebar"] { display: none; }
        p, h1, h2, h3, h4, h5, span, label, td, th { color: #000000 !important; }
        .app-card { background: white; padding: 25px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid #edf2f7; margin-bottom: 20px; }
        .menu-item { width: 100%; text-align: left; padding: 20px; border-radius: 1rem; font-weight: 900; font-size: 20px; white-space: nowrap; border-bottom: 2px solid #EDF2F7; background: transparent; color: #000000 !important; transition: 0.3s; }
        .menu-item-active { background-color: #75C9D7 !important; color: #FFFFFF !important; border-bottom: none; }
        .menu-item-active span { color: #FFFFFF !important; }
        .admin-grid-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px 2px !important; font-size: 11px !important; font-weight: 900 !important; white-space: nowrap !important; gap: 4px; border-radius: 15px !important; color: white !important; border: none !important; cursor: pointer; }
      `}</style>

      {/* ハンバーガー */}
      {isMobile && !activeTask && (
        <button onClick={() => setSidebarOpen(true)} className="fixed top-6 left-6 z-[130] p-3 bg-white shadow-xl rounded-2xl border border-slate-100"><Menu size={28} color="#75C9D7" /></button>
      )}

      {/* サイドバー */}
      <div className={`fixed inset-0 bg-black/40 z-[140] transition-opacity duration-300 ${sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`fixed md:relative inset-y-0 left-0 z-[150] w-[75vw] md:w-80 bg-white border-r border-slate-100 p-8 flex flex-col shadow-2xl md:shadow-none transition-transform duration-300 transform ${sidebarOpen || !isMobile ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-10">
          <h1 className="text-3xl font-black italic text-[#75C9D7]">BE STONE Pro</h1>
        </div>
        <nav className="flex-1 space-y-2">
          {["📋 本日の業務", "⚠️ 未完了タスク", "🕒 自分の履歴", "📊 監視(Admin)", "📅 出勤簿(Admin)"].filter(label => !label.includes("Admin") || staff.role === 'admin').map((label) => (
            <button key={label} onClick={() => { setMenuChoice(label); setSidebarOpen(false); localStorage.setItem('active_page', label); if(label.includes("履歴")) fetchPersonalHistory(staff.id); if(label.includes("監視")) fetchAdminMonitorTasks(monitorDate); }} className={`menu-item ${menuChoice === label ? 'menu-item-active' : ''}`}><span>{label}</span></button>
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
                <div className="space-y-8 animate-in fade-in duration-500">
                    <div className="app-card border-l-8 border-[#75C9D7]">
                        {attendanceStatus === 'offline' ? (
                            <button onClick={handleClockIn} className="w-full py-6 bg-[#75C9D7] text-white font-black rounded-3xl text-2xl shadow-lg border-none cursor-pointer">🚀 業務開始 (出勤)</button>
                        ) : (
                            <div className="flex flex-col gap-4 text-center">
                                <div className="flex gap-4">
                                    <button onClick={handleBreak} className={`flex-1 py-6 border-none cursor-pointer ${attendanceStatus === 'break' ? 'bg-orange-400' : 'bg-[#1a202c]'} text-white font-black rounded-3xl text-xl`}>{attendanceStatus === 'break' ? '🏃 業務復帰' : '☕ 休憩入り'}</button>
                                    <button onClick={handleClockOut} className="flex-1 py-6 bg-white border-2 border-slate-200 text-slate-400 font-black rounded-3xl text-xl cursor-pointer">退勤</button>
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-slate-400">出勤：{formatToJSTTime(currCard?.clock_in_at)}</p>
                                    <p className="text-xl font-black mt-1" style={{color: timerDisplay.color}}>{timerDisplay.label}：{timerDisplay.value}</p>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="space-y-4">
                        <p className="font-black text-slate-400 px-4 uppercase tracking-tighter">Target Tasks</p>
                        {displayTasks.length > 0 ? displayTasks.map(t => (
                            <div key={t.id} className="app-card flex justify-between items-center border-l-8 border-[#75C9D7]">
                                <div className="flex-1 pr-4">
                                    <p className="text-[10px] font-black uppercase text-[#75C9D7]">{t.task_master?.locations?.name}</p>
                                    <h5 className="text-xl font-bold">{t.task_master?.task_name}</h5>
                                    {t.status === 'started' && <p className="text-xs text-orange-500 font-bold mt-1 animate-pulse">● 実行中</p>}
                                </div>
                                {t.status === 'completed' ? <CheckCircle2 className="text-green-500" size={40} /> : (
                                    <button onClick={() => handleTaskAction(t)} className={`px-10 py-5 font-black rounded-2xl text-lg shadow-lg border-none cursor-pointer ${t.status === 'started' ? 'bg-orange-500' : 'bg-[#1a202c]'} text-white`}>{t.status === 'started' ? '再開' : '着手'}</button>
                                )}
                            </div>
                        )) : <p className="text-center text-slate-400 py-10 font-bold">現在（±30分）のタスクはありません</p>}
                    </div>
                </div>
            )}

            {menuChoice === "⚠️ 未完了タスク" && (
                <div className="space-y-4 animate-in fade-in duration-500 text-black">
                    <h3 className="font-black text-red-500 px-2 uppercase">やり残しタスクのリカバリー</h3>
                    {overdueTasks.length > 0 ? overdueTasks.map(t => (
                        <div key={t.id} className="app-card border-l-8 border-red-400 flex justify-between items-center text-black">
                            <div className="flex-1 pr-4">
                                <p className="text-red-500 font-black text-xs uppercase mb-1">【遅延】{t.task_master?.target_hour}:00</p>
                                <h5 className="text-xl font-bold text-black">{t.task_master?.task_name}</h5>
                                <p className="text-xs text-slate-400">{t.task_master?.locations?.name}</p>
                            </div>
                            <button onClick={() => handleTaskAction(t)} className={`px-8 py-5 font-black rounded-2xl shadow-lg text-white border-none cursor-pointer ${t.status === 'started' ? 'bg-orange-500' : 'bg-[#E53E3E]'}`}>{t.status === 'started' ? '再開' : 'リカバリー'}</button>
                        </div>
                    )) : <p className="text-center text-slate-400 py-10 font-bold">未完了のタスクはありません</p>}
                </div>
            )}

            {menuChoice === "🕒 自分の履歴" && (
                <div className="space-y-4 animate-in fade-in duration-500">
                    {personalHistory.map(r => (
                        <div key={r.id} className="app-card flex justify-between items-center border-l-8 border-[#75C9D7]">
                            <div className="text-black">
                                <p className="font-black text-lg">{r.work_date} <span className="text-xs text-slate-400">({formatToJSTTime(r.clock_in_at)}〜{formatToJSTTime(r.clock_out_at)})</span></p>
                                <p className="text-xs text-slate-500 font-bold mt-1 text-black">実働：<span style={{color: '#75C9D7'}}>{r.work_time}</span> ／ 休憩：{r.break_time}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {menuChoice === "📊 監視(Admin)" && (
                <div className="space-y-6 animate-in fade-in duration-500">
                    <div className="app-card">
                         <label className="text-sm font-black text-slate-400 block mb-2 tracking-widest">MONITORING DATE</label>
                         <input type="date" className="p-4 bg-slate-50 rounded-xl font-bold border-none w-full" value={monitorDate} onChange={(e) => { setMonitorDate(e.target.value); fetchAdminMonitorTasks(e.target.value); }} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {adminTasks.map(t => (
                            <div key={t.id} className="app-card p-4 text-center border-b-4 border-[#75C9D7]">
                                <img src={`${SUPABASE_URL}/storage/v1/object/public/task-photos/${t.photo_url}`} className="rounded-2xl mb-4 aspect-square object-cover w-full shadow-md" alt="写真" />
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-[#75C9D7] uppercase">{t.task_master.locations.name}</p>
                                    <h5 className="text-sm font-bold text-slate-800">{t.task_master.task_name}</h5>
                                    <div className="flex items-center justify-center gap-1 mt-3 bg-slate-50 py-2 rounded-xl"><UserCheck size={14} color="#75C9D7"/><p className="text-xs font-black text-slate-600">{t.staff?.name} 様</p></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {menuChoice === "📅 出勤簿(Admin)" && (
                <div className="space-y-6 animate-in fade-in duration-500">
                    <div className="app-card">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <select className="p-4 bg-slate-50 rounded-xl font-bold border-none text-black" value={filterStaffId} onChange={(e: any) => setFilterStaffId(e.target.value)}><option value="all">全員を表示</option>{adminStaffList.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                            <input type="date" className="p-4 bg-slate-50 rounded-xl font-bold border-none" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} />
                            <input type="date" className="p-4 bg-slate-50 rounded-xl font-bold border-none" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <button onClick={generateAdminReport} className="admin-grid-btn bg-[#1a202c]"><Search size={18}/>抽出実行</button>
                            <button onClick={downloadCSV} className="admin-grid-btn bg-[#75C9D7]"><Download size={18}/>CSV出力</button>
                            <button onClick={handleAddClick} className="admin-grid-btn bg-orange-400"><Plus size={18}/>新規追加</button>
                        </div>
                    </div>
                    {adminReport.map(r => (
                        <div key={r.id} className="app-card flex justify-between items-center border-l-8 border-slate-100">
                            <div className="flex-1 text-black">
                                <p className="font-black">{r.staff_name} 様</p>
                                <p className="text-xs text-slate-500">{r.work_date} ({formatToJSTTime(r.clock_in_at)}〜{formatToJSTTime(r.clock_out_at)})</p>
                                <p className="text-xs font-bold text-[#75C9D7] mt-1 text-black">実働: {r.work_time} (休: {r.break_time})</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleEditClick(r)} className="p-2 bg-slate-100 text-slate-600 rounded-lg border-none active:scale-90 transition-all cursor-pointer"><Edit size={16}/></button>
                                <button onClick={async () => { if(confirm("消去しますか？")) { await supabase.from('breaks').delete().eq('timecard_id', r.id); await supabase.from('timecards').delete().eq('id', r.id); generateAdminReport(); }}} className="p-2 bg-red-50 text-red-500 rounded-lg border-none active:scale-90 transition-all cursor-pointer"><Trash2 size={16}/></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </main>

      {/* 業務遂行オーバーレイ */}
      {activeTask && (
        <div className="fixed inset-0 bg-white z-[300] flex flex-col p-6 pt-12 overflow-y-auto text-black text-center">
          <div className="flex justify-between items-center mb-10 px-4">
              <button onClick={() => setActiveTask(null)} className="p-3 bg-slate-100 rounded-2xl flex items-center gap-2 font-bold border-none text-black cursor-pointer"><PauseCircle size={20}/>一時離脱</button>
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

      {/* 勤怠編集・追加モーダル */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[400] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in duration-300 text-black">
                <h3 className="text-2xl font-black mb-8 text-center">{editingCard ? '📝 勤怠修正' : '✨ 勤怠登録'}</h3>
                <div className="space-y-5">
                    <div>
                        <label className="block text-xs font-black text-slate-400 mb-2 ml-1">対象スタッフ</label>
                        <select className="w-full p-4 bg-slate-50 rounded-2xl font-black border border-slate-100 text-black" value={editForm.staff_id} onChange={(e) => setEditForm({...editForm, staff_id: e.target.value})} disabled={!!editingCard}>
                            {adminStaffList.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-black text-slate-400 mb-2 ml-1">勤務日付</label>
                        <input type="date" className="w-full p-4 bg-slate-50 rounded-2xl font-black border border-slate-100" value={editForm.work_date} onChange={(e) => setEditForm({...editForm, work_date: e.target.value})} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-black text-slate-400 mb-2 ml-1">出勤時刻</label>
                            <input type="time" className="w-full p-4 bg-slate-50 rounded-2xl font-black border border-slate-100" value={editForm.clock_in_time} onChange={(e) => setEditForm({...editForm, clock_in_time: e.target.value})} />
                        </div>
                        <div>
                            <label className="block text-xs font-black text-slate-400 mb-2 ml-1">退勤時刻</label>
                            <input type="time" className="w-full p-4 bg-slate-50 rounded-2xl font-black border border-slate-100" value={editForm.clock_out_time} onChange={(e) => setEditForm({...editForm, clock_out_time: e.target.value})} />
                        </div>
                    </div>
                </div>
                <div className="flex gap-4 mt-10">
                    <button onClick={() => setIsEditModalOpen(false)} className="flex-1 py-4 bg-slate-100 text-slate-500 font-black rounded-2xl border-none cursor-pointer">中止</button>
                    <button onClick={handleSaveRecord} className="flex-1 py-4 bg-[#75C9D7] text-white font-black rounded-2xl shadow-lg border-none flex items-center justify-center gap-2 cursor-pointer">
                        {loading ? <Loader2 className="animate-spin" /> : <><Save size={20}/> 保存</>}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}