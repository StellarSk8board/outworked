---
name: Gmail
description: "Read, search, send, and manage emails via Gmail API. Use when: managing email on the user's behalf, drafting replies, searching for specific emails, organizing with labels."
emoji: "📧"
runtime: gmail
auth:
  type: oauth2
  provider: google
  scopes:
    - https://www.googleapis.com/auth/gmail.modify
tools:
  - gmail:search
  - gmail:read
  - gmail:send
  - gmail:reply
  - gmail:list_labels
triggers:
  - gmail:new_email
---

# Gmail Skill

You have access to the user's Gmail account. Use the gmail:\* tools to manage email on their behalf.

## Available Tools

- **gmail:search** — Search emails by query (uses Gmail search syntax like `from:boss@company.com is:unread`). Params: `query` (string), `maxResults` (number, default 10).
- **gmail:read** — Read a specific email by ID. Returns full content, headers, and attachments list. Params: `messageId` (string).
- **gmail:send** — Send a new email. Params: `to` (string), `subject` (string), `body` (string, plain text or HTML).
- **gmail:reply** — Reply to an existing email thread. Params: `threadId` (string), `body` (string).
- **gmail:list_labels** — List all Gmail labels. No params.

## Best Practices

- Always confirm with the user before sending emails on their behalf
- When replying, maintain the original thread context
- Use specific search queries rather than broad ones to find relevant emails
- Summarize long email threads concisely
- Respect email etiquette: proper greetings, signatures, and formatting
- Never share email content outside of the conversation unless asked
