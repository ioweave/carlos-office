---
name: context7
description: Use Context7 to fetch current library and framework documentation, manage AI coding skills, and configure Context7 MCP. Activate when the user asks about libraries, frameworks, API references, needs code examples, mentions "ctx7" or "context7", or wants to set up Context7 for their AI coding agent.
---

# Context7

Context7 fetches up-to-date library documentation instead of relying on potentially outdated training data.

## When to Use This Skill

Activate this skill when the user:

- Asks setup or configuration questions ("How do I configure Next.js middleware?")
- Requests code involving libraries ("Write a Prisma query for...")
- Needs API references ("What are the Supabase auth methods?")
- Mentions specific frameworks (React, Vue, Svelte, Express, Tailwind, etc.)
- Mentions "ctx7" or "context7", wants to install/search/generate skills, or needs to set up Context7 for their editor.

## How to Fetch Documentation

### Step 1: Resolve the Library ID

Call `resolve-library-id` with:
- `libraryName`: The library name extracted from the user's question
- `query`: What to look up in the library's documentation (improves relevance ranking)

### Step 2: Select the Best Match

From the resolution results, choose based on:
- Exact or closest name match to what the user asked for
- Higher benchmark scores indicate better documentation quality
- If the user mentioned a version, prefer version-specific IDs

### Step 3: Fetch the Documentation

Call `query-docs` with:
- `libraryId`: The selected Context7 library ID (e.g., `/vercel/next.js`)
- `query`: What to look up, scoped to a single concept

If the question spans multiple distinct concepts, make a separate `query-docs` call per concept with the same library ID, unless the question is about how the concepts interact.

### Step 4: Use the Documentation

Incorporate the fetched documentation into your response: answer with current, accurate information, include relevant code examples, and cite the library version when relevant.

## CLI Usage

Keep the CLI up to date before running commands:

```bash
npm install -g ctx7@latest
```

Or run directly: `npx ctx7@latest <command>`

```bash
# Documentation
ctx7 library <name> <query>           # Step 1: resolve library ID
ctx7 docs <libraryId> <query>         # Step 2: fetch docs

# Skills
ctx7 skills install /owner/repo       # Install from a repo (interactive)
ctx7 skills search <keywords>         # Search the registry
ctx7 skills list                      # List installed skills
ctx7 skills generate                  # Generate a custom skill (requires login)

# Setup
ctx7 setup                            # Configure Context7 MCP (interactive)
ctx7 login                             # Log in for higher rate limits
```

## Common Mistakes

- Library IDs require a `/` prefix — `/facebook/react` not `facebook/react`
- Always run `ctx7 library` first — `ctx7 docs` will fail without a valid ID
- Repository format for skills is `/owner/repo`
- Keep each docs query to a single concept for best relevance

## Guidelines

- **Be specific**: Describe what to look up, but keep each query to a single concept
- **One topic per query**: Split multi-topic questions into separate calls unless asking about how concepts interact
- **Version awareness**: When users mention versions ("React 19"), use version-specific library IDs if available
- **Prefer official sources**: When multiple matches exist, prefer official/primary packages over community forks
