# ⚡ CryptoXchange: Decentralized Cross-Chain Transaction Verification

> **User-mediated, relayer-free cross-chain transaction verification.** No coordinator chains (Axelar / LayerZero / CCIP), zero backend, no protocol changes.

---

## 📖 Overview

CryptoXchange demonstrates a decentralized, client-mediated cross-chain bridge between **Ethereum Sepolia (N1)** and **Polygon Amoy (N2)**:

1. **Phase 1 (Sepolia)**: The user locks native ETH into `Router.sol`. The request data `keccak256(abi.encode(id, sender, recipient, value, deadline))` is appended as a leaf to an OpenZeppelin incremental Merkle tree (depth 8) on-chain.
2. **Phase 2 (Client)**: The client listens for block confirmations, fetches all on-chain `RequestCreated` events from the Router, reconstructs the identical depth-8 Merkle tree off-chain, verifies that the computed root matches `Router.root()`, and extracts the 8-sibling inclusion proof.
3. **Phase 3 (Polygon Amoy)**: The user switches their wallet network to Polygon Amoy and submits the Merkle proof + header directly to `Verifier.sol` / `RealCrossChainBridge.sol`. The contract verifies the proof against the verified state root and disburses native assets directly to the recipient.
4. **Reclaim**: If the request deadline expires without execution on N2, the sender can reclaim their locked ETH on Sepolia via `Router.reclaim(id)`.

---

## ⚡ Latency Benchmark vs. Coordinator Chains

| Approach | Typical Latency | Trust Assumptions |
|---|---|---|
| **CryptoXchange (User-Mediated)** | **~9.75 seconds** (Local) / N confirmations (Live) | Direct on-chain verification, self-relayed |
| **Coordinator Chains (LayerZero, Axelar, CCIP)** | **119.7 seconds** (Standard baseline) | Quorum polling, relayer networks, intermediate chain finality |

---

## 🛠️ Project Structure

```text
CryptoXchange/
├── contracts/
│   ├── RealCrossChainBridge.sol  # Production bidirectional real bridge & smart contract executor
│   ├── MockERC20.sol             # ERC-20 token for cross-chain transfer testing
│   ├── SampleTargetReceiver.sol  # Destination contract for arbitrary cross-chain calls
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
│       └── crossChain.ts         # Ethers v6 SDK: submitRequest, rebuildTree, buildProof, submitRealBridgeRequest, executeRealBridgeTransaction
├── scripts/
│   ├── deploy-real-bridge.ts     # Deploy RealCrossChainBridge to Sepolia / Amoy / Localhost
│   ├── deploy-n1.ts              # Deploy Router to Sepolia / Localhost
│   ├── deploy-n2.ts              # Deploy HeaderVerifier + WrappedDemo + Verifier to Amoy / Localhost
│   └── test-flow.ts              # Full 7-phase integration test (spawns 2 nodes or runs live)
├── test/
│   ├── RealCrossChainBridge.test.ts # Comprehensive tests for real payouts, ERC20, contract calls, & edge cases
│   ├── Router.test.ts            # Unit tests for Router (locking, id increments, reclaim logic)
│   └── Verifier.test.ts          # Unit tests for Verifier (valid proofs, tampering, wrong root, replays, deadlines)
├── hardhat.config.ts             # Hardhat config with Cancun EVM & viaIR support
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
# All 33 tests passing (RealCrossChainBridge + Router + Verifier)
```

### 3. Deploy Real Cross-Chain Bridge
```bash
# Deploy to Sepolia (N1)
npm run deploy:real:n1

# Deploy to Polygon Amoy (N2)
npm run deploy:real:n2
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

## 📜 Live Verified Contracts (Testnets)

| Network | Role | Contract Address | Explorer |
|---|---|---|---|
| **Ethereum Sepolia** | Real Bridge & Liquidity Vault | `0xB59e7218d0FeF27dB36AE54Ef552174958d6355B` | [Sepolia Etherscan](https://sepolia.etherscan.io/address/0xB59e7218d0FeF27dB36AE54Ef552174958d6355B) |
| **Polygon Amoy** | Settlement Bridge & Verifier | `0x17B6d8FC628BAa2646b10Bce715b3f636374AB51` | [Polygonscan Amoy](https://amoy.polygonscan.com/address/0x17B6d8FC628BAa2646b10Bce715b3f636374AB51) |
| **Polygon Amoy** | Header Verifier | `0x7179069d27038eA90F845a7b8eC3E8A1D34A7d34` | [Polygonscan Amoy](https://amoy.polygonscan.com/address/0x7179069d27038eA90F845a7b8eC3E8A1D34A7d34) |
| **Polygon Amoy** | Wrapped Demo Token | `0x6f6916eCd52a9058E5531d044F8177488B8718f4` | [Polygonscan Amoy](https://amoy.polygonscan.com/address/0x6f6916eCd52a9058E5531d044F8177488B8718f4) |

---

## 🛡️ Security & Protocol Architecture
1. **Zero-Relayer Trust Model**: Pure client-side Merkle proof verification directly against the authenticated state root.
2. **Incremental Merkle Tree**: Depth 8 tree supporting on-chain cryptographic commitment tracking.
3. **Anti-Double-Spend Timelock**: Contract enforces an emergency non-custodial reclaim timelock (`req.deadline + reclaimGrace`) before unlocked refunds can be claimed.
4. **Non-Custodial Direct Settlement**: Guaranteed payout execution directly from on-chain liquidity vaults without intermediary mint/burn peg risks.

---

## 📄 License
ISC
