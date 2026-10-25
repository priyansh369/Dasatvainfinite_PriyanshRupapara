/**
 * scripts/test-flow.ts
 *
 * End-to-end integration test for the Decentralized Cross-Chain Transaction Verification demo.
 *
 * Usage:
 *   Local (default) — spawns two Hardhat nodes, deploys fresh, runs full flow:
 *     npx ts-node scripts/test-flow.ts
 *     npx ts-node scripts/test-flow.ts --local
 *
 *   Testnet — reads deployments.json + .env for addresses and RPC URLs:
 *     npx ts-node scripts/test-flow.ts --testnet
 *
 * Options:
 *   --confirmations <n>   Confirmations to wait after Phase 1 tx (default: 3)
 *   --value <ethAmount>   ETH to lock (default: "0.001")
 *
 * Phases logged with elapsed time:
 *   Phase 0 – Connect / spawn nodes
 *   Phase 1 – Deploy contracts           (local only)
 *   Phase 2 – submitRequest
 *   Phase 3 – waitForConfirmations
 *   Phase 4 – rebuildTree + buildProof
 *   Phase 5 – submitToVerifier
 *   Phase 6 – Verify wDEMO balance
 */

import { ethers }            from "ethers";
import { spawn, spawnSync, ChildProcess } from "child_process";
import * as http             from "http";
import * as path             from "path";
import * as fs               from "fs";
import * as dotenv           from "dotenv";

import {
  CrossChainConfig,
  WRAPPED_DEMO_ABI,
  submitRequest,
  waitForConfirmations,
  rebuildTree,
  buildProof,
  submitToVerifier,
} from "../src/lib/crossChain";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// CLI arg parsing (manual — avoids adding a CLI parser dep)
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        out[key] = argv[i + 1];
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

const args      = parseArgs(process.argv.slice(2));
const isTestnet = "testnet" in args;
const isLocal   = !isTestnet;
const CONFS     = parseInt(String(args["confirmations"] ?? "3"), 10);
const VALUE_ETH = String(args["value"] ?? "0.001");

const N1_PORT = 8545;
const N2_PORT = 8546;

// ─────────────────────────────────────────────────────────────────────────────
// Terminal colour helpers
// ─────────────────────────────────────────────────────────────────────────────

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  red:    "\x1b[31m",
  dim:    "\x1b[2m",
};

function log(msg: string)  { console.log(`  ${msg}`); }
function ok(msg: string)   { console.log(`  ${c.green}✓${c.reset} ${msg}`); }
function info(msg: string) { console.log(`  ${c.cyan}→${c.reset} ${msg}`); }
function err(msg: string)  { console.error(`  ${c.red}✗${c.reset} ${msg}`); }

function phaseHeader(n: number, label: string) {
  console.log(`\n${c.bold}${c.yellow}Phase ${n} — ${label}${c.reset}`);
}

function elapsed(startMs: number): string {
  const ms = Date.now() - startMs;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Node readiness check via raw HTTP (avoids ethers v6 internal retry logs)
// ─────────────────────────────────────────────────────────────────────────────

function httpPost(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port:     Number(parsed.port) || 80,
        path:     parsed.pathname,
        method:   "POST",
        headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function waitForNode(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const payload  = JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 });
  while (Date.now() < deadline) {
    try {
      await httpPost(url, payload);
      return; // any HTTP response = node is up
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Node at ${url} did not become ready within ${timeoutMs / 1000}s`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Spawn a Hardhat node
// ─────────────────────────────────────────────────────────────────────────────

function spawnHardhatNode(port: number, label: string): ChildProcess {
  const child = spawn(
    "npx",
    ["hardhat", "node", "--port", String(port)],
    {
      cwd:   path.resolve(__dirname, ".."),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr?.on("data", (d: Buffer) => {
    const msg = d.toString().trim();
    if (msg && (msg.includes("ERROR") || msg.includes("Error"))) {
      process.stderr.write(`  [${label} err] ${msg}\n`);
    }
  });
  return child;
}

function killProcessTree(child: ChildProcess): void {
  if (child.pid) {
    if (process.platform === "win32") {
      try {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {}
    } else {
      try { child.kill("SIGTERM"); } catch {}
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Load compiled artifact bytecode
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadArtifact(contractFile: string, contractName: string): { abi: any[]; bytecode: string } {
  const p = path.resolve(
    __dirname,
    `../artifacts/contracts/${contractFile}/${contractName}.json`,
  );
  if (!fs.existsSync(p)) {
    throw new Error(`Artifact not found: ${p}\nRun "npx hardhat compile" first.`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(p);
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy helpers (local mode only)
// ─────────────────────────────────────────────────────────────────────────────

async function deployN1(signer: ethers.Signer): Promise<string> {
  const art    = loadArtifact("Router.sol", "Router");
  const router = await new ethers.ContractFactory(art.abi, art.bytecode, signer).deploy();
  await router.waitForDeployment();
  return router.getAddress();
}

async function deployN2(signer: ethers.Signer): Promise<{
  headerVerifierAddress: string;
  wrappedDemoAddress: string;
  verifierAddress: string;
}> {
  const deployerAddr = await signer.getAddress();

  info("  → MockHeaderVerifier…");
  const hvArt = loadArtifact("MockHeaderVerifier.sol", "MockHeaderVerifier");
  const hv    = await new ethers.ContractFactory(hvArt.abi, hvArt.bytecode, signer).deploy();
  await hv.waitForDeployment();
  const headerVerifierAddress = await hv.getAddress();
  ok(`  MockHeaderVerifier: ${headerVerifierAddress}`);

  info("  → WrappedDemo…");
  const wdArt = loadArtifact("WrappedDemo.sol", "WrappedDemo");
  const wd    = await new ethers.ContractFactory(wdArt.abi, wdArt.bytecode, signer).deploy(
    deployerAddr,
  );
  await wd.waitForDeployment();
  const wrappedDemoAddress = await wd.getAddress();
  ok(`  WrappedDemo       : ${wrappedDemoAddress}`);

  info("  → Verifier…");
  const vArt  = loadArtifact("Verifier.sol", "Verifier");
  const v     = await new ethers.ContractFactory(vArt.abi, vArt.bytecode, signer).deploy(
    headerVerifierAddress,
    wrappedDemoAddress,
  );
  await v.waitForDeployment();
  const verifierAddress = await v.getAddress();
  ok(`  Verifier          : ${verifierAddress}`);

  info("  → Transferring WrappedDemo ownership to Verifier…");
  // Transfer WrappedDemo ownership → Verifier
  const wd2 = new ethers.Contract(
    wrappedDemoAddress,
    ["function transferOwnership(address)"],
    signer,
  );
  await (await wd2.transferOwnership(verifierAddress)).wait();
  ok("  Ownership transferred ✓");

  return { headerVerifierAddress, wrappedDemoAddress, verifierAddress };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\n${c.bold}Cross-Chain Verification — Integration Test${c.reset}`,
    `\n  mode         : ${isLocal ? "LOCAL (two Hardhat nodes)" : "TESTNET"}`,
    `\n  confirmations: ${CONFS}`,
    `\n  value        : ${VALUE_ETH} ETH`,
  );

  const children: ChildProcess[] = [];
  const cleanup = () => children.forEach((ch) => killProcessTree(ch));
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(1); });
  process.on("uncaughtException", (e) => { err(String(e)); cleanup(); process.exit(1); });

  const totalStart = Date.now();

  // ── Phase 0: Connect / spawn ──────────────────────────────────────────────
  phaseHeader(0, "Connect / spawn nodes");
  const t0 = Date.now();

  let n1Provider: ethers.JsonRpcProvider;
  let n2Provider: ethers.JsonRpcProvider;
  let n1Signer: ethers.Signer;
  let n2Signer: ethers.Signer;
  let routerAddress: string;
  let verifierAddress: string;
  let wrappedDemoAddress: string;

  if (isLocal) {
    info(`Spawning N1 Hardhat node on port ${N1_PORT}…`);
    children.push(spawnHardhatNode(N1_PORT, "N1"));

    info(`Spawning N2 Hardhat node on port ${N2_PORT}…`);
    children.push(spawnHardhatNode(N2_PORT, "N2"));

    info("Waiting for both nodes to become ready (up to 60 s)…");
    await Promise.all([
      waitForNode(`http://127.0.0.1:${N1_PORT}`, 60_000).then(() =>
        ok(`N1 ready  (http://127.0.0.1:${N1_PORT})`),
      ),
      waitForNode(`http://127.0.0.1:${N2_PORT}`, 60_000).then(() =>
        ok(`N2 ready  (http://127.0.0.1:${N2_PORT})`),
      ),
    ]);

    // KNOWN LIMITATION: both local nodes share chainId 31337; MockHeaderVerifier
    // accepts any header so this is fine for demo purposes.
    n1Provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${N1_PORT}`);
    n2Provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${N2_PORT}`);

    // Hardhat default funded account #0 wrapped in NonceManager
    const HARDHAT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    n1Signer = new ethers.NonceManager(new ethers.Wallet(HARDHAT_KEY, n1Provider));
    n2Signer = new ethers.NonceManager(new ethers.Wallet(HARDHAT_KEY, n2Provider));
  } else {
    const SEPOLIA_RPC = process.env.SEPOLIA_RPC;
    const AMOY_RPC   = process.env.AMOY_RPC;
    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    if (!SEPOLIA_RPC || !AMOY_RPC || !PRIVATE_KEY) {
      throw new Error("Testnet mode requires SEPOLIA_RPC, AMOY_RPC, PRIVATE_KEY in .env");
    }

    n1Provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
    n2Provider = new ethers.JsonRpcProvider(AMOY_RPC);
    n1Signer   = new ethers.NonceManager(new ethers.Wallet(PRIVATE_KEY, n1Provider));
    n2Signer   = new ethers.NonceManager(new ethers.Wallet(PRIVATE_KEY, n2Provider));

    const depPath = path.resolve(__dirname, "../deployments.json");
    if (!fs.existsSync(depPath)) {
      throw new Error("deployments.json not found — run npm run deploy:n1 and deploy:n2 first.");
    }
    const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));
    routerAddress      = dep.n1?.router;
    verifierAddress    = dep.n2?.verifier;
    wrappedDemoAddress = dep.n2?.wrappedDemo;
    if (!routerAddress || !verifierAddress || !wrappedDemoAddress) {
      throw new Error("deployments.json is missing n1.router or n2.verifier/wrappedDemo.");
    }
    info(`Router      : ${routerAddress}`);
    info(`Verifier    : ${verifierAddress}`);
    info(`WrappedDemo : ${wrappedDemoAddress}`);
  }

  ok(`N1 signer: ${await n1Signer.getAddress()}`);
  ok(`N2 signer: ${await n2Signer.getAddress()}`);
  log(`${c.dim}Phase 0 elapsed: ${elapsed(t0)}${c.reset}`);

  // ── Phase 1: Deploy (local only) ──────────────────────────────────────────
  if (isLocal) {
    phaseHeader(1, "Deploy contracts");
    const t1 = Date.now();

    info("Deploying Router → N1…");
    routerAddress = await deployN1(n1Signer);
    ok(`Router            : ${routerAddress}`);

    info("Deploying N2 stack…");
    const n2 = await deployN2(n2Signer);
    verifierAddress    = n2.verifierAddress;
    wrappedDemoAddress = n2.wrappedDemoAddress;
    ok(`MockHeaderVerifier: ${n2.headerVerifierAddress}`);
    ok(`WrappedDemo       : ${wrappedDemoAddress}`);
    ok(`Verifier          : ${verifierAddress}`);
    log(`${c.dim}Phase 1 elapsed: ${elapsed(t1)}${c.reset}`);
  } else {
    phaseHeader(1, "Deploy contracts (SKIPPED — using deployments.json)");
  }

  const config: CrossChainConfig = {
    routerAddress:   routerAddress!,
    n1Provider,
    n1Signer,
    verifierAddress: verifierAddress!,
    n2Provider,
    n2Signer,
  };
  const recipient = await n2Signer.getAddress();

  // ── Phase 2: submitRequest ────────────────────────────────────────────────
  phaseHeader(2, "submitRequest (N1)");
  const t2 = Date.now();

  info(`Locking ${VALUE_ETH} ETH → recipient ${recipient}`);
  const submitted = await submitRequest(config, recipient, VALUE_ETH);
  ok(`Tx hash   : ${submitted.txHash}`);
  ok(`Block     : ${submitted.blockNumber}`);
  ok(`Request id: ${submitted.id}`);
  ok(`Leaf hash : ${submitted.leaf}`);
  ok(`Deadline  : ${new Date(Number(submitted.deadline) * 1000).toISOString()}`);
  log(`${c.dim}Phase 2 elapsed: ${elapsed(t2)}${c.reset}`);

  // ── Phase 3: waitForConfirmations ─────────────────────────────────────────
  phaseHeader(3, `waitForConfirmations (target: ${CONFS})`);
  const t3 = Date.now();

  // On local Hardhat nodes, mine blocks via hardhat_mine to avoid real-time waiting.
  const miner: (() => Promise<void>) | undefined = isLocal
    ? async () => { await (n1Provider as ethers.JsonRpcProvider).send("hardhat_mine", ["0x1"]); }
    : undefined;

  await waitForConfirmations(
    n1Provider,
    submitted.txHash,
    CONFS,
    (cur, tgt) => info(`  confirmations: ${cur} / ${tgt}`),
    miner,
    isLocal ? 50 : 2_000, // minimal sleep on local (miner does the work)
  );

  ok(`${CONFS} confirmations reached`);
  log(`${c.dim}Phase 3 elapsed: ${elapsed(t3)}${c.reset}`);

  // ── Phase 4: rebuildTree + buildProof ─────────────────────────────────────
  phaseHeader(4, "rebuildTree + buildProof (N1)");
  const t4 = Date.now();

  info("Rebuilding Merkle tree from on-chain logs…");
  const treeState = await rebuildTree(config);
  ok(`Leaves in tree : ${treeState.requests.size} / ${1 << 8}`);
  ok(`Root (computed): ${treeState.root}`);
  ok(`Root assertion : ✓ matches Router.root()`);

  info(`Building proof for request id ${submitted.id}…`);
  const proofResult = await buildProof(config, submitted.id);
  ok(`Proof length   : ${proofResult.proof.length} siblings`);
  ok(`Header root    : ${proofResult.header.root}`);
  ok(`Source block   : ${proofResult.header.sourceBlock}`);
  log(`${c.dim}  Siblings:`);
  proofResult.proof.forEach((s, i) => log(`  ${c.dim}[${i}] ${s}${c.reset}`));
  log(`${c.dim}Phase 4 elapsed: ${elapsed(t4)}${c.reset}`);

  // ── Phase 5: submitToVerifier ─────────────────────────────────────────────
  phaseHeader(5, "submitToVerifier (N2)");
  const t5 = Date.now();

  info("Calling Verifier.verifyAndExecute…");
  const verifyReceipt = await submitToVerifier(
    config,
    proofResult.header,
    proofResult.proof,
    proofResult.request,
  );
  ok(`Tx hash : ${verifyReceipt.hash}`);
  ok(`Block   : ${verifyReceipt.blockNumber}`);
  log(`${c.dim}Phase 5 elapsed: ${elapsed(t5)}${c.reset}`);

  // ── Phase 6: Verify wDEMO balance ─────────────────────────────────────────
  phaseHeader(6, "Verify wDEMO balance (N2)");
  const t6 = Date.now();

  const wDemo    = new ethers.Contract(wrappedDemoAddress!, WRAPPED_DEMO_ABI, n2Provider);
  const decimals = await wDemo.decimals() as bigint;
  const balance  = await wDemo.balanceOf(recipient) as bigint;
  const expected = ethers.parseEther(VALUE_ETH);

  ok(`Recipient    : ${recipient}`);
  ok(`wDEMO balance: ${ethers.formatUnits(balance, decimals)} wDEMO`);
  ok(`Expected     : ${ethers.formatUnits(expected, decimals)} wDEMO`);

  if (balance !== expected) {
    throw new Error(`Balance mismatch: got ${balance}, expected ${expected}`);
  }
  ok(`Balance assertion PASSED ✓`);
  log(`${c.dim}Phase 6 elapsed: ${elapsed(t6)}${c.reset}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${c.bold}${c.green}✓ All phases passed!  Total: ${elapsed(totalStart)}${c.reset}\n`);
  cleanup();
  process.exit(0);
}

main().catch((e) => {
  err(String(e));
  if (e?.stack) console.error(c.dim + e.stack + c.reset);
  process.exit(1);
});
