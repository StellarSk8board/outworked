---
name: Google Sheets
emoji: "📊"
description: "Read, write, and manage Google Sheets spreadsheets"
runtime: google-sheets
auth:
  type: oauth2
  provider: google
  scopes:
    - https://www.googleapis.com/auth/spreadsheets
tools:
  - sheets:read
  - sheets:write
  - sheets:append
  - sheets:create
  - sheets:get_metadata
---

# Google Sheets Skill

You can read, write, and manage Google Sheets spreadsheets.

## Tools

- **sheets:read** — Read a range of cells (e.g. `Sheet1!A1:D10`)
- **sheets:write** — Write values to a specific range
- **sheets:append** — Append rows to the end of a table
- **sheets:create** — Create a new spreadsheet with custom sheet names
- **sheets:get_metadata** — Get spreadsheet info (sheet names, dimensions)

## Tips

- The `spreadsheetId` is the long ID in the URL: `docs.google.com/spreadsheets/d/{spreadsheetId}/edit`
- Ranges use A1 notation: `Sheet1!A1:D10`, `Sheet1!A:A` (whole column), `Sheet1!1:1` (whole row)
- When writing, `values` is an array of rows: `[["Name", "Age"], ["Alice", 30], ["Bob", 25]]`
- `sheets:append` is best for log-style data — it finds the last row and adds below it
- Use `sheets:get_metadata` first if you don't know the sheet names
