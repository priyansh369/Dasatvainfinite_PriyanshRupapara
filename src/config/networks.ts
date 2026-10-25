/**
 * Network and Chain configuration for Sepolia, Polygon Amoy, and Local Hardhat.
 */

export interface NetworkConfig {
  chainIdHex: string;
  chainIdDec: number;
  name: string;
  shortName: string;
  symbol: string;
  rpcUrls: string[];
  blockExplorerUrl: string;
  color: string;
  icon: string;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  sepolia: {
    chainIdHex: "0xaa36a7",
    chainIdDec: 11155111,
    name: "Ethereum Sepolia",
    shortName: "Sepolia (N1)",
    symbol: "ETH",
    rpcUrls: [
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://rpc.sepolia.org",
      "https://1rpc.io/sepolia",
    ],
    blockExplorerUrl: "https://sepolia.etherscan.io",
    color: "#d9633e", // Terracotta
    icon: "🔷",
  },
  amoy: {
    chainIdHex: "0x13882",
    chainIdDec: 80002,
    name: "Polygon Amoy Testnet",
    shortName: "Polygon Amoy (N2)",
    symbol: "POL",
    rpcUrls: [
      "https://rpc-amoy.polygon.technology",
      "https://polygon-amoy-bor-rpc.publicnode.com",
    ],
    blockExplorerUrl: "https://amoy.polygonscan.com",
    color: "#af789b", // Dusty Mauve
    icon: "🟣",
  },
  localN1: {
    chainIdHex: "0x7a69", // 31337
    chainIdDec: 31337,
    name: "Hardhat Local N1",
    shortName: "Local N1 (Port 8545)",
    symbol: "ETH",
    rpcUrls: ["http://127.0.0.1:8545"],
    blockExplorerUrl: "",
    color: "#d9633e", // Terracotta
    icon: "🖥️",
  },
  localN2: {
    chainIdHex: "0x7a69", // 31337
    chainIdDec: 31337,
    name: "Hardhat Local N2",
    shortName: "Local N2 (Port 8546)",
    symbol: "ETH",
    rpcUrls: ["http://127.0.0.1:8546"],
    blockExplorerUrl: "",
    color: "#af789b", // Dusty Mauve
    icon: "🖥️",
  },
};

/** Default contract addresses */
export const DEFAULT_CONTRACTS = {
  sepolia: {
    router: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  },
  amoy: {
    verifier: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    wrappedDemo: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    mockHeaderVerifier: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  },
};

export const COORDINATOR_CHAIN_BASELINE_SECONDS = 119.7;
