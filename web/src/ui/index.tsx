// Shared components. Every screen is built from these.
import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, Search, X, XCircle } from 'lucide-react';
import { errMsg, newRequestId, rpc } from '../lib/api';
import { refreshAll, useConnection } from '../lib/live';

/* ---------- Button ---------- */
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'danger-solid' | 'quiet';
  size?: 'sm' | 'md' | 'lg'; block?: boolean; pending?: boolean; icon?: React.ReactNode; iconOnly?: boolean;
};
export function Button({ variant = 'default', size = 'md', block, pending, icon, iconOnly, className = '', children, disabled, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', iconOnly && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || pending} aria-busy={pending || undefined} {...rest}>
      {pending ? <Loader2 size={16} className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ---------- Form fields ---------- */
export function Field({ label, required, help, error, children, htmlFor }: { label: string; required?: boolean; help?: React.ReactNode; error?: string | null; children: React.ReactNode; htmlFor?: string }) {
  // Link the label, help and error text to the control so screen readers announce them.
  const auto = useId();
  const child = React.isValidElement(children) ? (children as React.ReactElement<any>) : null;
  const id = htmlFor ?? child?.props.id ?? auto;
  const noteId = `${id}-note`;
  const control = child
    ? React.cloneElement(child, { id, 'aria-describedby': error || help ? noteId : undefined, 'aria-invalid': error ? true : undefined, 'aria-required': required || undefined })
    : children;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}{required && <span className="req" aria-hidden>*</span>}</label>
      {control}
      {error ? <span id={noteId} className="field-error" role="alert">{error}</span> : help ? <span id={noteId} className="field-help">{help}</span> : null}
    </div>
  );
}
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...p }, ref) {
  return <input ref={ref} className={`input ${className}`} {...p} />;
});
export function Select({ className = '', children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`select ${className}`} {...p}>{children}</select>;
}
export function Textarea({ className = '', ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} {...p} />;
}
export const SearchInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function SearchInput(p, ref) {
  return <div className="search"><Search size={16} aria-hidden /><input ref={ref} type="search" className="input" autoComplete="off" {...p} /></div>;
});

export function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(o => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(i => (
        <button key={i.value} role="tab" aria-selected={i.value === value} onClick={() => onChange(i.value)}>
          {i.label}{i.count != null && <span className="count num">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Status ---------- */
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
export function Badge({ tone = 'neutral', children, live, plain }: { tone?: Tone; children: React.ReactNode; live?: boolean; plain?: boolean }) {
  return <span className={`badge ${tone !== 'neutral' ? 'badge-' + tone : ''} ${live ? 'badge-live' : ''} ${plain ? 'plain' : ''}`}>{children}</span>;
}
const STARTUP_STATUS: Record<string, [string, Tone]> = {
  registered: ['Not arrived', 'neutral'], waiting: ['In queue', 'neutral'], hold: ['On hold', 'warn'],
  on_deck: ['Called', 'info'], pitching: ['Pitching', 'info'], done: ['Done', 'ok'],
  no_show: ['No-show', 'danger'], withdrawn: ['Withdrawn', 'neutral'],
};
export const startupStatusLabel = (s: string) => STARTUP_STATUS[s]?.[0] ?? s;
export function StartupStatus({ status }: { status: string }) {
  const [label, tone] = STARTUP_STATUS[status] ?? [status, 'neutral'];
  return <Badge tone={tone} live={status === 'pitching'}>{label}</Badge>;
}
const ROOM_STATUS: Record<string, [string, Tone]> = { open: ['Open', 'ok'], break: ['On break', 'warn'], closed: ['Closed', 'neutral'] };
export function RoomStatus({ status }: { status: string }) {
  const [label, tone] = ROOM_STATUS[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Callout({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; children?: React.ReactNode; title?: React.ReactNode }) {
  const Icon = tone === 'danger' ? XCircle : tone === 'warn' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : Info;
  return (
    <div className={`callout callout-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={16} aria-hidden />
      <div className="col" style={{ gap: 2 }}>{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty">{icon}<h3>{title}</h3>{children && <p className="small">{children}</p>}{action}</div>;
}
export function Skeleton({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden />;
}
export function LoadingRows({ n = 5 }: { n?: number }) {
  return <div className="col-3" style={{ padding: 16 }} aria-busy="true" aria-label="Loading">{Array.from({ length: n }, (_, i) => <Skeleton key={i} h={20} w={`${90 - i * 7}%`} />)}</div>;
}
export function LoadError({ error, retry }: { error: Error; retry: () => void }) {
  return <Empty icon={<XCircle size={28} />} title="Could not load" action={<Button onClick={retry}>Try again</Button>}>{errMsg(error)}</Empty>;
}

export function Connection({ updatedAt }: { updatedAt?: number }) {
  const c = useConnection();
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick(x => x + 1), 5000); return () => clearInterval(i); }, []);
  const age = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : null;
  const text = c === 'offline' ? 'Offline' : c === 'live' ? 'Live' : 'Updating every few seconds';
  return (
    <span className={`conn ${c === 'offline' ? 'down' : c === 'polling' ? 'slow' : ''}`} title={age != null ? `Last updated ${age}s ago` : undefined}>
      <i aria-hidden />{text}{c === 'offline' && age != null ? ` · last update ${age}s ago` : ''}
    </span>
  );
}
export function OfflineBanner() {
  const c = useConnection();
  if (c !== 'offline') return null;
  return <div className="banner banner-danger" role="status"><XCircle size={16} />You are offline. What you see may be out of date, and actions will not go through until the connection returns.</div>;
}

/* ---------- Dialog ---------- */
export function Dialog({ title, onClose, children, footer, wide }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input, select, textarea, button.btn-primary, button.btn-danger-solid');
    (first || el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const f = Array.from(el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(x => !x.hasAttribute('disabled'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <div className="dialog-head"><h2 id={id}>{title}</h2><Button variant="quiet" size="sm" iconOnly onClick={onClose} aria-label="Close"><X size={18} /></Button></div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation for consequential actions. Optional reason field and typed confirmation. */
export function Confirm({ title, body, confirmLabel, danger, reason, reasonLabel = 'Reason', reasonRequired, typeToConfirm, onConfirm, onClose }: {
  title: string; body?: React.ReactNode; confirmLabel: string; danger?: boolean; reason?: boolean; reasonLabel?: string; reasonRequired?: boolean;
  typeToConfirm?: string; onConfirm: (reason: string) => Promise<unknown> | void; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const blocked = (reasonRequired && !text.trim()) || (typeToConfirm != null && typed !== typeToConfirm);
  const go = async () => {
    if (blocked) return;
    setPending(true); setErr(null);
    try { await onConfirm(text.trim()); onClose(); } catch (e) { setErr(errMsg(e)); } finally { setPending(false); }
  };
  return (
    <Dialog title={title} onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant={danger ? 'danger-solid' : 'primary'} pending={pending} disabled={blocked} onClick={go}>{confirmLabel}</Button>
    </>}>
      {body && <div className="muted">{body}</div>}
      {reason && <Field label={reasonLabel} required={reasonRequired}><Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder={reasonRequired ? 'Required, for the activity log' : 'Optional'} maxLength={200} /></Field>}
      {typeToConfirm != null && <Field label={`Type ${typeToConfirm} to confirm`} required><Input value={typed} onChange={e => setTyped(e.target.value)} autoCapitalize="characters" /></Field>}
      {err && <Callout tone="danger">{err}</Callout>}
    </Dialog>
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; tone: 'ok' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {});
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems(xs => [...xs.slice(-2), { id, tone, text }]);
    setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span className="t-icon">{t.tone === 'error' ? <XCircle size={16} /> : t.tone === 'ok' ? <CheckCircle2 size={16} /> : <Info size={16} />}</span>
            <span>{t.text}</span>
            <button onClick={() => setItems(xs => xs.filter(x => x.id !== t.id))} aria-label="Dismiss"><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/**
 * Run a backend write with a fresh request id. Shows success or the server's reason,
 * then refreshes every live view on this device.
 */
export function useAction() {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: string, args: Record<string, unknown>, success?: string | ((r: T) => string | null)): Promise<T | undefined> => {
    setPending(key);
    try {
      const r = await rpc<T>(fn, { ...args, p_req: newRequestId() });
      const msg = typeof success === 'function' ? success(r) : success;
      if (msg) toast('ok', msg);
      refreshAll();
      return r;
    } catch (e) {
      toast('error', errMsg(e));
      refreshAll();
      return undefined;
    } finally {
      setPending(null);
    }
  }, [toast]);
  /** Same as run, but throws so a dialog can show the reason and stay open. */
  const must = useCallback(async <T,>(key: string, fn: string, args: Record<string, unknown>, success?: string): Promise<T> => {
    setPending(key);
    try {
      const r = await rpc<T>(fn, { ...args, p_req: newRequestId() });
      if (success) toast('ok', success);
      return r;
    } finally {
      refreshAll();
      setPending(null);
    }
  }, [toast]);
  return { run, must, pending };
}
