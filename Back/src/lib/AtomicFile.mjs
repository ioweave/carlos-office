import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Atomically replace one durable file. The temporary sibling is fsynced before rename so readers
 * see either the previous complete version or the next complete version, never a partial write.
 */
export const atomicWriteFile = async (path, data, encoding = null) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle = null;

  try {
    handle = await open(temporary, "w");
    await handle.writeFile(data, encoding ?? undefined);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
  } catch (error) {
    try { await handle?.close(); } catch {}
    try { await rm(temporary, { force: true }); } catch {}
    throw error;
  }
};
