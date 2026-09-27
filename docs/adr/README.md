# Architecture Decision Records

One file per decision, `NNNN-<kebab-title>.md`, numbered in order, never renumbered. A record is the user's own words about what was decided and why, with a title and one status line:

```
# <title under ten words>

Status: accepted <YYYY-MM-DD>

<the decision, verbatim>
```

Rules every agent and every human follow here:

* **Accepted records bind.** Planners read them all before a plan, builders before the first edit, reviewers and the gate driver before a verdict. A record the spec did not cite still applies.
* **Never edit a record.** A decision that must change is a new record whose status line reads `Status: accepted <date>, supersedes NNNN`; the old file gets `Status: superseded by NNNN` and nothing else changes. The pre-commit guard refuses any other edit to an existing record.
* **Never argue with a record in code.** An agent that disagrees stops, says which record and why, and proposes the superseding record for the user to word. The `adr` skill writes records only from the user's wording.
* **Read in numeric order, in full.** `node ~/.agents/scripts/gate/adr-check.mjs --repo .` lists the accepted records and checks the chain.

Empty until the first decision is worded.
