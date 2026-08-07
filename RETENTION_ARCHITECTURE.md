# Carlos Office Retention Architecture

## Principle

Carlos Office uses **promotion-based persistence**. Runtime activity is disposable by default. Persistent storage is reserved for information that Carlos, Nora, or the knowledge-governance workflow deliberately decides is worth keeping.

The goal is to accumulate useful knowledge without accumulating telemetry, stale attachments, intermediate model output, or accidental archives.

## Retention layers

| Layer | Examples | Default storage | Lifetime |
| --- | --- | --- | --- |
| Working memory | current prompt, recent turns, tool results | RAM/model context | current execution |
| Session sources | one-chat upload, temporary web reference | RAM | session/TTL |
| Temporary conversation | ordinary new chat | RAM | until discarded/TTL/restart |
| Remembered facts | small stable preferences/details Nora retains | one compact Markdown-backed fact store | until expired/superseded/forgotten |
| Project sources | books, transcripts, Drive folders, project references | source registry + external/or managed source | project lifecycle |
| Project knowledge | atomic knowledge derived for one project | `25-Projects/<projectId>/Knowledge/` | project lifecycle |
| Universal sources | deliberately designated cross-project references | source registry | durable |
| Universal knowledge | reusable operating knowledge | `10-Shared/` | durable until superseded/retired |
| Agent memory | reusable role-specific lessons | `20-Agents/<Agent>/` | durable until superseded/retired |
| Live job trace | agent messages, iteration output, Vera/Nora exchanges | RAM | active + recent trace TTL |
| Job receipt | objective, criteria, final outcome, QC/approval state | `40-Jobs/` | durable/clearable |
| Saved conversation | conversation Carlos explicitly chose to retain | `30-Conversations/Threads/` | until manually deleted |

## Conversations

Every new conversation is temporary.

- It is kept in backend memory only.
- Temporary attachment bytes are kept in backend memory only.
- Temporary conversations do not appear in Saved Chats or the Office Map conversation list.
- Starting another conversation discards the current unsaved conversation.
- Expired temporary conversations are removed by retention maintenance.
- Backend restart also discards unsaved conversations because they were never promised persistence.

The Chat UI exposes **Save** only after a real temporary conversation exists. Saving promotes the transcript and its current attachments into Obsidian. Existing historical conversation files are treated as already-saved conversations; this migration does not delete them.

Saving a conversation and remembering information are deliberately different operations. Nora may remember a useful fact while the surrounding chat remains temporary and later disappears.

## Remembered facts

Compact semantic memory lives in a single persistent record:

`15-Memory/Facts.md`

A remembered fact includes scope, confidence, source, importance, timestamps, expiry, use metadata, supersession state, and pin state. Facts are intended for stable details that may improve future work, not transcripts or source documents.

Nora alone can create/update/delete facts. Iris may inspect them for knowledge hygiene. Facts are retrieved separately from Markdown knowledge.

## Knowledge sources

Source manifests have three lifecycles:

### Session

Session source manifests live in RAM only. They are not written into the persistent registry and expire automatically.

### Project

Project sources require a `projectId`. Their definitions are registered persistently, and derived project knowledge belongs under:

`25-Projects/<projectId>/Knowledge/`

Project knowledge is not ambient universal memory. It is eligible for retrieval only when that project scope is explicitly active.

### Universal

Universal source designation belongs to Nora. Iris cannot create, reclassify, or update a universal source independently. Universal derived knowledge created by Iris is written first as a proposal under:

`00-Inbox/Knowledge/`

Nora promotes an accepted proposal into `10-Shared/<Category>/`.

## Derived knowledge

Iris should create atomic, retrievable notes rather than giant source summaries. Durable notes preserve source ID, authority, lifecycle, project scope where applicable, status, tags, freshness metadata, and provenance.

Authority values:

- `authoritative`
- `reference`
- `historical`
- `experimental`

Lifecycle status supports active, stale, superseded, and retiring states. Retention scanning uses explicit status/expiry metadata; age alone is not sufficient reason for deletion.

## Ambient retrieval

Automatic retained context intentionally excludes:

- saved conversations;
- job receipts;
- monitors;
- source registries;
- runtime records;
- compact fact storage as raw Markdown.

Ambient Markdown retrieval is limited to:

- `10-Shared/` universal knowledge;
- `20-Agents/<current agent>/` procedural memory;
- `25-Projects/<active projectId>/Knowledge/` when a project scope is explicitly supplied.

Compact facts are searched separately with the same project/agent scope rules.

## Jobs

Detailed job execution is operational telemetry, not permanent knowledge.

While a job is active and for a configurable recent period, its attempts, agent-to-agent messages, worker output, and review trace live in RAM. The Office Map and Jobs UI can inspect that trace while it is retained.

The persistent `40-Jobs/` Markdown record is a compact checkpoint/receipt. Active jobs retain the plan, criteria, state, iteration, and QC metadata required for recovery. Terminal jobs may retain the bounded final result and final Vera/Nora status, but not the complete iteration history.

Default detailed trace TTL:

`JOB_TRACE_RETENTION_MS=86400000`

A backend restart intentionally discards detailed transient traces. Pending jobs can resume from the compact iteration checkpoint and original plan.

## Knowledge retirement

Nora is the knowledge governor. Iris is the knowledge librarian/executor.

Iris may scan for explicit stale, superseded, retiring, or expired knowledge. Iris cannot delete or archive curated knowledge solely on her own judgment.

The controlled workflow is:

1. Iris/Nora identify a retention candidate.
2. Nora creates an exact retention directive containing one path, one action, and the reason.
3. Iris executes that directive without broadening its scope.
4. Archive is preferred when future value is uncertain.

Allowed directive targets are curated Markdown under `10-Shared/`, `20-Agents/`, and `25-Projects/` only. Runtime files, saved conversations, and unrelated vault paths cannot be targeted through this tool.

## Automatic cleanup

The retention manager runs periodically and removes expired volatile runtime state:

- temporary conversations;
- temporary attachment buffers with their conversation;
- session source manifests;
- expired recent job traces.

It does **not** automatically delete curated persistent knowledge based merely on age or low use.

Defaults:

```env
TEMP_CONVERSATION_TTL_MS=86400000
TEMP_SOURCE_TTL_MS=86400000
JOB_TRACE_RETENTION_MS=86400000
RETENTION_CLEANUP_INTERVAL_MS=600000
JOB_RECEIPT_RESULT_CHARS=80000
MAX_REMEMBERED_FACTS=2000
```

## Migration behavior

This change is non-destructive for existing persistent data.

Existing files in `30-Conversations/Threads/` remain available and are interpreted as conversations that were already saved under the former persistence model. Existing job Markdown remains until cleared. New conversations and new detailed job traces follow the promotion/receipt model.

No automatic migration deletes historical material. Nora and Iris can review old knowledge gradually through the new retention workflow.
