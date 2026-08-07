---
name: git-commit
description: Create consistent Git commits that follow git semantic commit format
---

When performing a Git commit follow these rules:

1. Separate subject from body with a blank line
2. Subject line: 50 chars max, capitalize, no period, imperative mood
3. Body: wrap at 72 chars, explain WHAT and WHY (not HOW)
4. Use semantic prefixes: feat/, fix/, refactor/, docs/, chore/

Example:
git commit -m "feat(config): Add min position size threshold

- Add MIN_POSITION_SIZE_PCT (1% of equity minimum)
- Add check in TradingLoop to block small positions
- Blocks trades below minimum to avoid fee burn"