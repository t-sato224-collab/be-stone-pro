"use client";

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  ClipboardList, History, LogOut, Clock, 
  MapPin, CheckCircle2, PlayCircle, Camera, X, Loader2, Coffee, ArrowLeft
} from 'lucide-react';
import QrScanner from '../../components/QrScanner';

export default function DashboardPage() {
  const [staff, setStaff] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [attendanceStatus, setAttendanceStatus] = useState<'offline' | 'working' | 'break'>('offline');
  const [activeTask, setActiveTask] = useState<any>(null);
  const [isQrVerified, setIsQrVerified] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const init = async () => {
      const savedId = localStorage.getItem('staff_id');
      const { data: staffData } = await supabase.from('staff').select('*').eq('staff_id', savedId).single();
      if (staffData) {
        setStaff(staffData);
        // 出勤状況の復元
        const { data: tc } = await supabase.from('timecards').select('*').eq('staff_id', staffData.id).is('clock_out_at', null).maybeSingle();
        if (tc) {
          const { data: br } = await supabase.from('breaks').select('*').eq('staff_id', staffData.id).is('break_end_at', null).maybeSingle();
          setAttendanceStatus(br ? 'break' : 'working');
        }
      }
    };
    init();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { if (staff) fetchTasks(); }, [staff]);

  const fetchTasks = async () => {
    const today = new Date().toLocaleDateString('sv-SE');
    const { data } = await supabase.from('task_logs').select('*, task_master(*, locations(*))').eq('work_date', today);
    if (data) setTasks(data.sort((a,b) => a.task_master.target_hour - b.task_master.target_hour));
  };

  const handleClockIn = async () => {
    await supabase.from('timecards').insert({ staff_id: staff.id, staff_name: staff.name, clock_in_at: new Date().toISOString(), work_date: new Date().toLocaleDateString('sv-SE') });
    setAttendanceStatus('working');
  };

  const handleBreak = async () => {
    if (attendanceStatus === 'working') {
      await supabase.from('breaks').insert({ staff_id: staff.id, break_start_at: new Date().toISOString(), work_date: new Date().toLocaleDateString('sv-SE') });
      setAttendanceStatus('break');
    } else {
      await supabase.from('breaks').update({ break_end_at: new Date().toISOString() }).eq('staff_id', staff.id).is('break_end_at', null);
      setAttendanceStatus('working');
    }
  };

  const handleTaskComplete = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setLoading(true);
    const file = e.target.files[0];
    const fileName = `${activeTask.id}-${Date.now()}.jpg`;
    await supabase.storage.from('task-photos').upload(fileName, file);
    await supabase.from('task_logs').update({ status: 'completed', completed_at: new Date().toISOString(), photo_url: fileName }).eq('id', activeTask.id);
    setActiveTask(null);
    setIsQrVerified(false);
    setLoading(false);
    fetchTasks();
  };

  if (!staff) return <div className="h-screen flex items-center justify-center bg-white text-cyan-500 font-bold animate-pulse text-2xl">BE STONE...</div>;

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col md:flex-row text-slate-800">
      
      {/* 業務遂行モード（全画面オーバーレイ） */}
      {activeTask && (
        <div className="fixed inset-0 bg-white z-[100] flex flex-col p-6 overflow-y-auto text-black">
          <div className="flex items-center gap-4 mb-8">
            <button onClick={() => {setActiveTask(null); setIsQrVerified(false);}} className="p-3 bg-slate-100 rounded-2xl"><ArrowLeft size={24}/></button>
            <h2 className="text-xl font-black">業務遂行中</h2>
          </div>

          <div className="bg-white border-2 border-[#75C9D7] rounded-[2.5rem] p-8 mb-8 shadow-xl shadow-cyan-100">
            <p className="text-[10px] text-[#75C9D7] font-black uppercase tracking-widest mb-2">{activeTask.task_master.locations.name}</p>
            <h3 className="text-2xl font-bold">{activeTask.task_master.task_name}</h3>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center">
            {!isQrVerified ? (
              <div className="w-full text-center">
                <p className="text-slate-400 font-bold mb-6">STEP 1: 現場のQRコードをスキャン</p>
                <QrScanner onScanSuccess={(txt) => {
                  if(txt === activeTask.task_master.locations.qr_token) {
                    setIsQrVerified(true);
                  } else {
                    alert("場所が違います。正しい位置でスキャンしてください。");
                  }
                }} />
              </div>
            ) : (
              <div className="w-full text-center space-y-8 animate-in zoom-in-95 duration-300">
                <div className="w-24 h-24 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 size={48}/></div>
                <div>
                  <p className="text-2xl font-black mb-2">認証完了！</p>
                  <p className="text-slate-400 font-medium">作業が終わったら、完了写真を撮影してください。</p>
                </div>
                <label className="block">
                  <div className="w-full py-6 bg-[#75C9D7] text-white font-black rounded-[2rem] shadow-2xl flex items-center justify-center gap-4 text-xl active:scale-95 transition-all">
                    {loading ? <Loader2 className="animate-spin"/> : <Camera size={32}/>}
                    {loading ? "送信中..." : "カメラを起動する"}
                  </div>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleTaskComplete} disabled={loading} />
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {/* サイドバー */}
      <aside className="w-full md:w-72 bg-white border-r border-slate-100 flex flex-col p-8">
        <h1 className="text-3xl font-black text-[#75C9D7] tracking-tighter mb-12">BE STONE</h1>
        <nav className="flex-1 space-y-4">
          <button className="w-full flex items-center gap-4 px-6 py-4 bg-[#75C9D7] text-white rounded-[2rem] font-bold shadow-lg shadow-cyan-200">
            <ClipboardList size={24}/> 本日の業務
          </button>
          <button className="w-full flex items-center gap-4 px-6 py-4 text-slate-400 hover:bg-slate-50 rounded-[2rem] font-bold transition-all">
            <History size={24}/> 履歴
          </button>
        </nav>
        <div className="mt-auto pt-8 border-t border-slate-50 text-center">
            <p className="text-lg font-black text-slate-700 mb-6">{staff.name} 様</p>
            <button onClick={() => {localStorage.clear(); window.location.href='/';}} className="w-full py-4 text-red-400 font-bold rounded-2xl flex items-center justify-center gap-2">
                <LogOut size={20}/> EXIT
            </button>
        </div>
      </aside>

      {/* メイン */}
      <main className="flex-1 p-6 md:p-12">
        <div className="flex justify-between items-center mb-12">
          <h2 className="text-3xl font-bold">Dashboard</h2>
          <div className="bg-white px-6 py-3 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3 font-black text-slate-500">
            <Clock size={20} className="text-[#75C9D7]"/>
            {currentTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        {/* タイムカード & 休憩 */}
        <div className="bg-white rounded-[3rem] p-10 shadow-xl shadow-slate-200/50 border border-slate-50 mb-12">
          <div className="flex gap-4">
            {attendanceStatus === 'offline' ? (
              <button onClick={handleClockIn} className="flex-1 py-6 bg-[#75C9D7] text-white font-black rounded-[2rem] text-xl shadow-lg shadow-cyan-200 active:scale-95 transition-all">🚀 出勤</button>
            ) : (
              <>
                <button onClick={handleBreak} className={`flex-1 py-6 ${attendanceStatus === 'break' ? 'bg-orange-400' : 'bg-[#2c3e50]'} text-white font-black rounded-[2rem] text-xl flex items-center justify-center gap-3 transition-all`}>
                  {attendanceStatus === 'break' ? <PlayCircle/> : <Coffee/>}
                  {attendanceStatus === 'break' ? '業務復帰' : '休憩入り'}
                </button>
                <button className="flex-1 py-6 bg-slate-100 text-slate-400 font-black rounded-[2rem] text-xl">退勤</button>
              </>
            )}
          </div>
        </div>

        {/* タスクリスト */}
        <div className="space-y-6">
          <h3 className="text-xl font-bold flex items-center gap-3"><PlayCircle className="text-[#75C9D7]"/> 今やるべきタスク</h3>
          {tasks.filter(t => t.status !== 'completed').map((task) => (
            <div key={task.id} className="p-8 bg-white rounded-[2.5rem] shadow-md flex justify-between items-center border border-transparent hover:border-[#75C9D7] transition-all">
              <div className="flex items-center gap-6">
                <div className="w-14 h-14 bg-cyan-50 text-[#75C9D7] rounded-2xl flex items-center justify-center"><MapPin size={28}/></div>
                <div>
                  <p className="text-xs text-[#75C9D7] font-black uppercase">{task.task_master.locations.name}</p>
                  <h4 className="text-lg font-bold">{task.task_master.task_name}</h4>
                </div>
              </div>
              <button 
                onClick={() => { setActiveTask(task); setIsQrVerified(false); }}
                className="px-10 py-4 bg-[#2c3e50] text-white font-black rounded-2xl hover:bg-[#75C9D7] transition-all"
              >
                着手
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}