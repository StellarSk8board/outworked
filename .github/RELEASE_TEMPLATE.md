## Release Summary

Use this section to say, in one blunt paragraph, what changed and who this release is for.

Example:

> This release improves the Windows-forward port of Outworked with better shell handling, safer process cleanup, and clearer platform-specific behavior. Suitable for beta testers on Windows 10/11 and anyone tracking the port effort.

## Platform Availability

List only the artifacts that actually exist for this release.

- **Windows beta:** NSIS `.exe` installer when published
- **macOS:** `.dmg` if a macOS build is being shipped
- **Linux:** AppImage only if actually built and tested

If a platform is not shipping for this release, say so plainly instead of implying parity.

## Notes for Users

- `.zip`, `.blockmap`, and `.yml` files are usually auto-update artifacts
- most users should download the primary installer for their platform
- if Windows code signing is not configured yet, say that directly so SmartScreen warnings are not a surprise

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Recommended Release Tone

Call out platform status honestly:
- whether the release is Windows beta, macOS-first, or dual-platform
- what improved in this release
- what still is not done
- whether the release was smoke-tested on real Windows hardware

Do not oversell parity that does not exist yet.
