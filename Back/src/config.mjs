import { loadEnvFile } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

try {
  loadEnvFile(resolve(here, "../.env"));
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

const port = Number(process.env.LOCAL_PORT);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid LOCAL_PORT: ${process.env.LOCAL_PORT}`);
}

const config = {
  host: process.env.LOCAL_HOST,
  port,
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL,
    apiKey: process.env.OLLAMA_API_KEY,
  },
};

export default config;
