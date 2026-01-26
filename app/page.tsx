"use client";

import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Lock, User, ArrowRight, Save, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isFirstLogin, setIsFirstLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [staffRecord, setStaffRecord] = useState<any>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('staff_id', staffId)
        .eq('password', password)
        .single();

      if (error || !data) {
        alert("IDまたはパスワードが違います。");
        setLoading(false);
        return;
      }

      if (data.is_initial_password) {
        setIsFirstLogin(true);
        setStaffRecord(data);
        setLoading(false);
      } else {
        loginSuccess(data);
      }
    } catch (err) {
      alert("ログインエラーが発生しました。");
      setLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 4) {
      alert("パスワードは4文字以上にしてください。");
      return;
    }
    setLoading(true);

    const { error } = await supabase
      .from('staff')
      .update({ password: newPassword, is_initial_password: false })
      .eq('id', staffRecord.id);

    if (error) {
      alert("更新に失敗しました。");
      setLoading(false);
    } else {
      alert("パスワードを変更しました。新しいパスワードでログインします。");
      const updatedStaff = { ...staffRecord, password: newPassword, is_initial_password: false };
      loginSuccess(updatedStaff);
    }
  };

  const loginSuccess = (staffData: any) => {
    localStorage.setItem('staff_id', staffData.staff_id);
    localStorage.setItem('session_key', staffData.session_key || 'demo-key');
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-black px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
        <div className="text-center mb-10">
          {/* 修正箇所：テキストではなくロゴ画像を表示 */}
          <img src="/logo.png" alt="BE STONE" className="w-48 mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">業務管理システム Pro</p>
        </div>

        {!isFirstLogin ? (
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-black text-slate-600 mb-2">スタッフID</label>
              <div className="relative">
                <User className="absolute left-4 top-3.5 text-slate-300" size={20} />
                <input 
                  type="text" 
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold focus:outline-none focus:border-[#75C9D7]"
                  placeholder="IDを入力"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-black text-slate-600 mb-2">パスワード</label>
              <div className="relative">
                <Lock className="absolute left-4 top-3.5 text-slate-300" size={20} />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold focus:outline-none focus:border-[#75C9D7]"
                  placeholder="パスワードを入力"
                  required
                />
              </div>
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-4 bg-[#75C9D7] text-white font-black rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              {loading ? "確認中..." : <>ログイン <ArrowRight size={20} /></>}
            </button>
          </form>
        ) : (
          <form onSubmit={handlePasswordChange} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 flex items-start gap-3">
              <AlertCircle className="text-orange-500 shrink-0" size={24} />
              <div>
                <p className="font-black text-orange-600 text-sm">初回ログインです</p>
                <p className="text-xs text-orange-400 font-bold mt-1">セキュリティのため、新しいパスワードを設定してください。</p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-black text-slate-600 mb-2">新しいパスワード</label>
              <div className="relative">
                <Lock className="absolute left-4 top-3.5 text-slate-300" size={20} />
                <input 
                  type="password" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold focus:outline-none focus:border-[#75C9D7]"
                  placeholder="4文字以上で入力"
                  minLength={4}
                  required
                />
              </div>
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-4 bg-[#1a202c] text-white font-black rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              {loading ? "更新中..." : <>変更して開始 <Save size={20} /></>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}