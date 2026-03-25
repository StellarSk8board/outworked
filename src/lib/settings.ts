// ─── SQLite-backed App Settings ──────────────────────────────────
//
// Replaces localStorage for all persistent app settings.
// Uses the Electron IPC bridge to read/write from the SQLite
// app_settings table. Falls back to localStorage when not in Electron.

function getAPI(): {
  settingGet: (key: string) => Promise<string | null>;
  settingSet: (key: string, value: string) => Promise<void>;
  settingDelete: (key: string) => Promise<void>;
  settingList: () => Promise<{ key: string; value: string }[]>;
} | null {
  const w = window as unknown as {
    electronAPI?: { db?: Record<string, unknown> };
  };
  return (w.electronAPI?.db as ReturnType<typeof getAPI>) ?? null;
}

/** Get a string setting. Returns null if not set. */
export async function getSetting(key: string): Promise<string | null> {
  const api = getAPI();
  if (api) return api.settingGet(key);
  return localStorage.getItem(key);
}

/** Set a string setting. For objects/arrays, JSON.stringify before calling. */
export async function setSetting(key: string, value: string): Promise<void> {
  const api = getAPI();
  if (api) {
    await api.settingSet(key, value);
  } else {
    localStorage.setItem(key, value);
  }
}

/** Delete a setting. */
export async function deleteSetting(key: string): Promise<void> {
  const api = getAPI();
  if (api) {
    await api.settingDelete(key);
  } else {
    localStorage.removeItem(key);
  }
}

/** Get a JSON-serialized setting, parsed. Returns fallback if not set. */
export async function getSettingJSON<T>(
  key: string,
  fallback: T,
): Promise<T> {
  const raw = await getSetting(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Set a JSON-serialized setting. */
export async function setSettingJSON<T>(key: string, value: T): Promise<void> {
  await setSetting(key, JSON.stringify(value));
}
