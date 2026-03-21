# Workflow: Token & Efficiency Optimization

Follow these steps to minimize token usage and maximize effectiveness.

## Optimization Rules
1.  **Stop Before You Read**: Don't use `view_file` on large files (>200 lines) until you've used `grep_search` to find the exact function or block.
2.  **Use ARCHITECTURE.md**: Check this file first to know where things are. Don't use `list_dir` recursively.
3.  **Specific Replacements**: Use `replace_file_content` or `multi_replace_file_content` instead of rewriting whole files.
4.  **No Boilerplate**: When providing code in chat, omit imports or standard boilerplate unless it changed. Focus on changes.
5.  **JIT Context**: Only open necessary files. Don't open a whole directory's files "just in case".

## Strategy for Tasks
-   **Stage 1: Search**: Use `find_by_name` or `grep_search` for keywords.
-   **Stage 2: Drill Down**: Read only the relevant 50-100 lines.
-   **Stage 3: Plan**: Propose the change with a **diff chunk**.
-   **Stage 4: Execute**: One precise edit call.
-   **Stage 5: Verify**: Confirm if it looks right without re-reading the whole file.

## AI Roles
-   **The Architect**: If asked about design, read `ARCHITECTURE.md`.
-   **The Debugger**: If asked about bugs, trace using `grep_search` across `hooks/`.
-   **The UI Expert**: Check `tailwind.config.ts` and `components/ui/` first.
