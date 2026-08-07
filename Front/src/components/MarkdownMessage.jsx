import { Fragment } from 'react';

const safeLink = value => {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch {
        return '';
    }
};

const inline = (value, prefix = 'inline') => {
    const inlinePattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^) \n]+\))/g;
    const source = String(value || '');
    const result = [];
    let cursor = 0;
    let match;
    let index = 0;

    while ((match = inlinePattern.exec(source))) {
        if (match.index > cursor) result.push(source.slice(cursor, match.index));
        const token = match[0];
        const key = `${prefix}-${index++}`;

        if (token.startsWith('`')) {
            result.push(<code key={key}>{token.slice(1, -1)}</code>);
        } else if (token.startsWith('**')) {
            result.push(<strong key={key}>{inline(token.slice(2, -2), `${key}-strong`)}</strong>);
        } else {
            const link = token.match(/^\[([^\]]+)]\(([^)]+)\)$/);
            const href = safeLink(link?.[2]);
            result.push(href
                ? <a key={key} href={href} target="_blank" rel="noreferrer">{link[1]}</a>
                : token);
        }

        cursor = match.index + token.length;
    }

    if (cursor < source.length) result.push(source.slice(cursor));
    return result;
};

const isTableDivider = line => /^\s*\|?[\s:-]+(?:\|[\s:-]+)+\|?\s*$/.test(line);
const tableCells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

const specialLine = (lines, index) => {
    const line = lines[index] || '';
    const next = lines[index + 1] || '';

    return (
        /^```/.test(line)
        || /^#{1,6}\s+/.test(line)
        || /^>\s?/.test(line)
        || /^\s*[-*+]\s+/.test(line)
        || /^\s*\d+\.\s+/.test(line)
        || /^---+$/.test(line.trim())
        || (line.includes('|') && isTableDivider(next))
    );
};

export default function MarkdownMessage({ content }) {
    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];

        if (!line.trim()) {
            index += 1;
            continue;
        }

        if (line.startsWith('```')) {
            const language = line.slice(3).trim();
            const code = [];
            index += 1;

            while (index < lines.length && !lines[index].startsWith('```')) {
                code.push(lines[index]);
                index += 1;
            }

            if (index < lines.length) index += 1;
            blocks.push(
                <div className="rich-text__code" key={`code-${blocks.length}`}>
                    {language && <div className="rich-text__code-label">{language}</div>}
                    <pre><code>{code.join('\n')}</code></pre>
                </div>,
            );
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            const level = Math.min(heading[1].length, 4);
            const Tag = `h${level}`;
            blocks.push(<Tag key={`heading-${blocks.length}`}>{inline(heading[2], `heading-${blocks.length}`)}</Tag>);
            index += 1;
            continue;
        }

        if (/^>\s?/.test(line)) {
            const quoted = [];

            while (index < lines.length && /^>\s?/.test(lines[index])) {
                quoted.push(lines[index].replace(/^>\s?/, ''));
                index += 1;
            }

            blocks.push(
                <blockquote key={`quote-${blocks.length}`}>
                    {quoted.map((item, quoteIndex) => (
                        <Fragment key={`quote-line-${quoteIndex}`}>
                            {inline(item, `quote-${quoteIndex}`)}
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

            const Tag = unordered ? 'ul' : 'ol';
            blocks.push(
                <Tag key={`list-${blocks.length}`}>
                    {items.map((item, itemIndex) => (
                        <li key={`item-${itemIndex}`}>{inline(item, `list-${blocks.length}-${itemIndex}`)}</li>
                    ))}
                </Tag>,
            );
            continue;
        }

        if (line.includes('|') && isTableDivider(lines[index + 1] || '')) {
            const headers = tableCells(line);
            index += 2;
            const rows = [];

            while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
                rows.push(tableCells(lines[index]));
                index += 1;
            }

            blocks.push(
                <div className="rich-text__table" key={`table-${blocks.length}`}>
                    <table>
                        <thead>
                            <tr>{headers.map((cell, cellIndex) => <th key={`head-${cellIndex}`}>{inline(cell, `th-${cellIndex}`)}</th>)}</tr>
                        </thead>
                        <tbody>
                            {rows.map((row, rowIndex) => (
                                <tr key={`row-${rowIndex}`}>
                                    {headers.map((_, cellIndex) => (
                                        <td key={`cell-${rowIndex}-${cellIndex}`}>{inline(row[cellIndex] || '', `td-${rowIndex}-${cellIndex}`)}</td>
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
            blocks.push(<hr key={`rule-${blocks.length}`} />);
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
            <p key={`paragraph-${blocks.length}`}>
                {inline(paragraph.join(' '), `paragraph-${blocks.length}`)}
            </p>,
        );
    }

    return <div className="rich-text">{blocks}</div>;
}
