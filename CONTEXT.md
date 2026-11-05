# Decentralized Cross-Chain Transaction Verification — Project Context

## Hackathon Scope

User-mediated, no relayer, no coordinator chain, no backend, no protocol changes.
The user's wallet carries the Merkle proof from Sepolia (N1) to Polygon Amoy (N2).

## Plan (5 steps)

1. **Router (N1/Sepolia)** — lock ETH, push leaf into OZ incremental MerkleTree, expose root.
2. **Verifier (N2/Amoy)** — accept header + proof + request, verify inclusion, mint wDETH.
3. **WrappedDemo** — ERC20 "Wrapped Demo ETH" (wDETH), minter set once by owner.
4. **MockHeaderVerifier** — stub; full ZK/light-client header relay is a roadmap item.
5. **Tests + deploy scripts** — cover valid flow, tampered data, replay, expiry, reclaim edge-cases.

## Architecture

### Phase 1 — Sepolia (N1)

- User calls `Router.initiateRequest(address recipient) payable`
- `id = nextId++`, `deadline = block.timestamp + requestTtl`
- `leaf = keccak256(abi.encode(block.chainid, address(this), id, sender, recipient, msg.value, deadline))`
- Leaf pushed into OZ `Bytes32PushTree` (depth 8, commutativeKeccak256); returned index asserted == id
- Emits `RequestCreated(id, sender, recipient, amount, deadline, leaf, newRoot, index)`
- `root()` returns current tree root; `nextId()` is public
- `reclaim(id)` — only sender, only once, only after `deadline + reclaimGrace`; uses ReentrancyGuard

### Phase 2 — Polygon Amoy (N2)

- Client builds proof off-chain (same commutativeKeccak256 tree, depth 8)
- User calls `Verifier.verifyAndExecute(header, proof, req)`
- Checks: `!processed[req.id]`, `block.timestamp <= req.deadline`, `headerVerifier.verifyHeader(header)`
- Recomputes leaf using `sourceChainId` and `sourceRouter`, verifies via `MerkleProof.verify`
- Marks processed, mints `req.amount` of wDETH to `req.recipient`
- Emits `Verified(id, recipient, amount, sourceBlock)`

## Stack

- Hardhat + TypeScript
- Solidity 0.8.24
- OpenZeppelin Contracts ^5.1 (uses `utils/structs/MerkleTree.sol`)
- ethers v6
- hardhat-gas-reporter

## Files

### Contracts
- `contracts/Router.sol` — N1 (Sepolia)
- `contracts/Verifier.sol` — N2 (Polygon Amoy)
- `contracts/WrappedDemo.sol` — ERC20 minted by Verifier
- `contracts/MockHeaderVerifier.sol` — stub; returns true always
- `contracts/interfaces/IHeaderVerifier.sol`

### Tests
- `test/Router.test.ts`
- `test/Verifier.test.ts`

### Scripts
- `scripts/deploy-n1.ts` — deploy Router (TTL 1h, grace 10m), write `shared/deployments.json`
- `scripts/deploy-n2.ts` — deploy WrappedDemo + MockHeaderVerifier + Verifier, setMinter, write `shared/deployments.json` + ABIs

## Known Limitations (flagged inline in contracts)

1. `MockHeaderVerifier` accepts any header — needs light client / ZK proof in production
2. `block.timestamp` can be manipulated by validators by ~12 s
3. Merkle tree depth fixed at 8 → max 256 leaves per deployment (rolling tree is roadmap)
4. No ETH redemption on Amoy; wDETH minted 1:1 with msg.value for demo only
5. No on-chain guarantee N2 execution and N1 reclaim cannot both succeed; deadline window is the guard
