# Security

Waterline makes no network requests, touches none of your files, runs no commands and calls no model. It reads only each turn's token counts and id, and the only thing it saves is its own small store: a JSON file Claude Code keeps for it, holding a few small values. "What it can and can't do" in the [README](README.md) lists everything it does.

To report a security problem, use GitHub's private vulnerability reporting: open this repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue for it.
