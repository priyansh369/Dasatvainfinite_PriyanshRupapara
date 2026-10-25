/**
 * deploy-n2.ts — Deploy MockHeaderVerifier, WrappedDemo, and Verifier to Polygon Amoy (N2).
 * Usage: npx hardhat run scripts/deploy-n2.ts --network amoy
 *
 * Reads:  AMOY_RPC, PRIVATE_KEY  from .env
 * Writes: deployments.json  (creates or merges)
 *
 * Deployment order:
 *   1. MockHeaderVerifier (no deps)
 *   2. WrappedDemo        (no deps — deployer as initial owner)
 *   3. Verifier           (depends on #1 and #2)
 *   4. Transfer WrappedDemo ownership to Verifier so it can mint.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_FILE = path.resolve(__dirname, "../deployments.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying N2 contracts to Polygon Amoy with:", deployer.address);

  // 1. MockHeaderVerifier
  const MockHeaderVerifier = await ethers.getContractFactory("MockHeaderVerifier");
  const headerVerifier = await MockHeaderVerifier.deploy();
  await headerVerifier.waitForDeployment();
  const headerVerifierAddress = await headerVerifier.getAddress();
  console.log("MockHeaderVerifier deployed at:", headerVerifierAddress);

  // 2. WrappedDemo (deployer is temporary owner; transferred to Verifier below)
  const WrappedDemo = await ethers.getContractFactory("WrappedDemo");
  const wrappedDemo = await WrappedDemo.deploy(deployer.address);
  await wrappedDemo.waitForDeployment();
  const wrappedDemoAddress = await wrappedDemo.getAddress();
  console.log("WrappedDemo deployed at:", wrappedDemoAddress);

  // 3. Verifier
  const Verifier = await ethers.getContractFactory("Verifier");
  const verifier = await Verifier.deploy(headerVerifierAddress, wrappedDemoAddress);
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log("Verifier deployed at:", verifierAddress);

  // 4. Transfer WrappedDemo ownership to Verifier
  const tx = await wrappedDemo.transferOwnership(verifierAddress);
  await tx.wait();
  console.log("WrappedDemo ownership transferred to Verifier");

  // ── Write / merge deployments.json ───────────────────────────────────────
  let deployments: Record<string, unknown> = {};
  if (fs.existsSync(DEPLOYMENTS_FILE)) {
    deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
  }

  deployments["n2"] = {
    network: "amoy",
    chainId: 80002,
    headerVerifier: headerVerifierAddress,
    wrappedDemo: wrappedDemoAddress,
    verifier: verifierAddress,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
  console.log("Addresses written to deployments.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
