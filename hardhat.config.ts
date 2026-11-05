import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "0x" + "0".repeat(64);
const SEPOLIA_RPC  = process.env.SEPOLIA_RPC  ?? "https://ethereum-sepolia-rpc.publicnode.com";
const AMOY_RPC     = process.env.AMOY_RPC     ?? "https://polygon-amoy-bor-rpc.publicnode.com";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    sepolia: {
      url: SEPOLIA_RPC,
      accounts: [PRIVATE_KEY],
      chainId: 11155111,
    },
    amoy: {
      url: AMOY_RPC,
      accounts: [PRIVATE_KEY],
      chainId: 80002,
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    outputFile: "gas-report.txt",
    noColors: true,
  },
};

export default config;
