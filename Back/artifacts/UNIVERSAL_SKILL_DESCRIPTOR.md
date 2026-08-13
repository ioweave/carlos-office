# Carlos Office universal skill descriptor

**Status:** implemented and validated  
**Runtime contract:** `carlos-office.skill-manifest.v1`  
**Validation contract:** `carlos-office.universal-skill-validation.v1`

## Decision

Carlos Office ingests a standard `SKILL.md` package into one canonical Markdown descriptor plus content-addressed supporting resources. The descriptor is the complete activation document used by every office agent. Resources remain lossless but out of the model context until an agent requests a specific file through `skill_read_resource`.

This keeps routine messages small without discarding upstream detail:

1. `skill_list` returns metadata only.
2. `skill_read` activates the complete canonical descriptor.
3. `skill_read_resource` retrieves one integrity-checked file or bounded chunk.
4. `skill_install` and `skill_remove` remain Nora-governed.
5. A skill's tool declarations are descriptive. They never extend the central agent allowlist.

## Canonical package

```text
Back/skills/<declared-name>/
  SKILL.md                 canonical universal descriptor
  SKILL.md.json            machine-readable manifest
  _resources/<sha256.ext>  lossless, content-addressed source files
```

The descriptor frontmatter records the declared name, description, version, license, allowed-tool hints, upstream repository/ref/path, commit provenance, and SHA-256 hashes for the descriptor body, canonical source, and resource tree.

The body always contains:

- purpose, triggers, and non-triggers;
- inputs and outputs;
- ordered workflow;
- tool contracts and side-effect hints;
- runtime, network, shell, project-write, credential, environment, and package dependencies;
- a compact resource inventory count and on-demand manifest lookup contract;
- safety constraints and failure modes;
- validation criteria and agent applicability;
- the complete original upstream instructions, without paraphrase loss.

## Four reference abstractions

| Repository | Declared skill | What the abstraction preserves | Canonical source |
| --- | --- | --- | --- |
| `alchaincyf/huashu-design` | `huashu-design` | Three-direction design exploration, user selection gate, HTML-first high-fidelity production, export/review workflow, scripts, templates, and media resources. | `SKILL.md` |
| `leonxlnx/taste-skill` | `design-taste-frontend` | Frontend taste heuristics, design system discovery, anti-patterns, visual hierarchy, motion/detail rules, and the repository's additional skill/reference files. | `skills/taste-skill/SKILL.md` |
| `pbakaus/impeccable` | `impeccable` | Design diagnosis and improvement workflow plus the full multi-platform command, agent, skill, asset, and documentation tree. | `.agents/skills/impeccable/SKILL.md` |
| `juliusbrussee/caveman` | `caveman` | Product discovery, visual-language and workflow guidance, supporting commands/agents/skills, and complete plugin resources. | `skills/caveman/SKILL.md` |

Repository identity and declared skill identity are deliberately separate. For example, the `taste-skill` repository declares `design-taste-frontend`; ingestion preserves that name.

## Safety and determinism

- Import accepts approved local roots and GitHub repositories/tree paths.
- Package traversal rejects symbolic links and path escapes.
- Import is bounded by configurable file and byte limits.
- Files are sorted and hashed deterministically.
- Normalization never executes hooks, scripts, package managers, or dependencies.
- A staged install must pass its descriptor hash check before replacing an existing skill.
- Every agent can list, activate, and read resources; only Nora can install or remove.
- Missing tools or dependencies remain explicit prerequisites, never implicit authority.

## Live validation evidence

The executable validator clones all four repositories, resolves their canonical `SKILL.md`, normalizes each twice, requires byte-for-byte determinism, verifies descriptor/source/tree/resource hashes, persists and reads managed resources, rejects malformed frontmatter, and confirms a declared `postinstall` hook is preserved but not executed.

Validated upstream revisions:

| Skill | Commit | Files/resources | Package bytes |
| --- | --- | ---: | ---: |
| `huashu-design` | `1572d431f1411c82ec0baea94dea6a45f6063b26` | 188 | 33,174,454 |
| `design-taste-frontend` | `e988add20dab0fa97d7a76781c48961c8184288e` | 57 | 1,705,785 |
| `impeccable` | `2ab054d1f400c5ec085133352232ffc2617f0d54` | 2,962 | 53,728,112 |
| `caveman` | `309834233183478e6fd7800d26e1fbaa6210274e` | 169 | 1,276,760 |

Run the contract with:

```text
npm run validate:universal-skills
```

## UI contract

The Skills page provides the nontechnical view of installed skills: description, integrity state, resource count, license, source commit, and an on-demand complete descriptor. Installation remains an agent-governed operation initiated through Nora rather than an unrestricted UI button.
