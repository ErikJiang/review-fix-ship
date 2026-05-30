#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = join(ROOT, "skills", "review-fix-ship");
const SKILL_FILE = join(SKILL_DIR, "SKILL.md");

function fail(message) {
  throw new Error(message);
}

if (!existsSync(SKILL_FILE)) fail(`Missing skill file: ${SKILL_FILE}`);

const content = readFileSync(SKILL_FILE, "utf8");
const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!match) fail("SKILL.md must start with YAML frontmatter");

const frontmatter = new Map();
for (const line of match[1].split(/\r?\n/)) {
  const separator = line.indexOf(":");
  if (separator === -1) continue;
  frontmatter.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
}

const name = frontmatter.get("name");
const description = frontmatter.get("description");
if (!name) fail("SKILL.md frontmatter requires name");
if (!description) fail("SKILL.md frontmatter requires description");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) fail(`Invalid skill name: ${name}`);
if (name !== basename(SKILL_DIR)) fail(`Skill directory must match name: ${name}`);
if (description.length > 1024) fail("Skill description must not exceed 1024 characters");
if (/[<>]/.test(description)) fail("Skill description must not contain angle brackets");

const requiredFiles = [
  "README.md",
  "TODO.md",
  join("scripts", "reviewctl.mjs"),
  join("scripts", "reviewctl.test.mjs"),
  join("references", "hosts.md"),
  join("references", "platforms.md"),
  join("references", "token-efficiency.md"),
];

for (const file of requiredFiles) {
  if (!existsSync(join(SKILL_DIR, file))) fail(`Missing required skill resource: ${file}`);
}

process.stdout.write(`Validated ${name}: ${requiredFiles.length + 1} required files present\n`);
