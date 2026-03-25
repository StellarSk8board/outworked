// ─── Scheduler ───────────────────────────────────────────────────────────────
// Main-process scheduler that polls the DB for due tasks and fires them to
// the renderer via IPC.  Supports one-time, interval, and 5-field cron tasks.

"use strict";

const db = require("../../electron/db/database.js");

// ─── Cron helpers ────────────────────────────────────────────────────────────

/**
 * Parse one cron field into an expanded set of matching integers.
 *
 * Supports:
 *   *             → every value in [min, max]
 *   n             → single value n
 *   n-m           → inclusive range
 *   *\/step        → every `step` values starting from `min`
 *   n-m/step      → every `step` values inside range
 *   a,b,c         → list of any of the above forms
 *
 * Returns a sorted array of valid integers, or null on parse error.
 */
function parseCronField(field, min, max) {
  const values = new Set();

  for (const part of field.split(",")) {
    const trimmed = part.trim();

    // step: *\/n  or  range/n
    if (trimmed.includes("/")) {
      const [rangeStr, stepStr] = trimmed.split("/");
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step < 1) return null;

      let rangeMin = min;
      let rangeMax = max;

      if (rangeStr !== "*") {
        if (rangeStr.includes("-")) {
          const [lo, hi] = rangeStr.split("-").map(Number);
          if (isNaN(lo) || isNaN(hi)) return null;
          rangeMin = lo;
          rangeMax = hi;
        } else {
          rangeMin = parseInt(rangeStr, 10);
          if (isNaN(rangeMin)) return null;
          rangeMax = max;
        }
      }

      for (let v = rangeMin; v <= rangeMax; v += step) {
        if (v >= min && v <= max) values.add(v);
      }
      continue;
    }

    // range: n-m
    if (trimmed.includes("-")) {
      const [lo, hi] = trimmed.split("-").map(Number);
      if (isNaN(lo) || isNaN(hi)) return null;
      for (let v = lo; v <= hi; v++) {
        if (v >= min && v <= max) values.add(v);
      }
      continue;
    }

    // wildcard
    if (trimmed === "*") {
      for (let v = min; v <= max; v++) values.add(v);
      continue;
    }

    // single value
    const n = parseInt(trimmed, 10);
    if (isNaN(n)) return null;
    if (n >= min && n <= max) values.add(n);
  }

  return [...values].sort((a, b) => a - b);
}

/**
 * Calculate the next timestamp (in ms) at or after `afterMs` that matches the
 * given 5-field cron expression "minute hour dom month dow".
 *
 * - month is 1-12 (standard cron)
 * - dow  is 0-6  (0 = Sunday)
 *
 * Returns 0 if no matching time is found within ~400 days.
 */
function nextCronRun(expression, afterMs) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return 0;

  const [minuteField, hourField, domField, monthField, dowField] = parts;

  const minutes = parseCronField(minuteField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const doms = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const dows = parseCronField(dowField, 0, 6);

  if (!minutes || !hours || !doms || !months || !dows) return 0;
  if (
    !minutes.length ||
    !hours.length ||
    !doms.length ||
    !months.length ||
    !dows.length
  )
    return 0;

  // Determine whether day matching uses dom, dow, or both.
  // Classic cron: if both are unrestricted (*), match any day.
  // If only one is restricted, OR-match (either condition satisfies).
  // If both are restricted, AND-match (both must be satisfied).
  const domRestricted = domField.trim() !== "*";
  const dowRestricted = dowField.trim() !== "*";

  // Start searching from the next whole minute after afterMs
  const startMs = afterMs - (afterMs % 60000) + 60000; // round up to next minute
  const limitMs = startMs + 400 * 24 * 60 * 60 * 1000; // ~400 days

  let cursor = new Date(startMs);

  while (cursor.getTime() < limitMs) {
    const month = cursor.getMonth() + 1; // 1-12
    const dom = cursor.getDate(); // 1-31
    const dow = cursor.getDay(); // 0-6
    const hour = cursor.getHours();
    const min = cursor.getMinutes();

    // --- Month check ---
    if (!months.includes(month)) {
      // Advance to the first day of the next matching month
      const nextMonth = months.find((m) => m > month);
      if (nextMonth !== undefined) {
        cursor = new Date(cursor.getFullYear(), nextMonth - 1, 1, 0, 0, 0, 0);
      } else {
        // Roll to next year, first matching month
        cursor = new Date(
          cursor.getFullYear() + 1,
          months[0] - 1,
          1,
          0,
          0,
          0,
          0,
        );
      }
      continue;
    }

    // --- Day check ---
    let dayMatch;
    if (!domRestricted && !dowRestricted) {
      dayMatch = true;
    } else if (domRestricted && dowRestricted) {
      // Both restricted: both must match (POSIX says OR, but most implementations
      // differ; we use the common Vixie-cron OR semantics here)
      dayMatch = doms.includes(dom) || dows.includes(dow);
    } else if (domRestricted) {
      dayMatch = doms.includes(dom);
    } else {
      dayMatch = dows.includes(dow);
    }

    if (!dayMatch) {
      // Advance to the next day at midnight
      cursor = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() + 1,
        0,
        0,
        0,
        0,
      );
      continue;
    }

    // --- Hour check ---
    if (!hours.includes(hour)) {
      const nextHour = hours.find((h) => h > hour);
      if (nextHour !== undefined) {
        cursor = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate(),
          nextHour,
          0,
          0,
          0,
        );
      } else {
        // Roll to next day
        cursor = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate() + 1,
          0,
          0,
          0,
          0,
        );
      }
      continue;
    }

    // --- Minute check ---
    if (!minutes.includes(min)) {
      const nextMin = minutes.find((m) => m > min);
      if (nextMin !== undefined) {
        cursor = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate(),
          cursor.getHours(),
          nextMin,
          0,
          0,
        );
      } else {
        // Roll to next matching hour
        const nextHour = hours.find((h) => h > hour);
        if (nextHour !== undefined) {
          cursor = new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate(),
            nextHour,
            0,
            0,
            0,
          );
        } else {
          cursor = new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate() + 1,
            0,
            0,
            0,
            0,
          );
        }
      }
      continue;
    }

    // All fields matched — return this timestamp (truncated to the minute)
    return new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate(),
      cursor.getHours(),
      cursor.getMinutes(),
      0,
      0,
    ).getTime();
  }

  return 0; // no match within look-ahead window
}

// ─── Scheduler class ─────────────────────────────────────────────────────────

class Scheduler {
  constructor() {
    this.pollInterval = 30000; // 30 seconds
    this.timer = null;
    this.mainWindow = null;
  }

  /**
   * Start the scheduler.  Performs an immediate first poll then sets up the
   * recurring interval.
   *
   * @param {Electron.BrowserWindow} mainWindow
   */
  start(mainWindow) {
    this.mainWindow = mainWindow;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollInterval);
  }

  /**
   * Stop the scheduler and clear the interval timer.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Update the main window reference (e.g. after a reload).
   *
   * @param {Electron.BrowserWindow} mainWindow
   */
  setWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * Query the database for tasks that are due, atomically claim them (update
   * state + insert run logs in a single transaction), then dispatch each to the
   * renderer.  This eliminates the window between read and update where a crash
   * could cause tasks to be skipped or duplicated.
   */
  poll() {
    const now = Date.now();
    let claimed;
    try {
      claimed = db.schedulerClaimDueTasks(now, (task) =>
        this.calculateNextRun(task),
      );
    } catch (err) {
      console.error("[Scheduler] poll error claiming due tasks:", err);
      return;
    }

    for (const { task, logId, updates } of claimed) {
      try {
        this.dispatchToRenderer(task, logId, updates);
      } catch (err) {
        console.error(`[Scheduler] error dispatching task ${task.id}:`, err);
        // The task was already claimed in the DB — mark the run as errored so
        // it doesn't silently disappear.
        try {
          db.schedulerCompleteRun(logId, "error", null, err.message);
        } catch (logErr) {
          console.error(
            `[Scheduler] failed to log error for run ${logId}:`,
            logErr,
          );
        }
      }
    }
  }

  /**
   * Send a claimed task to the renderer process via IPC.
   *
   * @param {object} task    - The scheduled task.
   * @param {number} logId   - Run log row id.
   * @param {object} updates - The state updates applied to the task.
   */
  dispatchToRenderer(task, logId, updates) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("scheduler:fire", {
        ...task,
        ...updates,
        runLogId: logId,
      });
    }
  }

  /**
   * Compute the timestamp (ms) of the next run for `task` based on its type
   * and schedule string.
   *
   * @param {object} task
   * @returns {number} Unix timestamp in ms, or 0 if there is no next run.
   */
  calculateNextRun(task) {
    const now = Date.now();
    switch (task.type) {
      case "one-time":
        return 0;

      case "interval": {
        const intervalMs = parseInt(task.schedule, 10);
        if (isNaN(intervalMs) || intervalMs <= 0) return 0;
        return now + intervalMs;
      }

      case "cron":
        return nextCronRun(task.schedule, now);

      default:
        return 0;
    }
  }

  /**
   * Mark a previously-logged run as complete.
   * Called from the renderer (via IPC) once the agent finishes executing the
   * task prompt.
   *
   * @param {number} logId   - The run log row id returned when the task fired.
   * @param {string} status  - 'completed' | 'error'
   * @param {string} [result]
   * @param {string} [error]
   */
  completeRun(logId, status, result, error) {
    try {
      db.schedulerCompleteRun(logId, status, result, error);
    } catch (err) {
      console.error(`[Scheduler] completeRun error for logId ${logId}:`, err);
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

const scheduler = new Scheduler();

module.exports = { Scheduler, scheduler, nextCronRun };
