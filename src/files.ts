// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * File helpers of the plugin.
 *
 * Every write is UTF-8 with LF and a final newline. Every path that the plugin builds stays
 * below the session output directory.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_OUTPUT_DIRECTORY_NAME, INPUTS_DIRECTORY_NAME } from "./constants.js";
import { ExperimentError } from "./errors.js";

/**
 * Create one directory and its parents.
 *
 * @param directory - the absolute or working-directory-relative path.
 */
export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

/**
 * Report whether a path exists.
 *
 * @param target - the path to test.
 * @returns true when the path exists.
 */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse one JSON file.
 *
 * @param filePath - the path of the file.
 * @returns the parsed value.
 * @throws ExperimentError when the file is absent or holds invalid JSON.
 */
export async function readJsonFile(filePath: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    throw new ExperimentError("FILE_FAILURE", `Cannot read the file ${filePath}.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ExperimentError("FILE_FAILURE", `The file ${filePath} holds invalid JSON.`);
  }
}

/**
 * Write one JSON file with two-space indentation and a final newline.
 *
 * @param filePath - the path of the file.
 * @param value - the value to write.
 */
export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, text, "utf8");
}

/**
 * Write one text file and add a final newline when it is absent.
 *
 * @param filePath - the path of the file.
 * @param text - the text to write.
 */
export async function writeTextFile(filePath: string, text: string): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await writeFile(filePath, body, "utf8");
}

/**
 * Read one text file.
 *
 * @param filePath - the path of the file.
 * @returns the file text.
 */
export async function readTextFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    throw new ExperimentError("FILE_FAILURE", `Cannot read the file ${filePath}.`);
  }
}

/**
 * List the direct child directories of one directory.
 *
 * @param directory - the directory to read.
 * @returns the absolute child paths, sorted by name.
 */
export async function listChildDirectories(directory: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const directories: string[] = [];
  for (const name of names.sort()) {
    const child = path.join(directory, name);
    try {
      const info = await stat(child);
      if (info.isDirectory()) {
        directories.push(child);
      }
    } catch {
      continue;
    }
  }
  return directories;
}

/**
 * Compute the SHA-256 digest of one text.
 *
 * @param text - the text to hash.
 * @returns the digest as lowercase hexadecimal.
 */
export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Build one session code from the start time and a random suffix.
 *
 * The code is safe as a directory name on every platform, and its lexical order is the creation
 * order.
 *
 * @param startedAt - the start time of the run.
 * @param randomSeed - the seed of the run; it makes two runs of one second distinguishable.
 * @returns the session code, for example `20260815T101500Z-20260815-a1b2c3`.
 */
export function createSessionCode(startedAt: Date, randomSeed: number): string {
  const stamp = startedAt.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  const suffix = randomBytes(3).toString("hex");
  return `${stamp}-${randomSeed}-${suffix}`;
}

/**
 * Make one string safe as one path segment.
 *
 * @param value - the string to convert.
 * @returns the string with each unsafe character replaced by a hyphen.
 */
export function safeFileSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return cleaned === "" ? "unnamed" : cleaned;
}

/**
 * Resolve one file of the packaged plugin directory.
 *
 * @param relativePath - the path relative to the package root, for example `inputs/providers.json`.
 * @returns the absolute path of the file.
 */
export function packagedPath(relativePath: string): string {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  return path.join(root, relativePath);
}

/**
 * Resolve the output root of one run.
 *
 * A relative root resolves against the workspace directory. An empty root selects the default
 * directory name below the workspace.
 *
 * @param workspace - the absolute workspace directory.
 * @param outputRoot - the configured output root, possibly empty.
 * @returns the absolute output root.
 */
export function resolveOutputRoot(workspace: string, outputRoot: string): string {
  if (outputRoot.trim() === "") {
    return path.join(workspace, DEFAULT_OUTPUT_DIRECTORY_NAME);
  }
  return path.isAbsolute(outputRoot) ? outputRoot : path.join(workspace, outputRoot);
}

/**
 * Resolve an input file of a workspace.
 *
 * A workspace copy wins over the packaged copy. The function does not create a file.
 *
 * @param workspace - the absolute workspace directory.
 * @param fileName - the file name inside the inputs directory.
 * @returns the absolute path of the file to read.
 */
export async function resolveInputPath(workspace: string, fileName: string): Promise<string> {
  const workspacePath = path.join(workspace, INPUTS_DIRECTORY_NAME, fileName);
  if (await pathExists(workspacePath)) {
    return workspacePath;
  }
  return packagedPath(path.join(INPUTS_DIRECTORY_NAME, fileName));
}

/**
 * Resolve the inputs directory of a workspace.
 *
 * @param workspace - the absolute workspace directory.
 * @returns the absolute inputs directory.
 */
export function resolveInputsDirectory(workspace: string): string {
  return path.join(workspace, INPUTS_DIRECTORY_NAME);
}

/**
 * Wait for one delay.
 *
 * @param delayMilliseconds - the delay in milliseconds.
 * @param signal - the cancellation signal.
 * @returns a promise that settles after the delay.
 */
export async function sleep(
  delayMilliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve();
    }, delayMilliseconds);
    if (signal === undefined) {
      return;
    }
    if (signal.aborted) {
      clearTimeout(timer);
      reject(new Error("The delay was cancelled."));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("The delay was cancelled."));
      },
      { once: true },
    );
  });
}
