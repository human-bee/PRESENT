import type { CSSProperties } from 'react';
const paths = {
  plus: 'M12 5v14M5 12h14', arrow: 'm5 12 7-7 7 7M12 5v14', close: 'm6 6 12 12M18 6 6 18',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  camera: 'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM16 10l6-4v12l-6-4',
  screen: 'M3 3h18v14H3zM8 21h8M12 17v4M8 10l4-4 4 4M12 6v8',
  note: 'M5 3h14v14l-4 4H5zM9 8h6M9 12h6M14 21v-5h5',
  timer: 'M9 2h6M12 2v3M19 5l2 2M12 9v4l3 2M21 14a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 8h.01M16 16h.01M12 12h.01M8 16h.01M16 8h.01',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  link: 'm10 13 4-4M8 15l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 6 0M16 9l2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-6 0',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  fit: 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  pin: 'm8 3 8 0-1 6 4 4H5l4-4-1-6ZM12 13v8',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v6l4 2',
  spark: 'm12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z',
  move: 'M12 2v20M2 12h20m-14-6 4-4 4 4m2 2 4 4-4 4m-2 2-4 4-4-4m-2-2-4-4 4-4',
  pen: 'm4 16 12-12 4 4L8 20l-5 1 1-5ZM13 7l4 4',
  sound: 'M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14',
  download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
};
export type IconName = keyof typeof paths;
export function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]}/></svg>;
}
