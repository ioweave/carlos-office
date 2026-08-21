import { Fragment } from "react";

const safeLink = value => {
  try {
    const url = new URL(value);
    return ["http:", "https:", "artifact:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
};

const inline = (value, prefix = "inline", artifacts = []) => {
  const inlinePattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^) \n]+\)|\[\[[^\]\n]+\]\])/g;
  const source = String(value || "");
  const result = [];
  let cursor = 0;
  let match;
  let index = 0;

  while ((match = inlinePattern.exec(source))) {
    if (match.index > cursor) result.push(source.slice(cursor, match.index));
    const token = match[0];
    const key = `${prefix}-${index++}`;

    if (token.startsWith("`")) {
      result.push(<code key={key} className="rich-text__inline-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      result.push(<strong key={key} className="rich-text__strong">{inline(token.slice(2, -2), `${key}-strong`, artifacts)}</strong>);
    } else if (token.startsWith("[[")) {
      const label = token.slice(2, -2).trim();
      const normalized = label.toLowerCase();
      const matched = artifacts.find(item => [item.title, item.name, item.artifactId]
        .some(value => String(value || "").trim().toLowerCase() === normalized));
      result.push(matched?.artifactId
        ? <a key={key} href={`artifact://${matched.artifactId}`} data-artifact-id={matched.artifactId} className="rich-text__artifact-ref">{label}</a>
        : token);
    } else {
      const link = token.match(/^\[([^\]]+)]\(([^)]+)\)$/);
      const href = safeLink(link?.[2]);
      const artifactId = href.startsWith("artifact://") ? href.slice("artifact://".length).replace(/\/$/, "") : "";
      result.push(href
        ? <a key={key} href={href} data-artifact-id={artifactId || undefined} target={artifactId ? undefined : "_blank"} rel={artifactId ? undefined : "noreferrer"} className="rich-text__link">{link[1]}</a>
        : token);
    }

    cursor = match.index + token.length;
  }

  if (cursor < source.length) result.push(source.slice(cursor));
  return result;
};

const isTableDivider = line => /^\s*\|?[\s:-]+(?:\|[\s:-]+)+\|?\s*$/.test(line);
const tableCells = line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());

const specialLine = (lines, index) => {
  const line = lines[index] || "";
  const next = lines[index + 1] || "";

  return (
    /^```/.test(line)
        || /^#{1,6}\s+/.test(line)
        || /^>\s?/.test(line)
        || /^\s*[-*+]\s+/.test(line)
        || /^\s*\d+\.\s+/.test(line)
        || /^---+$/.test(line.trim())
        || (line.includes("|") && isTableDivider(next))
  );
};

export default function MarkdownMessage({ content, artifacts = [], onArtifactSelect }) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  const renderInline = (value, prefix) => inline(value, prefix, artifacts);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code = [];
      index += 1;

      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) index += 1;
      blocks.push(
        <div className="rich-text__code" key={`code-${blocks.length}`}>
          {language && <div className="rich-text__code-label">{language}</div>}
          <pre className="rich-text__code-block"><code>{code.join("\n")}</code></pre>
        </div>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      const Tag = `h${level}`;
      blocks.push(<Tag key={`heading-${blocks.length}`} className={`rich-text__heading rich-text__heading--${level}`}>{renderInline(heading[2], `heading-${blocks.length}`)}</Tag>);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted = [];

      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push(
        <blockquote key={`quote-${blocks.length}`} className="rich-text__quote">
          {quoted.map((item, quoteIndex) => (
            <Fragment key={`quote-line-${quoteIndex}`}>
              {renderInline(item, `quote-${quoteIndex}`)}
              {quoteIndex < quoted.length - 1 && <br />}
            </Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);

    if (unordered || ordered) {
      const items = [];
      const expression = unordered ? /^\s*[-*+]\s+(.+)$/ : /^\s*\d+\.\s+(.+)$/;

      while (index < lines.length) {
        const match = lines[index].match(expression);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }

      const Tag = unordered ? "ul" : "ol";
      blocks.push(
        <Tag key={`list-${blocks.length}`} className={`rich-text__list${unordered ? "" : " rich-text__list--ordered"}`}>
          {items.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`} className="rich-text__list-item">{renderInline(item, `list-${blocks.length}-${itemIndex}`)}</li>
          ))}
        </Tag>,
      );
      continue;
    }

    if (line.includes("|") && isTableDivider(lines[index + 1] || "")) {
      const headers = tableCells(line);
      index += 2;
      const rows = [];

      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }

      blocks.push(
        <div className="rich-text__table" key={`table-${blocks.length}`}>
          <table className="rich-text__table-grid">
            <thead>
              <tr>{headers.map((cell, cellIndex) => <th key={`head-${cellIndex}`} className="rich-text__table-header">{renderInline(cell, `th-${cellIndex}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {headers.map((_, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`} className="rich-text__table-cell">{renderInline(row[cellIndex] || "", `td-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={`rule-${blocks.length}`} className="rich-text__rule" />);
      index += 1;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;

    while (index < lines.length && lines[index].trim() && !specialLine(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    blocks.push(
      <p key={`paragraph-${blocks.length}`} className="rich-text__paragraph">
        {renderInline(paragraph.join(" "), `paragraph-${blocks.length}`)}
      </p>,
    );
  }

  const openArtifact = event => {
    const link = event.target.closest?.("a[data-artifact-id]");
    if (!link) return;
    event.preventDefault();
    onArtifactSelect?.(link.dataset.artifactId);
  };

  return <div className="rich-text" onClick={openArtifact}>{blocks}</div>;
}