# Carlos Office retention architecture

**Status:** architecture record  
**Principle:** promotion-based persistence. Runtime activity is disposable by default; persistence is a deliberate promotion decision.

## Retention layers

| Layer | Examples | Default storage | Lifetime |
| --- | --- | --- | --- |
| Working memory | current prompt, recent turns, tool results | RAM/model context | current execution |
| Session sources | one-chat upload, temporary web reference | RAM/temp runtime | session/TTL |
| Temporary conversation | ordinary new chat | RAM | until discarded/TTL/restart |
| Remembered facts | small stable preferences/details Nora retains | compact Markdown-backed fact store | until expired/superseded/forgotten |
| Project sources | books, transcripts, Drive folders, project references | source registry + external/or managed source | project lifecycle |
| Project knowledge | atomic knowledge derived for one project | `25-Projects/<projectId>/Knowledge/` | project lifecycle |
| Universal sources | deliberately designated cross-project references | source registry | durable |
| Universal knowledge | reusable operating knowledge | `10-Shared/` | durable until superseded/retired |
| Agent memory | reusable role-specific lessons | `20-Agents/<Agent>/` | durable until superseded/retired |
| Live job trace | agent messages, iteration output, Vera/Nora exchanges | RAM | active + recent trace TTL |
| Job receipt | objective, criteria, final outcome, QC/approval state | `40-Jobs/` | durable/clearable |
| Saved conversation | conversation Carlos explicitly chose to retain | `30-Conversations/Threads/` | until manually deleted |

The goal is to accumulate useful knowledge without accumulating telemetry, stale attachments, intermediate model output, or accidental archives.

## Conversations

Every new conversation is temporary.

- It is kept in backend runtime memory unless Carlos saves it.
- Temporary attachment bytes are not promoted into durable conversation storage unless the conversation is saved.
- Temporary conversations do not appear as saved chats.
- Navigation within the frontend must not itself imply persistence; a temporary active chat may remain available while the application session is alive.
- Expired temporary conversations are removed by retention maintenance.
- Backend restart may discard unsaved conversations because durable persistence was never promised.

Saving a conversation and remembering information are different operations. Nora may remember one stable fact while the surrounding temporary chat later disappears.

## Remembered facts

Compact semantic memory lives in:

`15-Memory/Facts.md`

A remembered fact is for a stable detail likely to improve future sessions. It is not a transcript or a note that merely describes current conversational state.

Good examples:

- a confirmed durable preference;
- a project constraint that will matter again;
- an approved decision;
- a stable identifier or responsibility.

Bad examples:

- “Carlos will review this plan”;
- “Carlos wants to test Nora next”;
- temporary task progress;
- speculative or unverified statements;
- incidental chatter.

Nora alone can create/update/delete compact facts. Iris may inspect them for knowledge hygiene. Nora must not claim something was remembered unless the memory tool actually succeeded.

## Knowledge sources

Source manifests have three lifecycles.

### Session

Session sources remain volatile. They are not promoted into the persistent source registry merely because they were read once.

### Project

Project sources require a `projectId`. Their derived knowledge belongs under:

`25-Projects/<projectId>/Knowledge/`

Project knowledge is eligible for retrieval only in the relevant project scope.

### Universal

Universal source designation belongs to Nora. Iris cannot independently designate/reclassify a universal source. Universal derived knowledge created by Iris is proposed first under the inbox and promoted by Nora only after review.

## Derived knowledge

Iris should create small retrievable knowledge units rather than giant source summaries. Durable notes preserve provenance, source ID, authority, lifecycle, scope, status, freshness metadata and tags.

Useful authority values:

- `authoritative`
- `reference`
- `historical`
- `experimental`

Useful lifecycle states include active, stale, superseded and retiring. Age alone is not a sufficient deletion criterion.

## Ambient retrieval

Automatic retained context intentionally excludes saved conversations, job receipts, monitor snapshots, source registries and runtime telemetry as ambient memory.

Ambient durable retrieval is limited to the appropriate layers:

- `10-Shared/` universal knowledge;
- `20-Agents/<current agent>/` procedural memory;
- `25-Projects/<active projectId>/Knowledge/` when project scope is active;
- compact remembered facts through their dedicated retrieval path.

Saved chats/job receipts remain inspectable through their own interfaces but are not automatically treated as knowledge.

## Project repository artifacts

Durable repository-level architecture/planning references belong under:

`Back/artifacts/`

They are version-controlled project artifacts, distinct from Obsidian memory and distinct from generated runtime artifacts.

`Back/artifacts/README.md` indexes the current durable repository artifacts. For Carlos Office planning tasks, agents should reconcile those artifacts with live source before creating a new plan. Obsolete generated prompts and superseded duplicate roadmaps should be deleted from the repository instead of retained indefinitely.

## Jobs

Detailed job execution is operational telemetry, not permanent knowledge.

While a job is active and for a configurable recent period, attempts, agent-to-agent messages, worker output and review traffic may live in memory for Jobs/Office Map inspection.

The persistent job record is a compact checkpoint/receipt. Terminal receipts retain useful outcome/QC/approval information without storing every intermediate model exchange forever.

A backend restart intentionally discards detailed transient traces. Pending work may resume from the compact checkpoint/original plan according to current runner behavior.

## Knowledge retirement

Nora is the knowledge governor. Iris is the librarian/executor.

Iris may scan for stale, superseded, retiring, expired or duplicate knowledge. She cannot independently delete/retire curated knowledge.

Controlled workflow:

1. Iris/Nora identify a retention candidate.
2. Nora creates an exact retention directive containing target/action/reason.
3. Iris executes only that directive.
4. Archive is preferred when future value is uncertain.

## Automatic cleanup

The retention manager may automatically remove volatile runtime state such as:

- expired temporary conversations;
- their temporary attachments/buffers;
- expired session source manifests;
- expired recent job traces.

It does **not** automatically delete curated persistent knowledge merely because it is old or rarely used.

Relevant defaults live in `Back/.env.example`; that file is authoritative for current configured defaults.

## Migration behavior

Persistence changes should be non-destructive unless Carlos explicitly requests cleanup. Historical saved conversations/job receipts may remain until intentionally removed. New activity follows the current promotion/receipt model.
