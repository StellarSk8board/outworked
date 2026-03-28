---
name: Slack
emoji: "💬"
description: "Search messages, manage channels, reactions, pins, and users in Slack"
runtime: slack
auth:
  type: oauth2
  provider: slack
  scopes:
    - search:read
    - channels:read
    - channels:manage
    - groups:read
    - reactions:write
    - pins:write
    - users:read
tools:
  - slack:search_messages
  - slack:list_channels
  - slack:create_channel
  - slack:set_topic
  - slack:add_reaction
  - slack:pin_message
  - slack:list_users
---

# Slack Skill

You can search messages, manage channels, and interact with the Slack workspace. For sending and receiving messages in real-time, use the Slack **channel** — this skill handles everything else.

## Tools

- **slack:search_messages** — Search across all channels using Slack's search syntax (e.g. `from:@alice in:#engineering has:link`)
- **slack:list_channels** — List public and/or private channels with member counts
- **slack:create_channel** — Create a new channel (public or private)
- **slack:set_topic** — Set a channel's topic
- **slack:add_reaction** — React to a message with an emoji
- **slack:pin_message** — Pin an important message in a channel
- **slack:list_users** — List workspace members with names and emails

## Tips

- Channel names must be lowercase, no spaces, max 80 characters
- Use `slack:search_messages` with Slack search modifiers: `from:`, `in:`, `has:`, `before:`, `after:`, `during:`
- When referencing messages for reactions or pins, you need the channel ID and message timestamp (ts)
