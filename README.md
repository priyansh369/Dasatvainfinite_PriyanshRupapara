# ⚡ Vecnaverse: Decentralized Cross-Chain Transaction Verification

> **User-mediated, relayer-free cross-chain transaction verification.** No coordinator chains (Axelar / LayerZero / CCIP), zero backend, no protocol changes.

---

## 📖 Overview

Vecnaverse demonstrates a decentralized, client-mediated cross-chain bridge between **Ethereum Sepolia (N1)** and **Polygon Amoy (N2)**:

1. **Phase 1 (Sepolia)**: The user locks native ETH into `Router.sol`. The request data `keccak256(abi.encode(id, sender, recipient, value, deadline))` is appended as a leaf to an OpenZeppelin incremental Merkle tree (depth 8) on-chain.
2. **Phase 2 (Client)**: The client listens for block confirmations, fetches all on-chain `RequestCreated` events from the Router, reconstructs the identical depth-8 Merkle tree off-chain, verifies that the computed root matches `Router.root()`, and extracts the 8-sibling inclusion proof.
3. **Phase 3 (Polygon Amoy)**: The user switches their wallet network to Polygon Amoy and submits the Merkle proof + header directly to `Verifier.sol`. The contract verifies the proof against the root and mints `WrappedDemo` (wDEMO) tokens 1:1 to the recipient.
4. **Reclaim**: If the request deadline expires without execution on N2, the sender can reclaim their locked ETH on Sepolia via `Router.reclaim(id)`.

---

## ⚡ Latency Benchmark vs. Coordinator Chains

| Approach | Typical Latency | Trust Assumptions |
|---|---|---|
| **Vecnaverse (User-Mediated)** | **~9.75 seconds** (Local) / N confirmations (Live) | Direct on-chain verification, self-relayed |
| **Coordinator Chains (LayerZero, Axelar, CCIP)** | **119.7 seconds** (Standard baseline) | Quorum polling, relayer networks, intermediate chain finality |

---

## 🛠️ Project Structure

```text
Vecnaverse/
├── contracts/
│   ├── Router.sol                # Locks ETH on N1 (Sepolia), pushes to incremental Merkle tree
│   ├── Verifier.sol              # Verifies Merkle proof on N2 (Amoy), mints wDEMO
│   ├── WrappedDemo.sol           # ERC20 token minted to recipient upon verification
│   ├── MockHeaderVerifier.sol    # Header verifier stub
│   └── interfaces/
│       └── IHeaderVerifier.sol   # BlockHeader interface
├── src/
│   ├── App.tsx                   # Single-page React application (2-phase stepper, live stopwatch, proof explorer)
│   ├── index.css                 # Dark theme with crimson accents design system
│   ├── config/
│   │   └── networks.ts           # Sepolia, Polygon Amoy, and Local RPC/Chain definitions
│   └── lib/
│       └── crossChain.ts         # Ethers v6 SDK: submitRequest, waitForConfirmations, rebuildTree, buildProof, submitToVerifier, reclaimRequest
├── scripts/
│   ├── deploy-n1.ts              # Deploy Router to Sepolia / Localhost
│   ├── deploy-n2.ts              # Deploy HeaderVerifier + WrappedDemo + Verifier to Amoy / Localhost
│   └── test-flow.ts              # Full 7-phase integration test (spawns 2 nodes or runs live)
├── test/
│   ├── Router.test.ts            # Unit tests for Router (locking, id increments, reclaim logic)
│   └── Verifier.test.ts          # Unit tests for Verifier (valid proofs, tampering, wrong root, replays, deadlines)
├── hardhat.config.ts             # Hardhat config with Cancun EVM support (mcopy opcode)
└── vite.config.ts                # Vite bundler config with React plugin
```

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Smart Contract Unit Tests
```bash
npx hardhat test
# All 16 tests passing (Router + Verifier)
```

### 3. Run End-to-End Integration Flow (Dual Local Nodes)
```bash
npm run flow:local
# Spawns two independent Hardhat nodes on ports 8545 & 8546, deploys all contracts,
# locks ETH, awaits confirmations, builds Merkle proof, submits to Verifier, and validates wDEMO balance.
```

### 4. Run the Web Application
```bash
npm run dev
# Starts Vite dev server at http://localhost:5173/
```

### 5. Build for Production
```bash
npm run build
```

---

## 🌐 Deploying to Testnets

Copy `.env.example` to `.env` and fill in your keys:
```bash
SEPOLIA_RPC="https://ethereum-sepolia-rpc.publicnode.com"
AMOY_RPC="https://rpc-amoy.polygon.technology"
PRIVATE_KEY="your_private_key"
```

Deploy:
```bash
# Deploy to Sepolia (N1)
npm run deploy:n1

# Deploy to Polygon Amoy (N2)
npm run deploy:n2

# Run full cross-chain testnet flow
npm run flow:testnet
```

---

## ⚠️ Known Limitations (Flagged Inline)
1. **MockHeaderVerifier** accepts any header in this hackathon demo; production requires a light-client or ZK-header proof.
2. **MerkleTree depth is 8**, supporting up to 256 requests per tree.
3. **Deadline window**: Uses `block.timestamp` with a 1-hour buffer before `reclaim` is permitted to prevent dual-spend.
4. **wDEMO Token**: Minted 1:1 against locked wei for demonstration purposes.

---

## 📄 License
ISC
