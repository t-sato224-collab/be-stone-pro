// components/QrScanner.tsx
"use client";

import { useEffect } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

interface QrScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanError?: (error: string) => void;
}

export default function QrScanner({ onScanSuccess, onScanError }: QrScannerProps) {
  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      "reader",
      { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
      },
      /* verbose= */ false
    );

    scanner.render(
      (decodedText) => {
        scanner.clear(); // 読み取り成功時にカメラを止める
        onScanSuccess(decodedText);
      },
      (error) => {
        if (onScanError) onScanError(error);
      }
    );

    return () => {
      scanner.clear().catch(error => console.error("Scanner cleanup failed", error));
    };
  }, [onScanSuccess, onScanError]);

  return (
    <div className="w-full max-w-sm mx-auto overflow-hidden rounded-2xl shadow-lg bg-black">
      <div id="reader"></div>
    </div>
  );
}