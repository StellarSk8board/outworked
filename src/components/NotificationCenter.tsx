import { useState, useEffect } from "react";
import { AppNotification } from "../lib/notifications";
import {
  getSoundsEnabled,
  setSoundsEnabled,
  getDesktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
} from "../lib/sounds";

interface NotificationCenterProps {
  notifications: AppNotification[];
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onApprovalResponse: (notifId: string, permId: string, allow: boolean) => void;
  onNavigateToAgent?: (agentName: string) => void;
}

export default function NotificationCenter({
  notifications,
  onDismiss,
  onDismissAll,
  onApprovalResponse,
  onNavigateToAgent,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [soundsOn, setSoundsOn] = useState(getSoundsEnabled);
  const [desktopOn, setDesktopOn] = useState(getDesktopNotificationsEnabled);

  const unread = notifications.filter((n) => !n.read).length;
  const pending = notifications.filter((n) => n.type === "approval" && !n.read);

  return (
    <>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className={`relative w-full btn-pixel text-[10px] ${
          pending.length > 0
            ? "bg-amber-700 hover:bg-amber-600 text-amber-50 animate-pulse"
            : unread > 0
              ? "bg-indigo-700 hover:bg-indigo-600 text-indigo-50"
              : "bg-slate-700 hover:bg-slate-600 text-slate-200"
        }`}
      >
        🔔 Notifications
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-pixel px-1">
            {unread}
          </span>
        )}
      </button>

      {/* Notification panel modal */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-slate-800 border border-slate-600 rounded-lg w-[420px] max-h-[70vh] shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
              <h3 className="text-sm font-pixel text-white">
                🔔 Notifications
              </h3>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <button
                    onClick={onDismissAll}
                    className="text-[9px] font-pixel text-slate-500 hover:text-slate-300"
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="text-slate-400 hover:text-white text-sm"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Settings row */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700/50">
              <button
                onClick={() => {
                  const v = !soundsOn;
                  setSoundsOn(v);
                  setSoundsEnabled(v);
                }}
                className={`text-[9px] font-pixel px-2 py-0.5 rounded ${soundsOn ? "bg-indigo-700 text-indigo-100" : "bg-slate-700 text-slate-400"}`}
              >
                {soundsOn ? "🔊 Sounds ON" : "🔇 Sounds OFF"}
              </button>
              <button
                onClick={() => {
                  const v = !desktopOn;
                  setDesktopOn(v);
                  setDesktopNotificationsEnabled(v);
                }}
                className={`text-[9px] font-pixel px-2 py-0.5 rounded ${desktopOn ? "bg-indigo-700 text-indigo-100" : "bg-slate-700 text-slate-400"}`}
              >
                {desktopOn ? "🖥 Desktop ON" : "🖥 Desktop OFF"}
              </button>
            </div>

            {/* Notifications list */}
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 && (
                <div className="text-center py-8">
                  <span className="text-2xl">🔕</span>
                  <p className="text-[11px] font-pixel text-slate-500 mt-2">
                    No notifications yet
                  </p>
                </div>
              )}
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-slate-700/50 transition-colors ${
                    !n.read ? "bg-slate-800/60" : "bg-transparent opacity-70"
                  } ${n.type === "approval" && !n.read ? "border-l-2 border-l-amber-500" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm mt-0.5 shrink-0">
                      {n.type === "approval"
                        ? "🔒"
                        : n.type === "task-complete"
                          ? "✅"
                          : n.type === "agent-stuck"
                            ? "⚠️"
                            : n.type === "orchestration-done"
                              ? "🏁"
                              : "ℹ️"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] font-pixel text-white">
                          {n.title}
                        </p>
                        {n.agentName && (
                          <button
                            onClick={() => onNavigateToAgent?.(n.agentName!)}
                            className="text-[9px] font-pixel px-1.5 py-0.5 rounded bg-slate-700/80 hover:bg-slate-600 transition-colors"
                            style={{ color: n.agentColor || "#94a3b8" }}
                          >
                            {n.agentName}
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {n.body}
                      </p>
                      <p className="text-[9px] text-slate-600 mt-1">
                        {formatTimestamp(n.timestamp)}
                      </p>

                      {/* Approval actions */}
                      {n.type === "approval" &&
                        !n.read &&
                        n.permissionPermId && (
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() =>
                                onApprovalResponse(
                                  n.id,
                                  n.permissionPermId!,
                                  true,
                                )
                              }
                              className="btn-pixel text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-0.5"
                            >
                              ✓ Allow
                            </button>
                            <button
                              onClick={() =>
                                onApprovalResponse(
                                  n.id,
                                  n.permissionPermId!,
                                  false,
                                )
                              }
                              className="btn-pixel text-[10px] bg-red-700 hover:bg-red-600 text-white px-3 py-0.5"
                            >
                              ✕ Deny
                            </button>
                          </div>
                        )}
                    </div>
                    <button
                      onClick={() => onDismiss(n.id)}
                      className="text-slate-600 hover:text-slate-300 text-[10px] shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pending approvals summary */}
            {pending.length > 0 && (
              <div className="px-4 py-2 border-t border-amber-700/50 bg-amber-950/30">
                <p className="text-[10px] font-pixel text-amber-300">
                  ⏳ {pending.length} pending approval
                  {pending.length !== 1 ? "s" : ""}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function formatTimestamp(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

/** Toast overlay — shows the latest notification briefly */
export function NotificationToast({
  notification,
  onDismiss,
}: {
  notification: AppNotification | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [notification, onDismiss]);

  if (!notification) return null;

  const borderColor =
    notification.type === "approval"
      ? "border-amber-500/50"
      : notification.type === "task-complete" ||
          notification.type === "orchestration-done"
        ? "border-emerald-500/50"
        : notification.type === "agent-stuck"
          ? "border-red-500/50"
          : "border-slate-500/50";

  const bgColor =
    notification.type === "approval"
      ? "bg-amber-950/90"
      : notification.type === "task-complete" ||
          notification.type === "orchestration-done"
        ? "bg-emerald-950/90"
        : notification.type === "agent-stuck"
          ? "bg-red-950/90"
          : "bg-slate-950/90";

  return (
    <div
      className={`absolute top-14 right-4 z-30 rounded-lg border shadow-xl px-3 py-2 max-w-xs backdrop-blur-sm animate-slide-up ${borderColor} ${bgColor}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-sm">
          {notification.type === "approval"
            ? "🔒"
            : notification.type === "task-complete"
              ? "✅"
              : notification.type === "agent-stuck"
                ? "⚠️"
                : notification.type === "orchestration-done"
                  ? "🏁"
                  : "ℹ️"}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-pixel text-white">
            {notification.title}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5 truncate">
            {notification.body}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-slate-500 hover:text-white text-xs shrink-0"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
