"use client";

import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Clock, CheckCircle2, Camera, X, Loader2, Coffee, ArrowLeft, 
  Download, Search, Menu, Edit, Trash2, Plus, Save, PauseCircle, UserCheck, AlertTriangle
} from 'lucide-react';
import dynamic from 'next/dynamic';

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
  const [filterStaffId, setFilterStaffId] = useState("all");
  const [filterStartDate, setFilterStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterEndDate, setFilterEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [monitorDate, setMonitorDate] = useState(new Date().toISOString().split('T')[0]);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<any>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [editForm, setEditForm] = useState({ staff_id: "", work_date: "", clock_in_time: "", clock_out_time: "", break_mins: "0" });

  // --- 2. 補助関数（エラー ts(2304) を完全に防ぐ統一定義） ---
  const formatToJSTTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false }) : "---";
  const isoToTime = (s: string | null) => s ? `${String(new Date(s).getHours()).padStart(2,'0')}:${String(new Date(s).getMinutes()).padStart(2,'0')}` : "";
  const formatHHMM = (m: number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  const minDateLimit = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().split('T')[0]; }, []);
  const todayISO = useMemo(() => new Date().toISOString().split('T')[0], []);

  const calculateTotalBreak = useCallback((brks: any[], includeActive: boolean = false) => {
    let t = 0; brks?.forEach(b => { if (b.break_start_at && b.break_end_at) t += Math.round((new Date(b.break_end_at).getTime() - new Date(b.break_start_at).getTime())/60000); });
    if (includeActive) { const a = brks?.find(b => !b.break_end_at); if (a) t += Math.round((currentTime.getTime() - new Date(a.break_start_at).getTime())/60000); }
    return t;
  }, [currentTime]);

  const calculateWorkMins = (cIn: string, cOut: string | null, brks: any[]) => {
    if (!cIn) return 0;
    const end = cOut ? new Date(cOut) : currentTime;
    return Math.max(0, Math.round((end.getTime() - new Date(cIn).getTime())/60000) - calculateTotalBreak(brks, !cOut));
  };

  // --- 3. データ同期ロジック ---
  const fetchTasks = useCallback(async () => {
    const todayStr = new Date().toLocaleDateString('sv-SE');
    const todayDay = new Date().getDay();
    const [mRes, lRes] = await Promise.all([
      supabase.from('task_master').select('*').or(`day_of_week.eq.${todayDay},day_of_week.is.null`),
      supabase.from('task_logs').select('*, task_master(*, locations(*)), staff(name)').eq('work_date', todayStr)
    ]);
    const masters = mRes.data || []; const logs = lRes.data || [];
    const missing = masters.filter(m => !logs.some(l => l.task_id === m.id));
    if (missing.length > 0) {
      await supabase.from('task_logs').insert(missing.map(m => ({ task_id: m.id, work_date: todayStr, status: 'pending' })));
      const { data: r } = await supabase.from('task_logs').select('*, task_master(*, locations(*)), staff(name)').eq('work_date', todayStr);
      setTasks(r || []);
    } else { setTasks(logs); }
  }, []);

  const fetchAdminMonitor = useCallback(async (date: string) => {
    const { data } = await supabase.from('task_logs').select('*, staff(name), task_master(*, locations(*))').eq('work_date', date).eq('status', 'completed').order('completed_at', { ascending: false });
    if (data) setAdminTasks(data);
  }, []);

  const fetchPersonalHistory = useCallback(async (staffId: string) => {
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const { data: h } = await supabase.from('timecards').select('*, breaks(*)').eq('staff_id', staffId).gte('work_date', start).order('work_date', { ascending: false });
    if (h) setPersonalHistory(h.map((r: any) => ({ ...r, work_time: formatHHMM(calculateWorkMins(r.clock_in_at, r.clock_out_at, r.breaks)), break_time: formatHHMM(calculateTotalBreak(r.breaks)) })));
  }, [currentTime, calculateTotalBreak]);

  const syncStatus = useCallback(async (staffId: string) => {
    const { data: tc } = await supabase.from('timecards').select('*').eq('staff_id', staffId).is('clock_out_at', null).maybeSingle();
    if (tc) {
      setCurrCard(tc); const { data: brs } = await supabase.from('breaks').select('*').eq('timecard_id', tc.id);
      setBreaksList(brs || []); setAttendanceStatus(brs?.find((b: any) => !b.break_end_at) ? 'break' : 'working');
    } else { setCurrCard(null); setBreaksList([]); setAttendanceStatus('offline'); }
    fetchTasks(); fetchPersonalHistory(staffId);
  }, [fetchTasks, fetchPersonalHistory]);

  useEffect(() => {
    const id = localStorage.getItem('staff_id'); if (!id) { window.location.href = '/'; return; }
    const init = async () => {
      const page = localStorage.getItem('active_page') || "📋 本日の業務"; setMenuChoice(page);
      const { data: s } = await supabase.from('staff').select('*').eq('staff_id', id).single();
      if (s) {
        setStaff(s); syncStatus(s.id); 
        if (s.role === 'admin') { const { data: l } = await supabase.from('staff').select('id, name'); if (l) setAdminStaffList(l); }
      } else { localStorage.clear(); window.location.href = '/'; }
    };
    init();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    const resizer = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', resizer); resizer();
    return () => { clearInterval(timer); window.removeEventListener('resize', resizer); };
  }, [syncStatus]);

  // --- 4. 業務ロジック ---
  const displayTasks = useMemo(() => {
    const cur = currentTime.getHours() * 60 + currentTime.getMinutes();
    return tasks.filter(t => Math.abs(cur - ((t.task_master?.target_hour || 0) * 60 + (t.task_master?.target_minute || 0))) <= 30)
      .sort((a,b)=>((a.task_master?.target_hour||0)*60+(a.task_master?.target_minute||0))-((b.task_master?.target_hour||0)*60+(b.task_master?.target_minute||0)));
  }, [tasks, currentTime]);

  const overdueTasks = useMemo(() => {
    const cur = currentTime.getHours() * 60 + currentTime.getMinutes();
    return tasks.filter(t => ((t.task_master?.target_hour || 0) * 60 + (t.task_master?.target_minute || 0)) < cur - 30 && t.status !== 'completed')
      .sort((a,b)=>((a.task_master?.target_hour||0)*60+(a.task_master?.target_minute||0))-((b.task_master?.target_hour||0)*60+(b.task_master?.target_minute||0)));
  }, [tasks, currentTime]);

  // --- 5. アクションハンドラ ---
  const handleClockAction = async (type: 'in' | 'out' | 'break') => {
    setLoading(true);
    if (type === 'in') await supabase.from('timecards').insert({ staff_id: staff.id, staff_name: staff.name, clock_in_at: new Date().toISOString(), work_date: todayISO });
    if (type === 'out') { if(!confirm("退勤を記録?")) { setLoading(false); return; } await supabase.from('timecards').update({ clock_out_at: new Date().toISOString() }).eq('staff_id', staff.id).is('clock_out_at', null); }
    if (type === 'break') {
      if (attendanceStatus === 'working') await supabase.from('breaks').insert({ staff_id: staff.id, timecard_id: currCard?.id, break_start_at: new Date().toISOString(), work_date: todayISO });
      else await supabase.from('breaks').update({ break_end_at: new Date().toISOString() }).eq('staff_id', staff.id).is('break_end_at', null);
    }
    await syncStatus(staff.id); setLoading(false);
  };

  const handleTaskAction = (t: any) => { setActiveTask(t); setIsQrVerified(t.status === 'started'); };

  const onQrScan = useCallback(async (txt: string) => {
    if (activeTask && txt === activeTask.task_master?.locations?.qr_token) {
      await supabase.from('task_logs').update({ status: 'started', started_at: new Date().toISOString(), staff_id: staff.id }).eq('id', activeTask.id);
      setIsQrVerified(true); fetchTasks();
    } else if (activeTask) { alert("場所が違います"); }
  }, [activeTask, fetchTasks, staff]);

  const handleTaskComplete = async (e: any) => {
    if (!e.target.files?.[0]) return;
    setLoading(true);
    const reader = new FileReader(); reader.readAsDataURL(e.target.files[0]);
    reader.onload = (ev) => {
      const img = new Image(); img.src = ev.target?.result as string;
      img.onload = async () => {
        const canvas = document.createElement('canvas'); const MAX = 1280;
        let w = img.width; let h = img.height;
        if (w > MAX) { h *= MAX / w; w = MAX; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
        canvas.toBlob(async (blob) => {
          if (blob) {
            const fn = `${activeTask.id}-${Date.now()}.jpg`;
            await supabase.storage.from('task-photos').upload(fn, blob);
            await supabase.from('task_logs').update({ status: 'completed', completed_at: new Date().toISOString(), photo_url: fn, staff_id: staff.id }).eq('id', activeTask.id);
            setActiveTask(null); setIsQrVerified(false); fetchTasks(); alert("報告完了");
          }
          setLoading(false);
        }, 'image/jpeg', 0.8);
      };
    };
  };

  // --- 6. Admin：機能ハンドラ ---
  const generateAdminReport = async () => {
    setLoading(true);
    let q = supabase.from('timecards').select('*, breaks(*)').gte('work_date', filterStartDate).lte('work_date', filterEndDate);
    if (filterStaffId !== "all") q = q.eq('staff_id', filterStaffId);
    const { data } = await q.order('work_date', { ascending: false });
    if (data) setAdminReport(data.map((r: any) => ({ ...r, work_time: formatHHMM(calculateWorkMins(r.clock_in_at, r.clock_out_at, r.breaks)), break_time: formatHHMM(calculateTotalBreak(r.breaks)) })));
    setLoading(false);
  };

  const downloadCSV = () => {
    const h = "名前,日付,出勤,退勤,休憩,実働\n";
    const r = adminReport.map(x => `${x.staff_name},${x.work_date},${formatToJSTTime(x.clock_in_at)},${formatToJSTTime(x.clock_out_at)},${x.break_time},${x.work_time}`).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\uFEFF" + h + r])); link.download = `Report.csv`; link.click();
  };

  const handleEditClick = (record: any) => {
    setEditingCard(record);
    setEditForm({ staff_id: record.staff_id, work_date: record.work_date, clock_in_time: isoToTime(record.clock_in_at), clock_out_time: isoToTime(record.clock_out_at), break_mins: String(calculateTotalBreak(record.breaks)) });
    setIsEditModalOpen(true);
  };

  const handleSaveRecord = async () => {
    setLoading(true);
    const cIn = new Date(`${editForm.work_date}T${editForm.clock_in_time}:00`).toISOString();
    const cOut = editForm.clock_out_time ? new Date(`${editForm.work_date}T${editForm.clock_out_time}:00`).toISOString() : null;
    let cardId = editingCard?.id;
    if (editingCard) await supabase.from('timecards').update({ clock_in_at: cIn, clock_out_at: cOut, work_date: editForm.work_date }).eq('id', cardId);
    else { const res = await supabase.from('timecards').insert({ staff_id: editForm.staff_id, staff_name: adminStaffList.find(x => x.id === editForm.staff_id)?.name, clock_in_at: cIn, clock_out_at: cOut, work_date: editForm.work_date }).select(); cardId = res.data?.[0]?.id; }
    if (cardId) {
      await supabase.from('breaks').delete().eq('timecard_id', cardId);
      if (parseInt(editForm.break_mins) > 0) {
        const bS = new Date(cIn); const bE = new Date(bS.getTime() + parseInt(editForm.break_mins) * 60000);
        await supabase.from('breaks').insert({ staff_id: editingCard?.staff_id || editForm.staff_id, timecard_id: cardId, break_start_at: bS.toISOString(), break_end_at: bE.toISOString(), work_date: editForm.work_date });
      }
    }
    setIsEditModalOpen(false); await generateAdminReport(); setLoading(false);
  };

  const handleConfirmDelete = async () => {
    if(!deleteReason.trim()) { alert("理由を入力してください"); return; }
    setLoading(true);
    await supabase.from('breaks').delete().eq('timecard_id', deleteTargetId);
    await supabase.from('timecards').delete().eq('id', deleteTargetId);
    setIsDeleteModalOpen(false); await generateAdminReport(); setLoading(false);
  };

  // --- 7. 表示部品 ---
  if (!staff) return null;
  const cbObj = breaksList.find(b => !b.break_end_at);
  const tInfo = attendanceStatus === 'break' ? { label: "休憩中", val: `${Math.round((currentTime.getTime() - new Date(cbObj?.break_start_at).getTime())/60000)}分 (累計:${calculateTotalBreak(breaksList, true)}分)`, col: "#ED8936" } : { label: "実働中", val: formatHHMM(calculateWorkMins(currCard?.clock_in_at, null, breaksList)), col: "#75C9D7" };

  return (
    <div className="min-h-screen bg-white flex flex-col md:flex-row text-black overflow-x-hidden font-sans">
      <style jsx global>{`
        header, footer { display: none !important; }
        .app-card { background: white; padding: 22px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid #edf2f7; margin-bottom: 20px; }
        .menu-item { width: 100%; text-align: left; padding: 18px 20px; border-radius: 1rem; font-weight: 900; font-size: 18px; white-space: nowrap; border-bottom: 1px solid #EDF2F7; background: transparent; color: #000000 !important; }
        .menu-item-active { background-color: #75C9D7 !important; color: white !important; border: none; }
        .menu-item-active span { color: white !important; }
        .admin-grid-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 2px; font-size: 11px; font-weight: 900; border-radius: 12px; border: none; color: white !important; cursor: pointer; }
      `}</style>

      {isMobile && !activeTask && <button onClick={() => setSidebarOpen(true)} className="fixed top-6 left-6 z-[130] p-3 bg-white shadow-xl rounded-2xl border border-slate-100"><Menu size={24} color="#75C9D7" /></button>}

      <div className={`fixed inset-0 bg-black/40 z-[140] transition-opacity ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`fixed md:relative inset-y-0 left-0 z-[150] w-[75vw] md:w-72 bg-white border-r p-6 flex flex-col transition-transform ${sidebarOpen || !isMobile ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex justify-between items-center mb-8"><h1 className="text-2xl font-black italic text-[#75C9D7]">MENU</h1>{isMobile && <button onClick={() => setSidebarOpen(false)}><X size={28} color="#75C9D7" /></button>}</div>
        <nav className="flex-1 space-y-1">
          {["📋 本日の業務", "⚠️ 未完了タスク", "🕒 自分の履歴", "📊 監視(Admin)", "📅 出勤簿(Admin)"].filter(x => !x.includes("Admin") || staff.role === 'admin').map(x => (
            <button key={x} onClick={() => { setMenuChoice(x); setSidebarOpen(false); localStorage.setItem('active_page', x); if(x.includes("監視")) fetchAdminMonitor(monitorDate); }} className={`menu-item ${menuChoice === x ? 'menu-item-active' : ''}`}><span>{x}</span></button>
          ))}
        </nav>
        <div className="mt-auto pt-4 border-t text-center"><p className="font-black text-sm mb-3 text-black">{staff.name}</p><button onClick={() => {localStorage.clear(); window.location.href='/';}} className="w-full py-3 bg-slate-50 text-[#E53E3E] font-black rounded-xl border border-slate-200">ログアウト</button></div>
      </aside>

      <main className="flex-1 p-6 md:p-10 overflow-y-auto pt-24 md:pt-10">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8 text-black"><img src="/logo.png" className="w-32" alt="logo" /><div className="bg-white px-4 py-1.5 rounded-full border flex items-center gap-2 font-black text-slate-500 text-xs text-black"><Clock size={14} color="#75C9D7"/>{currentTime.toLocaleTimeString('ja-JP')}</div></div>

          {menuChoice === "📋 本日の業務" && (
            <div className="space-y-6 animate-in fade-in text-black">
              <div className="app-card border-l-8 border-[#75C9D7] text-center">
                {attendanceStatus === 'offline' ? <button onClick={() => handleClockAction('in')} className="w-full py-5 bg-[#75C9D7] text-white font-black rounded-2xl text-xl border-none shadow-lg">🚀 業務開始 (出勤)</button> : <>
                    <div className="flex gap-3 mb-4"><button onClick={() => handleClockAction('break')} className={`flex-1 py-4 border-none ${attendanceStatus === 'break' ? 'bg-orange-400' : 'bg-[#1a202c]'} text-white font-black rounded-2xl`}>{attendanceStatus === 'break' ? '🏃 業務復帰' : '☕ 休憩入り'}</button><button onClick={() => handleClockAction('out')} className="flex-1 py-4 bg-white border border-slate-200 text-slate-400 font-black rounded-2xl">退勤</button></div>
                    <p className="text-sm font-bold text-slate-400 text-center">出勤：{formatToJSTTime(currCard?.clock_in_at)}</p>
                    <p className="text-lg font-black mt-1 text-center" style={{color: tInfo.col}}>{tInfo.label}：{tInfo.val}</p>
                </>}
              </div>
              {attendanceStatus !== 'offline' && displayTasks.map(t => (
                <div key={t.id} className="app-card flex justify-between items-center border-l-8 border-[#75C9D7] text-black">
                  <div className="flex-1 pr-4">
                    <p className="text-[10px] font-black uppercase text-[#75C9D7]">{t.task_master?.locations?.name}</p>
                    <h5 className="text-lg font-bold text-black">【{String(t.task_master?.target_hour).padStart(2,'0')}:{String(t.task_master?.target_minute || 0).padStart(2,'0')}】{t.task_master?.task_name}</h5>
                    {t.status === 'started' && <p className="text-xs text-orange-500 font-bold mt-1">● 進行中</p>}
                  </div>
                  {t.status === 'completed' ? <CheckCircle2 className="text-green-500" size={32} /> : (
                    <button onClick={() => handleTaskAction(t)} className={`px-8 py-4 font-black rounded-xl border-none text-white ${t.status === 'started' ? 'bg-orange-500' : 'bg-[#1a202c]'}`}>{t.status === 'started' ? '再開' : '着手'}</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {menuChoice === "⚠️ 未完了タスク" && overdueTasks.map(t => (
            <div key={t.id} className="app-card border-l-8 border-red-400 flex justify-between items-center text-black">
              <div className="flex-1 text-black"><p className="text-red-500 font-black text-xs uppercase mb-1">【遅延】{String(t.task_master?.target_hour).padStart(2,'0')}:00</p><h5 className="text-lg font-bold text-black">{t.task_master?.task_name}</h5></div>
              <button onClick={() => handleTaskAction(t)} className={`px-8 py-4 font-black rounded-xl text-white border-none ${t.status === 'started' ? 'bg-orange-500' : 'bg-[#E53E3E]'}`}>{t.status === 'started' ? '再開' : 'リカバリ'}</button>
            </div>
          ))}

          {menuChoice === "🕒 自分の履歴" && personalHistory.map(r => (
            <div key={r.id} className="app-card border-l-8 border-[#75C9D7] text-black"><p className="font-black text-sm text-black">{r.work_date} ({formatToJSTTime(r.clock_in_at)}〜{formatToJSTTime(r.clock_out_at)})</p><p className="text-xs font-bold text-slate-600 mt-1">実働: {r.work_time} / 休憩: {r.break_time}</p></div>
          ))}

          {menuChoice === "📊 監視(Admin)" && (
            <div className="space-y-6 text-black">
              <div className="app-card py-4"><input type="date" className="p-4 bg-slate-50 rounded-xl font-bold border-none w-full text-center" min={minDateLimit} max={todayISO} value={monitorDate} onChange={e => {setMonitorDate(e.target.value); fetchAdminMonitor(e.target.value);}} /></div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {adminTasks.map(t => (
                  <div key={t.id} className="app-card p-3 text-center border-b-4 border-[#75C9D7] text-black">
                    <img src={`${SUPABASE_URL}/storage/v1/object/public/task-photos/${t.photo_url}`} className="rounded-xl mb-3 aspect-square object-cover w-full shadow-sm" alt="img" />
                    <div className="text-[10px] font-black text-slate-800 line-clamp-1">{t.task_master.locations.name}</div>
                    <div className="bg-slate-50 py-1.5 rounded-lg text-[10px] font-black text-black"><UserCheck size={10} className="inline mr-1" />{t.staff?.name}</div>
                    <p className="text-[10px] text-slate-400 font-bold mt-1 italic text-center">完了：{formatToJSTTime(t.completed_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {menuChoice === "📅 出勤簿(Admin)" && (
            <div className="space-y-6 text-black">
              <div className="app-card">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                  <select className="p-3 bg-slate-50 rounded-xl font-bold text-sm border-none text-black" value={filterStaffId} onChange={e => setFilterStaffId(e.target.value)}><option value="all">全員</option>{adminStaffList.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  <input type="date" className="p-3 bg-slate-50 rounded-xl border-none font-bold text-black" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} /><input type="date" className="p-3 bg-slate-50 rounded-xl border-none font-bold text-black" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-white">
                  <button onClick={generateAdminReport} className="admin-grid-btn bg-[#1a202c] text-white"><Search size={16}/>抽出</button>
                  <button onClick={downloadCSV} className="admin-grid-btn bg-[#75C9D7] text-white"><Download size={16}/>CSV</button>
                  <button onClick={() => {setEditingCard(null); setEditForm({staff_id: adminStaffList[0]?.id || "", work_date: todayISO, clock_in_time: "09:00", clock_out_time: "18:00", break_mins: "0"}); setIsEditModalOpen(true);}} className="admin-grid-btn bg-orange-400 text-white"><Plus size={16}/>追加</button>
                </div>
              </div>
              {adminReport.map(r => (<div key={r.id} className="app-card flex justify-between items-center border-l-8 border-slate-100 text-black py-4"><div className="flex-1 text-black"><p className="font-black text-sm text-black">{r.staff_name}</p><p className="text-[10px] text-slate-500">{r.work_date} (休憩:{r.break_time})</p><p className="text-xs font-bold text-[#75C9D7]">実働:{r.work_time}</p></div><div className="flex gap-1">
                <button onClick={() => handleEditClick(r)} className="p-2.5 bg-slate-50 text-slate-500 rounded-lg border-none cursor-pointer"><Edit size={14}/></button>
                <button onClick={() => { setDeleteTargetId(r.id); setDeleteReason(""); setIsDeleteModalOpen(true); }} className="p-2.5 bg-red-50 text-red-400 rounded-lg border-none cursor-pointer"><Trash2 size={14}/></button>
              </div></div>))}
            </div>
          )}
        </div>
      </main>

      {activeTask && (
        <div className="fixed inset-0 bg-white z-[300] flex flex-col p-6 pt-10 overflow-y-auto text-center text-black">
          <div className="flex justify-between items-center mb-8 px-2"><button onClick={() => setActiveTask(null)} className="p-3 bg-slate-100 rounded-xl border-none"><PauseCircle size={20}/></button><h2 className="text-lg font-black italic">MISSION</h2><div className="w-10"></div></div>
          {!isQrVerified ? <QrScanner onScanSuccess={onQrScan} /> : <div className="space-y-8 animate-in zoom-in duration-300 text-black"><CheckCircle2 size={64} className="text-green-500 mx-auto" /><p className="font-black text-xl text-black text-center">{activeTask.task_master?.task_name}</p><p className="text-xs font-bold text-slate-400 text-center">担当：{staff.name}</p><label className="block w-full px-4 cursor-pointer text-black"><div className="w-full py-8 bg-[#75C9D7] text-white font-black rounded-3xl shadow-xl flex items-center justify-center gap-3 text-xl active:scale-95 transition-all"><Camera size={32}/>完了撮影</div><input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleTaskComplete} /></label></div>}
        </div>
      )}

      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[400] flex items-center justify-center p-4 backdrop-blur-sm text-black">
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl text-black">
            <h3 className="text-lg font-black mb-6 text-center text-black">{editingCard ? '修正' : '登録'}</h3>
            <div className="space-y-4">
              <div><label className="text-[10px] font-black text-slate-400 ml-1">スタッフ</label><select className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={editForm.staff_id} onChange={e => setEditForm({...editForm, staff_id: e.target.value})} disabled={!!editingCard}>{adminStaffList.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className="text-[10px] font-black text-slate-400 ml-1 text-black">日付</label><input type="date" className="w-full p-3 bg-slate-50 rounded-xl border-none text-sm font-bold text-black" value={editForm.work_date} onChange={e => setEditForm({...editForm, work_date: e.target.value})} /></div>
              <div className="flex gap-3 text-black"><div className="flex-1"><label className="text-[10px] font-black text-slate-400 ml-1 text-black">出勤</label><input type="time" className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={editForm.clock_in_time} onChange={e => setEditForm({...editForm, clock_in_time: e.target.value})} /></div><div className="flex-1"><label className="text-[10px] font-black text-slate-400 ml-1 text-black">退勤</label><input type="time" className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={editForm.clock_out_time} onChange={e => setEditForm({...editForm, clock_out_time: e.target.value})} /></div></div>
              <div><label className="text-[10px] font-black text-slate-400 ml-1">休憩時間 (分)</label><input type="number" className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={editForm.break_mins} onChange={e => setEditForm({...editForm, break_mins: e.target.value})} /></div>
            </div>
            <div className="flex gap-3 mt-8 text-black">
              <button onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 bg-slate-50 text-slate-400 font-black rounded-xl border-none">中止</button>
              <button onClick={handleSaveRecord} className="flex-1 py-3 bg-[#75C9D7] text-white font-black rounded-xl shadow-lg border-none flex items-center justify-center gap-2">{loading ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>}保存</button>
            </div>
          </div>
        </div>
      )}

      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[400] flex items-center justify-center p-4 backdrop-blur-md">
            <div className="bg-white w-full max-w-sm rounded-3xl p-8 shadow-2xl text-black">
                <div className="flex flex-col items-center text-center">
                    <AlertTriangle size={48} className="text-red-500 mb-4" />
                    <h3 className="text-xl font-black mb-6 text-red-600 text-center">記録の削除確認</h3>
                </div>
                <textarea className="w-full p-4 bg-slate-50 rounded-2xl border-none font-bold text-sm mb-6" rows={3} placeholder="削除理由を入力..." value={deleteReason} onChange={(e)=>setDeleteReason(e.target.value)} />
                <div className="flex gap-3">
                    <button onClick={()=>setIsDeleteModalOpen(false)} className="flex-1 py-4 bg-slate-100 text-slate-500 font-black rounded-2xl">中止</button>
                    <button onClick={handleConfirmDelete} className="flex-1 py-4 bg-red-500 text-white font-black rounded-2xl">削除実行</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}