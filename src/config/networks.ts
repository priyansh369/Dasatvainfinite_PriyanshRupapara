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

/** Comprehensive EVM chain lookup map for MetaMask network synchronization */
export const KNOWN_CHAINS: Record<number, { name: string; symbol: string; icon: string; color: string; isPolygon?: boolean; isEthereum?: boolean }> = {
  1: { name: "Ethereum Mainnet", symbol: "ETH", icon: "🔷", color: "#627eea", isEthereum: true },
  11155111: { name: "Ethereum Sepolia", symbol: "ETH", icon: "🔷", color: "#d9633e", isEthereum: true },
  17000: { name: "Ethereum Holesky", symbol: "ETH", icon: "🔷", color: "#627eea", isEthereum: true },
  137: { name: "Polygon Mainnet", symbol: "POL", icon: "🟣", color: "#8247e5", isPolygon: true },
  80002: { name: "Polygon Amoy", symbol: "POL", icon: "🟣", color: "#af789b", isPolygon: true },
  80001: { name: "Polygon Mumbai", symbol: "MATIC", icon: "🟣", color: "#8247e5", isPolygon: true },
  1101: { name: "Polygon zkEVM", symbol: "ETH", icon: "🟣", color: "#8247e5", isPolygon: true },
  42161: { name: "Arbitrum One", symbol: "ETH", icon: "🔵", color: "#28a0f0" },
  10: { name: "Optimism", symbol: "ETH", icon: "🔴", color: "#ff0420" },
  8453: { name: "Base", symbol: "ETH", icon: "🔵", color: "#0052ff" },
  56: { name: "BNB Smart Chain", symbol: "BNB", icon: "🟡", color: "#f0b90b" },
  43114: { name: "Avalanche C-Chain", symbol: "AVAX", icon: "🔺", color: "#e84142" },
  31337: { name: "Hardhat Localhost", symbol: "ETH", icon: "🖥️", color: "#af789b" },
};

export function getChainInfo(chainId: number | null): { name: string; symbol: string; icon: string; color: string; isPolygon: boolean; isEthereum: boolean } {
  if (!chainId) return { name: "Not Connected", symbol: "ETH", icon: "⚡", color: "#999", isPolygon: false, isEthereum: false };
  const known = KNOWN_CHAINS[chainId];
  if (known) return { ...known, isPolygon: !!known.isPolygon, isEthereum: !!known.isEthereum };
  return { name: `Chain #${chainId}`, symbol: "ETH", icon: "⛓️", color: "#af789b", isPolygon: false, isEthereum: false };
}
