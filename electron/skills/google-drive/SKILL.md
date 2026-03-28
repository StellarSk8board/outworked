---
name: Google Drive
emoji: "📁"
description: "Search, read, upload, and share files in Google Drive"
runtime: google-drive
auth:
  type: oauth2
  provider: google
  scopes:
    - https://www.googleapis.com/auth/drive
tools:
  - drive:list
  - drive:search
  - drive:read
  - drive:upload
  - drive:create_folder
  - drive:share
---

# Google Drive Skill

You can search, read, upload, and manage files in Google Drive.

## Tools

- **drive:list** — List files in a folder (or root)
- **drive:search** — Search files by name or content
- **drive:read** — Read text content of a file (supports Google Docs, Sheets as CSV, plain text)
- **drive:upload** — Upload a text file to Drive
- **drive:create_folder** — Create a new folder
- **drive:share** — Share a file with a user or make it publicly accessible

## Tips

- The `fileId` is in the URL: `drive.google.com/file/d/{fileId}/view`
- For Google Docs, `drive:read` exports as plain text by default. Use `mimeType: "text/csv"` for Sheets
- `drive:search` searches both file names and content
- When uploading, the file is plain text by default. Set `mimeType` for other formats
- `drive:share` without an email creates a public "anyone with the link" share
