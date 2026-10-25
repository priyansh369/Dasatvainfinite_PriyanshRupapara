# Decentralized Cross-Chain Transaction Verification — Project Context

## Hackathon Scope (3 hours total)

User-mediated, no relayer, no coordinator chain, no backend, no protocol changes.

## Architecture

### Phase 1 — Sepolia (Network 1 / N1)
- User calls `Router.initiateRequest(address recipient) payable`
- Leaf = `keccak256(abi.encode(id, msg.sender, recipient, msg.value, deadline))`
- Appended to an **OpenZeppelin incremental MerkleTree** (fixed depth 8)
- Emits `RequestCreated(id, leaf, sender, recipient, value, deadline)`
- `root()` exposes the current Merkle root
- `reclaim(id)` refunds sender only after `deadline + 1 hour`

### Phase 2 — Polygon Amoy (Network 2 / N2)
- Client builds Merkle proof off-chain
- User switches wallet, calls `Verifier.verifyAndExecute(header, proof, requestData)`
- Checks header via `IHeaderVerifier`
- Verifies `MerkleProof.verify(proof, root, leaf)`
- Rejects replays (mapping) and expired deadlines (`block.timestamp > deadline`)
- Mints `WrappedDemo` (ERC20) to recipient
- Emits `Verified(id)`

## Stack
- Hardhat
- Solidity ^0.8.24
- OpenZeppelin Contracts >= 5.1
- ethers v6
- Vite + React + TypeScript (frontend — Phase 2, not started yet)

## Files to Build

### Contracts
- `contracts/Router.sol` — N1
- `contracts/Verifier.sol` — N2
- `contracts/WrappedDemo.sol` — ERC20 minted by Verifier
- `contracts/MockHeaderVerifier.sol` — stub, accepts any header
- `contracts/interfaces/IHeaderVerifier.sol`

### Tests
- `test/Router.test.ts` — valid flow, reclaim, early reclaim
- `test/Verifier.test.ts` — valid proof, tampered proof, wrong root, replay, expired deadline

### Scripts
- `scripts/deploy-n1.ts` — deploy Router, print to `deployments.json`
- `scripts/deploy-n2.ts` — deploy MockHeaderVerifier, WrappedDemo, Verifier, print to `deployments.json`

## Known Limitations (flagged inline)
1. `MockHeaderVerifier` accepts any header — needs a light client / zk proof in production
2. Deadline logic is simplistic — uses `block.timestamp` which miners can manipulate slightly
3. Merkle tree depth is fixed at 8 → max 256 leaves per deployment
4. No ETH refund on Amoy; wrapped token is minted 1:1 with msg.value for demo purposes
5. Cross-chain root authenticity is NOT verified; user is trusted to supply correct root
