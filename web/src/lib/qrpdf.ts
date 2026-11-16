import { asset } from './asset';
// Printable QR badges for startups. Generated in the browser; nothing is uploaded.
// The QR carries "PD:<Eureka! ID>", the same code the startup page shows and the desk scanner reads.
import QRCode from 'qrcode';

export type BadgeRow = { eureka_id: string; startup_name: string; track: string };
export type BadgeLayout = 'sheet' | 'single';

async function imageData(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const blob = await (await fetch(url)).blob();
    const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob); });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = data; });
    return { data, w: img.naturalWidth, h: img.naturalHeight };
  } catch { return null; }
}

/** Build the PDF and start the download. Returns the number of badges. */
export async function downloadQrBadges(rows: BadgeRow[], opts: { layout: BadgeLayout; eventName: string; title: string; onProgress?: (done: number) => void }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const logo = await imageData(asset('ecell-mark.png'));
  const PW = 210, PH = 297;
  const ascii = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').trim() || s; // built-in PDF fonts are Latin only

  const header = (x: number, y: number, size: number) => {
    let tx = x;
    if (logo) { const h = size * 0.55; const w = (logo.w / logo.h) * h; doc.addImage(logo.data, 'PNG', x, y - h * 0.8, w, h, 'ecell-mark', 'FAST'); tx = x + w + 2; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.setTextColor(23, 23, 28);
    doc.text(opts.eventName, tx, y);
  };

  // QR drawn as vector squares: sharp at any print size and a few KB per badge.
  const drawQr = (m: { size: number; data: Uint8Array | boolean[] }, x: number, y: number, size: number) => {
    const u = size / m.size;
    doc.setFillColor(23, 23, 28);
    for (let r = 0; r < m.size; r++) {
      let c = 0;
      while (c < m.size) {
        if (!m.data[r * m.size + c]) { c++; continue; }
        let e = c; while (e < m.size && m.data[r * m.size + e]) e++;
        doc.rect(x + c * u, y + r * u, (e - c) * u + 0.01, u + 0.01, 'F');
        c = e;
      }
    }
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const qr = QRCode.create(`PD:${r.eureka_id}`, { errorCorrectionLevel: 'M' }).modules;
    const name = ascii(r.startup_name);

    if (opts.layout === 'single') {
      if (i > 0) doc.addPage();
      header(20, 28, 18);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120, 120, 130);
      doc.text('E-Cell IIT Bombay', PW - 20, 28, { align: 'right' });
      const size = 120;
      drawQr(qr, (PW - size) / 2, 60, size);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(23, 23, 28);
      const lines = doc.splitTextToSize(name, PW - 40).slice(0, 2);
      doc.text(lines, PW / 2, 205, { align: 'center' });
      doc.setFont('courier', 'bold'); doc.setFontSize(20);
      doc.text(r.eureka_id, PW / 2, 205 + lines.length * 11 + 4, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(14); doc.setTextColor(90, 90, 100);
      doc.text(ascii(r.track), PW / 2, 205 + lines.length * 11 + 14, { align: 'center' });
      doc.setFontSize(10); doc.setTextColor(140, 140, 150);
      doc.text('Show this code at the registration desk to check in.', PW / 2, PH - 20, { align: 'center' });
    } else {
      // 3 x 4 badges per A4 page with dashed cut lines.
      const cols = 3, rowsPer = 4, mx = 10, my = 12;
      const cw = (PW - 2 * mx) / cols, ch = (PH - 2 * my) / rowsPer;
      const k = i % (cols * rowsPer);
      if (k === 0) {
        if (i > 0) doc.addPage();
        doc.setDrawColor(200, 200, 208); doc.setLineWidth(0.2); doc.setLineDashPattern([1.5, 1.5], 0);
        for (let c = 0; c <= cols; c++) doc.line(mx + c * cw, my, mx + c * cw, PH - my);
        for (let rr = 0; rr <= rowsPer; rr++) doc.line(mx, my + rr * ch, PW - mx, my + rr * ch);
        doc.setLineDashPattern([], 0);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150, 150, 160);
        doc.text(`${opts.title} · page ${Math.floor(i / (cols * rowsPer)) + 1} of ${Math.ceil(rows.length / (cols * rowsPer))}`, PW / 2, PH - 5, { align: 'center' });
      }
      const x = mx + (k % cols) * cw, y = my + Math.floor(k / cols) * ch;
      header(x + 5, y + 8, 9);
      const q = 34;
      drawQr(qr, x + (cw - q) / 2, y + 12, q);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(23, 23, 28);
      const lines = doc.splitTextToSize(name, cw - 8).slice(0, 2);
      doc.text(lines, x + cw / 2, y + 51, { align: 'center' });
      const ly = y + 51 + lines.length * 4.2;
      doc.setFont('courier', 'bold'); doc.setFontSize(10);
      doc.text(r.eureka_id, x + cw / 2, ly + 0.5, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110, 110, 120);
      doc.text(ascii(r.track), x + cw / 2, ly + 4.5, { align: 'center' });
    }
    if (i % 10 === 0) { opts.onProgress?.(i); await new Promise(r2 => setTimeout(r2, 0)); }
  }
  opts.onProgress?.(rows.length);
  doc.setProperties({ title: opts.title, creator: 'Eureka! Finals · E-Cell IIT Bombay' });
  doc.save(`${opts.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
  return rows.length;
}
