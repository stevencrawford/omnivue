---
description: Go build it on a dedictated branch off HEAD of main, commit and push draft PR
agent: build
---

Using a git worktree local to the project or specified by the User. Fetch the latest HEAD of main from the remote repository. Create a new branch using semantic Git name prefix (i.e. fix/*, feat/*, refactor/*). Execute the plan if provided or the instructions provided by the user. Git commit the changes. Use the /git-commit skill with multiple commits if multiple tasks were completed. 

Push the branch/changes to the remote. Open a draft PR with short/concise description targeting main branch.