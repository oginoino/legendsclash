import { useSyncExternalStore } from 'react';

export interface ClientPreferences {
  reducedMotion: boolean;
  haptics: boolean;
  battleHints: boolean;
}

const STORAGE_KEY = 'lc_preferences_v1';

export const DEFAULT_PREFERENCES: ClientPreferences = {
  reducedMotion: false,
  haptics: true,
  battleHints: true,
};

function loadPreferences(): ClientPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ClientPreferences>;
    return {
      reducedMotion: typeof saved.reducedMotion === 'boolean'
        ? saved.reducedMotion
        : DEFAULT_PREFERENCES.reducedMotion,
      haptics: typeof saved.haptics === 'boolean' ? saved.haptics : DEFAULT_PREFERENCES.haptics,
      battleHints: typeof saved.battleHints === 'boolean'
        ? saved.battleHints
        : DEFAULT_PREFERENCES.battleHints,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

let preferences = loadPreferences();
const listeners = new Set<() => void>();

function applyPreferences(): void {
  if (typeof document === 'undefined') return;
  if (preferences.reducedMotion) document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
}

function persistPreferences(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* armazenamento opcional */ }
}

function emit(): void {
  applyPreferences();
  for (const listener of listeners) listener();
}

applyPreferences();

export function getPreferences(): ClientPreferences {
  return preferences;
}

export function usePreferences(): ClientPreferences {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getPreferences,
    getPreferences,
  );
}

export function updatePreferences(patch: Partial<ClientPreferences>): void {
  preferences = { ...preferences, ...patch };
  persistPreferences();
  emit();
}

export function resetPreferences(): void {
  preferences = { ...DEFAULT_PREFERENCES };
  persistPreferences();
  emit();
}

export function triggerHaptic(pattern: number | number[] = 8): void {
  if (!preferences.haptics || typeof navigator === 'undefined') return;
  try { navigator.vibrate?.(pattern); } catch { /* melhoria progressiva */ }
}

export function resetLearningProgress(profileId?: string): void {
  try {
    localStorage.removeItem('lc_taught_taunt');
    localStorage.removeItem('lc_taught_fatigue');
    if (profileId) localStorage.removeItem(`lc_tutorial_done:${profileId}`);
  } catch { /* armazenamento opcional */ }
}
