// Generates the TypeScript side of the core bridge:
//   src/lib/anki/proto/anki/*_pb.ts   message types (protoc-gen-es v2)
//   src/lib/anki/generated/core.ts    one typed call per core method (src-tauri/codegen)
//
// The descriptor set is written by the core's own build (cargo build in
// src-tauri) to build/core/descriptors.bin.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protoRoot = join(root, "vendor/anki/proto");
const out = join(root, "src/lib/anki/proto");
const generated = join(root, "src/lib/anki/generated");
const descriptors = join(root, "build/core/descriptors.bin");
const isWindows = process.platform === "win32";

function findProtoc() {
  if (process.env.PROTOC) return process.env.PROTOC;
  const local = join(root, ".tools/protoc/bin", isWindows ? "protoc.exe" : "protoc");
  return existsSync(local) ? local : "protoc";
}

const protos = readdirSync(join(protoRoot, "anki"))
  .filter((name) => name.endsWith(".proto"))
  .map((name) => `anki/${name}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const plugin = join(root, "node_modules/.bin", isWindows ? "protoc-gen-es.cmd" : "protoc-gen-es");
execFileSync(
  findProtoc(),
  [
    `--plugin=protoc-gen-es=${plugin}`,
    `--es_out=${out}`,
    "--es_opt=target=ts,import_extension=none",
    `--proto_path=${protoRoot}`,
    ...protos,
  ],
  { stdio: "inherit", cwd: root },
);
console.log(`Wrote ${protos.length} message modules to ${out}`);

if (!existsSync(descriptors)) {
  console.error(`Missing ${descriptors}; build the core first (cargo build in src-tauri).`);
  process.exit(1);
}
execFileSync(
  "cargo",
  ["run", "--quiet", "--package", "hayaki_codegen", "--", descriptors, generated],
  { stdio: "inherit", cwd: join(root, "src-tauri") },
);
console.log(`Wrote ${join(generated, "core.ts")}`);
