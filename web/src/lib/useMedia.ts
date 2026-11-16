import { useEffect, useState } from 'react';
export function useMedia(query: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f); f();
    return () => mq.removeEventListener('change', f);
  }, [query]);
  return m;
}
export const useIsMobile = () => useMedia('(max-width: 767px)');
