import { createContext, useContext } from 'react';
import type { MoonScene } from './MoonScene';

export const SceneContext = createContext<{ current: MoonScene | null }>({ current: null });

/** Returns a getter so components can call scene actions from event handlers. */
export function useScene() {
  const ref = useContext(SceneContext);
  return () => ref.current;
}
