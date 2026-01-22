"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  ClipboardList, History, LogOut, Clock, 
  MapPin, CheckCircle2, PlayCircle, Camera, X, Loader2, Coffee, ArrowLeft
} from 'lucide-react';
import dynamic from 'next/dynamic';

// QRスキャナーをクライアントサイドのみで読み込む設定（エラー対策）
const QrScanner = dynamic(() => import('../../components/QrScanner'), { ssr: false });

export default function DashboardPage() {
  const [staff, setStaff] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [attendanceStatus, setAttendanceStatus] = useState<'offline' | 'working' | 'break'>('offline');
  const [activeTask, setActiveTask] = useState<any>(null);
  const [isQrVerified, setIsQrVerified] = useState(false);
  const [loading, setLoading] = useState(false);

  // 1. ログイン確認と基本データ取得
  const fetchTasks = useCallback(async () => {
    const today = new Date().toLocaleDateString('sv-SE');
    const { data, error } = await supabase
      .from('task_logs')
      .select('*, task_master(*, locations(*))')
      .eq('work_date', today);
    
    if (data) {
      setTasks(data.sort((a: any, b: any) => 
        (a.task_master?.target_hour || 0) - (b.task_master?.target_hour || 0)
      ));
    }
  }, []);

  const syncStatus = useCallback(async (staffId: string) => {
    const { data: tc } = await supabase.from('timecards')
      .select('*').eq('staff_id', staffId).is('clock_out_at', null)
      .order('clock_in_at', { ascending: false }).limit(1).maybeSingle();
    
    if (tc) {
      const { data: br } = await supabase.from('breaks')
        .select('*').eq('staff_id', staffId).is('break_end_at', null).maybeSingle();
      setAttendanceStatus(br ? 'break' : 'working');
    } else {
      setAttendanceStatus('offline');
    }
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const init = async () => {
      if (typeof window === 'undefined') return;
      const savedId = localStorage.getItem('staff_id');
      const savedKey = localStorage.getItem('session_key');

      if (!savedId || !savedKey) {
        window.location.href = '/';
        return;
      }

      const { data: staffData } = await supabase.from('staff')
        .select('*').eq('staff_id', savedId).eq('session_key', savedKey).single();

      if (staffData) {
        setStaff(staffData);
        syncStatus(staffData.id);
      } else {
        localStorage.clear();
        window.location.href = '/';
      }
    };
    init();
    setCurrentTime(new Date());
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [syncStatus]);

  // 2. 打刻アクション
  const handleClockIn = async () => {
    if (!staff) return;
    setLoading(true);
    await supabase.from('timecards').insert({
      staff_id: staff.id,
      staff_name: staff.name,
      clock_in_at: new Date().toISOString(),
      work_date: new Date().toLocaleDateString('sv-SE')
    });
    await syncStatus(staff.id);
    setLoading(false);
  };

  const handleClockOut = async () => {
    if (!staff || !confirm("退勤しますか？")) return;
    setLoading(true);
    await supabase.from('timecards').update({ clock_out_at: new Date().toISOString() })
      .eq('staff_id', staff.id).is('clock_out_at', null);
    await syncStatus(staff.id);
    setLoading(false);
  };

  const handleBreak = async () => {
    if (!staff) return;
    setLoading(true);
    if (attendanceStatus === 'working') {
      await supabase.from('breaks').insert({
        staff_id: staff.id,
        break_start_at: new Date().toISOString(),
        work_date: new Date().toLocaleDateString('sv-SE')
      });
    } else {
      await supabase.from('breaks').update({ break_end_at: new Date().toISOString() })
        .eq('staff_id', staff.id).is('break_end_at', null);
    }
    await syncStatus(staff.id);
    setLoading(false);
  };

  // 3. タスク完了（写真）
  const handleTaskComplete = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !activeTask) return;
    setLoading(true);
    const file = e.target.files[0];
    const fileName = `${activeTask.id}-${Date.now()}.jpg`;

    try {
      await supabase.storage.from('task-photos').upload(fileName, file);
      await supabase.from('task_logs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        photo_url: fileName,
        staff_id: staff.id
      }).eq('id', activeTask.id);
      
      setActiveTask(null);
      setIsQrVerified(false);
      fetchTasks();
      alert("完了報告を送信しました");
    } catch (err) {
      alert("エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  if (!staff || !currentTime) return null;

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col md:flex-row text-slate-800">
      
      {/* 業務遂行モード（全画面） */}
      {activeTask && (
        <div className="fixed inset-0 bg-white z-[200] flex flex-col p-6 overflow-y-auto">
          <div className="flex items-center gap-4 mb-8">
            <button onClick={() => {setActiveTask(null); setIsQrVerified(false);}} className="p-3 bg-slate-100 rounded-2xl"><ArrowLeft size={24}/></button>
            <h2 className="text-xl font-black">業務遂行中</h2>
          </div>

          <div className="bg-white border-2 border-[#75C9D7] rounded-[2.5rem] p-8 mb-8 shadow-xl shadow-cyan-100">
            <p className="text-[10px] text-[#75C9D7] font-black uppercase tracking-widest mb-2">{activeTask.task_master?.locations?.name}</p>
            <h3 className="text-2xl font-bold">{activeTask.task_master?.task_name}</h3>
          </div>

          {!isQrVerified ? (
            <div className="w-full text-center">
              <p className="text-slate-400 font-bold mb-6 italic">STEP 1: 現場QRをスキャン</p>
              <QrScanner 
                onScanSuccess={(txt) => {
                  if(txt === activeTask.task_master?.locations?.qr_token) setIsQrVerified(true);
                  else alert("場所が違います。正しいQRをスキャンしてください。");
                }} 
              />
            </div>
          ) : (
            <div className="w-full text-center space-y-10 py-10">
              <CheckCircle2 size={80} className="text-green-500 mx-auto animate-bounce" />
              <div className="space-y-2">
                <p className="text-3xl font-black">QR認証完了</p>
                <p className="text-slate-400 font-bold">清掃後の写真を撮影してください</p>
              </div>
              <label className="block w-full">
                <div className="w-full py-8 bg-[#75C9D7] text-white font-black rounded-[2.5rem] shadow-2xl flex items-center justify-center gap-4 text-2xl active:scale-95 transition-all">
                  {loading ? <Loader2 className="animate-spin" size={32}/> : <Camera size={40}/>}
                  {loading ? "送信中..." : "カメラを起動"}
                </div>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleTaskComplete} disabled={loading} />
              </label>
            </div>
          )}
        </div>
      )}

      {/* サイドバー */}
      <aside className="w-full md:w-72 bg-white border-r border-slate-100 flex flex-col p-8">
        <h1 className="text-4xl font-black text-[#75C9D7] tracking-tighter mb-12">BE STONE</h1>
        <nav className="flex-1 space-y-4">
          <div className="flex items-center gap-4 px-6 py-4 bg-[#75C9D7] text-white rounded-[2rem] font-black shadow-lg">
            <ClipboardList size={24}/> 本日の業務
          </div>
          <div className="flex items-center gap-4 px-6 py-4 text-slate-300 rounded-[2rem] font-bold">
            <History size={24}/> 履歴 (準備中)
          </div>
        </nav>
        <div className="mt-auto pt-8 border-t border-slate-50 text-center">
            <p className="font-black text-slate-700 mb-4">{staff.name} 様</p>
            <button onClick={() => {localStorage.clear(); window.location.href='/';}} className="w-full py-4 text-red-400 font-bold hover:bg-red-50 rounded-2xl transition-all">
              ログアウト
            </button>
        </div>
      </aside>

      {/* メイン */}
      <main className="flex-1 p-6 md:p-12 overflow-y-auto">
        <header className="flex justify-between items-center mb-12">
          <h2 className="text-3xl font-black text-slate-800">業務管理</h2>
          <div className="bg-white px-6 py-3 rounded-2xl shadow-lg flex items-center gap-4 font-black text-slate-500 border border-slate-50">
            <Clock size={20} className="text-[#75C9D7]"/>
            {currentTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </header>

        {/* 勤怠管理 */}
        <div className="app-card mb-12">
          <div className="flex gap-4">
            {attendanceStatus === 'offline' ? (
              <button onClick={handleClockIn} disabled={loading} className="flex-1 py-6 bg-[#75C9D7] text-white font-black rounded-[2rem] text-xl shadow-xl active:scale-95 transition-all">
                🚀 出勤する
              </button>
            ) : (
              <>
                <button onClick={handleBreak} disabled={loading} className={`flex-1 py-6 ${attendanceStatus === 'break' ? 'bg-orange-400' : 'bg-slate-800'} text-white font-black rounded-[2rem] text-lg flex items-center justify-center gap-3 active:scale-95 transition-all`}>
                  {attendanceStatus === 'break' ? <PlayCircle/> : <Coffee/>}
                  {attendanceStatus === 'break' ? '業務に戻る' : '休憩入り'}
                </button>
                <button onClick={handleClockOut} disabled={loading} className="flex-1 py-6 bg-white border-2 border-slate-100 text-slate-400 font-black rounded-[2rem] text-lg">
                  退勤
                </button>
              </>
            )}
          </div>
        </div>

        {/* タスクリスト */}
        <div className="space-y-6">
          <h3 className="text-xl font-black text-slate-400 uppercase tracking-widest px-4">Current Tasks</h3>
          {tasks.filter(t => t.status !== 'completed').length === 0 ? (
            <div className="p-20 text-center text-slate-300 font-bold bg-white rounded-[3rem] border-2 border-dashed border-slate-100">タスクはありません</div>
          ) : (
            tasks.filter(t => t.status !== 'completed').map((task) => (
              <div key={task.id} className="p-8 bg-white rounded-[2.5rem] shadow-xl flex flex-col md:flex-row justify-between items-center gap-6 border-2 border-transparent hover:border-[#75C9D7] transition-all">
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 bg-cyan-50 text-[#75C9D7] rounded-[1.5rem] flex items-center justify-center"><MapPin size={32}/></div>
                  <div>
                    <p className="text-[10px] text-[#75C9D7] font-black uppercase tracking-widest mb-1">{task.task_master?.locations?.name}</p>
                    <h4 className="text-xl font-bold text-slate-700">{task.task_master?.task_name}</h4>
                  </div>
                </div>
                <button 
                  onClick={() => { setActiveTask(task); setIsQrVerified(false); }}
                  disabled={attendanceStatus !== 'working'}
                  className="w-full md:w-auto px-12 py-5 bg-slate-800 disabled:bg-slate-50 disabled:text-slate-200 text-white font-black rounded-2xl shadow-lg text-lg"
                >
                  着手
                </button>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}