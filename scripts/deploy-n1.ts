/**
 * deploy-n1.ts — Deploy Router to Sepolia (N1).
 *
 * Usage:
 *   npx hardhat run scripts/deploy-n1.ts --network sepolia
 *
 * Reads:  SEPOLIA_RPC, PRIVATE_KEY from .env
 * Writes: shared/deployments.json  (creates or merges)
 *         shared/abis/Router.json
 */

import { ethers, artifacts } from "hardhat";
import * as fs   from "fs";
import * as path from "path";

const SHARED_DIR      = path.resolve(__dirname, "../shared");
const DEPLOYMENTS_FILE = path.join(SHARED_DIR, "deployments.json");
const ABIS_DIR         = path.join(SHARED_DIR, "abis");

const REQUEST_TTL    = 3600;  // 1 hour  (seconds)
const RECLAIM_GRACE  = 600;   // 10 min  (seconds)

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Router to N1 (Sepolia) with:", deployer.address);

  const RouterFactory = await ethers.getContractFactory("Router");
  const router = await RouterFactory.deploy(REQUEST_TTL, RECLAIM_GRACE);
  await router.waitForDeployment();

  const routerAddress = await router.getAddress();
  console.log("Router deployed at:", routerAddress);
  console.log("  requestTtl  :", REQUEST_TTL, "s");
  console.log("  reclaimGrace:", RECLAIM_GRACE, "s");

  // ── Ensure shared directories exist ────────────────────────────────────────
  fs.mkdirSync(ABIS_DIR, { recursive: true });

  // ── Export ABI ─────────────────────────────────────────────────────────────
  const artifact = await artifacts.readArtifact("Router");
  fs.writeFileSync(path.join(ABIS_DIR, "Router.json"), JSON.stringify(artifact.abi, null, 2));
  console.log("ABI written to shared/abis/Router.json");

  // ── Write / merge deployments.json ─────────────────────────────────────────
  let deployments: Record<string, unknown> = {};
  if (fs.existsSync(DEPLOYMENTS_FILE)) {
    deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
  }

  deployments["n1"] = {
    network:      "sepolia",
    chainId:      11155111,
    router:       routerAddress,
    requestTtl:   REQUEST_TTL,
    reclaimGrace: RECLAIM_GRACE,
    deployedAt:   new Date().toISOString(),
    deployer:     deployer.address,
  };

  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
  console.log("Addresses written to shared/deployments.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
