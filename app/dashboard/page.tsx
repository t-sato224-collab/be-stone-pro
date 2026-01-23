"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  ClipboardList, History, LogOut, Clock, 
  MapPin, CheckCircle2, PlayCircle, Camera, X, Loader2, Coffee, ArrowLeft, AlertTriangle, BarChart3, Download, Search
} from 'lucide-react';
import dynamic from 'next/dynamic';

// QRスキャナーをクライアントサイドのみで読み込む（SSRエラー防止）
const QrScanner = dynamic(() => import('../../components/QrScanner'), { ssr: false });

// Supabase URLを環境変数から取得
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

export default function DashboardPage() {
  // --- 1. 状態管理（State） ---
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
  const [adminStaffList, setAdminStaffList] = useState<any[]>([]);
  const [attendanceReport, setAttendanceReport] = useState<any[]>([]);

  // 検索・フィルタ用
  const [filterStaffId, setFilterStaffId] = useState<string>("all");
  const [filterStartDate, setFilterStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterEndDate, setFilterEndDate] = useState(new Date().toISOString().split('T')[0]);

  // --- 2. データ取得・同期関数 ---
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

  // --- 3. ライフサイクル管理 ---
  useEffect(() => {
    if (typeof window === "undefined") return;

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
          const { data: staffs } = await supabase.from('staff').select('id, name');
          if (staffs) setAdminStaffList(staffs);
        }
      } else { 
        localStorage.clear();
        window.location.href = '/'; 
      }
    };
    init();

    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    handleResize();

    const clockTimer = setInterval(() => setCurrentTime(new Date()), 1000);
    const syncTimer = setInterval(() => { if (!activeTask) fetchTasks(); }, 30000);

    return () => {
        clearInterval(clockTimer);
        clearInterval(syncTimer);
        window.removeEventListener('resize', handleResize);
    };
  }, [activeTask, fetchTasks, syncStatus]);

  // --- 4. 勤怠アクション ---
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

  // --- 5. タスク管理アクション ---
  const handleTaskAction = (task: any) => {
    setActiveTask(task);
    setIsQrVerified(false);
  };

  const handleTaskComplete = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setLoading(true);
    const file = e.target.files[0];
    const fileName = `${activeTask.id}-${Date.now()}.jpg`;
    try {
      await supabase.storage.from('task-photos').upload(fileName, file);
      await supabase.from('task_logs').update({ status: 'completed', completed_at: new Date().toISOString(), photo_url: fileName, staff_id: staff.id }).eq('id', activeTask.id);
      setActiveTask(null);
      setIsQrVerified(false);
      fetchTasks();
      alert("完了報告を送信しました。");
    } catch (err) {
      alert("エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  // --- 6. 管理者レポート機能 ---
  const generateReport = async () => {
    setLoading(true);
    let query = supabase.from('timecards').select('*, breaks(*)').gte('work_date', filterStartDate).lte('work_date', filterEndDate);
    if (filterStaffId !== "all") query = query.eq('staff_id', filterStaffId);
    
    const { data } = await query.order('work_date', { ascending: false });
    if (data) {
      const formatted = data.map((r: any) => {
        const cIn = new Date(r.clock_in_at);
        const cOut = r.clock_out_at ? new Date(r.clock_out_at) : null;
        let bMins = 0;
        r.breaks?.forEach((b: any) => {
          if (b.break_start_at && b.break_end_at) {
            bMins += Math.floor((new Date(b.break_end_at).getTime() - new Date(b.break_start_at).getTime()) / 60000);
          }
        });
        let workTime = "---";
        let rawMins = 0;
        if (cOut) {
          rawMins = Math.floor((cOut.getTime() - cIn.getTime()) / 60000) - bMins;
          const h = Math.floor(rawMins / 60); const m = rawMins % 60;
          workTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
        return { ...r, break_mins: bMins, work_time: workTime, raw_mins: rawMins };
      });
      setAttendanceReport(formatted);
    }
    setLoading(false);
  };

  const downloadCSV = () => {
    const headers = "名前,日付,出勤,退勤,休憩(分),実働(00:00)\n";
    const rows = attendanceReport.map(r => 
      `${r.staff_name},${r.work_date},${r.clock_in_at.substring(11,16)},${r.clock_out_at?.substring(11,16) || "未"},${r.break_mins},${r.work_time}`
    ).join("\n");
    const blob = new Blob(["\uFEFF" + headers + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `BE_STONE_Attendance_${filterStartDate}.csv`;
    link.click();
  };

  if (!staff) return null;
  const currentHour = currentTime.getHours();

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col md:flex-row text-black font-sans">
      {/* 究極のデザイン強制適用CSS */}
      <style jsx global>{`
        header, footer { display: none !important; }
        :root { color-scheme: light !important; }
        section[data-testid="stSidebar"] { width: 75vw !important; border-right: 1px solid #eee; }
        .app-card { background: white; padding: 25px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.04); border: 1px solid #edf2f7; margin-bottom: 20px; }
        
        /* 漆黒文字とブランドカラー */
        p, h1, h2, h3, h4, h5, span, label, td, th { color: #000000 !important; font-style: normal !important; }
        .brand-turquoise { color: #75C9D7 !important; }

        /* ボタン黒靄除去 & 白文字固定 */
        button {
          background-color: #75C9D7 !important;
          color: #FFFFFF !important;
          border-radius: 12px !important;
          font-weight: 900 !important;
          border: none !important;
          box-shadow: none !important;
          opacity: 1 !important;
        }
        
        /* 着手ボタン：絶対的視認性（濃紺） */
        .btn-dark { background-color: #1a202c !important; color: white !important; }
      `}</style>

      {/* 業務遂行オーバーレイ */}
      {isMobile && activeTask && attendanceStatus === 'working' && menuChoice === "📋 本日の業務" && (
        <div className="fixed inset-0 bg-white z-[200] flex flex-col p-6 pt-12 overflow-y-auto">
          <div className="flex items-center gap-4 mb-8">
            <button onClick={() => setActiveTask(null)} className="p-3 bg-slate-100 rounded-2xl"><ArrowLeft size={24} color="black"/></button>
            <h2 className="text-xl font-black">業務遂行中</h2>
          </div>
          <div className="app-card border-2 border-[#75C9D7]">
            <p className="text-[10px] brand-turquoise font-black uppercase mb-1">{activeTask.task_master?.locations?.name}</p>
            <h3 className="text-2xl font-bold">{activeTask.task_master?.task_name}</h3>
          </div>
          {!isQrVerified ? (
            <div className="w-full text-center">
              <p className="text-slate-500 font-bold mb-6 italic">STEP 1: 現場QRをスキャン</p>
              <QrScanner onScanSuccess={(txt) => { if(txt === activeTask.task_master?.locations?.qr_token) setIsQrVerified(true); else alert("場所が違います"); }} />
            </div>
          ) : (
            <div className="text-center space-y-10">
              <CheckCircle2 size={80} className="text-green-500 mx-auto" />
              <label className="block w-full">
                <div className="w-full py-8 bg-[#75C9D7] text-white font-black rounded-[2.5rem] shadow-xl flex items-center justify-center gap-4 text-2xl active:scale-95 transition-all">
                  {loading ? <Loader2 className="animate-spin text-white" /> : <Camera size={40} color="white"/>}
                  <span style={{color: 'white !important'}}>完了写真を撮影</span>
                </div>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleTaskComplete} disabled={loading} />
              </label>
            </div>
          )}
        </div>
      )}

      {/* サイドバー */}
      <aside className="w-full md:w-80 bg-white border-r border-slate-100 flex flex-col p-8 shadow-sm">
        <h1 className="text-4xl font-black brand-turquoise tracking-tighter mb-10 italic">BE STONE</h1>
        <nav className="flex-1 space-y-2">
          {[
            { label: "📋 本日の業務", role: 'staff' },
            { label: "⚠️ 未完了タスク", role: 'staff' },
            { label: "🕒 履歴", role: 'staff' },
            { label: "📊 監視(Admin)", role: 'admin' },
            { label: "📅 出勤簿(Admin)", role: 'admin' },
          ].filter(item => item.role === 'staff' || staff.role === 'admin').map((item) => (
            <button 
              key={item.label}
              onClick={() => { setMenuChoice(item.label); localStorage.setItem('active_page', item.label); }}
              className={`w-full text-left px-6 py-6 rounded-[1rem] font-black text-2xl transition-all border-b border-slate-50 ${menuChoice === item.label ? 'bg-[#75C9D7] text-white shadow-md' : 'text-black hover:bg-slate-50'}`}
            >
              <span style={{ color: menuChoice === item.label ? 'white' : 'black' }}>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-10 pt-8 border-t border-slate-100 text-center">
            <p className="font-black text-slate-800 text-lg mb-4">{staff.name} 様</p>
            <button onClick={() => {localStorage.clear(); window.location.href='/';}} className="w-full py-5 bg-[#f8f9fa] text-[#2c3e50] font-black rounded-2xl shadow-sm">ログアウト</button>
        </div>
      </aside>

      {/* メインエリア */}
      <main className="flex-1 p-6 md:p-12 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full">
            <div className="flex justify-between items-center mb-10">
                <h2 className="text-4xl font-black brand-turquoise">BE STONE</h2>
                <div className="bg-white px-6 py-3 rounded-2xl shadow-sm border flex items-center gap-4 font-black text-slate-600">
                    <Clock size={20} className="text-[#75C9D7]"/>
                    {currentTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>

            {menuChoice === "📋 本日の業務" && (
                <div className="space-y-8 animate-in fade-in duration-500">
                    <div className="app-card border-l-8 border-[#75C9D7]">
                        <h3 className="text-xs font-black text-slate-400 uppercase mb-6 tracking-widest">TIME CARD</h3>
                        {attendanceStatus === 'offline' ? (
                            <button onClick={handleClockIn} className="w-full py-6 bg-[#75C9D7] text-white font-black rounded-3xl text-xl shadow-lg">🚀 業務開始 (出勤)</button>
                        ) : (
                            <div className="flex flex-col gap-4">
                                <div className="flex gap-4">
                                    <button onClick={handleBreak} className={`flex-1 py-6 ${attendanceStatus === 'break' ? 'bg-orange-400' : 'bg-[#1a202c]'} text-white font-black rounded-3xl text-xl flex items-center justify-center gap-3`}>
                                        {attendanceStatus === 'break' ? <PlayCircle/> : <Coffee/>}
                                        <span style={{color: 'white'}}>{attendanceStatus === 'break' ? '業務復帰' : '休憩入り'}</span>
                                    </button>
                                    <button onClick={handleClockOut} className="flex-1 py-6 bg-white border-2 border-slate-200 text-slate-400 font-black rounded-3xl text-xl">退勤打刻</button>
                                </div>
                                <p className="text-center font-bold text-slate-400">出勤：{currCard?.clock_in_at?.substring(11,16)}</p>
                            </div>
                        )}
                    </div>

                    {/* 出勤中のみタスクを表示 */}
                    {attendanceStatus !== 'offline' ? (
                      <div className="space-y-4">
                        <p className="font-black text-slate-400 px-4 uppercase">Target Tasks ({currentHour}時台)</p>
                        {tasks.filter(t => t.task_master?.target_hour === currentHour).map(t => (
                            <div key={t.id} className="app-card flex justify-between items-center border-l-8 border-[#75C9D7]">
                                <div className="flex-1 pr-4">
                                    <p className="text-[10px] brand-turquoise font-black uppercase mb-1">{t.task_master?.locations?.name}</p>
                                    <h5 className="text-xl font-bold">{t.task_master?.task_name}</h5>
                                </div>
                                {t.status === 'completed' ? <CheckCircle2 className="text-green-500" size={40} /> : 
                                <button onClick={() => handleTaskAction(t)} disabled={attendanceStatus !== 'working'} className="px-10 py-5 btn-dark text-white font-black rounded-2xl shadow-xl active:scale-95 transition-all text-lg">着手</button>}
                            </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-20 text-center text-slate-300 font-bold border-2 border-dashed rounded-[3rem]">出勤打刻をすると本日のタスクが表示されます</div>
                    )}
                </div>
            )}

            {menuChoice === "⚠️ 未完了タスク" && (
                <div className="space-y-4">
                    {tasks.filter(t => (t.task_master?.target_hour || 0) < currentHour && t.status !== 'completed').map(t => (
                        <div key={t.id} className="app-card border-l-8 border-red-400 flex justify-between items-center">
                            <div className="flex-1 pr-4">
                                <p className="text-red-500 font-black text-xs uppercase mb-1">【遅延】{t.task_master?.target_hour}:00</p>
                                <h5 className="text-xl font-bold">{t.task_master?.task_name}</h5>
                            </div>
                            <button onClick={() => handleTaskAction(t)} className="px-8 py-5 bg-red-500 text-white font-black rounded-2xl shadow-lg">リカバリー</button>
                        </div>
                    ))}
                </div>
            )}

            {menuChoice === "🕒 履歴" && (
                <div className="space-y-4">
                    <p className="text-slate-400 font-bold px-4">最近の完了タスク</p>
                    {tasks.filter(t => t.status === 'completed').reverse().map(t => (
                        <div key={t.id} className="app-card flex items-center gap-6">
                             <img src={`${SUPABASE_URL}/storage/v1/object/public/task-photos/${t.photo_url}`} className="w-20 h-20 rounded-xl object-cover" alt="完了写真" />
                             <div>
                                <p className="text-xs text-slate-400">{t.completed_at?.substring(11, 16)} 完了</p>
                                <h5 className="font-bold">{t.task_master.task_name}</h5>
                             </div>
                        </div>
                    ))}
                </div>
            )}

            {menuChoice === "📊 監視(Admin)" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {tasks.filter(t => t.status === 'completed').reverse().map(t => (
                        <div key={t.id} className="app-card p-4 text-center">
                            <img src={`${SUPABASE_URL}/storage/v1/object/public/task-photos/${t.photo_url}`} className="rounded-2xl mb-4 aspect-square object-cover w-full shadow-sm" alt="報告写真" />
                            <p className="text-sm font-black mb-1">{t.task_master.locations.name}</p>
                            <p className="text-[10px] text-slate-400 font-bold">{t.completed_at?.substring(11, 16)} 完了</p>
                        </div>
                    ))}
                </div>
            )}

            {menuChoice === "📅 出勤簿(Admin)" && (
                <div className="space-y-6">
                    <div className="app-card">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <select className="p-3 bg-slate-50 rounded-xl border-none font-bold" onChange={(e) => setFilterStaffId(e.target.value)}>
                                <option value="all">全員を表示</option>
                                {adminStaffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            <input type="date" className="p-3 bg-slate-50 rounded-xl border-none font-bold" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} />
                            <input type="date" className="p-3 bg-slate-50 rounded-xl border-none font-bold" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} />
                        </div>
                        <div className="flex gap-4">
                            <button onClick={generateReport} className="flex-1 py-4 btn-dark text-white font-black rounded-2xl flex items-center justify-center gap-2"><Search size={20}/> 抽出実行</button>
                            <button onClick={downloadCSV} className="flex-1 py-4 bg-green-500 text-white font-black rounded-2xl flex items-center justify-center gap-2 shadow-lg"><Download size={20}/> CSV出力</button>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-slate-100">
                                    <th className="py-4 font-black">名前</th>
                                    <th className="py-4 font-black">日付</th>
                                    <th className="py-4 font-black">出勤</th>
                                    <th className="py-4 font-black">退勤</th>
                                    <th className="py-4 font-black">実働</th>
                                </tr>
                            </thead>
                            <tbody>
                                {attendanceReport.map(r => (
                                    <tr key={r.id} className="border-b border-slate-50">
                                        <td className="py-4 font-bold">{r.staff_name}</td>
                                        <td className="py-4 text-slate-400 text-xs">{r.work_date}</td>
                                        <td className="py-4">{r.clock_in_at.substring(11,16)}</td>
                                        <td className="py-4">{r.clock_out_at?.substring(11,16) || "---"}</td>
                                        <td className={`py-4 font-black text-right text-lg ${r.raw_mins >= 420 ? 'text-red-500' : 'text-slate-700'}`}>{r.work_time}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
      </main>
    </div>
  );
}