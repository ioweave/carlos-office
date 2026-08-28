import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getVariable } from "../src/services/VariableService.mjs";
import { runExternalCommand } from "../src/services/ExternalCommandService.mjs";
import { resolveWorkspacePath } from "../src/services/ExecutionWorkspaceService.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultHome = resolve(here, "../.carlos-office/integrations/Unlimited-OCR");
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

const tool = {
  name: "unlimited-ocr",
  description: "Runs Baidu Unlimited-OCR against a PDF, image, or image directory. The upstream repository is kept outside Carlos Office source and is invoked through its infer.py entry point. Results are written as Markdown files in the Agent workspace so they can be consumed or declared as Artifacts.",
  requiresApproval: false,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      source: { type: "string", description: "PDF, image file, or image directory. Relative paths resolve inside the Agent workspace." },
      outputDirectory: { type: "string", description: "Output directory. Defaults to unlimited-ocr-output in the Agent workspace.", default: "unlimited-ocr-output" },
      model: { type: "string", description: "Hugging Face model id or local model path.", default: "baidu/Unlimited-OCR" },
      imageMode: { type: "string", enum: ["gundam", "base"], default: "gundam" },
      concurrency: { type: "number", description: "Concurrent page/image requests.", default: 8 },
      gpu: { type: "string", description: "CUDA_VISIBLE_DEVICES value passed to Unlimited-OCR.", default: "0" },
      timeoutMs: { type: "number", description: "Maximum runtime in milliseconds.", default: 1800000 },
    },
    required: ["source"],
    additionalProperties: false,
  },
  output: { type: "object" },
  async execute(inputs = {}, context = {}) {
    if (typeof inputs.source !== "string" || !inputs.source.trim()) throw new Error("unlimited-ocr: source is required");
    const concurrency = inputs.concurrency ?? 8;
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64) {
      throw new Error("unlimited-ocr: concurrency must be an integer from 1 to 64");
    }
    const timeoutMs = inputs.timeoutMs ?? 1_800_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("unlimited-ocr: timeoutMs must be positive");

    const home = getVariable("integration.unlimitedOcrPath")?.value
      || process.env.UNLIMITED_OCR_HOME
      || defaultHome;
    const python = getVariable("integration.pythonCommand")?.value || process.env.PYTHON_COMMAND || "python";
    const source = resolveWorkspacePath(context.workspaceDir, inputs.source);
    const outputDirectory = resolveWorkspacePath(context.workspaceDir, inputs.outputDirectory || "unlimited-ocr-output");
    const sourceInfo = await stat(source);
    const args = [resolve(home, "infer.py"), "--output_dir", outputDirectory, "--concurrency", String(concurrency)];
    args.push("--gpu", inputs.gpu || "0", "--model_dir", inputs.model || "baidu/Unlimited-OCR");
    args.push("--image_mode", inputs.imageMode || "gundam", "--server_log", resolve(outputDirectory, "sglang-server.log"));

    let temporaryInput = null;
    if (sourceInfo.isDirectory()) {
      args.push("--image_dir", source);
    } else if (extname(source).toLowerCase() === ".pdf") {
      args.push("--pdf", source);
    } else if (imageExtensions.has(extname(source).toLowerCase())) {
      temporaryInput = resolve(context.workspaceDir || outputDirectory, `.unlimited-ocr-${randomUUID()}`);
      await mkdir(temporaryInput, { recursive: true });
      await copyFile(source, resolve(temporaryInput, `input${extname(source).toLowerCase()}`));
      args.push("--image_dir", temporaryInput);
    } else {
      throw new Error("unlimited-ocr: source must be a PDF, supported image, or image directory");
    }

    await mkdir(outputDirectory, { recursive: true });
    try {
      const result = await runExternalCommand({
        command: python,
        args,
        cwd: home,
        timeoutMs,
        signal: context.signal,
      });
      const files = (await readdir(outputDirectory, { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
        .map(entry => resolve(outputDirectory, entry.name));
      return { outputDirectory, files, log: result.stdout };
    } finally {
      if (temporaryInput) await rm(temporaryInput, { recursive: true, force: true });
    }
  },
};

export default tool;
export { tool };
