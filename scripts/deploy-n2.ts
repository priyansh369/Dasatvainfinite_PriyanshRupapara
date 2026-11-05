/**
 * deploy-n2.ts — Deploy WrappedDemo, MockHeaderVerifier, and Verifier to Polygon Amoy (N2).
 *
 * Usage:
 *   npx hardhat run scripts/deploy-n2.ts --network amoy
 *
 * Reads:  AMOY_RPC, PRIVATE_KEY from .env
 *         shared/deployments.json (to get n1.router address and n1.chainId)
 * Writes: shared/deployments.json  (creates or merges)
 *         shared/abis/WrappedDemo.json
 *         shared/abis/MockHeaderVerifier.json
 *         shared/abis/Verifier.json
 *
 * Deployment order:
 *   1. MockHeaderVerifier  (no deps)
 *   2. WrappedDemo         (deployer as initial owner)
 *   3. Verifier            (depends on 1 + 2 + n1 Router address + n1 chainId)
 *   4. WrappedDemo.setMinter(Verifier)  — one-time, called by deployer (owner)
 */

import { ethers, artifacts } from "hardhat";
import * as fs   from "fs";
import * as path from "path";

const SHARED_DIR       = path.resolve(__dirname, "../shared");
const DEPLOYMENTS_FILE = path.join(SHARED_DIR, "deployments.json");
const ABIS_DIR         = path.join(SHARED_DIR, "abis");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying N2 contracts to Polygon Amoy with:", deployer.address);

  // ── Read Router address from N1 deployment ───────────────────────────────
  if (!fs.existsSync(DEPLOYMENTS_FILE)) {
    throw new Error("shared/deployments.json not found — run deploy-n1.ts first");
  }
  const deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8")) as Record<string, any>;
  const n1 = deployments["n1"];
  if (!n1?.router) throw new Error("deployments.json missing n1.router — run deploy-n1.ts first");

  const sourceRouter  = n1.router  as string;
  const sourceChainId = BigInt(n1.chainId ?? 11155111);
  console.log("Source Router :", sourceRouter, `(chainId ${sourceChainId})`);

  // ── 1. MockHeaderVerifier ─────────────────────────────────────────────────
  const MockHV = await ethers.getContractFactory("MockHeaderVerifier");
  const headerVerifier = await MockHV.deploy();
  await headerVerifier.waitForDeployment();
  const headerVerifierAddress = await headerVerifier.getAddress();
  console.log("MockHeaderVerifier deployed at:", headerVerifierAddress);

  // ── 2. WrappedDemo ─────────────────────────────────────────────────────────
  const WrappedDemoFactory = await ethers.getContractFactory("WrappedDemo");
  const wrappedDemo = await WrappedDemoFactory.deploy(deployer.address);
  await wrappedDemo.waitForDeployment();
  const wrappedDemoAddress = await wrappedDemo.getAddress();
  console.log("WrappedDemo (wDETH) deployed at:", wrappedDemoAddress);

  // ── 3. Verifier ────────────────────────────────────────────────────────────
  const VerifierFactory = await ethers.getContractFactory("Verifier");
  const verifier = await VerifierFactory.deploy(
    wrappedDemoAddress,
    headerVerifierAddress,
    sourceChainId,
    sourceRouter
  );
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log("Verifier deployed at:", verifierAddress);

  // ── 4. Set Verifier as the one-time minter on WrappedDemo ──────────────────
  const tx = await wrappedDemo.setMinter(verifierAddress);
  await tx.wait();
  console.log("WrappedDemo minter set to Verifier");

  // ── Ensure shared directories exist ────────────────────────────────────────
  fs.mkdirSync(ABIS_DIR, { recursive: true });

  // ── Export ABIs ────────────────────────────────────────────────────────────
  for (const name of ["WrappedDemo", "MockHeaderVerifier", "Verifier"]) {
    const artifact = await artifacts.readArtifact(name);
    fs.writeFileSync(
      path.join(ABIS_DIR, `${name}.json`),
      JSON.stringify(artifact.abi, null, 2)
    );
    console.log(`ABI written to shared/abis/${name}.json`);
  }

  // ── Write / merge deployments.json ─────────────────────────────────────────
  deployments["n2"] = {
    network:        "amoy",
    chainId:        80002,
    headerVerifier: headerVerifierAddress,
    wrappedDemo:    wrappedDemoAddress,
    verifier:       verifierAddress,
    sourceChainId:  sourceChainId.toString(),
    sourceRouter,
    deployedAt:     new Date().toISOString(),
    deployer:       deployer.address,
  };

  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
  console.log("Addresses written to shared/deployments.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
