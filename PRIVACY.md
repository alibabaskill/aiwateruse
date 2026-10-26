# Privacy policy

Effective 26 October 2026. This covers the Waterline plugin for Claude Code, published by Alistair Sinclaire.

## What Waterline reads

When each Claude Code turn ends, Waterline reads two things about it:

- its token counts: the four numbers the API reports (new input, output, cache reads and cache writes);
- its id, so a turn Claude Code replays is counted once.

It never reads your messages, Claude's replies, your files, your tool calls or your account details.

## What Waterline keeps

Waterline keeps a few small values in its own plugin store, a JSON file Claude Code keeps for it in your Claude configuration folder on your computer:

- the estimate you chose (Low, Mid or High);
- whether the panel opens by itself;
- totals in weighted tokens: one all-time total, and one total per day for the last 14 days.

For the current session only, Claude Code also holds this chat's running total and the ids of the last 64 turns counted. These are gone when the session ends.

## What Waterline shares

Nothing. Waterline makes no network requests and has no analytics, tracking or third-party services. Its panel, its line under the prompt and its notices are drawn by Claude Code in your own session, like any other part of its interface. The source links in the panel open only when you click them.

## Deleting what it keeps

Run `/waterline reset` to empty the glass and delete everything Waterline saved. Uninstalling the plugin stops it collecting anything; run `/waterline reset` first to remove the saved totals as well.

## Questions

Open an issue at [github.com/alibabaskill/aiwateruse/issues](https://github.com/alibabaskill/aiwateruse/issues). To report a security problem privately, see [SECURITY.md](SECURITY.md).

If this policy changes, the new version will be published in this file with a new effective date.
