import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';
import { CameraOff } from 'lucide-react';

export function QrImage({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && value) QRCode.toCanvas(ref.current, value, { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#17171c', light: '#ffffff' } });
  }, [value, size]);
  return <canvas ref={ref} width={size} height={size} role="img" aria-label={label} style={{ width: size, height: size, display: 'block' }} />;
}

/** Camera scanner. Ignores repeat reads of the same code for 3 seconds. */
export function QrScan({ onCode, active = true }: { onCode: (text: string) => void; active?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const last = useRef<{ t: string; at: number }>({ t: '', at: 0 });
  const cb = useRef(onCode); cb.current = onCode;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active || !video.current) return;
    const sc = new QrScanner(video.current, r => {
      const now = Date.now();
      if (r.data === last.current.t && now - last.current.at < 3000) return;
      last.current = { t: r.data, at: now };
      if (navigator.vibrate) navigator.vibrate(40);
      cb.current(r.data);
    }, { preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 8 });
    sc.start().catch(() => setError('Camera unavailable. Allow camera access, or search by Eureka! ID instead.'));
    return () => { sc.stop(); sc.destroy(); };
  }, [active]);
  if (error) return <div className="empty" style={{ padding: 24 }}><CameraOff size={24} /><p className="small">{error}</p></div>;
  return <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', aspectRatio: '4 / 3' }}><video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>;
}
