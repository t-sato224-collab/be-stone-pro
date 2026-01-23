// components/QrScanner.tsx
"use client";

import { useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface QrScannerProps {
  onScanSuccess: (decodedText: string) => void;
}

export default function QrScanner({ onScanSuccess }: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    // 1. スキャナーの初期化
    const html5QrCode = new Html5Qrcode("reader");
    scannerRef.current = html5QrCode;

    const config = { 
      fps: 10, 
      qrbox: { width: 250, height: 250 }
    };

    // 2. 背面カメラで自動起動を試みる
    html5QrCode.start(
      { facingMode: "environment" }, // 外側カメラを指定
      config,
      (decodedText) => {
        // 成功時
        html5QrCode.stop().then(() => {
          onScanSuccess(decodedText);
        });
      },
      () => { /* エラー（スキャン中）は無視 */ }
    ).catch(err => {
      console.error("カメラの起動に失敗しました", err);
    });

    // 3. 終了時のクリーンアップ
    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(e => console.error(e));
      }
    };
  }, [onScanSuccess]);

  return (
    <div className="relative w-full max-w-[300px] mx-auto overflow-hidden rounded-[2rem] border-4 border-[#75C9D7] shadow-2xl">
      {/* 読み取り枠のオーバーレイ（BE STONE スタイル） */}
      <div className="absolute inset-0 z-10 pointer-events-none border-[40px] border-black/30"></div>
      <div id="reader" className="w-full bg-black h-[300px]"></div>
    </div>
  );
}