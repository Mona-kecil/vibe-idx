# Workspace prototype reference

This is the source of the composable research workspace prototype (V2.4). The production workspace in `apps/web` ports it.

- `src/` holds the prototype's views, workspace shell, tooltips, chart controls, and styles. `build.py` inlined them into one HTML file.
- `research/` holds the researched public data for SINI, BRPT, TPIA, and BREN: the broker directory, IPO underwriters, monthly registry snapshots, KSEI investor types, and controller affiliations.

The built prototype embeds captured Stockbit broker summaries, so it stays out of this public repository.
