---
description: Log challenges and blockers from current session to memory for future reference
agent: build
---

Log the challenges encountered during this session to `.opencode/memory/challenges.md`.

## Process

1. **Analyze the conversation** - Review what was attempted during this session, what issues arose, and why work was abandoned or blocked.

2. **Format the entry** using the template in `.opencode/memory/challenge-template.md`:
   - Use today's date
   - Feature: What was being attempted
   - Status: `abandoned` if stopped mid-work, `blocked` if waiting on something, `deferred` if intentionally postponed
   - Summary: Brief description of the attempt and outcome
   - Challenges: List specific issues (technical blockers, design problems, scope creep, etc.)
   - Decisions Made: Key decisions during the session and reasoning
   - What Works: Any partial progress, working components, or salvageable code
   - Recommendations: Actionable advice for future attempts

3. **Append to challenges.md** - Add the new entry at the top of the file (after the header), maintaining newest-first order.

4. **Output confirmation** - Show a brief summary of what was logged.

## Notes

- If no challenges were encountered (session completed successfully), note this and skip logging.
- Focus on actionable insights, not just listing problems.
- Include any partial implementations that could be useful for future work.
