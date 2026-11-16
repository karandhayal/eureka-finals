import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Activity, ClipboardCheck, DoorOpen, Gauge, ListOrdered, LogOut, Menu, Scale, Settings, Trophy, Users } from 'lucide-react';
import { useStaff } from '../lib/auth';
import { Button, Connection, Dialog, OfflineBanner } from '../ui';
import { Brand } from '../ui/brand';

type Item = { to: string; label: string; icon: React.ReactNode; badge?: number };

export function navFor(isAdmin: boolean, roomId: number | null): { main: Item[]; floor: Item[] } {
  const room: Item = { to: roomId ? `/room/${roomId}` : '/duty', label: 'Room console', icon: <DoorOpen size={18} /> };
  const desk: Item = { to: '/desk', label: 'Registration desk', icon: <ClipboardCheck size={18} /> };
  const judges: Item = { to: '/judges', label: 'Judges', icon: <Scale size={18} /> };
  if (!isAdmin) return { main: [desk, room, judges], floor: [] };
  return {
    main: [
      { to: '/live', label: 'Live', icon: <Gauge size={18} /> },
      { to: '/queue', label: 'Queue', icon: <ListOrdered size={18} /> },
      { to: '/rooms', label: 'Rooms', icon: <DoorOpen size={18} /> },
      judges,
      { to: '/results', label: 'Results', icon: <Trophy size={18} /> },
      { to: '/setup', label: 'Setup', icon: <Settings size={18} /> },
    ],
    floor: [desk, { to: '/activity', label: 'Activity log', icon: <Activity size={18} /> }],
  };
}

/** Desktop: persistent sidebar. Mobile: bottom bar with the 4 most used destinations and a "More" sheet. */
export function StaffShell({ title, actions, updatedAt, children, narrow }: { title: React.ReactNode; actions?: React.ReactNode; updatedAt?: number; children: React.ReactNode; narrow?: boolean }) {
  const { me, isAdmin, signOut } = useStaff();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const { main, floor } = navFor(isAdmin, me.room_id);
  const mobile = isAdmin
    ? [main[0], main[1], main[2], floor[0]]
    : main;
  const overflow = isAdmin ? [main[3], main[4], main[5], floor[1]] : [];
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand"><Brand /></div>
        <nav>
          {main.map(i => <NavLink key={i.to} to={i.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>{i.icon}<span>{i.label}</span></NavLink>)}
        </nav>
        {floor.length > 0 && <>
          <div className="section-title" style={{ padding: '8px 20px 0' }}><span className="hide-mobile">Floor</span></div>
          <nav>{floor.map(i => <NavLink key={i.to} to={i.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>{i.icon}<span>{i.label}</span></NavLink>)}</nav>
        </>}
        <div className="sidebar-foot">
          <div className="who"><div className="strong truncate">{me.name}</div><div className="subtle xsmall">{isAdmin ? 'Admin' : 'Coordinator'}</div></div>
          <Button variant="quiet" size="sm" icon={<LogOut size={16} />} onClick={() => signOut()} aria-label="Sign out"><span className="who">Sign out</span></Button>
        </div>
      </aside>
      <div className="main">
        <OfflineBanner />
        <header className="topbar">
          <h1 className="truncate">{title}</h1>
          <div className="spacer" />
          <span className="hide-mobile"><Connection updatedAt={updatedAt} /></span>
          {actions}
        </header>
        <main className={`content ${narrow ? 'narrow' : ''}`} id="main">{children}</main>
      </div>
      <nav className="bottombar" aria-label="Main navigation">
        {mobile.map(i => <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? 'active' : '')}>{i.icon}<span>{shortLabel(i.label)}</span></NavLink>)}
        {isAdmin
          ? <button onClick={() => setMore(true)} className={overflow.some(o => loc.pathname.startsWith(o.to)) ? 'active' : ''}><Menu size={18} /><span>More</span></button>
          : <button onClick={() => setMore(true)}><Users size={18} /><span>Account</span></button>}
      </nav>
      {more && (
        <Dialog title={isAdmin ? 'More' : 'Account'} onClose={() => setMore(false)}>
          <div className="list panel">
            {overflow.map(i => <NavLink key={i.to} to={i.to} className="list-item" onClick={() => setMore(false)} style={{ color: 'var(--text)' }}>{i.icon}<span className="main title">{i.label}</span></NavLink>)}
            <div className="list-item"><Users size={18} /><div className="main"><span className="title">{me.name}</span><span className="meta">{isAdmin ? 'Admin' : 'Coordinator'} · <Connection /></span></div></div>
            <button className="list-item" onClick={() => { setMore(false); signOut(); }} style={{ color: 'var(--danger)' }}><LogOut size={18} /><span className="main title">Sign out</span></button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
const shortLabel = (l: string) => ({ 'Registration desk': 'Desk', 'Room console': 'Room', 'Activity log': 'Log' } as Record<string, string>)[l] ?? l;
