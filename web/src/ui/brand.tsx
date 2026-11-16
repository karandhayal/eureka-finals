import { asset } from '../lib/asset';
// E-Cell IIT Bombay branding for Eureka! Finals.
export const EVENT_TITLE = 'Eureka! Finals';
export const ORG = 'E-Cell IIT Bombay';

/** Compact lock-up: E-Cell mark + event name. */
export function Brand({ sub = true, light }: { sub?: boolean; light?: boolean }) {
  return (
    <span className="brand">
      <img src={light ? asset('ecell-mark-white.png') : asset('ecell-mark.png')} alt="E-Cell" width={18} height={24} />
      <span className="brand-text"><span className="brand-name">{EVENT_TITLE}</span>{sub && <span className="brand-sub">{ORG}</span>}</span>
    </span>
  );
}

/** Full E-Cell logo for sign-in screens. */
export function OrgLogo({ height = 56, light }: { height?: number; light?: boolean }) {
  return <img src={light ? asset('ecell-logo-white.png') : asset('ecell-logo.png')} alt={ORG} style={{ height, width: 'auto', display: 'block' }} />;
}
