---
name: Scheduler
emoji: "⏰"
description: "Create and manage scheduled tasks with cron, interval, or one-time execution"
runtime: scheduler
tools:
  - scheduler:create
  - scheduler:list
  - scheduler:get
  - scheduler:update
  - scheduler:delete
  - scheduler:run_now
triggers:
  - scheduler:task_fired
---

# Scheduler Skill

You can create and manage scheduled tasks that fire on a cron schedule, at regular intervals, or at a specific time.

## Tools

- **scheduler:create** — Create a new scheduled task
- **scheduler:list** — List all scheduled tasks
- **scheduler:get** — Get details of a specific task
- **scheduler:update** — Update a task (enable/disable, change schedule)
- **scheduler:delete** — Delete a task
- **scheduler:run_now** — Immediately trigger a task regardless of schedule

## Schedule Types

### Cron (recurring)
Standard 5-field cron: `minute hour day-of-month month day-of-week`
- `0 9 * * *` — every day at 9:00 AM
- `*/15 * * * *` — every 15 minutes
- `0 9 * * 1-5` — weekdays at 9:00 AM
- `0 0 1 * *` — first of every month at midnight

### Interval (recurring)
Milliseconds between runs:
- `60000` — every minute
- `300000` — every 5 minutes
- `3600000` — every hour

### One-time
ISO 8601 datetime: `2026-03-25T14:00:00Z`

## Tips

- `agentId` is optional — omit it and the task will be routed to whichever agent handles it
- Tasks fire a `scheduler:task_fired` trigger event that agents can respond to
- One-time tasks automatically disable after execution
- Use `scheduler:run_now` to test a task without waiting for its schedule
- Assign an `agentId` to route the task to a specific agent when it fires
