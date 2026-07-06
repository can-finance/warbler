# Git identity for this repo

This repo is pushed to `https://github.com/can-finance/warbler`.

When committing or pushing from this project, always use this identity
(already set as the local `git config user.name` / `user.email` in this
repo's `.git/config`, so no personal info is transmitted):

- name: `Triple Que`
- email: `tripleq@gmail.com`

Do not use the OS/global git identity for this repo. Do not include any
personal information (real name, personal email, employer) in commits,
commit messages, or file contents pushed to this repo.

# Testing

Small, low-risk changes (copy tweaks, CSS, small UI logic) don't need a full
`node test/pitch.test.mjs` run before committing. If unsure whether a change
is "small enough" to skip testing, ask rather than assume.
