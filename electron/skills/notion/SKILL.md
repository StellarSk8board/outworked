---
name: Notion
emoji: "📝"
description: "Search, read, create, and manage Notion pages and databases"
runtime: notion
auth:
  type: api-key
  provider: notion
tools:
  - notion:search
  - notion:read_page
  - notion:create_page
  - notion:update_page
  - notion:query_database
  - notion:append_blocks
---

# Notion Skill

You can search, read, create, and manage Notion pages and databases.

## Tools

- **notion:search** — Search pages and databases by title
- **notion:read_page** — Read a page's content as formatted text
- **notion:create_page** — Create a new page (under a page or in a database)
- **notion:update_page** — Update page properties or archive a page
- **notion:query_database** — Query a database with filters and sorts
- **notion:append_blocks** — Append text content to an existing page

## Tips

- Page and database IDs can be found in the URL: `notion.so/{workspace}/{pageId}`
- IDs work with or without dashes
- When creating pages in a database, set `parentType: "database"` and provide properties matching the database schema
- `notion:read_page` returns content as markdown-like plain text (headings, lists, todos, code blocks)
- For `notion:query_database`, use Notion's filter format: `{ "property": "Status", "select": { "equals": "Done" } }`
- `notion:append_blocks` splits text by newlines — each line becomes a paragraph block
