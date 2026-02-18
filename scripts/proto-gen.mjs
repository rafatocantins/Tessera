#!/usr/bin/env node
// proto-gen.mjs — Generate TypeScript gRPC stubs from .proto files
// Uses ts-proto for clean TypeScript output (no JS runtime, proper AsyncIterable)
//
// Requirements: protoc must be installed
//   macOS: brew install protobuf
//   Ubuntu: apt install protobuf-compiler
//   Or: use the npm protoc wrapper (npx protoc-gen-ts_proto)

import { execSync } from "node:child_process";
import { readdirSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROTO_DIR = resolve(ROOT, "packages/shared/src/proto");
const OUT_DIR = resolve(ROOT, "packages/shared/src/proto/generated");

if (!existsSync(OUT_DIR)) {
  mkdirSync(OUT_DIR, { recursive: true });
}

const protos = readdirSync(PROTO_DIR)
  .filter((f) => f.endsWith(".proto"))
  .map((f) => resolve(PROTO_DIR, f));

// Find ts-proto plugin
const tsProtoPlugin = resolve(ROOT, "node_modules/.bin/protoc-gen-ts_proto");

if (!existsSync(tsProtoPlugin)) {
  console.error(
    "ts-proto plugin not found. Run: pnpm add -w -D ts-proto protoc-gen-ts_proto"
  );
  process.exit(1);
}

console.log(`[proto-gen] Generating TypeScript stubs from ${protos.length} .proto files...`);

const cmd = [
  "protoc",
  `--plugin=protoc-gen-ts_proto=${tsProtoPlugin}`,
  `--ts_proto_out=${OUT_DIR}`,
  "--ts_proto_opt=outputServices=grpc-js",
  "--ts_proto_opt=esModuleInterop=true",
  "--ts_proto_opt=env=node",
  "--ts_proto_opt=useDate=false",
  `--proto_path=${PROTO_DIR}`,
  ...protos,
].join(" ");

try {
  execSync(cmd, { stdio: "inherit" });
  console.log(`[proto-gen] Done! Generated files in ${OUT_DIR}/`);
} catch (err) {
  console.error("[proto-gen] protoc failed. Make sure protoc is installed:");
  console.error("  macOS: brew install protobuf");
  console.error("  Ubuntu: apt install protobuf-compiler");
  process.exit(1);
}
