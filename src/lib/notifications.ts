import { getDesktopNotificationsEnabled } from "./sounds";

export interface AppNotification {
  id: string;
  type:
    | "approval"
    | "task-complete"
    | "agent-stuck"
    | "orchestration-done"
    | "info";
  title: string;
  body: string;
  agentName?: string;
  agentColor?: string;
  timestamp: number;
  read: boolean;
  /** For approval notifications — permission request details */
  permissionReqId?: number;
  permissionPermId?: string;
  permissionTool?: string;
  permissionDesc?: string;
}

/** Send a desktop notification via Electron */
export async function showDesktopNotification(title: string, body: string) {
  if (!getDesktopNotificationsEnabled()) return;
  const w = window as unknown as {
    electronAPI?: {
      notifications?: {
        show: (
          t: string,
          b: string,
          o?: Record<string, unknown>,
        ) => Promise<{ ok: boolean }>;
      };
    };
  };
  if (w.electronAPI?.notifications) {
    await w.electronAPI.notifications.show(title, body);
  }
}
