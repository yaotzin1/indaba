# Tutorial: every spec, step by step

This is the [spec-first cookbook](cookbook-spec-first.md) done in order: every document you write, word for word, and
every command between them. You build **contacts-app**, the shared contact list of a small office, one window at a
time: login, list, a window to add, change and delete, and finally an export that Indaba builds from your spec alone.

You can copy every text here as it is, or use it as a model for your own app. The specs were checked by building their
API in a reference implementation and testing each requirement (see
[how this recipe was checked](cookbook-spec-first.md#how-this-recipe-was-checked)). Review findings shown on this page
are examples written for this page, not output from a run; your agents will word theirs differently.

## 0. What a good spec has

Every spec below has the same parts, in the same order. When you write your own, keep them:

| Part | It answers | A tester uses it to |
| :--- | :--- | :--- |
| Header: status, depends on | Which features must exist first | Know what is already tested |
| Summary | What a person can do afterwards, in three sentences | Check the stories cover it |
| User stories, P1 / P2, *Given / When / Then* | The behaviour, as scenarios a person would try | Write one test per scenario |
| Requirements `FR-001` ... | Every rule, limit, request, status code and message, exactly | Write one test per requirement, with exact values |
| Edge cases | The boundaries (100 characters valid, 101 not) and the odd cases | Write the boundary tests |
| Out of scope | What will not be built | Not ask; and the agents do not add it |
| Success criteria | What "done" is, including what is checked by hand | Know when to stop |

Three habits make the review short:

1. **Exact values.** "An error is shown" cannot be tested; `401` `{ "error": "Wrong username or password." }` can.
2. **One rule, one place.** A rule for every feature goes in the constitution; a spec refers to it (`constitution IV`)
   instead of repeating it. A later spec refers to an earlier one by its id (`001, FR-009`).
3. **Say what is not built.** Every line of Out of scope is a question the reviewers will not ask.

## 1. Make the project

```bash
mkdir contacts-app && cd contacts-app
git init
mkdir -p .specify/memory specs src public test
printf ".indaba/\nnode_modules/\ndata/\n" > .gitignore
```

`data/` holds the users file and the contacts file the server writes; they are data, not code, and stay out of git.
On Windows `cmd`, write `.gitignore` in an editor with those three lines.

`package.json` (no dependencies: constitution III):

```json
{
  "name": "contacts-app",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test",
    "start": "node src/server.js",
    "add-user": "node src/add-user.js"
  }
}
```

### The constitution: `.specify/memory/constitution.md`

The principles every feature obeys. Write it once, before the first spec, and keep it short: each principle should be
something a reviewer can check. The specs below refer to these by number.

````markdown
# contacts-app Constitution

The shared contact list of a small office. These principles hold for every feature. Where a spec, a plan or the code
disagrees with them, they win, and the other document is wrong.

## Core Principles

### I. Spec first (NON-NEGOTIABLE)

Every change starts as `specs/<NNN-name>/spec.md`, written by a person. The code does nothing the spec does not ask
for. A change of behaviour is first a change of the spec. Agents may write plans, tasks, tests and code; they never
edit a `spec.md`.

### II. Tests first, exact and deterministic

Every requirement (`FR-...`) and every acceptance scenario has a test, written before the code, that asserts the exact
status code and body. Tests inject the clock, the id generator and the random token source; they start the app on
port 0; they never sleep or depend on timing. A test closes what it opens (a server, its connections) in `t.after`,
so that a failing test ends at once instead of keeping `npm test` running.

### III. No runtime dependencies

Node 22 and its standard library only. `package.json` has no `dependencies`. A dependency is a change to this
constitution, not to a feature.

### IV. Secure by default

- Passwords are stored as scrypt hashes (`node:crypto`), compared in constant time, and never logged or returned.
- Every `/api` route needs a signed-in session unless its spec says otherwise.
- The session cookie is `HttpOnly` and `SameSite=Strict`.
- Every request that changes data (`POST`, `PATCH`, `DELETE`) must have `Content-Type: application/json`, or it is
  refused with 415. Together with `SameSite=Strict`, this is the protection against cross-site requests.
- A window puts user data on the page as text (`textContent`), never as HTML.

### V. One error shape

Every error response is JSON: `{ "error": "<message for a person>" }`. A validation error adds
`"fields": { "<field>": "<message>" }` with one entry per invalid field.

### VI. Small and explicit

No option, setting or branch that a spec does not ask for. Unknown request fields and query parameters are refused
with 400, not ignored.

## Quality gate

`npm test` passes. That is the definition of done for every feature, together with a code review whose findings are
fixed or written down as accepted.

## Governance

This file outranks every other document in the repository. It changes only by a commit that says why.

**Version**: 1.0.0 | **Ratified**: the day the project starts
````

### `AGENTS.md`, and `CLAUDE.md`

`AGENTS.md` is what a coding agent reads first: where things are, how to run them, what "done" means. Claude Code reads
`CLAUDE.md`, so make that one line, `@AGENTS.md`, which imports it.

````markdown
# AGENTS.md: contacts-app

Rules for every coding agent working here. Read `.specify/memory/constitution.md` first: it outranks this file.

## What this is

The shared contact list of a small office: a JSON API and three windows (web pages) served by one Node process.
People sign in, list and search contacts, and add, change and delete them. Each feature is specified in
`specs/<NNN-name>/spec.md`.

## Layout

| Path | Holds |
| :--- | :--- |
| `src/app.js` | `createApp({ users, store, sessions, lockout, clock, publicDir })`: the request handler with every route |
| `src/auth.js` | password hashing, sessions, the login lockout |
| `src/users.js` | reading and adding accounts in the users file |
| `src/contacts.js` | contact validation, the store, search, sort and paging |
| `src/server.js` | starts the app on `PORT` (default 3000) with `USERS_FILE` and `DATA_FILE`; nothing else |
| `src/add-user.js` | the `npm run add-user -- <username>` command |
| `public/` | the windows: `login.html`, `contacts.html`, `contact.html`, their scripts and `app.css` |
| `test/` | `node:test` tests, one file per feature |
| `specs/` | one directory per feature. `spec.md` is written by a person: never edit it |

## Commands

```bash
npm test                       # the quality gate
npm start                      # http://localhost:3000
npm run add-user -- alice      # then type the password and press Enter
```

## Rules

1. Spec first: do only what the feature's `spec.md` says. If it is unclear, say so; do not guess.
2. Tests first: write the failing test, then the code. Assert exact status codes and bodies.
3. Inject the clock, ids and tokens (`createApp` takes them); no `Date.now()` or `Math.random()` in `src/` outside
   `src/server.js`.
4. No runtime dependencies.
5. Every error is `{ "error": "..." }` (plus `fields` for validation), as the constitution says.
6. Put user data on a page with `textContent`, never `innerHTML`.

## Done means

`npm test` passes, every `FR-...` of the feature has a test, and the code review's findings are fixed or listed in the
pull request as accepted.
````

```bash
echo "@AGENTS.md" > CLAUDE.md
```

### The two review workflows

Save [`examples/contacts-review-spec.workflow.ai.yml`](../examples/contacts-review-spec.workflow.ai.yml) and
[`examples/contacts-review-code.workflow.ai.yml`](../examples/contacts-review-code.workflow.ai.yml) in the folder under
the same names. Check them for free (no agent is started):

```bash
indaba validate contacts-review-spec.workflow.ai.yml && indaba plan contacts-review-spec.workflow.ai.yml
git add . && git commit -m "contacts-app: constitution, AGENTS.md, review workflows"
```

## 2. Feature 001: the login window

### 2.1 The first draft

Most first drafts look like this. Write yours quickly; the review is there to find what is missing. Save it as
`specs/001-login/spec.md`:

```markdown
# Feature 001: Login window

## Summary

People sign in with a username and a password before they see the contacts.

## User stories

1. **Given** an account, **when** the person enters the right username and password, **then** they see the contacts.
2. **When** the password is wrong, an error is shown.
3. A person who is signed in can sign out.

## Requirements

- **FR-001** `POST /api/login` checks the username and the password and starts a session.
- **FR-002** `POST /api/logout` ends the session.
- **FR-003** Every other `/api` route needs a session.
- **FR-004** The login window has a Username field, a Password field and a Sign in button.
```

### 2.2 Review it

```bash
git add specs/001-login && git commit -m "001-login: draft"
indaba run contacts-review-spec.workflow.ai.yml
indaba watch latest --plain
```

The feature line in the workflow already says `specs/001-login`. The board at the end of `watch --plain` holds the
debate. For a draft like this, expect findings of this kind (written for this page, one for each real gap in the draft):

1. **FR-001** gives no status codes or bodies: for a right password, a wrong one, or a malformed request. A tester
   cannot assert anything.
2. **US2** does not say what an unknown username gets. A different message from a wrong password tells an attacker
   which accounts exist.
3. **Security**: nothing limits failed attempts, so a password can be guessed without end.
4. **FR-001** "starts a session": for how long, in what cookie, with which flags? Constitution IV requires `HttpOnly`
   and `SameSite=Strict`, and the draft does not mention either.
5. **Summary**: there is no sign-up window and no way to create an account, so nobody can ever sign in.

### 2.3 Fix it

Each finding becomes requirements with exact values: 1 becomes FR-004 (every status and body); 2 becomes US1.3 and the
same 401 for both cases, with a dummy hash so both take the same time; 3 becomes US3 and FR-007 (five failures in 15
minutes lock the username); 4 becomes FR-004's cookie and FR-005 (30 minutes idle); 5 becomes US4 and FR-014 (the
`add-user` command). The window's states (FR-012) and the redirects (FR-011) are added before the reviewers ask. What
you decided not to build goes to Out of scope, so the next review does not raise it. Commit and review again until
what is left is only what you accept. The finished spec:

```markdown
# Feature 001: Login window

**Status**: reviewed | **Depends on**: nothing

## Summary

People in the office sign in with a username and a password before they see any contact. Accounts are created by the
person who runs the server, with a command; there is no sign-up window. After signing in, a person stays signed in
until they sign out or are inactive for 30 minutes.

## User stories

### US1: Sign in (P1)

Alice opens the app and signs in, so that she can work with the contacts.

1. **Given** the account `alice` with the password `correct horse 1`, **when** she enters both in the login window and
   presses Sign in, **then** she is taken to `/contacts` and sees "Signed in as alice".
2. **Given** the same account, **when** she enters a wrong password, **then** she stays on the login window, sees
   "Wrong username or password.", the password field is empty and the username is kept.
3. **Given** no account `bob`, **when** someone signs in as `bob`, **then** they see exactly the same message as in 2.
4. **Given** Alice typed `Alice` with a capital letter, **when** she signs in with the right password, **then** she
   is signed in as `alice`.

### US2: Sign out (P1)

1. **Given** Alice is signed in, **when** she presses Sign out, **then** she is on the login window, and the browser's
   Back button shows no contact data (every API call answers 401 and the window goes to `/login`).
2. **Given** Alice signed in and made no request for 30 minutes, **when** she makes one, **then** it answers 401 and
   the window goes to `/login`.

### US3: Too many wrong passwords (P2)

1. **Given** 5 failed sign-ins for `alice` within 15 minutes, **when** anyone tries to sign in as `alice` again, even
   with the right password, **then** they see "Too many attempts. Try again in 15 minutes." (the number is the
   minutes left, rounded up), until 15 minutes after the fifth failure.
2. **Given** 4 failed sign-ins for `alice`, **when** she signs in with the right password, **then** she is signed in
   and the count starts again from 0.

### US4: Create an account (P2)

1. **Given** the server's folder, **when** the administrator runs `npm run add-user -- alice` and types a password,
   **then** the account exists the next time the server starts.

## Requirements

- **FR-001** A username is 3 to 32 characters of `a`-`z`, `0`-`9`, `.`, `_` and `-`. It is stored in lowercase, and
  the username given at sign-in is lowercased before it is looked up.
- **FR-002** A password is 8 to 128 characters. Its length is checked only when the account is created.
- **FR-003** A password is stored as `scrypt$<salt>$<hash>`: a random 16-byte salt and a 64-byte scrypt hash
  (`node:crypto`, N=16384, r=8, p=1), both in hex. It is compared with `timingSafeEqual`. No password or hash
  appears in any response or log line.
- **FR-004** `POST /api/login` with `{ "username": "...", "password": "..." }`:
  - `200` `{ "username": "alice" }` and the header
    `Set-Cookie: sid=<token>; HttpOnly; SameSite=Strict; Path=/`, where the token is 32 random bytes in base64url.
  - `400` `{ "error": "Send a username and a password." }` when the body is not a JSON object with exactly those two
    string fields.
  - `401` `{ "error": "Wrong username or password." }` for an unknown username or a wrong password: the same status
    and body. For an unknown username a stored dummy hash is verified, so both cases do the same work.
  - `429` `{ "error": "Too many attempts. Try again in <n> minutes." }` with `Retry-After: <seconds>` while the
    username is locked (FR-007). `<n>` is the seconds left divided by 60, rounded up.
- **FR-005** A session lives in the server's memory. It ends 30 minutes after the last request that carried it; every
  request that carries a valid session moves that time forward. Restarting the server ends every session.
- **FR-006** `POST /api/logout` ends the session in the cookie, if there is one, and answers `204` with
  `Set-Cookie: sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`. Its body is ignored. It answers 204 even with no
  valid session.
- **FR-007** Failed sign-ins are counted per lowercased username, whether the account exists or not. When 5 failures
  happened within 15 minutes, the username is locked until 15 minutes after the fifth. While it is locked, attempts
  are refused with 429, are not counted and do not extend the lock. A successful sign-in sets the count to 0.
- **FR-008** `GET /api/session` answers `200` `{ "username": "alice" }` with a valid session, and `401`
  `{ "error": "Not signed in." }` without one.
- **FR-009** Every other `/api/` route answers `401` `{ "error": "Not signed in." }` without a valid session. This
  holds for the routes of later features too.
- **FR-010** A `POST` to `/api/login` or `/api/logout` without `Content-Type: application/json` answers `415`
  `{ "error": "Content-Type must be application/json." }` (constitution IV).
- **FR-011** Windows: `GET /login` serves the login window, or redirects (`303`, `Location: /contacts`) when the
  session is valid. `GET /` redirects to `/contacts`. `GET /contacts` and any path under `/contacts/` redirect to
  `/login` without a valid session. In this feature `/contacts` is a placeholder window with "Signed in as
  <username>" and a Sign out button; feature 002 replaces it.
- **FR-012** The login window has the title "Contacts: sign in", a Username field (`autocomplete="username"`, focused
  when the window opens), a Password field (`type="password"`, `autocomplete="current-password"`) and a Sign in button.
  Enter in either field signs in. While the request is under way the button is disabled and reads "Signing in…". An
  error from the API is shown, as its `error` text, in an area with `role="alert"`; when the server cannot be
  reached it shows "Cannot reach the server. Try again.".
- **FR-013** Every window after sign-in shows "Signed in as <username>" and a Sign out button. Whenever an API call
  answers 401, the window goes to `/login`.
- **FR-014** `npm run add-user -- <username>` reads the password from the first line of standard input, checks FR-001
  and FR-002, and adds the account to the users file (`USERS_FILE`, default `data/users.json`, created with its folder
  if missing) as `{ "users": [{ "username", "passwordHash", "createdAt" }] }`. It prints `User alice added.` and
  exits 0; for an invalid username or password, or one that exists, it prints the reason and exits 1. The server
  reads the users file when it starts.

## Edge cases

- A username with spaces around it is invalid at sign-in like any other: it is not trimmed (401, counted as a failure
  for that exact text, lowercased).
- Two sign-ins for the same account give two sessions; signing out of one leaves the other.
- A cookie with an unknown, ended or malformed token is the same as no cookie.

## Out of scope

Sign-up, changing or resetting a password, roles, "remember me", HTTPS (the app runs on the office network; put a
proxy in front for HTTPS), keeping sessions across a restart, deleting accounts.

## Success criteria

- Every scenario above and every FR has a test, and `npm test` passes.
- No response body and no log line contains a password or a hash (a test searches the output for both).
```

```bash
git add specs/001-login && git commit -m "001-login: reviewed"
indaba run contacts-review-spec.workflow.ai.yml      # the last review: what is left, you accept
```

### 2.4 Implement it

Write it yourself, or give your coding agent this prompt (Claude Code reads `CLAUDE.md`, so `AGENTS.md`, by itself):

```text
Implement specs/001-login/spec.md. Read AGENTS.md and .specify/memory/constitution.md first.
Write the failing tests first, in test/login.test.js, one or more for every FR and every scenario, with exact
status codes and bodies; then the code. Do not edit spec.md. If the spec is unclear or contradicts the
constitution, stop and tell me instead of guessing. Run npm test before you finish.
```

What a reviewer will look for, so check it yourself first: the same 401 body for an unknown user and a wrong password;
the minutes in the 429 rounded up (14 minutes and 1 second left is "15 minutes"); the cookie flags exactly as FR-004
says; no password or hash in any response or log; the clock injected, so the lockout and the idle time are tested
without waiting.

```bash
npm test
npm run add-user -- alice        # type a password, press Enter
npm start                        # sign in at http://localhost:3000
git add . && git commit -m "001-login: implemented"
```

### 2.5 Review the code

```bash
indaba run contacts-review-code.workflow.ai.yml
indaba watch latest --plain
```

Fix what you agree with and commit. A finding that the spec itself is wrong is fixed in the spec first, then in the
code and its test.

## 3. Feature 002: the contact list window

Point both review workflows at the new feature (the line `feature: "specs/001-login"` becomes
`feature: "specs/002-contact-list"`), then write the spec. This one defines the contact itself, because the list is the
first feature that shows one; feature 003 adds the rules for creating and changing it.

```markdown
# Feature 002: Contact list window

**Status**: reviewed | **Depends on**: 001-login

## Summary

After signing in, a person sees the office's contacts in a table: they can search, sort by a column and page through
the results. Everyone signed in sees the same contacts. Adding and changing contacts is feature 003; until then the
contacts come from the data file.

## The contact

A contact has these fields. Their rules for creating and changing are in feature 003.

| Field | Type |
| :--- | :--- |
| `id` | string, a UUID made by the server (`crypto.randomUUID()`) |
| `name` | string, never empty |
| `email`, `phone`, `company`, `notes` | string, `""` when not given |
| `createdAt`, `updatedAt` | string, ISO 8601 in UTC (`2026-11-01T20:15:00.000Z`) |
| `version` | whole number, 1 when created, plus 1 on every change |

The contacts are kept in memory and loaded, when the server starts, from the data file (`DATA_FILE`, default
`data/contacts.json`), shaped `{ "contacts": [ ... ] }`. A missing file is an empty list. A file that is not valid
JSON in that shape stops the server with a message naming the file.

## User stories

### US1: See the contacts (P1)

1. **Given** 3 contacts, **when** Alice opens `/contacts`, **then** she sees all 3 in a table, sorted by name.
2. **Given** no contacts, **when** she opens `/contacts`, **then** she sees "No contacts yet."

### US2: Search (P1)

1. **Given** contacts "Anna Kowalska" (company "Acme") and "Piotr Nowak" (email "piotr@acme.pl"), **when** Alice types
   `acme`, **then** both are shown; **when** she types `anna`, **then** only Anna is.
2. **Given** nothing matches `xyz`, **when** she searches for it, **then** she sees "No contacts match “xyz”."

### US3: Sort and page (P2)

1. **Given** 45 contacts, **when** she opens the list, **then** she sees the first 20 and "Showing 1–20 of 45";
   **when** she presses Next twice, **then** she sees "Showing 41–45 of 45" and Next is disabled.
2. **When** she clicks the Company header, **then** the list is sorted by company A to Z; **when** she clicks it again,
   Z to A.
3. **Given** she searched, sorted and paged, **when** she reloads the window or comes back to it, **then** she sees the
   same search, sort and page.

## Requirements

- **FR-001** `GET /api/contacts` takes these query parameters, all optional:
  - `q`: up to 100 characters; leading and trailing spaces are removed. A contact matches when its `name`, `email`,
    `company` or `phone` contains `q`, compared case-insensitively. An empty `q` matches every contact.
  - `sort`: `name` (the default), `company` or `updatedAt`.
  - `order`: `asc` (the default) or `desc`.
  - `page`: a whole number of 1 or more, default 1.
  - `pageSize`: a whole number from 1 to 100, default 20.
- **FR-002** It answers `200` with
  `{ "items": [ ... ], "total": <matches>, "page": <page>, "pageSize": <pageSize> }`. Each item has `id`, `name`,
  `email`, `phone`, `company` and `updatedAt`, and nothing else. A page after the last one answers `200` with
  `"items": []` and the real `total`.
- **FR-003** Sorting compares text with `a.localeCompare(b, "en", { sensitivity: "base" })` and `updatedAt` as text
  (ISO 8601 sorts in time order). For `sort=company`, contacts with an empty company come last in both orders. Ties
  are broken by `name`, then by `id`, both ascending, in both orders.
- **FR-004** A parameter that is not listed in FR-001 answers `400` `{ "error": "Unknown parameter: <name>." }`. A
  parameter given twice, or with a value outside its rule, answers `400`
  `{ "error": "Invalid query.", "fields": { "<name>": "<rule it breaks>" } }`, one entry per bad parameter.
- **FR-005** Without a valid session it answers `401` (001, FR-009).
- **FR-006** The list window replaces the placeholder of 001 at `/contacts`. From top to bottom: the title "Contacts",
  "Signed in as <username>" and Sign out (001, FR-013); a search box with the placeholder
  "Search name, email, company or phone"; the table; the paging line.
- **FR-007** The search runs 300 ms after the last keystroke, or at once on Enter, and goes back to page 1.
- **FR-008** The table's columns are Name, Company, Email, Phone and Updated (the date of `updatedAt` as `YYYY-MM-DD`
  in the browser's time zone). Clicking Name, Company or Updated sorts by that column, ascending; clicking the sorted
  column again reverses the order. The sorted column header shows ▲ or ▼ and has `aria-sort`. Sorting goes back to
  page 1.
- **FR-009** Below the table: "Showing <first>–<last> of <total>" and the buttons Previous and Next, each disabled when
  there is no page in its direction. With no results the line is not shown.
- **FR-010** The search, sort, order and page are kept in the window's URL (`/contacts?q=acme&sort=company&order=desc&page=2`),
  only those that differ from the defaults, so a reload, the Back button and a bookmark show the same list.
- **FR-011** States of the table: while loading, "Loading…"; no contacts and no search, "No contacts yet."; no match,
  "No contacts match “<q>”."; a failed request (not 401), "Could not load contacts." and a Try again button that
  repeats it. A 401 goes to `/login` (001, FR-013).
- **FR-012** Every value from a contact is put on the page as text (constitution IV).

## Edge cases

- `q` of exactly 100 characters is valid; 101 is a 400.
- `page=0`, `page=1.5`, `page=abc`, `pageSize=101` and `pageSize=0` are 400s; `page=999` with 45 contacts is a 200 with
  no items.
- A contact whose name contains `<b>` shows the characters `<b>`, not bold text.
- Two contacts with the same name are always in the same order (FR-003), so paging never shows one twice.

## Out of scope

Adding, changing and deleting contacts (003), filtering by one field, choosing columns, selecting several rows,
export (004), infinite scrolling.

## Success criteria

- Every scenario and FR that the API decides has a test, and `npm test` passes.
- The window's behaviour (FR-006 to FR-012) is checked by hand with the scenarios above, using a data file with 45
  contacts.
```

Before you run the review, read it once as a tester would. The parts reviewers most often question in a list:

- **Sort ties** (FR-003): without "ties are broken by name, then by id", two contacts with the same name can swap
  places between page 1 and page 2, and one is shown twice.
- **Empty values** in a sorted column: does an empty company come first or last? Say it, for both orders.
- **Every parameter's rule and its error**, including a parameter given twice.
- **Every state of the window**: loading, empty, no match, failed, signed out.

```bash
git add . && git commit -m "002-contact-list: spec"
indaba run contacts-review-spec.workflow.ai.yml
# fix, commit, review again; then implement (the prompt of 2.4, with specs/002-contact-list and test/list.test.js)
npm test && git add . && git commit -m "002-contact-list: implemented"
indaba run contacts-review-code.workflow.ai.yml
```

To try the window before feature 003 exists, put contacts in `data/contacts.json` by hand, in the shape the spec gives,
and restart the server. Forty-five of them show the paging of US3.

## 4. Feature 003: the contact window

Change the feature line of both review workflows to `specs/003-contact-edit`. This is the largest spec: three ways in
(new, change, delete), two people at once, and saving to a file.

```markdown
# Feature 003: Contact window (add, change, delete)

**Status**: reviewed | **Depends on**: 001-login, 002-contact-list

## Summary

From the list, a person opens one contact in its own window to change or delete it, or opens an empty window to add a
new one. Two people can have the same contact open: the second to save is told, instead of silently overwriting the
first. Every change is saved to the data file before the window is told it worked.

## User stories

### US1: Add a contact (P1)

1. **Given** the list window, **when** Alice presses New contact, fills in Name "Anna Kowalska" and Email
   "anna@acme.pl" and presses Save, **then** she is back on the list as she left it, and Anna is in it.
2. **When** she presses Save with an empty Name, **then** nothing is saved, "Enter a name." is shown under Name and the
   Name field has the focus.

### US2: Change a contact (P1)

1. **Given** Anna in the list, **when** Alice clicks her row, changes Company to "Acme" and presses Save, **then** she
   is back on the list and Anna's company is "Acme".
2. **Given** she has changed nothing, **then** Save is disabled.
3. **Given** she changed a field, **when** she presses Cancel or Back, **then** she is asked "Discard your changes?";
   **when** she says no, she stays with her changes.

### US3: Someone else saved first (P1)

1. **Given** Alice and Piotr both opened Anna (version 3), and Piotr saved, **when** Alice presses Save, **then**
   nothing is saved and she sees "This contact was changed by someone else." with two buttons: Load latest (shows
   Piotr's version and drops her changes) and Overwrite with mine (saves her changes over his).

### US4: Delete a contact (P2)

1. **Given** Anna's window, **when** Alice presses Delete, **then** she is asked "Delete Anna Kowalska? This cannot be
   undone."; **when** she confirms, Anna is deleted and Alice is back on the list; **when** she cancels, nothing
   happens.
2. **Given** Piotr deleted Anna, **when** Alice opens Anna's window from an old list or a bookmark, **then** she sees
   "This contact no longer exists." and Back to list.

## Requirements

- **FR-001** The fields a person can set, after removing leading and trailing spaces:
  - `name`: required, 1 to 100 characters.
  - `email`: optional; when given, at most 254 characters and matching `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
  - `phone`: optional; when given, at most 30 characters of digits, spaces and `+ - ( )`, with at least one digit.
  - `company`: optional, at most 100 characters.
  - `notes`: optional, at most 2000 characters; line breaks are kept (only the ends are trimmed).
  An optional field that is missing or empty is stored as `""`. The trimmed value is what is stored.
- **FR-002** The messages for a field that breaks its rule: `name`: "Enter a name." (empty) or "Use at most 100
  characters."; `email`: "Enter a valid email address." or "Use at most 254 characters."; `phone`: "Use digits,
  spaces and + - ( ) only, with at least one digit." or "Use at most 30 characters."; `company`: "Use at most 100
  characters."; `notes`: "Use at most 2000 characters."; a field that is not a string: "Must be text."; a field that is
  not one of the five (or `version` where it is allowed): "Unknown field.".
- **FR-003** `POST /api/contacts` with any of the five fields (`name` required) creates a contact with `version` 1 and
  `createdAt` = `updatedAt` = now, and answers `201` with the whole contact and `Location: /api/contacts/<id>`.
- **FR-004** `GET /api/contacts/<id>` answers `200` with the whole contact (every field of 002, "The contact"), or
  `404` `{ "error": "Contact not found." }`. An id that is not a UUID is a 404 too.
- **FR-005** `PATCH /api/contacts/<id>` with `version` (required) and at least one of the five fields changes only
  the fields given, adds 1 to `version`, sets `updatedAt` to now and answers `200` with the whole contact.
- **FR-006** `DELETE /api/contacts/<id>` with `{ "version": <n> }` deletes the contact and answers `204` with no body.
- **FR-007** Errors of FR-003 to FR-006, checked in this order, the first that applies:
  1. `401` without a valid session (001, FR-009);
  2. `415` `{ "error": "Content-Type must be application/json." }` for a POST, PATCH or DELETE without it;
  3. `400` `{ "error": "The body must be a JSON object." }` when it is not valid JSON or not an object;
  4. `404` `{ "error": "Contact not found." }` for an id that does not exist (PATCH, DELETE);
  5. `400` `{ "error": "Invalid contact.", "fields": { ... } }` with one entry per field that breaks FR-001 or FR-002,
     including `"version": "Send the version you loaded."` when `version` is missing or not a whole number of 1 or
     more, and `"name": "Enter a name."` when a POST has no name; a PATCH with only `version` answers
     `{ "error": "Change at least one field." }`;
  6. `409` `{ "error": "This contact was changed by someone else.", "current": <the whole stored contact> }` when
     `version` is not the stored version (PATCH, DELETE).
- **FR-008** A change is written to the data file (002) before the answer: to a temporary file in the same folder,
  then renamed over the old one. If that fails, the answer is `500` `{ "error": "Could not save. Try again." }`, and
  the contacts in memory are as they were before the request.
- **FR-009** The contact window is `/contacts/new` for a new contact and `/contacts/<id>` for an existing one. Its
  title is "New contact" or the contact's name. It has the fields Name (marked required), Email, Phone, Company and
  Notes (several lines), the buttons Save and Cancel, and, for an existing contact, Delete. It also shows "Signed in as
  <username>" and Sign out (001, FR-013).
- **FR-010** Save checks FR-001 in the window first and shows the same messages as FR-002 under each field, with the
  focus on the first wrong field; the server's `fields` are shown the same way. For an existing contact, Save sends
  only the changed fields and the loaded `version`, and is disabled while nothing is changed. While saving, Save,
  Cancel and Delete are disabled and Save reads "Saving…". After a 201, 200 or 204 the window goes back to the list.
- **FR-011** "Back to the list" means the list's URL as it was when the contact window was opened, with its search,
  sort and page (002, FR-010). The list window stores its URL in `sessionStorage` under `contacts.listUrl` whenever it
  changes; the contact window goes there, or to `/contacts` when it is not set.
- **FR-012** On a 409 the window shows the message and the buttons of US3. Load latest shows the `current` contact
  from the answer and drops the person's changes. Overwrite with mine repeats the save with the `current` contact's
  `version`.
- **FR-013** Leaving with changes not saved (Cancel, Back, Sign out, a link) asks "Discard your changes?" first.
  Closing the tab or reloading uses the browser's own leave-page warning.
- **FR-014** Delete asks "Delete <name>? This cannot be undone." in a dialog with Delete and Cancel; Delete sends the
  request with the loaded `version`. A 409 shows the US3 message with Load latest only.
- **FR-015** When loading the contact answers 404, the window shows "This contact no longer exists." and a Back to list
  button, and no fields.
- **FR-016** Changes to the list window (002): a New contact button next to the search box opens `/contacts/new`; each
  row opens `/contacts/<id>` by click, and by Enter when the row has the focus.

## Edge cases

- `name` of 100 characters after trimming is valid; `"  "` is "Enter a name.".
- A PATCH that sets `email` to `""` clears it.
- A PATCH whose values are the same as the stored ones still adds 1 to `version`.
- A DELETE of a contact that was already deleted answers 404.

## Out of scope

Undo, history of changes, finding duplicates, photos, custom fields, changing several contacts at once, keeping
unsaved changes after a 401.

## Success criteria

- Every scenario and FR that the API decides has a test, and `npm test` passes; FR-008 is tested with a data file
  path that cannot be written.
- The window's behaviour (FR-009 to FR-016) is checked by hand with the scenarios above, two of them (US3) in two
  browser windows signed in as different people.
```

What makes this spec reviewable:

- **The order of the errors** (FR-007). A request can be wrong in several ways at once (no session, no JSON, a
  missing contact, a bad field, an old version). Without an order, two correct implementations answer differently and
  a test has to guess.
- **The conflict** (US3, FR-012). `version` is how "someone else saved first" is noticed, and the 409 carries the
  stored contact so the window can show it without another request.
- **What happens when saving fails** (FR-008): memory and file stay as they were. A tester can only check this
  because the spec says what to point the data file at.
- **What changes in the earlier window** (FR-016): a later spec says exactly what it adds to an earlier one, instead
  of editing the earlier spec.

```bash
git add . && git commit -m "003-contact-edit: spec"
indaba run contacts-review-spec.workflow.ai.yml
# fix, commit, review again; implement (test/edit.test.js); then:
npm test && git add . && git commit -m "003-contact-edit: implemented"
indaba run contacts-review-code.workflow.ai.yml
```

US3 is the scenario to try by hand: two browser windows, two people signed in (add a second user with
`npm run add-user -- piotr`), the same contact open in both, then save in one and then in the other.

## 5. Keep the process: `workflow.ai.yml`

Three times now you have done the same thing: spec, review, tests first, code, `npm test`, review. Write it down. Save
[`examples/contacts.workflow.ai.yml`](../examples/contacts.workflow.ai.yml) at the root of the project as
`workflow.ai.yml`. It has one line to change per feature:

```yaml
artifacts:
  feature: "specs/004-export"   # the feature to build: change it for each spec
```

Its steps are explained in the cookbook, under
[Keeping the process](cookbook-spec-first.md#keeping-the-process-workflowaiyml). Two things in it come straight from
the three features you built:

- The goals of `tests` and `implement` say what you said in your prompt in 2.4: read `AGENTS.md`, tests first with
  exact values, never edit `spec.md`, and ask (as a `BOARD question:` line) instead of guessing.
- It starts with the spec gate, because a spec that cannot be built should stop the run before any code is written.

```bash
indaba validate workflow.ai.yml && indaba plan workflow.ai.yml
git add workflow.ai.yml && git commit -m "Keep the process in workflow.ai.yml"
```

`indaba plan` prints the ten steps and what each may change: check that `tests` may change only `test/**` and
`specs/*/tasks.md`, and `implement` only `src/**`, `public/**` and `specs/*/tasks.md`.

## 6. Feature 004: export, built by the workflow

From here on you write only the spec. Review it while you draft, as before (change the feature line of
`contacts-review-spec.workflow.ai.yml` to `specs/004-export`), then save the final version as
`specs/004-export/spec.md`:

```markdown
# Feature 004: Export the list as CSV

**Status**: reviewed | **Depends on**: 001-login, 002-contact-list

## Summary

From the list window, a person downloads the contacts they are looking at (the current search, in the current sort,
every page) as a CSV file that a spreadsheet opens correctly.

## User stories

### US1: Export what I see (P1)

1. **Given** the list searched for `acme` and sorted by company, **when** Alice presses Export CSV, **then** her
   browser downloads `contacts-2026-11-01.csv` (today's date), with every contact matching `acme`, in that order,
   not only the current page.
2. **Given** a contact whose notes have a comma, a quote and a line break, **when** the file is opened in a
   spreadsheet, **then** the notes are in one cell, exactly as typed.
3. **Given** no contact matches the search, **then** Export CSV is disabled.

### US2: A cell cannot run as a formula (P1)

1. **Given** a contact named `=HYPERLINK("http://example.com")`, **when** the file is opened in a spreadsheet,
   **then** the cell shows that text and is not a formula.

## Requirements

- **FR-001** `GET /api/contacts/export` takes `q`, `sort` and `order` with the rules, defaults and errors of 002
  (FR-001, FR-003, FR-004). `page` and `pageSize` are unknown parameters here (400).
- **FR-002** It answers `200` with `Content-Type: text/csv; charset=utf-8` and
  `Content-Disposition: attachment; filename="contacts-<YYYY-MM-DD>.csv"`, the date being today in UTC from the
  server's clock.
- **FR-003** The body starts with the UTF-8 byte order mark (`EF BB BF`), then the header line
  `name,email,phone,company,notes,createdAt,updatedAt`, then one line per matching contact in the order of 002, FR-003.
  Lines end with CRLF, the last one included.
- **FR-004** A value that contains a comma, a double quote, CR or LF is put in double quotes, with each double quote
  doubled. Other values are written as they are.
- **FR-005** A value that starts with `=`, `+`, `-`, `@`, a tab or CR gets a single quote (`'`) in front of it, before
  FR-004 is applied. This applies to every column, so a phone number `+48 600 100 200` is written `'+48 600 100 200`.
- **FR-006** Without a valid session it answers `401` (001, FR-009).
- **FR-007** The list window has an Export CSV button in the toolbar, next to New contact. It opens
  `/api/contacts/export` with the window's current `q`, `sort` and `order`, so the browser downloads the file. It is
  disabled while the list shows no contacts.

## Edge cases

- No contacts match: still a 200 with the BOM and the header line only (the button is disabled, but the API answers).
- An empty value is written as nothing between the commas.
- A name with non-Latin characters (`Łucja Żak`) is written as UTF-8 and shows correctly thanks to the BOM.

## Out of scope

Importing, choosing columns, other formats (Excel, vCard), exporting selected rows only.

## Success criteria

- Every scenario and FR that the API decides has a test, and `npm test` passes.
- The file from US1 opens in a spreadsheet with one row per contact and the notes of US1.2 in one cell (checked by
  hand).
```

FR-005 is the kind of rule a review exists for: a CSV opened in a spreadsheet runs any cell that starts with `=` as
a formula. Writing it in the spec, with the consequence spelled out (a phone number starting with `+` gets a `'` too),
means the tests check it and nobody "fixes" it later by accident.

Then let the workflow build it:

```bash
git add specs/004-export && git commit -m "004-export: spec"
indaba run workflow.ai.yml
```

What happens, step by step: `check_spec` finds your committed spec; `spec_gate` asks the two reviewers whether anything
blocks building it (if they cannot agree, you decide); `tasks` writes `specs/004-export/tasks.md`; `tests` writes
`test/export.test.js`, failing for now; `implement` writes the code until the tests pass; `verify` runs `npm test` and,
if it fails, sends the failure back to `implement` (up to three times); `code_review` debates the result. Each stage is
a commit on the branch `indaba/specs/004-export`:

```bash
git log --oneline indaba/specs/004-export
git diff main...indaba/specs/004-export          # or master, whichever your first branch is
npm test                                          # on the branch: git checkout indaba/specs/004-export
git merge indaba/specs/004-export
```

Read `tasks.md` and the tests before the code: if a test asserts something the spec does not say, the spec or the
test is wrong, and the review's findings on the board say which.

## 7. Your next feature

Copy this skeleton to `specs/<NNN-name>/spec.md`, fill it in, review it with `contacts-review-spec`, then change the
feature line in `workflow.ai.yml` and run it:

```markdown
# Feature NNN: <name>

**Status**: draft | **Depends on**: <ids>

## Summary
<What a person can do afterwards, in up to three sentences.>

## User stories
### US1: <title> (P1)
1. **Given** <state>, **when** <action>, **then** <exact result>.

## Requirements
- **FR-001** <one rule, with exact values: request, status, body, message, limit>.

## Edge cases
- <boundary: the largest valid value, the first invalid one>

## Out of scope
<What will not be built.>

## Success criteria
- Every scenario and FR that the API decides has a test, and `npm test` passes.
- <what is checked by hand>
```

Before you commit it, check: every action has its success and its failure answers; every field has a type and a limit;
every message is written out; the windows' states are listed (loading, empty, error, signed out); it refers to the
constitution and earlier specs instead of repeating them; and Out of scope is not empty.

## See also

- [Cookbook: you write the specs, Indaba reviews them](cookbook-spec-first.md): the process, the three workflow files,
  and what to do when a run goes wrong.
- [Tutorial: get the best result](cookbook-tutorial.md): the same advice for the cookbooks where agents write the spec.
- [Workflow format](workflow-format.md): debates, the arbiter, permissions and retries.
