import React from "react";

const inlinePattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\n]+\)|https?:\/\/[^\s<]+|\*[^*\n]+\*)/g;

const safeHref = value => {
  const href = String(value || "").trim();
  return /^(https?:|mailto:)/i.test(href) ? href : null;
};

const inline = (text, keyPrefix = "i") => {
  const value = String(text ?? "");
  const nodes = [];
  let cursor = 0;
  let index = 0;

  for (const match of value.matchAll(inlinePattern)) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{inline(token.slice(2, -2), `${key}-b`)}</strong>);
    } else if (token.startsWith("~~")) {
      nodes.push(<del key={key}>{inline(token.slice(2, -2), `${key}-d`)}</del>);
    } else if (token.startsWith("[")) {
      const split = token.lastIndexOf("](");
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      nodes.push(href
        ? <a key={key} href={href} target="_blank" rel="noreferrer">{inline(label, `${key}-a`)}</a>
        : token);
    } else if (/^https?:\/\//i.test(token)) {
      const href = safeHref(token);
      nodes.push(<a key={key} href={href} target="_blank" rel="noreferrer">{token}</a>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{inline(token.slice(1, -1), `${key}-e`)}</em>);
    }

    cursor = match.index + token.length;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
};

const splitCells = line => line
  .trim()
  .replace(/^\|/, "")
  .replace(/\|$/, "")
  .split("|")
  .map(cell => cell.trim());

const isTableDivider = line => splitCells(line).every(cell => /^:?-{3,}:?$/.test(cell));
const isBlockStart = line => (
  /^```/.test(line)
  || /^#{1,6}\s+/.test(line)
  || /^>\s?/.test(line)
  || /^\s*[-*+]\s+/.test(line)
  || /^\s*\d+\.\s+/.test(line)
  || /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)
);

export default function MarkdownContent({ children }) {
  const lines = String(children ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(/^```\s*([^\s`]*)\s*$/);
    if (fence) {
      const language = fence[1] || "";
      const code = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      blocks.push(
        <pre key={`b-${blocks.length}`} className="markdown-code-block">
          <code className={language ? `language-${language}` : undefined}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(React.createElement(
        `h${level}`,
        { key: `b-${blocks.length}` },
        inline(heading[2], `h-${i}`),
      ));
      i += 1;
      continue;
    }

    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={`b-${blocks.length}`} />);
      i += 1;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("|") && isTableDivider(lines[i + 1])) {
      const headers = splitCells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitCells(lines[i++]));
      blocks.push(
        <div className="markdown-table-wrap" key={`b-${blocks.length}`}>
          <table>
            <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell, `th-${cellIndex}`)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{inline(row[cellIndex] || "", `td-${rowIndex}-${cellIndex}`)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={`b-${blocks.length}`}>{inline(quote.join("\n"), `q-${i}`)}</blockquote>);
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const items = [];
      const matcher = unordered ? /^\s*[-*+]\s+(.+)$/ : /^\s*\d+\.\s+(.+)$/;
      while (i < lines.length) {
        const match = lines[i].match(matcher);
        if (!match) break;
        const task = match[1].match(/^\[([ xX])\]\s+(.+)$/);
        items.push(task
          ? <li key={items.length} className="markdown-task-item"><input type="checkbox" checked={task[1].toLowerCase() === "x"} readOnly /> <span>{inline(task[2], `li-${i}`)}</span></li>
          : <li key={items.length}>{inline(match[1], `li-${i}`)}</li>);
        i += 1;
      }
      blocks.push(unordered
        ? <ul key={`b-${blocks.length}`}>{items}</ul>
        : <ol key={`b-${blocks.length}`}>{items}</ol>);
      continue;
    }

    const paragraph = [line];
    i += 1;
    while (
      i < lines.length
      && lines[i].trim()
      && !isBlockStart(lines[i])
      && !(lines[i].includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) {
      paragraph.push(lines[i++]);
    }

    const paragraphNodes = [];
    paragraph.forEach((part, lineIndex) => {
      if (lineIndex) paragraphNodes.push(<br key={`br-${i}-${lineIndex}`} />);
      paragraphNodes.push(...inline(part, `p-${i}-${lineIndex}`));
    });
    blocks.push(<p key={`b-${blocks.length}`}>{paragraphNodes}</p>);
  }

  return <div className="markdown-body">{blocks}</div>;
}
