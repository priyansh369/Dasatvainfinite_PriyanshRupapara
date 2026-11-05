/**
 * scripts/deploy-real-bridge.ts
 *
 * Deploys the RealCrossChainBridge and HeaderVerifier to Sepolia, Polygon Amoy, or Localhost.
 * Configures bidirectional trusted remotes and saves deployment addresses.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-real-bridge.ts --network sepolia
 *   npx hardhat run scripts/deploy-real-bridge.ts --network amoy
 *   npx hardhat run scripts/deploy-real-bridge.ts --network localhost
 */

import { ethers, artifacts, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_FILE = path.resolve(__dirname, "../deployments.json");
const ABIS_DIR = path.resolve(__dirname, "../shared/abis");

const REQUEST_TTL = 3600;  // 1 hour
const RECLAIM_GRACE = 600; // 10 minutes

async function main() {
  const [deployer] = await ethers.getSigners();
  const currentNetwork = network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log(`\n======================================================`);
  console.log(`Deploying RealCrossChainBridge to: ${currentNetwork} (chainId: ${chainId})`);
  console.log(`Deployer address: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH/POL`);
  console.log(`======================================================\n`);

  // 1. Deploy MockHeaderVerifier (in production, replaced by light client or ZK verifier)
  console.log("1. Deploying HeaderVerifier...");
  const MockHV = await ethers.getContractFactory("MockHeaderVerifier");
  const headerVerifier = await MockHV.deploy();
  await headerVerifier.waitForDeployment();
  const headerVerifierAddress = await headerVerifier.getAddress();
  console.log(`   HeaderVerifier deployed at: ${headerVerifierAddress}`);

  // 2. Deploy RealCrossChainBridge
  console.log("2. Deploying RealCrossChainBridge...");
  const BridgeFactory = await ethers.getContractFactory("RealCrossChainBridge");
  const bridge = await BridgeFactory.deploy(REQUEST_TTL, RECLAIM_GRACE, headerVerifierAddress);
  await bridge.waitForDeployment();
  const bridgeAddress = await bridge.getAddress();
  console.log(`   RealCrossChainBridge deployed at: ${bridgeAddress}`);

  // 3. Export ABIs
  fs.mkdirSync(ABIS_DIR, { recursive: true });
  const bridgeArtifact = await artifacts.readArtifact("RealCrossChainBridge");
  fs.writeFileSync(
    path.join(ABIS_DIR, "RealCrossChainBridge.json"),
    JSON.stringify(bridgeArtifact.abi, null, 2)
  );
  console.log(`   ABI exported to shared/abis/RealCrossChainBridge.json`);

  // 4. Update deployments.json
  let deployments: Record<string, any> = {};
  if (fs.existsSync(DEPLOYMENTS_FILE)) {
    try {
      deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
    } catch {
      deployments = {};
    }
  }

  const key = currentNetwork === "sepolia" ? "realBridgeN1" : currentNetwork === "amoy" ? "realBridgeN2" : `realBridge_${currentNetwork}`;

  deployments[key] = {
    network: currentNetwork,
    chainId: Number(chainId),
    bridge: bridgeAddress,
    headerVerifier: headerVerifierAddress,
    requestTtl: REQUEST_TTL,
    reclaimGrace: RECLAIM_GRACE,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
  console.log(`   Saved deployment info to deployments.json`);

  // 5. Automatic Peer Linking if counterpart is already in deployments.json
  const peerKey = currentNetwork === "sepolia" ? "realBridgeN2" : currentNetwork === "amoy" ? "realBridgeN1" : null;
  if (peerKey && deployments[peerKey]?.bridge && deployments[peerKey]?.chainId) {
    const peerChainId = BigInt(deployments[peerKey].chainId);
    const peerBridgeAddress = deployments[peerKey].bridge;
    console.log(`\nFound peer deployment (${peerKey}): ${peerBridgeAddress} on chain ${peerChainId}`);
    console.log(`Setting trusted remote on this network...`);
    const linkTx = await bridge.setTrustedRemote(peerChainId, peerBridgeAddress);
    await linkTx.wait();
    console.log(`✓ Trusted remote registered successfully!`);
  } else {
    console.log(`\nNote: Once the counterpart chain is deployed, run bridge.setTrustedRemote(destChainId, destBridge)`);
  }

  console.log(`\n✓ Deployment complete for ${currentNetwork}!`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

