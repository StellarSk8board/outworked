---
name: Google Calendar
description: "View, create, update, and delete Google Calendar events. Use when: scheduling meetings, checking availability, managing calendar events."
emoji: "📅"
runtime: google-calendar
auth:
  type: oauth2
  provider: google
  scopes:
    - https://www.googleapis.com/auth/calendar.events
tools:
  - calendar:list
  - calendar:create
  - calendar:update
  - calendar:delete
---

# Google Calendar Skill

You have access to the user's Google Calendar. Use the calendar:\* tools to manage events.

## Available Tools

- **calendar:list** — List upcoming events. Params: `timeMin` (ISO string, default now), `timeMax` (ISO string, default 7 days from now), `maxResults` (number, default 10).
- **calendar:create** — Create a new event. Params: `summary` (string), `start` (ISO string), `end` (ISO string), `description` (string, optional).
- **calendar:update** — Update an existing event. Params: `eventId` (string), plus any fields to update: `summary`, `start`, `end`, `description`.
- **calendar:delete** — Delete an event. Params: `eventId` (string).

## Best Practices

- Always confirm with the user before creating or modifying events
- When listing events, present them in a clear, chronological format
- Include timezone information when relevant
- Check for conflicts before scheduling new events
- Use descriptive event summaries
