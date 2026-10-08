# StudyOS

**Your Personal Academic Operating System** — an offline-first Windows desktop app for managing an entire academic journey (school → university → Master's → PhD → professional learning), for any field of study.

Built with Tauri 2, React, TypeScript, Vite, Tailwind CSS and SQLite.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Foundation: shell, sidebar, dashboard, SQLite + migrations, institutions → programmes → years → semesters → courses, grading scales, settings, Windows packaging | **Done** |
| 1b | Accounts (Firebase Auth) and per-user cloud sync (Cloud Firestore) | **Done** |
| 2 | Lectures, Quick Lecture Mode, notes editor (LaTeX, code, tables, checklists), templates, autosave + crash recovery, attachments, PDF viewer, split screen | **Done** |
| 3 | Calendar (day/week/month/agenda), timetable, recurring classes, work schedule, conflict detection with suggestions, Windows reminders, ICS import/export | **Done** |
| 4 | Assignments, exams, grade calculator, GPA & "what if?", performance & Top Student Mode, tasks, attendance, study timer, smart study planner | **Done** |
| 5a | Learning engine: tracks → subjects → levels → lessons, 8 question types, adaptive quizzes with 5-part feedback, flashcards + spaced repetition, topic mastery, formula library, diagnostics + study plans, content-pack installer | **Done** |
| 5b | AI Preparation pack: 83 lessons + 7 guided projects, 405 questions, 151 flashcards, 65 formulas, 50-question diagnostic; 5 interactive visualizations | **Done** |
| 6 | Knowledge base (concepts linked across courses), global full-text search + Ctrl+K, tags and #hashtags, Files page, Ask My Studies (local) | **Done** |
| 7 | Projects (milestones, tasks, notes, files, team, links), research/thesis workspace, paper library with reading notes, APA 7 + BibTeX, DOI lookup | **Done** |
| 8 | Optional AI (OpenAI, Anthropic, Ollama): summaries, explanations, note clean-up, flashcards, quizzes, revision plans, paper summaries, AI answers in Ask My Studies | **Done** |
| 9a | Backups (daily automatic, keep 14, restore, import), "Export everything" ZIP, exports to JSON / Markdown / PDF / CSV | **Done** |
| 9b | Windows polish (system tray, close to tray, optional Ctrl+Shift+S), performance pass with years of data, paged long lists | **Done** |

## Prerequisites (development machine only)

End users only need the installer. To build from source you need:

1. **Node.js 20+** and npm
2. **Rust** (stable, MSVC toolchain) — install from <https://rustup.rs>
3. **Microsoft C++ Build Tools** — <https://aka.ms/vs/17/release/vs_BuildTools.exe>, with the *Desktop development with C++* workload (MSVC + Windows SDK)
4. **WebView2** — preinstalled on Windows 10/11

Check with `npx tauri info`.

## Firebase setup (one time)

StudyOS uses Firebase for accounts and to keep each user's data in their own private cloud space.

1. Go to <https://console.firebase.google.com>, then **Add project**. Analytics isn't needed and can be left off.
2. **Build → Authentication → Get started → Sign-in method**: enable **Email/Password**.
3. **Build → Firestore Database → Create database**: choose **Production mode** and an **EU location** (e.g. `eur3` or `europe-west1`), since study data is personal data under GDPR.
4. **Firestore → Rules**: paste the contents of [`firestore.rules`](firestore.rules) and **Publish**. Or, with the Firebase CLI: `firebase deploy --only firestore:rules`.
5. **Project settings → General → Your apps → Web (</>)**: register an app (no hosting needed) and copy its config.
6. Copy `.env.example` to `.env.local` and fill in `apiKey`, `authDomain`, `projectId` and `appId`.
7. Restart `npm run tauri dev`. The values are built into the app, so rebuild the installer after changing them.

### How sync works

- The local SQLite database stays the working copy: the app is fast, works offline, and shows changes immediately.
- Each user's data lives in Firestore at `users/{uid}/{table}/{rowId}`. The security rules allow a signed-in user to access only their own path.
- Sync runs at sign-in, a few seconds after each edit, when the window regains focus or the network returns, and every 3 minutes. If the same record was edited on two devices, the most recent edit wins.
- Signing in with a *different* account on the same PC clears the local copy first. If the previous account still has unsynced changes, StudyOS asks before discarding them.
- You must be online to sign in for the first time; after that the app opens offline.
- **Attachments are local-only.** File details (name, size, which lecture they belong to) sync; the files themselves stay in `%LOCALAPPDATA%com.studyos.appattachments` on the computer that added them. Other computers show them as "On another computer".
- If the same note is edited on two computers before they sync, the most recent save wins.

## Notes, lectures and files

- **Quick Lecture Mode** (`Start lecture` on a course or lecture): opens today's lecture (creating it if needed) with the lecture template, slides on the left and notes on the right.
- **Editor**: headings, bold/italic/underline/strike, highlight, lists, checklists, tables, quotes, links, images, code blocks with syntax highlighting and a copy button, and LaTeX via KaTeX. Markdown shortcuts work as you type (`#`, `-`, `[]`, three backticks for code, `$$x^2$$` for inline maths); Ctrl+M inserts inline maths, Ctrl+Shift+M an equation, Ctrl+K a link.
- **Autosave**: about 1.5 s after you stop typing, and whenever you leave the editor or close the window. A recovery draft is written within about 0.3 s; if StudyOS closes unexpectedly, the note offers to restore it.
- **Imports are validated**: an extension allow-list (PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, PNG, JPG, GIF, WEBP, ZIP), a 250 MB limit, and a content-signature check (a renamed `.exe` is rejected). Files are copied into StudyOS storage under random names and are never executed.

## Calendar and timetable

- **Recurring items are rules, not copies.** "Machine Learning, Tuesdays 17:00–19:00, Semester 1" is one timetable entry, expanded into sessions as you browse. Editing it changes every week; cancelling or moving one session (or taking a day off work) is stored as an exception.
- **Times are local wall-clock times**, so daylight-saving changes never shift a class.
- **Conflicts**: overlaps involving a fixed commitment (class, work, exam, internship) are flagged in red. When one side is flexible (study, personal…), StudyOS offers free slots to move it to.
- **Reminders** are Windows notifications sent while StudyOS is running (it can be minimised): classes, study sessions and exams (plus the day before an exam). Work shifts are not announced. Adjust or disable them in Settings.
- **ICS import** handles university timetables and Google/Outlook exports: weekly and daily repeats, `UNTIL`/`COUNT`, cancelled dates (`EXDATE`), moved sessions (`RECURRENCE-ID`), all-day and UTC events. Times with a time zone are read as wall-clock times (assumes your own time zone). Monthly/yearly repeats import as a single event, with a warning. Re-importing a file updates instead of duplicating.
- **ICS export** writes everything (with repeats and exceptions) for Google Calendar or Outlook.
- Assignment deadlines and exams appear on the calendar automatically, and get reminders (a day and two hours before a deadline; the day before an exam).

## Grades and tracking

- **Grade calculator** (course → Grades): each assignment and exam has a weight (% of the course) and a score. StudyOS shows the current average over graded work, the range still possible, and the average needed on the remaining work for 70/80/90/95% and your own target. Weights that don't add up to 100% are flagged.
- **Percent → scale** conversion is proportional (e.g. 87.5% = 8.75 on a 10-point scale). Universities may convert differently, so the final grade can always be set manually.
- **GPA**: credit-weighted (ECTS) average of final grades, per semester and per programme; a *projected* average that includes current standings in unfinished courses; a *cumulative* figure across all programmes (as a percentage of each programme's scale); and a "what if?" simulator.
- **Top Student Mode** (Grades page) gives recommendations computed only from stored data: weakest course, required scores, attendance, neglected courses, upcoming heavy assessments, study consistency. It never claims a class ranking.
- **Attendance** is marked automatically when you open Lecture Mode and can be edited per class date (course → Grades). The rate compares against classes scheduled on the timetable.
- **Study timer**: 25/5, 50/10, 90/20 or custom focus/break cycles, linked to a course, topic or task. Each finished focus block is saved; stopping early saves the minutes studied. The timer survives navigation and restarts; if StudyOS was closed for longer than a whole phase, the timer stops rather than inventing study time. Time spent in Lecture Mode (5 minutes or more) is recorded too.
- **Smart study planner** (exam → Plan revision): proposes sessions in free time before the exam, weighted towards unrevised topics and lectures marked "Not reviewed"/"Needs review", with a full review on the last day. Nothing is added until you accept.

## Learning platform

- **Structure**: learning tracks (e.g. *AI Preparation*, *Organic Chemistry*, *Bar Exam*) → subjects → four levels (Foundation, University, Advanced, Challenge) → lessons. Lessons, questions, flashcards and formulas are written in Markdown with LaTeX (`$x$`, `$$…$$`) and highlighted code. Raw HTML is disabled.
- **Questions**: multiple choice (single/multi, with per-option "why wrong"), numerical (tolerance, fractions), short answer, explain in your own words, predict the output, matching, coding and debugging. Coding/explain answers are self-assessed against a model answer; **StudyOS never runs code**.
- **Quizzes**: adaptive difficulty (½ level up per correct answer, ¾ down per wrong one, weak topics first) or fixed order. Wrong answers show the correct answer, explanation, why it was wrong, an example, and offer a similar question.
- **Spaced repetition** (SM-2 style, Again/Hard/Good/Easy) schedules flashcards *and* answered questions; up to 20 new cards per session.
- **Mastery** (0–100 per topic) combines recency-weighted accuracy with the amount of evidence and fades results older than ~2 months.
- **Diagnostics** run without feedback, then show strong/weak subjects and topics, recommend lessons, and can schedule study sessions in free calendar time.
- **Content packs** install with stable ids: reinstalling/upgrading updates content in place and keeps your progress, identically on every synced computer.

## AI Preparation pack

Practice → Learning tracks → **Install** adds the bundled curriculum (`src/content/packs/ai-prep/`): Linear Algebra, Calculus, Probability, Statistics (10 lessons each), Python & NumPy (10), Machine Learning (15), Deep Learning (10), Algorithms (8) and 7 guided projects with collapsible hints and evaluation criteria (no solutions upfront). It includes the 50-question *AI MSc preparation diagnostic* and embeds interactive visualizations: gradient descent, linear regression, classification decision boundary, neural-network training and probability distributions (also under Practice → Visualizations).

`tests/content.test.ts` is the quality gate for the pack: lesson counts, ≥300 questions, valid question data, every LaTeX expression rendered by KaTeX, no broken escape sequences, known visualizations, balanced hint blocks, and a full install into a test database. Lessons can embed `::viz[id]` and `:::hint Title … :::` blocks.

## Knowledge, search and Ask My Studies

- **Search** uses an SQLite FTS4 index kept up to date by triggers on every searchable table (also for data arriving via sync). Every word must match as a prefix; accents are ignored and Greek works. Press **Ctrl+K** anywhere for quick search.
- **Tags**: add tags to notes, lectures, assignments, exams, flashcards, questions and concepts, or type `#confusing` in a note. Tag ids derive from the name, so the same tag on two computers merges.
- **Knowledge base**: one page per concept (definition, formula, intuition, examples) linked to courses, lectures, notes, lessons, formulas, flashcards, questions, papers and projects, so the same concept connects across courses. Select text in a note and press the lightbulb to save a concept; concepts can generate flashcards and show their mastery.
- **Ask My Studies** answers from local data only (exam dates, deadlines, grades, tagged items, unreviewed topics, notes about a topic, next class, average, open tasks) and otherwise searches; if nothing matches it says *"I couldn't find this in your StudyOS data."* AI-assisted answers are planned for Phase 8.

## Projects and research

- **Projects** (AI, research, programming, group, thesis, other) have a status, dates, milestones, tasks, notes, files, team members and links. Progress counts milestones and tasks; due dates and milestones appear on the calendar as all-day items.
- **Guided AI projects**: on a project lesson (Practice → AI Projects), *Start this project* creates a project with one milestone per step, with dates spread up to the due date you choose.
- **Research workspace** (research and thesis projects): one note each for research question, literature review, methodology and results, plus any number of experiment logs, meeting notes and drafts (every project gets those three).
- **Papers**: a reading library with status (to read, reading, read), rating, your own summary, reading notes (with the PDF beside them in split view), files and concept links. Citations in APA 7 (with in-text form) and BibTeX; import and export `.bib` files from Zotero, Mendeley or Google Scholar; duplicates are matched by DOI or title.
- **DOI lookup** fills in a paper's details from the public Crossref API. Only the DOI is sent; nothing else leaves the computer.

## Optional AI

StudyOS works fully without AI; every AI control is hidden until you turn it on in **Settings → AI**.

- **Providers**: OpenAI and Anthropic (your own API key), or Ollama for models running on your own computer. *List models* shows what your key or Ollama install offers; *Test* checks the setup.
- **Keys** are stored in Windows Credential Manager, never in the database, settings or cloud sync. Requests are made by the Rust backend, so the key never returns to the app's web view.
- **Nothing is sent automatically.** Each AI action sends only the text it needs: the selection (or the note) for note actions, the abstract and reading notes for a paper summary, and the topic list, mastery and deadlines (no notes) for a revision plan.
- **Notes**: the *AI* button in the note header can summarise, explain a selection, improve messy notes, or create flashcards and quiz questions. You review cards and questions before they are saved, tagged `#ai-generated`.
- **Exams**: *AI plan* creates a revision plan you can save as a note. *Plan revision* still works without AI.
- **Papers**: *Draft with AI* writes a summary from the abstract and your reading notes, for you to edit.
- **Ask My Studies** becomes a study assistant (`src/services/agent`) when AI is on:
  - It chats naturally, remembers the conversation and explains topics.
  - For your own data it calls read-only tools instead of guessing: overview, search, read an item, deadlines, schedule, grades, study statistics, review status and tasks. Each step is shown in the chat, with links to the items it used.
  - Models without tool support (e.g. small Ollama models) automatically get the most relevant items as context instead.
  - The chat is kept on this computer; *New chat* clears it. Without AI, the page answers the built-in questions from local data as before.
- Everything AI produces carries a label naming the provider, the model and the date, and saying it is not official course material.

## Backups and export

- **Automatic backups**: once a day while StudyOS is running, a snapshot of all your data is saved in `%LOCALAPPDATA%\com.studyos.app\backups`. The newest 14 are kept. **Settings → Backups & export** also has *Backup now*, *Open folder* and the list of backups.
- **Restore** puts StudyOS back to a backup's state on all your devices: restored items are re-stamped so cloud sync spreads them, and items created after the backup are removed. A *Before restore* backup is saved first, so a restore can be undone.
- **Export everything (.zip)** writes all data plus every attached file, for moving to a new computer or keeping a copy elsewhere. **Import backup** accepts that ZIP or a `.json` backup. Files in a ZIP go through the same checks as any imported file, and never overwrite existing ones.
- **Exports** (the *Export* button on each page):
  - a note, all of a course's notes, or a project as **Markdown** or **PDF** (print to "Microsoft Print to PDF");
  - grades, tasks and flashcards as **CSV** (flashcards import into Anki);
  - a programme as **JSON**, which can be imported again (merged into existing data);
  - the calendar as **ICS** (Calendar page) and papers as **BibTeX** (Papers page).

## Windows

- **System tray**: StudyOS has a tray icon. Left-click opens it. The menu has *Open StudyOS*, *Quick Lecture Mode* (the class on now, or the next or last one today), *Start study timer* and *Quit StudyOS*.
- **Closing the window** keeps StudyOS running in the tray by default, so reminders and the study timer keep working. Open notes are saved first. Change this in **Settings → Windows**.
- **Ctrl+Shift+S** can bring StudyOS to the front from any program. It is **off by default** because, while on, other programs can't use that shortcut (it is often *Save As*). Turn it on in Settings → Windows.
- **Performance**: `tests/performance.test.ts` seeds 40 courses, 4,000 notes, 4,000 flashcards, 3,000 questions, 14,000 practice records, 1,500 tasks, 1,500 events and 400 files. The main screens must each load within 1.5 s on the test's in-memory SQLite (they currently take 0–110 ms). Long lists show 300 items at a time with *Show more*.

## Security model

The app window is treated as untrusted, so even if a rendering bug ever let script run there, it couldn't reach beyond StudyOS's own data:

- **Database**: the window can't use the SQL plugin directly. Queries go through `db_select`/`db_execute` (`src-tauri/src/db.rs`). These accept one SELECT, INSERT, UPDATE or DELETE statement at a time (plus `PRAGMA table_info`). That blocks `ATTACH`, `VACUUM INTO` and stacked statements that could write files.
- **Files**: open and save dialogs run in Rust (`src-tauri/src/paths.rs`), which records the chosen paths and any dropped files. File commands only accept a path recorded there, and only once. The window has no dialog or SQL permissions (`capabilities/default.json`).
- **Network**: the Content Security Policy allows only Firestore, Firebase Auth (Identity Toolkit and Secure Token) and Crossref. AI requests are made by Rust, and the Ollama address must be on this computer or the local network.
- **Imports**: attachments, ZIP exports and backups are checked by type, size and real file content, never executed, and never overwrite existing files. Markdown is rendered without raw HTML; KaTeX runs in safe mode and only http(s) and mailto links open.

## Commands

```bash
npm install          # install JS dependencies
npm test             # run unit + database tests (no Rust needed)
npm run build        # type-check and build the frontend
npm run tauri dev    # run the desktop app with hot reload
npm run release      # build the installer → release/StudyOS-Setup.exe
```

The installer is per-user (no admin rights). It adds Start Menu and desktop shortcuts and installs WebView2 if it is missing.

## Architecture

```
src/
  domain/      Pure logic and types: grading scales, GPA/averages, dates, validation (fully unit-tested)
  services/    All SQL lives here; one module per aggregate (institutions, programmes, terms, courses, settings, dashboard)
  lib/db/      DbDriver interface + Tauri SQLite implementation
  lib/firebase Firebase app/auth initialisation from .env.local
  sync/        Sync engine (provider-agnostic), Firestore remote, sync scheduler
  features/auth Sign-in / sign-up / password reset and the AuthGate
  hooks/       React Query hooks, form mutation helper, theme
  components/  Layout (shell, sidebar) and UI primitives (buttons, fields, modals, feedback)
  features/    Screens: dashboard, studies, lectures (incl. lecture mode), notes (editor, autosave), attachments (PDF viewer), settings
src-tauri/
  migrations/  Versioned SQL migrations (applied by tauri-plugin-sql on startup)
  src/lib.rs   Tauri builder, plugins, migration registry
  src/attachments.rs  File import/validation, storage, reading and opening (with unit tests)
tests/         Vitest suites; database tests run the real migrations against in-memory SQLite (sql.js)
```

**Data.** SQLite is the working copy (synced per user to Firestore, see above), stored at `%APPDATA%\com.studyos.app\studyos.db`. IDs are UUIDs and timestamps are ISO-8601. User-owned rows are soft-deleted (`deleted_at`). Foreign keys and indexes are enforced.

**Migrations.** To change the schema, add `src-tauri/migrations/000N_name.sql` and register it in `src-tauri/src/lib.rs`. Never edit a migration that has already shipped. The test-suite applies every `.sql` file in order, so tests always run against the production schema.

**Grades.** Every grade is stored as a number on its programme's scale (10-point, 4.0, percentage, letter, or custom). Letter scales map letters to grade points, so the same averaging code works for every system.

**Privacy.** No analytics, telemetry or tracking. The only network traffic is Firebase Authentication and syncing the signed-in user's own data. The content security policy restricts connections to Google/Firebase endpoints.
