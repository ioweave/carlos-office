import { spawn } from 'node:child_process';

const tool = {
  name: 'run-powershell',
  description: 'Executes a PowerShell command and returns its output, error, and exit code.',
  requiresApproval: false,
  input: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The PowerShell command to execute.' },
      workingDirectory: { type: 'string', description: 'Optional working directory for the command.' },
      timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds. Defaults to 30000.' }
    },
    required: ['command']
  },
  async execute(inputs = {}) {
    const command = typeof inputs.command === 'string' ? inputs.command.trim() : '';
    if (!command) throw new Error('command must be a non-empty string');
    const cwd = typeof inputs.workingDirectory === 'string' ? inputs.workingDirectory : undefined;
    const timeoutMs = typeof inputs.timeoutMs === 'number' ? inputs.timeoutMs : 30000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive number');

    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        cwd,
        windowsHide: true,
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeoutMs} ms`));
      }, timeoutMs);

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code, command, workingDirectory: cwd });
      });
    });
  }
};

export default tool;
export { tool };