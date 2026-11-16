import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc, errMsg } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Callout, Field, Input } from '../../ui';
import { OrgLogo } from '../../ui/brand';

export default function Login() {
  const { signIn, notice } = useAuth();
  const [needsAdmin, setNeedsAdmin] = useState<boolean | null>(null);
  const [eventName, setEventName] = useState('Eureka! Finals');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc<{ needs_admin: boolean; event_name: string }>('setup_status')
      .then(r => { setNeedsAdmin(r.needs_admin); setEventName(r.event_name); })
      .catch(e => { setNeedsAdmin(false); setError(errMsg(e)); });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true); setError(null);
    try {
      const r = needsAdmin
        ? await rpc('setup_first_admin', { p_name: name, p_email: email, p_password: password })
        : await rpc('staff_login', { p_email: email, p_password: password });
      signIn(r.token, r.me);
    } catch (err) { setError(errMsg(err)); }
    finally { setPending(false); }
  };

  return (
    <div className="solo">
      <main className="panel auth-card">
        <form className="col-4" onSubmit={submit} noValidate>
          <div className="col" style={{ gap: 4 }}>
            <div style={{ marginBottom: 20 }}><OrgLogo height={64} /></div>
            <h1>{needsAdmin ? 'Set up your event' : `Sign in to ${eventName}`}</h1>
            <p className="muted small">{needsAdmin ? 'Create the first admin account. You can add coordinators after this.' : 'For admins and coordinators.'}</p>
          </div>
          {notice && <Callout tone="warn">{notice}</Callout>}
          {needsAdmin && <Field label="Your name" required htmlFor="name"><Input id="name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" required /></Field>}
          <Field label="Email" required htmlFor="email"><Input id="email" type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required /></Field>
          <Field label="Password" required htmlFor="pw" help={needsAdmin ? 'At least 8 characters.' : undefined}>
            <Input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={needsAdmin ? 'new-password' : 'current-password'} required />
          </Field>
          {error && <Callout tone="danger">{error}</Callout>}
          <Button type="submit" variant="primary" block pending={pending} disabled={needsAdmin === null || !email || !password || (needsAdmin && !name)}>
            {needsAdmin ? 'Create admin and continue' : 'Sign in'}
          </Button>
        </form>
        <hr className="divider" style={{ margin: '24px 0 16px' }} />
        <p className="small muted">Startup team? <Link to="/s">Find your pitch time</Link></p>
        <p className="xsmall subtle" style={{ marginTop: 8 }}>Eureka! Finals · E-Cell IIT Bombay</p>
      </main>
    </div>
  );
}
