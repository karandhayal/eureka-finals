// Shareable links use the hash so they work on any static host.
const base = () => `${location.origin}${location.pathname}`;
export const judgeLink = (token: string) => `${base()}#/j/${token}`;
export const startupLink = (token: string) => `${base()}#/s/${token}`;
export const displayLink = (code: string) => `${base()}#/display/${code}`;
export const hallLink = (code: string) => `${base()}#/hall/${code}`;
