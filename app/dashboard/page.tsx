"use client";

import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Clock, CheckCircle2, Camera, X, Loader2, Coffee, ArrowLeft, 
  Download, Search, Menu, Edit, Trash2, Plus, Save, PauseCircle, UserCheck, AlertTriangle, Archive, RefreshCcw, Ban
} from 'lucide-react';
import dynamic from 'next/dynamic';

const QrScannerRaw = dynamic(() => import('../../components/QrScanner'), { ssr: false });
const QrScanner = memo(QrScannerRaw);
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
  const [activeStaffList, setActiveStaffList] = useState<any[]>([]);
  const [adminReport, setAdminReport] = useState<any[]>([]);
  const [filterStaffId, setFilterStaffId] = useState("all");
  const [filterStartDate, setFilterStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterEndDate, setFilterEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [monitorDate, setMonitorDate] = useState(new Date().toISOString().split('T')[0]);
  const [showRetiredStaff, setShowRetiredStaff] = useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [isRetireModalOpen, setIsRetireModalOpen] = useState(false);
  
  const [editingCard, setEditingCard] = useState<any>(null);
  const [editingStaff, setEditingStaff] = useState<any>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [retirementDate, setRetirementDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [editForm, setEditForm] = useState({ staff_id: "", work_date: "", clock_in_time: "", clock_out_time: "", break_mins: "0" });
  const [staffForm, setStaffForm] = useState({ staff_id: "", name: "", password: "", role: "staff", address: "", birth_date: "", hire_date: "", resignation_date: "", is_active: true });

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
    const diff = Math.round((end.getTime() - new Date(cIn).getTime())/60000);
    return Math.max(0, diff - calculateTotalBreak(brks, !cOut));
  };

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
    setLoading(true);
    const { data } = await supabase.from('task_logs').select('*, staff(name), task_master(*, locations(*))').eq('work_date', date).eq('status', 'completed').order('completed_at', { ascending: false });
    if (data) setAdminTasks(data);
    setLoading(false);
  }, []);

  const fetchStaffList = useCallback(async () => {
    let query = supabase.from('staff').select('*').order('staff_id', { ascending: true });
    const { data: allStaff } = await query;
    if (allStaff) {
        setAdminStaffList(allStaff);
        setActiveStaffList(allStaff.filter((s: any) => s.is_active));
    }
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
    fetchTasks();
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const { data: h } = await supabase.from('timecards').select('*, breaks(*)').eq('staff_id', staffId).gte('work_date', start).order('work_date', { ascending: false });
    if (h) setPersonalHistory(h.map((r: any) => ({ ...r, work_time: formatHHMM(calculateWorkMins(r.clock_in_at, r.clock_out_at, r.breaks)), break_time: formatHHMM(calculateTotalBreak(r.breaks)) })));
  }, [fetchTasks, currentTime, calculateTotalBreak]);

  useEffect(() => {
    const id = localStorage.getItem('staff_id'); if (!id) { window.location.href = '/'; return; }
    const init = async () => {
      const { data: s } = await supabase.from('staff').select('*').eq('staff_id', id).single();
      if (s) {
        setStaff(s); syncStatus(s.id); 
        if (s.role === 'admin') { fetchStaffList(); }
      } else { localStorage.clear(); window.location.href = '/'; }
    };
    init();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    const resizer = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', resizer); resizer();
    return () => { clearInterval(timer); window.removeEventListener('resize', resizer); };
  }, [syncStatus]);

  const displayTasks = useMemo(() => {
    const cur = currentTime.getHours() * 60 + currentTime.getMinutes();
    return tasks.filter(t => Math.abs(cur - ((t.task_master?.target_hour || 0) * 60 + (t.task_master?.target_minute || 0))) <= 30).sort((a,b)=>((a.task_master?.target_hour||0)*60+(a.task_master?.target_minute||0))-((b.task_master?.target_hour||0)*60+(b.task_master?.target_minute||0)));
  }, [tasks, currentTime]);

  const overdueTasks = useMemo(() => {
    const cur = currentTime.getHours() * 60 + currentTime.getMinutes();
    return tasks.filter(t => ((t.task_master?.target_hour || 0) * 60 + (t.task_master?.target_minute || 0)) < cur - 30 && t.status !== 'completed').sort((a,b)=>((a.task_master?.target_hour||0)*60+(a.task_master?.target_minute||0))-((b.task_master?.target_hour||0)*60+(b.task_master?.target_minute||0)));
  }, [tasks, currentTime]);

  const handleClockAction = async (type: 'in' | 'out' | 'break') => {
    setLoading(true);
    const nowJST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
    if (type === 'in') await supabase.from('timecards').insert({ staff_id: staff.id, staff_name: staff.name, clock_in_at: nowJST, work_date: todayISO });
    if (type === 'out') { if(!confirm("退勤を記録しますか？")) { setLoading(false); return; } await supabase.from('timecards').update({ clock_out_at: nowJST }).eq('staff_id', staff.id).is('clock_out_at', null); }
    if (type === 'break') {
      if (attendanceStatus === 'working') await supabase.from('breaks').insert({ staff_id: staff.id, timecard_id: currCard?.id, break_start_at: nowJST, work_date: todayISO });
      else await supabase.from('breaks').update({ break_end_at: nowJST }).eq('staff_id', staff.id).is('break_end_at', null);
    }
    await syncStatus(staff.id); setLoading(false);
  };

  const handleTaskAction = (t: any) => { setActiveTask(t); setIsQrVerified(t.status === 'started'); };
  const onQrScan = useCallback(async (txt: string) => {
    if (activeTask && txt === activeTask.task_master?.locations?.qr_token) {
      const nowJST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
      await supabase.from('task_logs').update({ status: 'started', started_at: nowJST, staff_id: staff.id }).eq('id', activeTask.id);
      setIsQrVerified(true); fetchTasks();
    } else if (activeTask) { alert("場所が違います"); }
  }, [activeTask, fetchTasks, staff]);

  const handleTaskComplete = async (e: any) => {
    if (!e.target.files?.[0]) return;
    setLoading(true);
    try {
      const reader = new FileReader(); reader.readAsDataURL(e.target.files[0]);
      reader.onload = (ev) => {
        const img = new Image(); img.src = ev.target?.result as string;
        img.onload = async () => {
          const canvas = document.createElement('canvas'); const MAX = 1280;
          let w = img.width, h = img.height;
          if (w > MAX) { h *= MAX / w; w = MAX; }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
          canvas.toBlob(async (blob) => {
            if (blob) {
              const fn = `${activeTask.id}-${Date.now()}.jpg`;
              const nowJST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
              await supabase.storage.from('task-photos').upload(fn, blob);
              await supabase.from('task_logs').update({ status: 'completed', completed_at: nowJST, photo_url: fn, staff_id: staff.id }).eq('id', activeTask.id);
              setActiveTask(null); setIsQrVerified(false); fetchTasks(); alert("報告完了");
            }
            setLoading(false);
          }, 'image/jpeg', 0.8);
        };
      };
    } catch { alert("エラー"); setLoading(false); }
  };

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
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\uFEFF" + h + r])); link.download = `Attendance.csv`; link.click();
  };

  const downloadStaffCSV = () => {
    const h = "ID,名前,権限,住所,生年月日,入社日,退社日,在籍状況\n";
    const targetList = showRetiredStaff ? adminStaffList : adminStaffList.filter((s:any) => s.is_active);
    const r = targetList.map((s: any) => `${s.staff_id},${s.name},${s.role},${s.address||""},${s.birth_date||""},${s.hire_date||""},${s.resignation_date||""},${s.is_active?"在籍":"退職"}`).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\uFEFF" + h + r])); link.download = `Staff_List.csv`; link.click();
  };

  const handleEditClick = (record: any) => {
    setEditingCard(record);
    setEditForm({ staff_id: record.staff_id, work_date: record.work_date, clock_in_time: isoToTime(record.clock_in_at), clock_out_time: isoToTime(record.clock_out_at), break_mins: String(calculateTotalBreak(record.breaks)) });
    setIsEditModalOpen(true);
  };

  const handleSaveRecord = async () => {
    setLoading(true);
    const cIn = `${editForm.work_date}T${editForm.clock_in_time}:00+09:00`;
    let cOut = null;
    if (editForm.clock_out_time) {
        if (editForm.clock_out_time < editForm.clock_in_time) {
            const nextDay = new Date(new Date(editForm.work_date).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            cOut = `${nextDay}T${editForm.clock_out_time}:00+09:00`;
        } else { cOut = `${editForm.work_date}T${editForm.clock_out_time}:00+09:00`; }
    }
    let cid = editingCard?.id;
    if (editingCard) await supabase.from('timecards').update({ clock_in_at: cIn, clock_out_at: cOut, work_date: editForm.work_date }).eq('id', cid);
    else { const res = await supabase.from('timecards').insert({ staff_id: editForm.staff_id, staff_name: activeStaffList.find(x => x.id === editForm.staff_id)?.name || "Unknown", clock_in_at: cIn, clock_out_at: cOut, work_date: editForm.work_date }).select(); cid = res.data?.[0]?.id; }
    if (cid) {
      await supabase.from('breaks').delete().eq('timecard_id', cid);
      if (parseInt(editForm.break_mins) > 0) {
        const bE = new Date(new Date(cIn).getTime() + parseInt(editForm.break_mins) * 60000).toISOString().replace('Z', '+09:00');
        await supabase.from('breaks').insert({ staff_id: editingCard?.staff_id || editForm.staff_id, timecard_id: cid, break_start_at: cIn, break_end_at: bE, work_date: editForm.work_date });
      }
    }
    setIsEditModalOpen(false); await generateAdminReport(); setLoading(false);
  };

  const handleConfirmDelete = async () => {
    if(!deleteReason.trim()) { alert("理由を入力してください"); return; }
    setLoading(true); await supabase.from('breaks').delete().eq('timecard_id', deleteTargetId); await supabase.from('timecards').delete().eq('id', deleteTargetId);
    setIsDeleteModalOpen(false); await generateAdminReport(); setLoading(false);
  };

  const handleSaveStaff = async () => {
    if (!staffForm.staff_id || !staffForm.name) { alert("IDと名前は必須です"); return; }
    const duplicateId = adminStaffList.find((s: any) => s.staff_id === staffForm.staff_id && s.id !== editingStaff?.id);
    if (duplicateId) { alert("IDが重複しています。"); return; }
    const duplicateName = adminStaffList.find((s: any) => s.name === staffForm.name && s.id !== editingStaff?.id);
    if (duplicateName) { if (!confirm(`「${staffForm.name}」さんは既に登録されています。\n同姓同名の別人として登録しますか？`)) return; }

    setLoading(true);
    const payload = {
        staff_id: staffForm.staff_id, name: staffForm.name, role: staffForm.role,
        address: staffForm.address, birth_date: staffForm.birth_date || null,
        hire_date: staffForm.hire_date || null, resignation_date: staffForm.resignation_date || null,
        is_active: staffForm.is_active
    };
    if (!editingStaff) { Object.assign(payload, { password: staffForm.password || "1234", is_initial_password: true, is_active: true }); }
    else if (staffForm.password) { Object.assign(payload, { password: staffForm.password, is_initial_password: true }); }

    if (editingStaff) await supabase.from('staff').update(payload).eq('id', editingStaff.id);
    else await supabase.from('staff').insert(payload);
    
    setIsStaffModalOpen(false); fetchStaffList(); setLoading(false);
  };

  const handleClickRetire = (staff: any) => {
      setEditingStaff(staff);
      setRetirementDate(new Date().toISOString().split('T')[0]); 
      setIsRetireModalOpen(true);
  };

  const executeRetirement = async () => {
      if(!confirm("退職処理を実行しますか？\n（この操作はシフト選択肢からの除外のみで、過去データは残ります）")) return;
      setLoading(true);
      await supabase.from('staff').update({ is_active: false, resignation_date: retirementDate }).eq('id', editingStaff.id);
      setIsRetireModalOpen(false); fetchStaffList(); setLoading(false);
  };
  
  // --- 【完全削除】物理削除の実行関数 ---
  const handlePhysicalDeleteStaff = async (id: string) => {
    if(!confirm("【警告】本当に完全に消去しますか？\n\n・このスタッフの全勤怠データ\n・全タスク実施記録\n・登録情報\n\nこれら全てがデータベースから消滅し、二度と復元できません。")) return;
    setLoading(true);
    // 関連データを先に消す（FK制約回避）
    await supabase.from('breaks').delete().eq('staff_id', id);
    await supabase.from('timecards').delete().eq('staff_id', id);
    await supabase.from('task_logs').delete().eq('staff_id', id);
    // 最後にスタッフを消す
    await supabase.from('staff').delete().eq('id', id);
    fetchStaffList(); setLoading(false);
  };
  
  const handleRestoreStaff = async (id: string) => {
    if(!confirm("このスタッフを在籍中に戻しますか？")) return;
    await supabase.from('staff').update({ is_active: true, resignation_date: null }).eq('id', id);
    fetchStaffList();
  };

  if (!staff) return null;
  const activeB = breaksList.find(b => !b.break_end_at);
  const tInfo = attendanceStatus === 'break' ? { label: "休憩中", val: `${Math.round((currentTime.getTime() - new Date(activeB?.break_start_at).getTime())/60000)}分 (累計:${calculateTotalBreak(breaksList, true)}分)`, col: "#ED8936" } : { label: "実働中", val: formatHHMM(calculateWorkMins(currCard?.clock_in_at, null, breaksList)), col: "#75C9D7" };
  const displayStaffList = showRetiredStaff ? adminStaffList : adminStaffList.filter((s:any) => s.is_active);

  return (
    <div className="min-h-screen bg-white flex flex-col md:flex-row text-black font-sans overflow-x-hidden">
      <style jsx global>{`
        header, footer { display: none !important; }
        .app-card { background: white; padding: 22px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid #edf2f7; margin-bottom: 20px; }
        .menu-item { width: 100%; text-align: left; padding: 18px 20px; border-radius: 1rem; font-weight: 900; font-size: 20px; white-space: nowrap; border-bottom: 1px solid #EDF2F7; background: transparent; color: #000000 !important; }
        .menu-item-active { background-color: #75C9D7 !important; color: white !important; border: none; }
        .menu-item-active span { color: white !important; }
        .admin-grid-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 2px; font-size: 11px; font-weight: 900; border-radius: 12px; border: none; color: white !important; cursor: pointer; }
        .staff-card { transition: all 0.2s; cursor: pointer; }
        .staff-card:hover { background-color: #f8fafc; transform: translateY(-2px); }
        .staff-card:active { transform: translateY(0); }
      `}</style>

      {isMobile && !activeTask && <button onClick={() => setSidebarOpen(true)} className="fixed top-6 left-6 z-[130] p-3 bg-white shadow-xl rounded-2xl border border-slate-100"><Menu size={24} color="#75C9D7" /></button>}

      <div className={`fixed inset-0 bg-black/40 z-[140] transition-opacity ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`fixed md:relative inset-y-0 left-0 z-[150] w-[75vw] md:w-72 bg-white border-r p-6 flex flex-col transition-transform ${sidebarOpen || !isMobile ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex justify-between items-center mb-8"><h1 className="text-2xl font-black italic text-[#75C9D7]">MENU</h1>{isMobile && <button onClick={() => setSidebarOpen(false)}><X size={28} color="#75C9D7" /></button>}</div>
        <nav className="flex-1 space-y-1">
          {["📋 本日の業務", "⚠️ 未完了タスク", "🕒 自分の履歴", "📊 監視(Admin)", "📅 出勤簿(Admin)", "👥 スタッフ管理(Admin)"].filter(x => !x.includes("Admin") || staff.role === 'admin').map(x => (
            <button key={x} onClick={() => { setMenuChoice(x); setSidebarOpen(false); localStorage.setItem('active_page', x); if(x.includes("監視")) fetchAdminMonitor(monitorDate); if(x.includes("スタッフ")) fetchStaffList(); }} className={`menu-item ${menuChoice === x ? 'menu-item-active' : ''}`}><span>{x}</span></button>
          ))}
        </nav>
        <div className="mt-auto pt-4 border-t text-center text-black"><p className="font-black text-sm mb-3">{staff.name}</p><button onClick={() => {localStorage.clear(); window.location.href='/';}} className="w-full py-3 bg-slate-50 text-[#E53E3E] font-black rounded-xl border border-slate-200">ログアウト</button></div>
      </aside>

      <main className="flex-1 p-6 md:p-10 overflow-y-auto pt-24 md:pt-10 text-black">
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
                  <div className="flex-1 pr-4 text-black"><p className="text-[10px] font-black uppercase text-[#75C9D7]">{t.task_master?.locations?.name}</p><h5 className="text-lg font-bold text-black">【{String(t.task_master?.target_hour).padStart(2,'0')}:{String(t.task_master?.target_minute || 0).padStart(2,'0')}】{t.task_master?.task_name}</h5>{t.status === 'started' && <p className="text-xs text-orange-500 font-bold mt-1">● 進行中</p>}</div>
                  {t.status === 'completed' ? <CheckCircle2 className="text-green-500" size={32} /> : <button onClick={() => handleTaskAction(t)} className={`px-8 py-4 font-black rounded-xl border-none text-white ${t.status === 'started' ? 'bg-orange-500' : 'bg-[#1a202c]'}`}>{t.status === 'started' ? '再開' : '着手'}</button>}
                </div>
              ))}
            </div>
          )}

          {menuChoice === "⚠️ 未完了タスク" && overdueTasks.map(t => (
            <div key={t.id} className="app-card border-l-8 border-red-400 flex justify-between items-center text-black">
              <div className="flex-1 text-black"><p className="text-red-500 font-black text-xs uppercase mb-1">【遅延】{String(t.task_master?.target_hour).padStart(2,'0')}:00</p><h5 className="text-lg font-bold text-black">{t.task_master?.task_name}</h5></div>
              <button onClick={() => handleTaskAction(t)} className={`px-8 py-4 font-black rounded-xl text-white border-none ${t.status === 'started' ? 'bg-orange-500' : 'bg-[#E53E3E]'}`}>{t.status === 'started' ? '再開' : '対応'}</button>
            </div>
          ))}

          {menuChoice === "🕒 自分の履歴" && personalHistory.map(r => (
            <div key={r.id} className="app-card border-l-8 border-[#75C9D7] text-black"><p className="font-black text-sm">{r.work_date} ({formatToJSTTime(r.clock_in_at)}〜{formatToJSTTime(r.clock_out_at)})</p><p className="text-xs font-bold text-slate-600 mt-1">実働: {r.work_time} / 休憩: {r.break_time}</p></div>
          ))}

          {menuChoice === "📊 監視(Admin)" && (
            <div className="space-y-6 text-black">
              <div className="app-card py-4"><input type="date" className="p-4 bg-slate-50 rounded-xl font-bold border-none w-full text-center text-black" min={minDateLimit} max={todayISO} value={monitorDate} onChange={e => {setMonitorDate(e.target.value); fetchAdminMonitor(e.target.value);}} /></div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-black text-center">
                {adminTasks.map(t => (
                  <div key={t.id} className="app-card p-3 border-b-4 border-[#75C9D7] text-black">
                    <img src={`${SUPABASE_URL}/storage/v1/object/public/task-photos/${t.photo_url}`} className="rounded-xl mb-3 aspect-square object-cover w-full shadow-sm" alt="img" />
                    <div className="text-[10px] font-black text-[#75C9D7] mb-1 line-clamp-1">{t.task_master.locations.name}</div>
                    <div className="bg-slate-50 py-1.5 rounded-lg text-[10px] font-black text-black"><UserCheck size={10} className="inline mr-1" />{t.staff?.name}</div>
                    <p className="text-[10px] text-slate-400 font-bold mt-1 italic">完了：{formatToJSTTime(t.completed_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {menuChoice === "📅 出勤簿(Admin)" && (
            <div className="space-y-6 text-black">
              <div className="app-card text-black">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5 text-black">
                  <select className="p-3 bg-slate-50 rounded-xl font-bold text-sm border-none text-black" value={filterStaffId} onChange={e => setFilterStaffId(e.target.value)}><option value="all">全員</option>{adminStaffList.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  <input type="date" className="p-3 bg-slate-50 rounded-xl border-none font-bold text-black" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} /><input type="date" className="p-3 bg-slate-50 rounded-xl border-none font-bold text-black" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-white">
                  <button onClick={generateAdminReport} className="admin-grid-btn bg-[#1a202c] text-white"><Search size={16}/>抽出</button>
                  <button onClick={downloadCSV} className="admin-grid-btn bg-[#75C9D7] text-white"><Download size={16}/>CSV</button>
                  <button onClick={() => {setEditingCard(null); setEditForm({staff_id: activeStaffList[0]?.id || "", work_date: todayISO, clock_in_time: "09:00", clock_out_time: "18:00", break_mins: "0"}); setIsEditModalOpen(true);}} className="admin-grid-btn bg-orange-400 text-white"><Plus size={16}/>追加</button>
                </div>
              </div>
              {adminReport.map(r => (<div key={r.id} className="app-card flex justify-between items-center border-l-8 border-slate-100 text-black py-4"><div className="flex-1 text-black"><p className="font-black text-sm text-black">{r.staff_name}</p><p className="text-[10px] text-slate-500">{r.work_date} (休憩:{r.break_time})</p><p className="text-xs font-bold text-[#75C9D7]">実働:{r.work_time}</p></div><div className="flex gap-1">
                <button onClick={() => handleEditClick(r)} className="p-2.5 bg-slate-50 text-slate-500 rounded-lg border-none cursor-pointer"><Edit size={14}/></button>
                <button onClick={() => { setDeleteTargetId(r.id); setDeleteReason(""); setIsDeleteModalOpen(true); }} className="p-2.5 bg-red-50 text-red-400 rounded-lg border-none cursor-pointer"><Trash2 size={14}/></button>
              </div></div>))}
            </div>
          )}

          {menuChoice === "👥 スタッフ管理(Admin)" && (
            <div className="space-y-6 text-black">
                <div className="app-card flex justify-between items-center">
                    <label className="flex items-center text-xs font-bold cursor-pointer text-slate-500"><input type="checkbox" className="mr-2 transform scale-125" checked={showRetiredStaff} onChange={e => setShowRetiredStaff(e.target.checked)} />退職者も表示</label>
                    <div className="flex gap-2">
                        <button onClick={() => { setEditingStaff(null); setStaffForm({ staff_id: "", name: "", password: "", role: "staff", address: "", birth_date: "", hire_date: "", resignation_date: "", is_active: true }); setIsStaffModalOpen(true); }} className="px-4 py-3 bg-orange-400 text-white font-black rounded-xl shadow-lg border-none text-xs"><Plus size={14} className="inline mr-1"/>新規</button>
                        <button onClick={downloadStaffCSV} className="px-4 py-3 bg-[#75C9D7] text-white font-black rounded-xl shadow-lg border-none text-xs"><Download size={14} className="inline mr-1"/>台帳</button>
                    </div>
                </div>
                {displayStaffList.map(s => (
                    <div 
                        key={s.id} 
                        className={`app-card staff-card flex justify-between items-center border-l-8 ${s.is_active ? 'border-slate-100' : 'border-slate-300 bg-slate-50'}`}
                        onClick={() => { setEditingStaff(s); setStaffForm({ ...s, password: "" }); setIsStaffModalOpen(true); }}
                    >
                        <div className="flex-1">
                            <p className="font-black text-lg">{s.name} <span className="text-xs text-slate-400 font-normal">({s.role})</span> {s.is_active ? "" : <span className="text-red-500 text-xs ml-2">● 退職済</span>}</p>
                            <p className="text-xs text-slate-500">ID: {s.staff_id}</p>
                            {s.address && <p className="text-[10px] text-slate-400 mt-1">{s.address}</p>}
                        </div>
                        <div className="flex gap-2">
                            {s.is_active ? 
                                <button onClick={(e) => { e.stopPropagation(); handleClickRetire(s); }} className="p-3 bg-red-50 text-red-400 rounded-xl border-none"><Archive size={16}/></button> :
                                <button onClick={(e) => { e.stopPropagation(); handlePhysicalDeleteStaff(s.id); }} className="p-3 bg-slate-200 text-slate-500 rounded-xl border-none"><Ban size={16}/></button>
                            }
                        </div>
                    </div>
                ))}
            </div>
          )}
        </div>
      </main>

      {activeTask && (
        <div className="fixed inset-0 bg-white z-[300] flex flex-col p-6 pt-10 overflow-y-auto text-center text-black">
          <div className="flex justify-between items-center mb-8 px-2"><button onClick={() => setActiveTask(null)} className="p-3 bg-slate-100 rounded-xl border-none text-black"><PauseCircle size={20}/></button><h2 className="text-lg font-black italic">MISSION</h2><div className="w-10"></div></div>
          {!isQrVerified ? <QrScanner onScanSuccess={onQrScan} /> : <div className="space-y-8 animate-in zoom-in duration-300 text-black"><CheckCircle2 size={64} className="text-green-500 mx-auto" /><p className="font-black text-xl text-black">{activeTask.task_master?.task_name}</p><p className="text-xs font-bold text-slate-400 text-center">担当：{staff.name}</p><label className="block w-full px-4 cursor-pointer text-black"><div className="w-full py-8 bg-[#75C9D7] text-white font-black rounded-3xl shadow-xl flex items-center justify-center gap-3 text-xl active:scale-95 transition-all"><Camera size={32}/>完了撮影</div><input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleTaskComplete} /></label></div>}
        </div>
      )}

      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[400] flex items-center justify-center p-4 backdrop-blur-sm text-black">
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl text-black">
            <h3 className="text-lg font-black mb-6 text-center text-black">勤怠修正</h3>
            <div className="space-y-4">
              <div><label className="text-[10px] font-black text-slate-400 ml-1">スタッフ</label><select className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={editForm.staff_id} onChange={e => setEditForm({...editForm, staff_id: e.target.value})} disabled={!!editingCard}>{activeStaffList.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className="text-[10px] font-black text-slate-400 ml-1 text-black">日付</label><input type="date" className="w-full p-3 bg-slate-50 rounded-xl border-none text-sm font-bold text-black" value={editForm.work_date} onChange={e => setEditForm({...editForm, work_date: e.target.value})} /></div>
              <div className="flex gap-3 text-black"><div className="flex-1"><label className="text-[10px] font-black text-slate-400 ml-1 text-black">出勤</label><input type="time" className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={editForm.clock_in_time} onChange={e => setEditForm({...editForm, clock_in_time: e.target.value})} /></div><div className="flex-1"><label className="text-[10px] font-black text-slate-400 ml-1 text-black">退勤</label><input type="time" className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={editForm.clock_out_time} onChange={e => setEditForm({...editForm, clock_out_time: e.target.value})} /></div></div>
              <div><label className="text-[10px] font-black text-slate-400 ml-1 text-black">休憩(分)</label><input type="number" className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={editForm.break_mins} onChange={e => setEditForm({...editForm, break_mins: e.target.value})} /></div>
            </div>
            <div className="flex gap-3 mt-8 text-black">
              <button onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-black rounded-xl border-none">中止</button>
              <button onClick={handleSaveRecord} className="flex-1 py-3 bg-[#75C9D7] text-white font-black rounded-xl shadow-lg border-none flex items-center justify-center gap-2">{loading ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>}保存</button>
            </div>
          </div>
        </div>
      )}

      {isStaffModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[400] flex items-center justify-center p-4 backdrop-blur-sm text-black">
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl text-black h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-black mb-6 text-center">{editingStaff ? 'スタッフ修正' : '新規採用'}</h3>
            <div className="space-y-4">
               <div><label className="text-[10px] font-black text-slate-400 ml-1">氏名</label><input className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={staffForm.name} onChange={e=>setStaffForm({...staffForm, name: e.target.value})} /></div>
               <div className="flex gap-2">
                   <div className="flex-1"><label className="text-[10px] font-black text-slate-400 ml-1">ID</label><input className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={staffForm.staff_id} onChange={e=>setStaffForm({...staffForm, staff_id: e.target.value})} /></div>
                   <div className="w-24"><label className="text-[10px] font-black text-slate-400 ml-1">権限</label><select className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={staffForm.role} onChange={e=>setStaffForm({...staffForm, role: e.target.value})}><option value="staff">一般</option><option value="admin">管理者</option></select></div>
               </div>
               <div><label className="text-[10px] font-black text-slate-400 ml-1">住所</label><input className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={staffForm.address} onChange={e=>setStaffForm({...staffForm, address: e.target.value})} /></div>
               <div className="flex gap-2">
                   <div className="flex-1"><label className="text-[10px] font-black text-slate-400 ml-1">生年月日</label><input type="date" className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={staffForm.birth_date} onChange={e=>setStaffForm({...staffForm, birth_date: e.target.value})} /></div>
                   <div className="flex-1"><label className="text-[10px] font-black text-slate-400 ml-1">入社日</label><input type="date" className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={staffForm.hire_date} onChange={e=>setStaffForm({...staffForm, hire_date: e.target.value})} /></div>
               </div>
               {!editingStaff && <div><label className="text-[10px] font-black text-slate-400 ml-1">初期パスワード</label><input className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={staffForm.password} onChange={e=>setStaffForm({...staffForm, password: e.target.value})} placeholder="1234" /></div>}
            </div>
            <div className="flex gap-3 mt-8 text-black">
              <button onClick={() => setIsStaffModalOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-black rounded-xl border-none">中止</button>
              <button onClick={handleSaveStaff} className="flex-1 py-3 bg-[#75C9D7] text-white font-black rounded-xl shadow-lg border-none flex items-center justify-center gap-2">{loading ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>}保存</button>
            </div>
          </div>
        </div>
      )}

      {isRetireModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[400] flex items-center justify-center p-4 backdrop-blur-sm text-black">
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl text-black">
            <h3 className="text-lg font-black mb-2 text-center text-red-500">退職処理</h3>
            <p className="text-xs text-center font-bold text-slate-400 mb-6">{editingStaff?.name} さんの退職日を選択してください</p>
            <div className="space-y-4">
              <div><label className="text-[10px] font-black text-slate-400 ml-1">退職日</label><input type="date" className="w-full p-3 bg-slate-50 rounded-xl border-none font-bold text-sm text-black" value={retirementDate} onChange={e => setRetirementDate(e.target.value)} /></div>
            </div>
            <div className="flex gap-3 mt-8 text-black">
              <button onClick={() => setIsRetireModalOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-black rounded-xl border-none">中止</button>
              <button onClick={executeRetirement} className="flex-1 py-3 bg-red-500 text-white font-black rounded-xl shadow-lg border-none flex items-center justify-center gap-2">{loading ? <Loader2 className="animate-spin" size={16}/> : <Archive size={16}/>}退職確定</button>
            </div>
          </div>
        </div>
      )}

      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[400] flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-white w-full max-w-sm rounded-3xl p-8 shadow-2xl text-black">
            <div className="text-center text-black"><AlertTriangle size={48} className="text-red-500 mb-4 mx-auto" /><h3 className="text-xl font-black mb-6 text-red-600">削除確認</h3></div>
            <textarea className="w-full p-4 bg-slate-50 rounded-2xl border-none font-bold text-sm mb-6 text-black" rows={3} placeholder="削除理由を入力..." value={deleteReason} onChange={(e)=>setDeleteReason(e.target.value)} />
            <div className="flex gap-3"><button onClick={()=>setIsDeleteModalOpen(false)} className="flex-1 py-4 bg-slate-100 text-slate-500 font-black rounded-2xl border-none">中止</button><button onClick={handleConfirmDelete} className="flex-1 py-4 bg-red-500 text-white font-black rounded-2xl border-none">実行</button></div>
          </div>
        </div>
      )}
    </div>
  );
}