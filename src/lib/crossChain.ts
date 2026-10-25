/**
 * src/lib/crossChain.ts
 *
 * Ethers v6 library for the Decentralized Cross-Chain Transaction Verification demo.
 *
 * Exported API:
 *   submitRequest        – lock ETH on N1 (Sepolia / Router)
 *   waitForConfirmations – poll until N confirmations with progress callback
 *   rebuildTree          – reconstruct the depth-8 Merkle tree from on-chain logs; asserts root
 *   buildProof           – derive an inclusion proof for a given request id
 *   submitToVerifier     – submit header + proof to N2 Verifier (mints wDEMO)
 *
 * KNOWN LIMITATION: rebuildTree() fetches logs from block 0 every call. For
 * large deployments, paginate and cache (e.g. IndexedDB in the browser, SQLite
 * in Node).
 */

import { ethers } from "ethers";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Must match the depth passed to MerkleTree.setup() in Router.sol. */
export const TREE_DEPTH = 8;
/** Maximum number of leaves (2 ** TREE_DEPTH). */
export const TREE_SIZE = 1 << TREE_DEPTH; // 256

// ─────────────────────────────────────────────────────────────────────────────
// Minimal ABIs — browser-safe, no Hardhat artifact imports required
// ─────────────────────────────────────────────────────────────────────────────

export const ROUTER_ABI = [
  "function initiateRequest(address recipient) payable returns (uint256)",
  "function root() view returns (bytes32)",
  "function nextId() view returns (uint256)",
  "function requests(uint256) view returns (address sender, address recipient, uint256 value, uint256 deadline, bool reclaimed)",
  "function leaves(uint256) view returns (bytes32)",
  "function reclaim(uint256 id)",
  "event RequestCreated(uint256 indexed id, bytes32 leaf, address indexed sender, address indexed recipient, uint256 value, uint256 deadline)",
] as const;

export const VERIFIER_ABI = [
  "function verifyAndExecute(tuple(uint256 sourceBlock, bytes32 root) header, bytes32[] proof, tuple(uint256 id, address sender, address recipient, uint256 value, uint256 deadline) request)",
  "function executed(uint256) view returns (bool)",
] as const;

export const WRAPPED_DEMO_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Mirror of IHeaderVerifier.BlockHeader. */
export interface BlockHeader {
  sourceBlock: bigint;
  /** bytes32 hex string — the Merkle root captured from Router at proof time. */
  root: string;
}

/** Mirror of Verifier.RequestData (must match Router's leaf encoding exactly). */
export interface RequestData {
  id: bigint;
  sender: string;
  recipient: string;
  value: bigint;
  deadline: bigint;
}

/**
 * Configuration object passed to every cross-chain function.
 * Addresses come from deployments.json; providers/signers from the caller.
 */
export interface CrossChainConfig {
  // ── N1 (Sepolia / Router) ──────────────────────────────────────────────
  routerAddress: string;
  n1Provider: ethers.Provider;
  n1Signer: ethers.Signer;
  // ── N2 (Polygon Amoy / Verifier) ──────────────────────────────────────
  verifierAddress: string;
  n2Provider: ethers.Provider;
  n2Signer: ethers.Signer;
}

export interface SubmitResult {
  txHash: string;
  blockNumber: number;
  id: bigint;
  leaf: string;
  deadline: bigint;
}

/**
 * Full in-memory Merkle tree snapshot.
 * `levels[0]` = leaf layer (size 256, padded with ZeroHash).
 * `levels[TREE_DEPTH]` = [root].
 */
export interface TreeState {
  root: string;
  /** Padded leaf array; index === request id. */
  leaves: string[];
  /** Parsed request data keyed by id. */
  requests: Map<bigint, RequestData>;
  levels: string[][];
}

export interface ProofResult {
  proof: string[];
  header: BlockHeader;
  request: RequestData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Merkle helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors OpenZeppelin's `Hashes.commutativeKeccak256`:
 * sorts the two 32-byte values as unsigned big-endian integers, then hashes.
 *
 * This is the hash function used by both MerkleTree.sol (tree construction)
 * and MerkleProof.sol (verification), so proofs built here are accepted by
 * the on-chain Verifier.
 */
function commutativeKeccak256(a: string, b: string): string {
  const ab = ethers.getBytes(a);
  const bb = ethers.getBytes(b);
  let lo = a, hi = b;
  for (let i = 0; i < 32; i++) {
    if (ab[i] < bb[i]) { lo = a; hi = b; break; }
    if (ab[i] > bb[i]) { lo = b; hi = a; break; }
    // equal byte → continue loop
  }
  return ethers.keccak256(ethers.concat([lo, hi]));
}

/**
 * Pre-compute the zero hash for each tree level.
 *
 * zeros[0] = bytes32(0)   (the empty-leaf sentinel used in MerkleTree.setup())
 * zeros[i] = commutativeKeccak256(zeros[i-1], zeros[i-1])
 *
 * These are the sibling values for unpopulated slots at each depth.
 */
export function computeZeroHashes(depth: number = TREE_DEPTH): string[] {
  const zeros: string[] = new Array(depth + 1);
  zeros[0] = ethers.ZeroHash;
  for (let i = 1; i <= depth; i++) {
    zeros[i] = commutativeKeccak256(zeros[i - 1], zeros[i - 1]);
  }
  return zeros;
}

/**
 * Build the full in-memory Merkle tree from an ordered list of pushed leaves.
 *
 * Slots beyond `pushedLeaves.length` are filled with `zeros[0]` (bytes32(0)),
 * exactly mirroring what OZ's incremental tree does.
 *
 * @returns Array of levels; `levels[0]` = leaf layer, `levels[depth]` = [root].
 */
function buildFullTree(pushedLeaves: string[], depth: number = TREE_DEPTH): string[][] {
  const size  = 1 << depth;
  const zeros = computeZeroHashes(depth);
  const levels: string[][] = [];

  // ── Level 0: leaf layer ──────────────────────────────────────────────────
  const leafLayer: string[] = [];
  for (let i = 0; i < size; i++) {
    leafLayer.push(i < pushedLeaves.length ? pushedLeaves[i] : zeros[0]);
  }
  levels.push(leafLayer);

  // ── Levels 1…depth ──────────────────────────────────────────────────────
  for (let lvl = 1; lvl <= depth; lvl++) {
    const prev    = levels[lvl - 1];
    const current: string[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      current.push(commutativeKeccak256(prev[i], prev[i + 1]));
    }
    levels.push(current);
  }

  return levels;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 1 — Lock ETH in the Router and register a cross-chain request.
 *
 * @param recipient  Destination address on N2 that will receive wDEMO.
 * @param valueEth   Amount to lock (as a decimal ETH string, e.g. "0.01").
 * @returns          Tx hash, block number, request id, leaf hash, and deadline.
 */
export async function submitRequest(
  config: CrossChainConfig,
  recipient: string,
  valueEth: string,
): Promise<SubmitResult> {
  const router = new ethers.Contract(config.routerAddress, ROUTER_ABI, config.n1Signer);
  const value  = ethers.parseEther(valueEth);

  const tx      = await router.initiateRequest(recipient, { value });
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error("submitRequest: no receipt");

  const iface = new ethers.Interface(ROUTER_ABI);
  let id = 0n, leaf = "", deadline = 0n;

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "RequestCreated") {
        id       = parsed.args.id       as bigint;
        leaf     = parsed.args.leaf     as string;
        deadline = parsed.args.deadline as bigint;
        break;
      }
    } catch { /* skip unrelated logs */ }
  }

  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, id, leaf, deadline };
}

/**
 * Poll `provider` until `txHash` has at least `n` confirmations.
 *
 * @param onProgress  Optional callback fired on every poll: `(current, target)`.
 * @param miner       Optional async thunk called before each poll iteration.
 *                    On local Hardhat nodes, pass a function that calls
 *                    `provider.send("hardhat_mine", ["0x1"])` to advance the chain.
 *                    On live networks, leave undefined.
 * @param pollMs      Milliseconds between polls (default 2 000).
 */
export async function waitForConfirmations(
  provider: ethers.Provider,
  txHash: string,
  n: number,
  onProgress?: (current: number, target: number) => void,
  miner?: () => Promise<void>,
  pollMs = 2_000,
): Promise<ethers.TransactionReceipt> {
  // Wait for tx to be included (1 confirmation)
  const initial = await provider.waitForTransaction(txHash, 1);
  if (!initial) throw new Error(`waitForConfirmations: tx ${txHash} not found`);

  const currentConfs = await initial.confirmations();
  onProgress?.(currentConfs, n);
  if (currentConfs >= n) return initial;

  // Poll for additional confirmations
  while (true) {
    if (miner) {
      await miner();
    } else {
      await new Promise<void>((r) => setTimeout(r, pollMs));
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) throw new Error(`waitForConfirmations: receipt for ${txHash} disappeared`);

    const confs = await receipt.confirmations();
    onProgress?.(confs, n);
    if (confs >= n) return receipt;
  }
}

/**
 * Fetch all `RequestCreated` logs from the Router, reconstruct the incremental
 * Merkle tree (same depth-8 / commutativeKeccak256 as the contract), and
 * **assert** that the locally computed root equals `Router.root()`.
 *
 * Throws if the roots diverge (e.g. a new push raced this call).
 *
 * KNOWN LIMITATION: fetches all logs from block 0. Paginate for large histories.
 */
export async function rebuildTree(config: CrossChainConfig): Promise<TreeState> {
  const router     = new ethers.Contract(config.routerAddress, ROUTER_ABI, config.n1Provider);
  const iface      = new ethers.Interface(ROUTER_ABI);
  const eventTopic = iface.getEvent("RequestCreated")!.topicHash;

  // ── Fetch all RequestCreated logs ────────────────────────────────────────
  const rawLogs = await config.n1Provider.getLogs({
    address:   config.routerAddress,
    topics:    [eventTopic],
    fromBlock: 0,
    toBlock:   "latest",
  });

  // ── Parse and sort by request id (= leaf insertion order) ────────────────
  const entries: Array<{ id: bigint; leaf: string; request: RequestData }> = [];

  for (const log of rawLogs) {
    const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
    if (!parsed) continue;
    const id        = parsed.args.id        as bigint;
    const leaf      = parsed.args.leaf      as string;
    const sender    = parsed.args.sender    as string;
    const recipient = parsed.args.recipient as string;
    const value     = parsed.args.value     as bigint;
    const deadline  = parsed.args.deadline  as bigint;
    entries.push({ id, leaf, request: { id, sender, recipient, value, deadline } });
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // ── Build full tree ───────────────────────────────────────────────────────
  const pushedLeaves = entries.map((e) => e.leaf);
  const levels       = buildFullTree(pushedLeaves);
  const computedRoot = levels[TREE_DEPTH][0];

  // ── Assert root matches on-chain value ───────────────────────────────────
  const onChainRoot = (await router.root()) as string;
  if (computedRoot.toLowerCase() !== onChainRoot.toLowerCase()) {
    throw new Error(
      `rebuildTree: root mismatch!\n` +
      `  computed : ${computedRoot}\n` +
      `  on-chain : ${onChainRoot}\n` +
      `KNOWN LIMITATION: a concurrent push may have changed the root. Retry.`,
    );
  }

  const requestMap = new Map<bigint, RequestData>(entries.map((e) => [e.id, e.request]));

  return {
    root:     computedRoot,
    leaves:   levels[0].slice(), // padded leaf layer
    requests: requestMap,
    levels,
  };
}

/**
 * Build a Merkle inclusion proof for request `id`.
 *
 * Internally calls `rebuildTree()` to snapshot the current state, then
 * extracts the sibling path for the leaf at `index === id`.
 *
 * Returns the proof, a `BlockHeader` (root + latest N1 block number),
 * and the `RequestData` to pass directly to `submitToVerifier`.
 *
 * KNOWN LIMITATION: calls rebuildTree() on every invocation — no caching.
 */
export async function buildProof(
  config: CrossChainConfig,
  id: bigint,
): Promise<ProofResult> {
  const treeState = await rebuildTree(config);

  const request = treeState.requests.get(id);
  if (!request) throw new Error(`buildProof: request id ${id} not found in on-chain logs`);

  const index = Number(id); // leaf index === request id (incremental IDs)

  // ── Extract sibling path (proof) ─────────────────────────────────────────
  const proof: string[] = [];
  let currentIndex = index;
  for (let lvl = 0; lvl < TREE_DEPTH; lvl++) {
    // Sibling is always at the neighbour index (XOR 1 = toggle last bit)
    const siblingIndex = currentIndex ^ 1;
    proof.push(treeState.levels[lvl][siblingIndex]);
    currentIndex = currentIndex >> 1;
  }

  const blockNumber = await config.n1Provider.getBlockNumber();
  const header: BlockHeader = {
    sourceBlock: BigInt(blockNumber),
    root:        treeState.root,
  };

  return { proof, header, request };
}

/**
 * Phase 2 — Submit the header + proof to the Verifier on N2.
 * On success the Verifier mints `request.value` wDEMO to `request.recipient`.
 */
export async function submitToVerifier(
  config: CrossChainConfig,
  header: BlockHeader,
  proof: string[],
  request: RequestData,
): Promise<ethers.TransactionReceipt> {
  const verifier = new ethers.Contract(config.verifierAddress, VERIFIER_ABI, config.n2Signer);
  const tx       = await verifier.verifyAndExecute(header, proof, request);
  const receipt  = await tx.wait(1);
  if (!receipt) throw new Error("submitToVerifier: no receipt for verifyAndExecute");
  return receipt;
}

/**
 * Reclaim locked ETH on N1 if deadline + 1 hour has expired and request was not executed.
 */
export async function reclaimRequest(
  routerAddress: string,
  signer: ethers.Signer,
  id: bigint,
): Promise<ethers.TransactionReceipt> {
  const router  = new ethers.Contract(routerAddress, ROUTER_ABI, signer);
  const tx      = await router.reclaim(id);
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error("reclaimRequest: no receipt for reclaim");
  return receipt;
}

