// components/QrScanner.tsx
"use client";

import { useEffect } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

export default function QrScanner({ onScanSuccess }: { onScanSuccess: (text: string) => void }) {
  useEffect(() => {
    // 確実にDOMが生成されてから初期化する
    const config = { 
      fps: 10, 
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0,
      showTorchButtonIfSupported: true
    };
    
    const scanner = new Html5QrcodeScanner("reader", config, false);

    scanner.render(
      (text) => {
        scanner.clear().then(() => onScanSuccess(text));
      },
      () => { /* エラーは無視 */ }
    );

    return () => {
      scanner.clear().catch(e => console.error(e));
    };
  }, [onScanSuccess]);

  return (
    <div className="w-full max-w-sm mx-auto overflow-hidden rounded-[2rem] border-4 border-slate-100">
      <div id="reader"></div>
    </div>
  );
}