---
description: Go build it on a dedictated branch off HEAD of main, commit and push draft PR
agent: build
---

Go build it.

Fetch the latest HEAD of main from the remote repository. Create a new branch using semantic Git name prefix (i.e. fix/*, feat/*, refactor/*). Execute the plan if provided or the instructions provided by the user. Use the /git-commit skill with multiple commits if multiple tasks were completed. 

Push the branch/changes to the remote. Open a draft PR with short/concise description targeting main branch.