# Site playbooks (`SKILLS_DIR`)

A playbook is a short, factual note about **how a particular site lays out its pages** —
where the data actually sits, how it paginates, what a static read misses. The research
graph matches the URLs a run has already retrieved against these files and injects the
match into the model's next planning turn, so guidance arrives when the run touches the
domain and costs no extra model call.

`SKILLS_DIR` (default `skills/definitions`, relative to this directory) points at the
root. A missing or empty root is a supported configuration: the run proceeds with no
playbooks. Nothing here is copied from the reference repositories — see
`docs/audit/C-repository-reuse-map.md` for the licence position on `web-agent-main`.

## Layout

```
skills/definitions/
  <any-directory-name>/
    SKILL.md            <- required, frontmatter below
    <other files>       <- optional resources, readable by relative path
    sites/
      <platform>.md     <- optional per-site playbook, needs `domains:`
```

Only directories containing a `SKILL.md` are loaded. A directory without one is skipped
without complaint; a `SKILL.md` that fails validation is **reported** — the reason appears
in the service log, in `/ai/v1/ready` under `skills.rejected`, and in
`discover_skills().rejected` for tests.

## Frontmatter

Delimited by `---` fences at the top of the file. Recognised keys, nothing else:

| Key | Required | Form |
|---|---|---|
| `name` | yes | scalar — the label the model and `playbooksUsed` metadata show |
| `description` | yes | scalar — what the playbook is for |
| `category` | no | scalar |
| `model` | no | scalar (recorded, not yet used to route) |
| `domains` | no (required for `sites/*.md`) | inline `[a.test, b.test]` or a block list |
| `platform` | no | scalar — the display name for a site playbook |

Values may be quoted. Unknown keys are ignored and logged; an unterminated fence makes the
whole file body rather than metadata.

## What belongs in a playbook

Write what you **observed** on the site, and say which observation it came from:

```markdown
---
name: Example board listings
description: How example.test lists jobs, and which fields a first read omits
domains:
  - example.test
---

The listing card shows title and location only. The salary band appears inside
`/jobs/<slug>` after the "Show more" control expands, so a static read of the card is not
the whole record. Pagination is `?page=N`; `?page=1` and no parameter are the same page.

Checked 2026-09-29 against three live postings.
```

What does **not** belong:

* a list of "good sources" for a topic area, with no site-specific content — that is a
  hardcoded default of exactly the kind the audit forbids;
* a claim a run could submit as data. A playbook is navigation guidance: the graph's
  evidence rule still requires every field to come from material retrieved this run. The
  prompt says this, and `app/research/prompts/research.md` is where that wording lives;
* instructions to get past a login screen, CAPTCHA, paywall or other access control. Those
  are refused by the prompt rules and by the tool layer, and a playbook telling the model
  to attempt one would not work.

Playbooks are read at startup and re-read on `SkillLibrary.refresh()`. They are not
editable by a request, and `SkillLibrary.read_resource()` refuses any path that resolves
outside its own skill directory.
