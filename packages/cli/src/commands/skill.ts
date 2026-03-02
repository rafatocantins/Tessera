/**
 * skill.ts — `tessera skill` subcommands for skills management.
 *
 * keygen        — Generate an Ed25519 key pair for signing skill manifests
 * sign          — Sign a skill manifest template and output signed manifest
 * install-local — Install a signed manifest directly (bypasses marketplace)
 * publish       — Publish a signed skill manifest to the marketplace
 * list          — Browse marketplace skills
 * install       — Install a skill from the marketplace
 * installed     — List locally installed skills
 */
import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import {
  generateEd25519KeyPair,
  signEd25519,
  SkillManifestSchema,
  canonicalSkillPayload,
} from "@tessera/shared";
import { apiGet, apiPost, printApiError } from "../http.js";

const DEFAULT_URL = "http://127.0.0.1:18789";

function addCommonOpts(cmd: Command): Command {
  return cmd
    .option("-t, --token <bearer>", "Bearer token (defaults to $GATEWAY_TOKEN)")
    .option(
      "--url <baseUrl>",
      `Gateway base URL (defaults to $GATEWAY_URL or ${DEFAULT_URL})`,
      process.env["GATEWAY_URL"] ?? DEFAULT_URL
    );
}

function resolveToken(opts: { token?: string }): string {
  const token = opts.token ?? process.env["GATEWAY_TOKEN"];
  if (!token) {
    process.stderr.write(
      "error: bearer token required — pass --token or set GATEWAY_TOKEN\n" +
      "       generate one with: tessera token generate --user <id> --secret <secret>\n"
    );
    process.exit(1);
  }
  return token;
}

export function skillCommand(): Command {
  const cmd = new Command("skill").description("Manage skills and marketplace");

  // ── skill keygen ───────────────────────────────────────────────────────
  cmd
    .command("keygen")
    .description("Generate an Ed25519 key pair for signing skill manifests")
    .option("--name <name>", "File name prefix for the key pair", "tessera-skill")
    .option("--output-dir <dir>", "Directory to write key files", ".")
    .action((opts: { name: string; outputDir: string }) => {
      const { publicKey, privateKey } = generateEd25519KeyPair();

      const dir = path.resolve(opts.outputDir);
      try {
        mkdirSync(dir, { recursive: true });
      } catch { /* ignore if exists */ }

      const privPath = path.join(dir, `${opts.name}.private.key`);
      const pubPath  = path.join(dir, `${opts.name}.public.key`);

      writeFileSync(privPath, privateKey, { mode: 0o600 });
      writeFileSync(pubPath,  publicKey);

      process.stdout.write(`Generated Ed25519 key pair:\n`);
      process.stdout.write(`  Private key: ${privPath}  (keep secret!)\n`);
      process.stdout.write(`  Public key:  ${pubPath}\n\n`);
      process.stdout.write(`Copy the public key into your manifest.template.json "public_key" field:\n`);
      process.stdout.write(`  ${publicKey}\n`);
    });

  // ── skill sign ─────────────────────────────────────────────────────────
  cmd
    .command("sign <manifestTemplate>")
    .description("Sign a skill manifest template and output the signed manifest JSON")
    .requiredOption("--private-key <path>", "Path to the Ed25519 private key file (.private.key)")
    .option("--output <path>", "Write signed manifest to this file (default: stdout)")
    .action((manifestTemplate: string, opts: { privateKey: string; output?: string }) => {
      let templateJson: string;
      try {
        templateJson = readFileSync(manifestTemplate, "utf-8").trim();
      } catch {
        process.stderr.write(`error: could not read manifest template: ${manifestTemplate}\n`);
        process.exit(1);
      }

      let privateKeyHex: string;
      try {
        privateKeyHex = readFileSync(opts.privateKey, "utf-8").trim();
      } catch {
        process.stderr.write(`error: could not read private key: ${opts.privateKey}\n`);
        process.exit(1);
      }

      let manifest: ReturnType<typeof SkillManifestSchema.parse>;
      try {
        manifest = SkillManifestSchema.parse(JSON.parse(templateJson));
      } catch (err) {
        process.stderr.write(`error: manifest template is invalid: ${String(err)}\n`);
        process.exit(1);
      }

      const canonical = canonicalSkillPayload(manifest);
      let signature: string;
      try {
        signature = signEd25519(privateKeyHex, canonical);
      } catch (err) {
        process.stderr.write(`error: signing failed (bad private key?): ${String(err)}\n`);
        process.exit(1);
      }

      const signed = JSON.stringify({ ...manifest, signature }, null, 2);

      if (opts.output) {
        writeFileSync(opts.output, signed);
        process.stdout.write(`Signed manifest written to: ${opts.output}\n`);
      } else {
        process.stdout.write(signed + "\n");
      }
    });

  // ── skill install-local ────────────────────────────────────────────────
  addCommonOpts(
    cmd
      .command("install-local <manifestPath>")
      .description("Install a signed skill manifest directly (bypasses marketplace)")
      .option("--force", "Reinstall even if the same version is already installed")
  ).action(async (manifestPath: string, opts: { token?: string; url: string; force?: boolean }) => {
    const token = resolveToken(opts);

    let manifestJson: string;
    try {
      manifestJson = readFileSync(manifestPath, "utf-8").trim();
    } catch {
      process.stderr.write(`error: could not read manifest file: ${manifestPath}\n`);
      process.exit(1);
    }

    try {
      const { body } = await apiPost(
        `${opts.url}/api/v1/skills`,
        token,
        { manifest_json: manifestJson, force: Boolean(opts.force) }
      );
      const result = body as {
        success: boolean;
        skill_id: string;
        skill_version: string;
        tools_registered: number;
        message: string;
      };
      process.stdout.write(`installed: ${result.skill_id}@${result.skill_version}\n`);
      process.stdout.write(`tools:     ${result.tools_registered} registered\n`);
      process.stdout.write(`message:   ${result.message}\n`);
    } catch (err) {
      printApiError(err);
      process.exit(1);
    }
  });

  // ── skill publish ──────────────────────────────────────────────────────
  addCommonOpts(
    cmd
      .command("publish <manifestPath>")
      .description("Publish a signed skill manifest to the marketplace")
      .option("--trivy", "Run Trivy security scan on the skill's container images before publishing")
  ).action(
    async (manifestPath: string, opts: { token?: string; url: string; trivy?: boolean }) => {
      const token = resolveToken(opts);

      let manifestJson: string;
      try {
        manifestJson = readFileSync(manifestPath, "utf-8").trim();
      } catch {
        process.stderr.write(`error: could not read manifest file: ${manifestPath}\n`);
        process.exit(1);
      }

      // Parse manifest to get image references for Trivy scan
      let trivyScanPassed = false;
      if (opts.trivy) {
        try {
          const manifest = JSON.parse(manifestJson) as {
            tools?: Array<{ image?: { repository?: string; tag?: string; digest?: string } }>;
          };
          const images = (manifest.tools ?? []).map((t) => {
            const img = t.image;
            if (!img) return null;
            return img.digest
              ? `${img.repository}:${img.tag ?? "latest"}@${img.digest}`
              : `${img.repository}:${img.tag ?? "latest"}`;
          }).filter(Boolean);

          let allPassed = true;
          for (const image of images) {
            try {
              process.stdout.write(`[trivy] Scanning ${image}...\n`);
              execSync(`trivy image --exit-code 1 --severity CRITICAL,HIGH ${image}`, { stdio: "inherit" });
            } catch {
              process.stderr.write(`[trivy] WARNING: scan found CRITICAL/HIGH vulnerabilities in ${image}\n`);
              allPassed = false;
            }
          }
          trivyScanPassed = allPassed;
          if (!trivyScanPassed) {
            process.stderr.write("[trivy] WARNING: publishing with failed scan — proceed with caution\n");
          }
        } catch (parseErr) {
          process.stderr.write(`[trivy] WARNING: could not parse manifest to extract images: ${String(parseErr)}\n`);
        }
      }

      try {
        const { body } = await apiPost(
          `${opts.url}/api/v1/marketplace/publish`,
          token,
          { manifest_json: manifestJson, trivy_scan_passed: trivyScanPassed }
        );
        const result = body as { success: boolean; skill_id: string; version: string; message: string };
        process.stdout.write(`published: ${result.skill_id}@${result.version}\n`);
        process.stdout.write(`message:   ${result.message}\n`);
        if (trivyScanPassed) {
          process.stdout.write("trivy:     PASSED\n");
        }
      } catch (err) {
        printApiError(err);
        process.exit(1);
      }
    }
  );

  // ── skill list ──────────────────────────────────────────────────────────
  cmd
    .command("list")
    .description("Browse available skills in the marketplace")
    .option("-s, --search <query>", "Search by name or description")
    .option("--namespace <ns>", "Filter by namespace (e.g. 'tessera')")
    .option("--tag <tag>", "Filter by tag")
    .option(
      "--url <baseUrl>",
      `Gateway base URL (defaults to $GATEWAY_URL or ${DEFAULT_URL})`,
      process.env["GATEWAY_URL"] ?? DEFAULT_URL
    )
    .action(async (opts: { search?: string; namespace?: string; tag?: string; url: string }) => {
      const params = new URLSearchParams();
      if (opts.search) params.set("search", opts.search);
      if (opts.namespace) params.set("namespace", opts.namespace);
      if (opts.tag) params.set("tag", opts.tag);

      try {
        const result = await apiGet(
          `${opts.url}/api/v1/marketplace?${params.toString()}`,
          "" // Public endpoint — no auth required
        );
        const r = result as { skills: Array<{ skill_id: string; version: string; name: string; author_name: string; download_count: number; trivy_scan_passed: boolean; tags: string[] }> };
        const skills = r.skills ?? [];

        if (skills.length === 0) {
          process.stdout.write("No skills found.\n");
          return;
        }

        // Print table
        const COL = { id: 32, ver: 8, author: 20, dl: 8, trivy: 6 };
        process.stdout.write(
          `${"SKILL ID".padEnd(COL.id)} ${"VER".padEnd(COL.ver)} ${"AUTHOR".padEnd(COL.author)} ${"DOWNLOADS".padEnd(COL.dl)} TRIVY\n`
        );
        process.stdout.write(`${"-".repeat(COL.id)} ${"-".repeat(COL.ver)} ${"-".repeat(COL.author)} ${"-".repeat(COL.dl)} -----\n`);

        for (const s of skills) {
          const trivyBadge = s.trivy_scan_passed ? "✓" : "✗";
          process.stdout.write(
            `${s.skill_id.padEnd(COL.id)} ${s.version.padEnd(COL.ver)} ${s.author_name.slice(0, COL.author).padEnd(COL.author)} ${String(s.download_count).padEnd(COL.dl)} ${trivyBadge}\n`
          );
        }
      } catch (err) {
        printApiError(err);
        process.exit(1);
      }
    });

  // ── skill install ──────────────────────────────────────────────────────
  addCommonOpts(
    cmd
      .command("install <skill>")
      .description("Install a skill from the marketplace (format: namespace/name[@version])")
  ).action(async (skillRef: string, opts: { token?: string; url: string }) => {
    const token = resolveToken(opts);

    // Parse "namespace/name@version" or "namespace/name"
    const atIdx = skillRef.lastIndexOf("@");
    const skillId = atIdx > 0 ? skillRef.slice(0, atIdx) : skillRef;
    const version = atIdx > 0 ? skillRef.slice(atIdx + 1) : "latest";

    // Extract namespace and name
    const parts = skillId.split("/");
    if (parts.length !== 2) {
      process.stderr.write(`error: invalid skill reference '${skillRef}' — expected 'namespace/name[@version]'\n`);
      process.exit(1);
    }
    const [ns, name] = parts as [string, string];

    try {
      const { body } = await apiPost(
        `${opts.url}/api/v1/marketplace/install/${ns}/${name}/${version}`,
        token,
        {}
      );
      const result = body as { success: boolean; skill_id: string; skill_version: string; tools_registered: number; message: string };
      process.stdout.write(`installed: ${result.skill_id}@${result.skill_version}\n`);
      process.stdout.write(`tools:     ${result.tools_registered} registered\n`);
      process.stdout.write(`message:   ${result.message}\n`);
      process.stdout.write("\nRestart agent-runtime to activate the new skill.\n");
    } catch (err) {
      printApiError(err);
      process.exit(1);
    }
  });

  // ── skill installed ─────────────────────────────────────────────────────
  addCommonOpts(
    cmd
      .command("installed")
      .description("List locally installed skills")
  ).action(async (opts: { token?: string; url: string }) => {
    const token = resolveToken(opts);
    try {
      const result = await apiGet(`${opts.url}/api/v1/skills`, token);
      const r = result as { skills?: Array<{ id: string; version: string; name: string; tool_count: number; installed_at: string }> };
      const skills = r.skills ?? [];

      if (skills.length === 0) {
        process.stdout.write("No skills installed.\n");
        return;
      }

      process.stdout.write(`${"SKILL ID".padEnd(36)} ${"VER".padEnd(8)} ${"TOOLS".padEnd(6)} INSTALLED AT\n`);
      process.stdout.write(`${"-".repeat(36)} ${"-".repeat(8)} ${"-".repeat(6)} ------------\n`);
      for (const s of skills) {
        process.stdout.write(
          `${s.id.padEnd(36)} ${s.version.padEnd(8)} ${String(s.tool_count).padEnd(6)} ${s.installed_at}\n`
        );
      }
    } catch (err) {
      printApiError(err);
      process.exit(1);
    }
  });

  return cmd;
}
