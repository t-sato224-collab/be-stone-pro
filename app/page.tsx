"use client";

import React, { useState } from 'react';
import { Lock, User, ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase'; // @/ はプロジェクトのルートを指します
import { v4 as uuidv4 } from 'uuid';

export default function LoginPage() {
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // 1. staffテーブルから該当ユーザーを検索
      const { data: staff, error: fetchError } = await supabase
        .from('staff')
        .select('*')
        .eq('staff_id', staffId)
        .eq('password', password)
        .single();

      if (fetchError || !staff) {
        throw new Error("IDまたはパスワードが正しくありません");
      }

      // 2. セッションキー（許可証）の発行
      const newSessionKey = uuidv4();
      const { error: updateError } = await supabase
        .from('staff')
        .update({ session_key: newSessionKey })
        .eq('id', staff.id);

      if (updateError) throw new Error("セッションの更新に失敗しました");

      // 3. ブラウザの記憶（LocalStorage）に保存
      localStorage.setItem('staff_id', staffId);
      localStorage.setItem('session_key', newSessionKey);

      // 4. 【核心】ダッシュボード画面へジャンプ
      window.location.href = '/dashboard';

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-4 text-black">
      <div className="mb-10 text-center">
        <h1 className="text-5xl font-black text-[#75C9D7] tracking-tighter mb-1">BE STONE</h1>
        <p className="text-gray-400 text-xs tracking-[0.4em] font-bold uppercase">Operation Management</p>
      </div>

      <div className="w-full max-w-[380px] bg-white rounded-[2.5rem] shadow-xl shadow-blue-900/5 p-10 border border-gray-100">
        <h2 className="text-2xl font-bold text-center text-gray-800 mb-8">Login</h2>
        
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="relative">
            <User className="absolute left-4 top-3.5 text-gray-400" size={20} />
            <input 
              type="text" 
              placeholder="STAFF ID" 
              required
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-[#75C9D7] outline-none"
            />
          </div>
          
          <div className="relative">
            <Lock className="absolute left-4 top-3.5 text-gray-400" size={20} />
            <input 
              type="password" 
              placeholder="PASSWORD" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-[#75C9D7] outline-none"
            />
          </div>

          {error && <p className="text-red-500 text-sm text-center font-bold">{error}</p>}

          <button 
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-[#75C9D7] hover:bg-[#5BAEB8] disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : "SIGN IN"}
            {!loading && <ArrowRight size={20} />}
          </button>
        </form>
      </div>
      <p className="mt-8 text-gray-400 text-sm">© 2026 BE STONE Pro</p>
    </div>
  );
}