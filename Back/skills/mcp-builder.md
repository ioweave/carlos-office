---
name: mcp-builder
description: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate external APIs or services, whether in Python (FastMCP) or Node/TypeScript (MCP SDK).
license: Complete terms in LICENSE.txt
---

# MCP Server Development Guide

## Overview

Create MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. The quality of an MCP server is measured by how well it enables LLMs to accomplish real-world tasks.

---

# Process

## High-Level Workflow

Creating a high-quality MCP server involves four main phases:

### Phase 1: Deep Research and Planning

**API Coverage vs. Workflow Tools.** Balance comprehensive API endpoint coverage with specialized workflow tools. Workflow tools can be more convenient for specific tasks, while comprehensive coverage gives agents flexibility to compose operations. When uncertain, prioritize comprehensive API coverage.

**Tool Naming and Discoverability.** Clear, descriptive tool names help agents find the right tools quickly. Use consistent prefixes (e.g., `github_create_issue`, `github_list_repos`) and action-oriented naming.

**Context Management.** Agents benefit from concise tool descriptions and the ability to filter/paginate results. Design tools that return focused, relevant data.

**Actionable Error Messages.** Error messages should guide agents toward solutions with specific suggestions and next steps.

### Phase 2: Implementation

Set up project structure, implement core infrastructure (API client with authentication, error handling helpers, response formatting, pagination support), and implement tools. For each tool:

- **Input Schema**: Use Zod (TypeScript) or Pydantic (Python). Include constraints, clear descriptions, and examples in field descriptions.
- **Output Schema**: Define `outputSchema` where possible for structured data. Use `structuredContent` in tool responses.
- **Tool Description**: Concise summary of functionality, parameter descriptions, and return type schema.
- **Implementation**: Async/await for I/O, proper error handling with actionable messages, support pagination where applicable.
- **Annotations**: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.

### Phase 3: Review and Test

Review for DRY (no duplicated code), consistent error handling, full type coverage, clear tool descriptions. Build and test with MCP Inspector.

### Phase 4: Create Evaluations

Create 10 complex, realistic, read-only, independent, verifiable evaluation questions and verify answers yourself. Output as an XML `<evaluation>` document with `<qa_pair>` entries.

---

# Reference

Consult the MCP specification (`https://modelcontextprotocol.io/sitemap.xml`, then specific pages with `.md` suffix) and the SDK documentation during development. For recommended stack:

- **Language**: TypeScript (high-quality SDK support, good compatibility, static typing)
- **Transport**: Streamable HTTP for remote servers (stateless JSON), stdio for local servers
