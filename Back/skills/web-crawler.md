# Web Crawler Skill

Use the `http` tool to fetch a web page (HTML) and extract the relevant information from it.

## When to use
- Carlos asks to read or scrape a web page such as a GitHub repository page, a documentation page, a blog post, or any public URL.
- Carlos wants to know what is on a page without manually visiting it.

## Procedure

1. **Fetch the page**
   - Call the `http` tool with `method: "GET"` and `url: "<target-url>"`.
   - Use a realistic `User-Agent` header when needed (e.g., `Mozilla/5.0`) to avoid being blocked.

2. **Inspect the response**
   - Check `ok` and `status`. If not ok, report the error and stop.
   - Look at `contentType`. If it is `text/html`, parse the HTML. If it is JSON, return the parsed `body` directly.

3. **Extract page information** (HTML pages)
   - **Title**: the content of the `<title>` tag.
   - **Meta**: from `<meta name="description" content="...">`.
   - **Headings**: text from `<h1>`, `<h2>`, `<h3>` tags.
   - **Main text**: the readable text content of the `<body>` (strip scripts/styles).
   - **Links**: all `<a href="...">` values (and their anchor text).
   - **Images**: `src` of `<img>` tags if relevant.

4. **Present the findings**
   - Summarize the page in a concise, organized way: title, description, key headings, bullet points of main content, and a list of links.
   - If the page is a GitHub repo, also include the repo name, owner, description, stars/forks if visible, and the list of top-level files/directories shown.

5. **Handle common issues**
   - Redirects: the http tool follows redirects automatically; use the final `url` in your report.
   - Large pages: respect `maxBytes`; if the page is too large, fetch and report partial information.
   - Dynamic pages: if the page renders content with JavaScript, note that the raw HTML may not contain the content; ask Carlos if he wants to use a headless browser instead.

## Example prompt
- "Crawl https://github.com/facebook/react and summarize its README and top-level folders."