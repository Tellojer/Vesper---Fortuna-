/**
 * Public-folder URL that also works when the app is served from a sub-path
 * (GitHub Pages: /Vesper---Fortuna-/). Vite sets BASE_URL from `base` in vite.config.ts.
 * asset('/data/vesper/missions.json') -> '/Vesper---Fortuna-/data/vesper/missions.json'
 */
export const asset = (path: string): string => {
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return import.meta.env.BASE_URL.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
};
