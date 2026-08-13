# Carlos Office retention architecture

**Status:** architecture record  
**Principle:** conversations are durable by default; semantic memory remains a deliberate promotion decision. Runtime execution telemetry is disposable by default.

## Retention layers

| Layer | Examples | Default storage | Lifetime |
| --- | --- | --- | --- |
| Working memory | current prompt, recent turns, tool results | RAM/model context | current execution |
| Session sources | one-chat upload, temporary web reference | RAM/temp runtime | session/TTL |
| Durable conversation | every Nora chat and retained attachment | `30-Conversations/Threads/` | until manually deleted |
| Remembered facts | small stable preferences/details Nora retains | tracked `10-Knowledge/Facts.md` | until expired/superseded/forgotten |
| Project sources | books, transcripts, Drive folders, project references | source registry + external/or managed source | project lifecycle |
| Project knowledge | atomic knowledge derived for one project | `25-Projects/<projectId>/Knowledge/` | project lifecycle |
| Universal sources | deliberately designated cross-project references | source registry | durable |
| Universal knowledge | reusable operating knowledge | `10-Shared/` | durable until superseded/retired |
| Agent memory | reusable role-specific lessons | `20-Agents/<Agent>/` | durable until superseded/retired |
| Live job/subagent trace | tool calls, iteration output, progress events | RAM | active + recent trace TTL |
| Subagent receipt | status, bounded final summary, changed paths | operational store | 7 days by default |
| Job receipt | objective, criteria, final outcome, QC/approval state | `40-Jobs/` | durable/clearable |

The goal is to retain user-facing work without turning telemetry, intermediate model output, or incidental context into permanent knowledge.

## Conversations

Every new conversation is durable from its first user message.

- The user message and retained attachments are saved before model execution begins.
- Failed or cancelled model runs do not erase the user message.
- Conversation history has no temporary, expiry, save, or promotion state.
- Starting or opening another chat does not change retention.
- Conversations remain until Carlos explicitly deletes them.
- Nora is the sole conversational entry point. Historical direct-agent chats remain saved but are read-only; new work is continued through Nora.

Saving a conversation and remembering information are still different operations. A durable transcript is searchable history, not ambient semantic memory. Nora may promote a stable fact when it will improve future work, but the existence of a saved chat does not automatically authorize that promotion.

## Remembered facts

Compact semantic memory lives in:

`10-Knowledge/Facts.md`

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

## Scratch files and archives

Agent working files are disposable scratch data. They default to the operating system's temporary directory rather than an Obsidian vault category. `OFFICE_SCRATCH_ROOT` may relocate that temporary area when an operator explicitly needs it. The former `OFFICE_WORKSPACE_ROOT` name remains a runtime compatibility fallback only.

Scratch archives are recovery conveniences, not durable knowledge. Vault archive folders and the legacy `60-Workspace` tree remain untracked. Anything worth preserving must be deliberately promoted to tracked knowledge, system configuration, or a repository artifact.

## Version-control boundary

Git tracks application source, tool definitions, installed skill packages, durable shared knowledge, compact facts/preferences in `10-Knowledge/Facts.md`, and active agent configuration in `90-System/Runtime/Agents/*.md`.

Git does not track conversations, attachments, jobs, task capsules, generated artifacts, scratch files, archives, runtime databases, browser captures, MCP audit records, retention directives, or migration receipts. Those records may remain durable on the local machine when their product lifecycle requires it; being locally persistent does not make them source configuration.

Data-shape schemas are source-code validation contracts. They stay beside the code that reads and writes each record; the vault intentionally has no `Schemas` folder.

## Knowledge sources

Source manifests have three lifecycles.

### Session

Session sources remain volatile. They are not promoted into the persistent source registry merely because they were read once. A retained chat attachment is durably available through its conversation, but it is not automatically a reusable knowledge source.

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

Automatic retained context intentionally excludes saved conversations, job receipts, subagent receipts, monitor snapshots, source registries and runtime telemetry as ambient memory.

Ambient durable retrieval is limited to the appropriate layers:

- `10-Shared/` universal knowledge;
- `20-Agents/<current agent>/` procedural memory;
- `25-Projects/<active projectId>/Knowledge/` when project scope is active;
- compact remembered facts through their dedicated retrieval path.

Saved chats, job receipts, and subagent receipts remain inspectable through their own interfaces but are not automatically treated as knowledge.

## Project repository artifacts

Durable repository-level architecture/planning references belong under:

`Back/artifacts/`

They are version-controlled project artifacts, distinct from Obsidian memory and distinct from generated runtime artifacts.

`Back/artifacts/README.md` indexes the current durable repository artifacts. For Carlos Office planning tasks, agents should reconcile those artifacts with live source before creating a new plan. Obsolete generated prompts and superseded duplicate roadmaps should be deleted from the repository instead of retained indefinitely.

## Nora subagents and jobs

Nora may spawn fresh, isolated specialist subagents for bounded work in the current request. Each child receives only an explicit goal/context capsule, runs with the intersection of Nora's and the specialist's tools, cannot recursively delegate, and returns a bounded final summary. A parent cancellation cancels its active children. An interrupted server process leaves in-flight subagent state `unknown` rather than pretending completion.

Durable jobs remain the restart-safe workflow primitive for implementation, consequential side effects, formal Vera acceptance, and work that must continue independently of the current chat request.

Detailed execution is operational telemetry, not permanent knowledge. While work is active and for a configurable recent period, attempts, agent-to-agent messages, worker output and review traffic may live in memory for Jobs/Office Map inspection. Persistent job records remain compact checkpoints/receipts.

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

- expired session source manifests;
- expired recent job traces;
- expired completed subagent receipts.

It does **not** expire conversations or their retained attachments, and it does **not** automatically delete curated persistent knowledge merely because it is old or rarely used.

Relevant defaults live in `Back/.env.example`; that file is authoritative for current configured defaults.

## Migration behavior

Persistence changes are non-destructive unless Carlos explicitly requests cleanup. Historical saved conversations and job receipts remain. Volatile conversations from the retired temporary-chat store were never durable and cannot be reconstructed after that process exits; new activity always follows the durable-chat model.
