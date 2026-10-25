/**
 * deploy-n1.ts — Deploy Router to Sepolia (N1).
 * Usage: npx hardhat run scripts/deploy-n1.ts --network sepolia
 *
 * Reads:  SEPOLIA_RPC, PRIVATE_KEY  from .env
 * Writes: deployments.json  (creates or merges)
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_FILE = path.resolve(__dirname, "../deployments.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Router to N1 (Sepolia) with:", deployer.address);

  const Router = await ethers.getContractFactory("Router");
  const router = await Router.deploy();
  await router.waitForDeployment();

  const routerAddress = await router.getAddress();
  console.log("Router deployed at:", routerAddress);

  // ── Write / merge deployments.json ───────────────────────────────────────
  let deployments: Record<string, unknown> = {};
  if (fs.existsSync(DEPLOYMENTS_FILE)) {
    deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
  }

  deployments["n1"] = {
    network: "sepolia",
    chainId: 11155111,
    router: routerAddress,
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
