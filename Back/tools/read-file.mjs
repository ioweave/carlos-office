import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const tool = {
  name: 'read-file',
  description: 'Reads the contents of a file from the local filesystem and returns the text content with metadata.',
  requiresApproval: false,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file to read.' },
      encoding: { type: 'string', description: 'Text encoding to use when decoding the file.', default: 'utf8' },
      maxBytes: { type: 'number', description: 'Maximum file size in bytes allowed to be read.', default: 5242880 }
    },
    required: ['path'],
    additionalProperties: false
  },
  async execute({ path, encoding = 'utf8', maxBytes = 5242880 } = {}) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('read-file: "path" is required and must be a non-empty string.');
    }
    const abs = resolve(path);
    const info = await stat(abs);
    if (!info.isFile()) {
      throw new Error(`read-file: not a regular file: ${abs}`);
    }
    if (info.size > maxBytes) {
      throw new Error(`read-file: file too large (${info.size} bytes > ${maxBytes} limit).`);
    }
    const content = await readFile(abs, { encoding });
    return {
      path: abs,
      bytes: info.size,
      encoding,
      content
    };
  }
};

export default tool;