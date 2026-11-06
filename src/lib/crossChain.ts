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
  const value = ethers.parseEther(valueEth);
  const routerIface = new ethers.Interface(ROUTER_ABI);
  const realIface = new ethers.Interface(REAL_BRIDGE_ABI);

  let tx: ethers.ContractTransactionResponse;

  // 1. Try calling RealCrossChainBridge.initiate first
  try {
    const realBridge = new ethers.Contract(config.routerAddress, REAL_BRIDGE_ABI, config.n1Signer);
    const net = await config.n1Provider.getNetwork();
    const destChainId = net.chainId === 11155111n ? 80002n : net.chainId === 80002n ? 11155111n : 31337n;

    tx = await realBridge.initiate(
      destChainId,
      recipient,
      ethers.ZeroAddress,
      value,
      ethers.ZeroAddress,
      "0x",
      { value }
    );
  } catch (bridgeErr: any) {
    // Fallback to legacy Router.initiateRequest
    try {
      const router = new ethers.Contract(config.routerAddress, ROUTER_ABI, config.n1Signer);
      tx = await router.initiateRequest(recipient, { value });
    } catch {
      throw new Error(parseContractError(bridgeErr));
    }
  }

  const receipt = await tx.wait(1);
  if (!receipt) throw new Error("submitRequest: no receipt returned");
  if (receipt.status === 0) {
    throw new Error("Transaction reverted on-chain. Please verify contract conditions and parameters.");
  }

  let id = 0n, leaf = "", deadline = 0n;
  let found = false;

  for (const log of receipt.logs) {
    try {
      const parsed = realIface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "TransactionInitiated") {
        id = parsed.args.id as bigint;
        leaf = parsed.args.leaf as string;
        deadline = parsed.args.deadline as bigint;
        found = true;
        break;
      }
    } catch { /* skip */ }

    try {
      const parsed = routerIface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "RequestCreated") {
        id = parsed.args.id as bigint;
        leaf = parsed.args.leaf as string;
        deadline = parsed.args.deadline as bigint;
        found = true;
        break;
      }
    } catch { /* skip */ }
  }

  if (!found) {
    throw new Error(
      `No TransactionInitiated or RequestCreated event emitted at ${config.routerAddress}. Make sure the contract is deployed on this network.`
    );
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
 * Fetch `RequestCreated` logs from the Router, reconstruct the incremental
 * Merkle tree (same depth-8 / commutativeKeccak256 as the contract), and
 * **assert** that the locally computed root equals `Router.root()`.
 *
 * Throws if the roots diverge (e.g. a new push raced this call).
 *
 * Uses a safe block window to avoid public RPC block-range query limits.
 */
export async function rebuildTree(
  config: CrossChainConfig,
  fromBlock?: number,
): Promise<TreeState> {
  const routerIface = new ethers.Interface(ROUTER_ABI);
  const realIface   = new ethers.Interface(REAL_BRIDGE_ABI);

  const topicRequestCreated = routerIface.getEvent("RequestCreated")!.topicHash;
  const topicTxInitiated    = realIface.getEvent("TransactionInitiated")!.topicHash;

  let totalRequests = 0;
  try {
    const routerContract = new ethers.Contract(config.routerAddress, ROUTER_ABI, config.n1Provider);
    const nextIdBn: bigint = await routerContract.nextId();
    totalRequests = Number(nextIdBn);
  } catch (err) {
    console.warn("Could not read contract.nextId():", err);
  }

  let startBlock = fromBlock;
  if (startBlock === undefined) {
    try {
      const curBlock = await config.n1Provider.getBlockNumber();
      startBlock = Math.max(0, curBlock - 2_000);
    } catch {
      startBlock = 0;
    }
  }

  // ── Fetch logs with range fallback ───────────────────────────────────────
  let rawLogs: ethers.Log[] = [];
  try {
    rawLogs = await config.n1Provider.getLogs({
      address:   config.routerAddress,
      topics:    [[topicRequestCreated, topicTxInitiated]],
      fromBlock: startBlock,
      toBlock:   "latest",
    });
  } catch {
    try {
      const curBlock = await config.n1Provider.getBlockNumber();
      rawLogs = await config.n1Provider.getLogs({
        address:   config.routerAddress,
        topics:    [[topicRequestCreated, topicTxInitiated]],
        fromBlock: Math.max(0, curBlock - 500),
        toBlock:   "latest",
      });
    } catch {
      rawLogs = [];
    }
  }

  // ── Parse and sort by request id (= leaf insertion order) ────────────────
  const entries: Array<{ id: bigint; leaf: string; request: RequestData }> = [];

  for (const log of rawLogs) {
    let parsed = null;
    try {
      parsed = realIface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === "TransactionInitiated") {
        const id = parsed.args.id as bigint;
        const leaf = parsed.args.leaf as string;
        const sender = parsed.args.sender as string;
        const recipient = parsed.args.recipient as string;
        const value = parsed.args.amount as bigint;
        const deadline = parsed.args.deadline as bigint;
        entries.push({ id, leaf, request: { id, sender, recipient, value, deadline } });
        continue;
      }
    } catch { /* try legacy */ }

    try {
      parsed = routerIface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === "RequestCreated") {
        const id = parsed.args.id as bigint;
        const leaf = parsed.args.leaf as string;
        const sender = parsed.args.sender as string;
        const recipient = parsed.args.recipient as string;
        const value = (parsed.args.value ?? parsed.args.amount) as bigint;
        const deadline = parsed.args.deadline as bigint;
        entries.push({ id, leaf, request: { id, sender, recipient, value, deadline } });
      }
    } catch { /* skip */ }
  }

  // Fallback: If logs missed any requests due to RPC indexing/pruning, query contract directly
  if (totalRequests > entries.length) {
    const existingIds = new Set(entries.map((e) => e.id.toString()));

    // 1. Try RealCrossChainBridge direct state queries first
    try {
      const realBridge = new ethers.Contract(config.routerAddress, REAL_BRIDGE_ABI, config.n1Provider);
      const net = await config.n1Provider.getNetwork();
      for (let i = 0; i < totalRequests; i++) {
        if (!existingIds.has(i.toString())) {
          const req = await realBridge.outgoingRequests(i);
          const leaf = await realBridge.computeLeaf(
            net.chainId,
            config.routerAddress,
            req.destChainId,
            BigInt(i),
            req.sender,
            req.recipient,
            req.token,
            req.amount,
            req.targetCall,
            req.callDataHash,
            req.deadline
          );
          entries.push({
            id: BigInt(i),
            leaf: leaf as string,
            request: {
              id: BigInt(i),
              sender: req.sender as string,
              recipient: req.recipient as string,
              value: req.amount as bigint,
              deadline: req.deadline as bigint,
            },
          });
        }
      }
    } catch {
      // 2. Try legacy Router direct state queries
      try {
        const routerContract = new ethers.Contract(config.routerAddress, ROUTER_ABI, config.n1Provider);
        for (let i = 0; i < totalRequests; i++) {
          if (!existingIds.has(i.toString())) {
            const [leaf, req] = await Promise.all([
              routerContract.leaves(i),
              routerContract.requests(i),
            ]);
            entries.push({
              id: BigInt(i),
              leaf: leaf as string,
              request: {
                id: BigInt(i),
                sender: req.sender as string,
                recipient: req.recipient as string,
                value: req.value as bigint,
                deadline: req.deadline as bigint,
              },
            });
          }
        }
      } catch (e) {
        console.warn("Direct contract leaf fallback failed:", e);
      }
    }
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // ── Build full tree ───────────────────────────────────────────────────────
  const pushedLeaves = entries.map((e) => e.leaf);
  const levels       = buildFullTree(pushedLeaves);
  const computedRoot = levels[TREE_DEPTH][0];

  // ── Assert root matches on-chain value ───────────────────────────────────
  try {
    const routerContract = new ethers.Contract(config.routerAddress, ROUTER_ABI, config.n1Provider);
    const onChainRoot = (await routerContract.root()) as string;
    if (computedRoot.toLowerCase() !== onChainRoot.toLowerCase()) {
      throw new Error(
        `rebuildTree: root mismatch!\n` +
        `  computed : ${computedRoot}\n` +
        `  on-chain : ${onChainRoot}\n` +
        `KNOWN LIMITATION: a concurrent push may have changed the root. Retry.`,
      );
    }
  } catch (err) {
    if (String(err).includes("rebuildTree: root mismatch!")) throw err;
    console.warn("Router.root() read warning:", err);
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
 * Builds a valid, authentic cryptographic depth-8 Merkle proof for demo/simulation mode.
 */
export function buildDemoProof(
  sender: string,
  recipient: string,
  valueEth: string,
  id = 0n,
): ProofResult & { submitResult: SubmitResult } {
  const value = ethers.parseEther(valueEth || "0.001");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // 24 hours
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const leaf = ethers.keccak256(
    coder.encode(
      ["uint256", "address", "address", "uint256", "uint256"],
      [id, sender, recipient, value, deadline]
    )
  );

  const levels = buildFullTree([leaf]);
  const root = levels[TREE_DEPTH][0];

  const proof: string[] = [];
  let currentIndex = Number(id);
  for (let lvl = 0; lvl < TREE_DEPTH; lvl++) {
    const siblingIndex = currentIndex ^ 1;
    proof.push(levels[lvl][siblingIndex]);
    currentIndex = currentIndex >> 1;
  }

  const request: RequestData = {
    id,
    sender,
    recipient,
    value,
    deadline,
  };

  const header: BlockHeader = {
    sourceBlock: 5892144n,
    root,
  };

  const fakeTxHash = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const submitResult: SubmitResult = {
    txHash: fakeTxHash,
    blockNumber: 5892144,
    id,
    leaf,
    deadline,
  };

  return { proof, header, request, submitResult };
}

/**
 * Build a Merkle inclusion proof for request `id`.
 *
 * Internally calls `rebuildTree()` to snapshot the current state, then
 * extracts the sibling path for the leaf at `index === id`.
 *
 * Returns the proof, a `BlockHeader` (root + latest N1 block number),
 * and the `RequestData` to pass directly to `submitToVerifier`.
 */
export async function buildProof(
  config: CrossChainConfig,
  id: bigint,
  submitBlockNumber?: number,
): Promise<ProofResult> {
  const fromBlock = submitBlockNumber ? Math.max(0, submitBlockNumber - 500) : undefined;
  const treeState = await rebuildTree(config, fromBlock);

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
  // 1. Try RealCrossChainBridge.executeTransaction
  try {
    const realBridge = new ethers.Contract(config.verifierAddress, REAL_BRIDGE_ABI, config.n2Signer);
    const net = await config.n2Provider.getNetwork();
    const sourceChainId = net.chainId === 80002n ? 11155111n : net.chainId === 11155111n ? 80002n : 31337n;

    const req = {
      id: request.id,
      sender: request.sender,
      recipient: request.recipient,
      token: ethers.ZeroAddress,
      amount: request.value,
      targetCall: ethers.ZeroAddress,
      callDataHash: ethers.keccak256("0x"),
      deadline: request.deadline,
      destChainId: net.chainId,
    };

    // Prepare gas parameters for destination chain (especially critical on Polygon Amoy)
    const overrides: Record<string, any> = { gasLimit: 450000n };
    try {
      const feeData = await config.n2Provider.getFeeData();
      if (net.chainId === 80002n) {
        const minPriority = ethers.parseUnits("35", "gwei");
        const priority = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > minPriority
          ? feeData.maxPriorityFeePerGas
          : minPriority;
        const maxFee = feeData.maxFeePerGas && feeData.maxFeePerGas > priority
          ? feeData.maxFeePerGas + ethers.parseUnits("15", "gwei")
          : priority + ethers.parseUnits("15", "gwei");
        overrides.maxPriorityFeePerGas = priority;
        overrides.maxFeePerGas = maxFee;
      } else if (feeData.gasPrice) {
        overrides.gasPrice = (feeData.gasPrice * 120n) / 100n;
      }
    } catch (feeErr) {
      console.warn("Could not fetch destination feeData:", feeErr);
    }

    // Pre-flight static call simulation to verify cryptographic validity before spending gas
    try {
      await realBridge.executeTransaction.staticCall(sourceChainId, header, proof, req, "0x");
    } catch (simErr: any) {
      console.error("executeTransaction staticCall simulation failed:", simErr);
      throw new Error(parseContractError(simErr));
    }

    const tx = await realBridge.executeTransaction(sourceChainId, header, proof, req, "0x", overrides);
    const receipt = await tx.wait(1);
    if (!receipt) throw new Error("submitToVerifier: no receipt returned");
    return receipt;
  } catch (bridgeErr: any) {
    // If bridgeErr is already a parsed contract error from simulation, rethrow directly
    if (bridgeErr?.message && (
      bridgeErr.message.includes("Insufficient") ||
      bridgeErr.message.includes("Already") ||
      bridgeErr.message.includes("Expired") ||
      bridgeErr.message.includes("Invalid") ||
      bridgeErr.message.includes("Wrong Destination")
    )) {
      throw bridgeErr;
    }

    // 2. Fallback to legacy Verifier.verifyAndExecute
    try {
      const verifier = new ethers.Contract(config.verifierAddress, VERIFIER_ABI, config.n2Signer);
      const tx       = await verifier.verifyAndExecute(header, proof, request);
      const receipt  = await tx.wait(1);
      if (!receipt) throw new Error("submitToVerifier: no receipt for verifyAndExecute");
      return receipt;
    } catch {
      throw new Error(parseContractError(bridgeErr));
    }
  }
}

/**
 * Reclaim locked funds on source chain if deadline has expired and request was not executed.
 */
export async function reclaimRequest(
  bridgeAddress: string,
  signer: ethers.Signer,
  id: bigint,
): Promise<ethers.TransactionReceipt> {
  try {
    const bridge = new ethers.Contract(bridgeAddress, REAL_BRIDGE_ABI, signer);
    const tx = await bridge.reclaim(id);
    const receipt = await tx.wait(1);
    if (!receipt) throw new Error("reclaimRequest: no receipt for reclaim");
    return receipt;
  } catch (err: any) {
    try {
      const router = new ethers.Contract(bridgeAddress, ROUTER_ABI, signer);
      const tx = await router.reclaim(id);
      const receipt = await tx.wait(1);
      if (!receipt) throw new Error("reclaimRequest: no receipt for reclaim");
      return receipt;
    } catch {
      throw new Error(parseContractError(err));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Real Cross-Chain Bridge & Smart Contract Transaction Executor ABI & Helpers
// ─────────────────────────────────────────────────────────────────────────────

export const REAL_BRIDGE_ABI = [
  "function initiate(uint256 destChainId, address recipient, address token, uint256 amount, address targetCall, bytes callData) payable returns (uint256)",
  "function executeTransaction(uint256 sourceChainId, tuple(uint256 sourceBlock, bytes32 root) header, bytes32[] proof, tuple(uint256 id, address sender, address recipient, address token, uint256 amount, address targetCall, bytes32 callDataHash, uint256 deadline, uint256 destChainId) req, bytes callData)",
  "function root() view returns (bytes32)",
  "function nextId() view returns (uint256)",
  "function processed(uint256 sourceChainId, uint256 id) view returns (bool)",
  "function getLiquidity(address token) view returns (uint256)",
  "function depositLiquidity(address token, uint256 amount) payable",
  "function reclaim(uint256 id)",
  "function outgoingRequests(uint256) view returns (address sender, address recipient, address token, uint256 amount, address targetCall, bytes32 callDataHash, uint256 deadline, uint256 destChainId, bool reclaimed)",
  "function computeLeaf(uint256 srcChainId, address srcBridge, uint256 dstChainId, uint256 id, address sender, address recipient, address token, uint256 amount, address targetCall, bytes32 callDataHash, uint256 deadline) pure returns (bytes32)",
  "error Expired(uint256 id, uint256 deadline, uint256 currentTime)",
  "error InvalidProof(uint256 id)",
  "error AlreadyProcessed(uint256 sourceChainId, uint256 id)",
  "error InsufficientLiquidity(address token, uint256 requested, uint256 available)",
  "error InsufficientVaultLiquidity(address token, uint256 available, uint256 required)",
  "error InvalidHeader()",
  "error WrongDestinationChain(uint256 expectedChainId, uint256 receivedChainId)",
  "error UntrustedSourceChain(uint256 sourceChainId)",
  "error CalldataHashMismatch(bytes32 expected, bytes32 actual)",
  "error TransferFailed()",
  "error ZeroAddress()",
  "error ZeroAmount()",
  "error RequestNotFound(uint256 id)",
  "error NotRequestSender()",
  "error AlreadyReclaimed(uint256 id)",
  "error TooEarlyToReclaim(uint256 id, uint256 unlockTime, uint256 currentTime)",
  "error ReclaimTooEarly(uint256 id, uint256 reclaimableAfter, uint256 currentTimestamp)",
  "event TransactionInitiated(uint256 indexed id, address indexed sender, address indexed recipient, uint256 destChainId, address token, uint256 amount, address targetCall, bytes32 callDataHash, uint256 deadline, bytes32 leaf, bytes32 newRoot)",
  "event TransactionExecuted(uint256 indexed id, uint256 indexed sourceChainId, address indexed recipient, address token, uint256 amount, address targetCall)",
  "event TargetCallExecuted(uint256 indexed id, address indexed targetCall, bool success, bytes returnData)",
  "event Reclaimed(uint256 indexed id, address indexed sender, address token, uint256 amount)",
  "event LiquidityAdded(address indexed provider, address indexed token, uint256 amount)",
  "event LiquidityWithdrawn(address indexed to, address indexed token, uint256 amount)"
] as const;

/**
 * Parses smart contract errors into clear, actionable explanations.
 */
export function parseContractError(err: any): string {
  if (!err) return "An unexpected error occurred.";

  const errorName = err.errorName || err.shortMessage || "";
  const rawData = err.data || err.error?.data || err.info?.error?.data;

  // Try parsing from raw hex data if errorName is not yet set
  if (!errorName && typeof rawData === "string" && rawData.startsWith("0x")) {
    try {
      const iface = new ethers.Interface(REAL_BRIDGE_ABI);
      const parsed = iface.parseError(rawData);
      if (parsed) {
        return parseContractError({ errorName: parsed.name, errorArgs: parsed.args });
      }
    } catch {
      // ignore
    }
  }

  if (errorName === "Expired" || err.message?.includes("Expired") || (typeof rawData === "string" && rawData.startsWith("0xe40e4d39"))) {
    return "Transaction Expired: This cross-chain transfer had a 1-hour validity window that has elapsed. Your funds are protected on-chain — click 'Reclaim Locked Funds' to receive them back in your wallet.";
  }

  if (
    errorName === "InsufficientLiquidity" ||
    errorName === "InsufficientVaultLiquidity" ||
    err.message?.includes("InsufficientLiquidity") ||
    err.message?.includes("InsufficientVaultLiquidity")
  ) {
    const available = err.errorArgs?.available ? ethers.formatEther(err.errorArgs.available) : undefined;
    const requested = (err.errorArgs?.requested ?? err.errorArgs?.required) ? ethers.formatEther(err.errorArgs?.requested ?? err.errorArgs?.required) : undefined;
    if (available && requested) {
      return `Insufficient Vault Liquidity on destination: Vault has ${available}, but ${requested} was requested. Please transfer a smaller amount (e.g. 0.001 - 0.04 POL/ETH) or deposit liquidity.`;
    }
    return "Insufficient Bridge Vault Liquidity: The destination vault currently does not have enough native coin to fulfill this amount. Please bridge a smaller calibrated amount or deposit vault liquidity.";
  }

  if (errorName === "AlreadyProcessed" || err.message?.includes("AlreadyProcessed")) {
    return "Already Executed: This transfer has already been completed and settled on the destination network.";
  }

  if (errorName === "AlreadyReclaimed" || err.message?.includes("AlreadyReclaimed")) {
    return "Already Reclaimed: The locked funds for this transfer have already been refunded to your wallet.";
  }

  if (errorName === "TooEarlyToReclaim" || errorName === "ReclaimTooEarly" || err.message?.includes("TooEarlyToReclaim") || err.message?.includes("ReclaimTooEarly")) {
    return "Reclaim Too Early: Locked funds can only be reclaimed after the 1-hour expiration and grace period have lapsed.";
  }

  if (errorName === "InvalidProof" || err.message?.includes("InvalidProof")) {
    return "Invalid Merkle Proof: The cryptographic sibling path does not match the header root.";
  }

  if (errorName === "WrongDestinationChain" || err.message?.includes("WrongDestinationChain")) {
    return "Wrong Destination Chain: Your connected wallet network does not match the transfer's destination chain.";
  }

  if (errorName === "UntrustedSourceChain" || err.message?.includes("UntrustedSourceChain")) {
    return "Untrusted Source Chain: Bridge does not recognize the source chain ID.";
  }

  if (err.reason) return err.reason;
  if (err.shortMessage) return err.shortMessage;
  if (err.message) return err.message;
  return String(err);
}

export interface RealCrossChainRequest {
  id: bigint;
  sender: string;
  recipient: string;
  token: string;
  amount: bigint;
  targetCall: string;
  callDataHash: string;
  deadline: bigint;
  destChainId: bigint;
}

export interface RealSubmitResult {
  txHash: string;
  blockNumber: number;
  id: bigint;
  leaf: string;
  deadline: bigint;
  callDataHash: string;
}

/**
 * Initiate real transaction on RealCrossChainBridge (supports native ETH/POL, ERC-20, and arbitrary contract calls).
 */
export async function submitRealBridgeRequest(
  bridgeAddress: string,
  signer: ethers.Signer,
  destChainId: bigint,
  recipient: string,
  token: string,
  amountWei: bigint,
  targetCall: string = ethers.ZeroAddress,
  callData: string = "0x"
): Promise<RealSubmitResult> {
  const bridge = new ethers.Contract(bridgeAddress, REAL_BRIDGE_ABI, signer);
  const isNative = token === ethers.ZeroAddress;

  const tx = await bridge.initiate(
    destChainId,
    recipient,
    token,
    amountWei,
    targetCall,
    callData,
    isNative ? { value: amountWei } : {}
  );

  const receipt = await tx.wait(1);
  if (!receipt) throw new Error("submitRealBridgeRequest: no receipt returned");

  const iface = new ethers.Interface(REAL_BRIDGE_ABI);
  let id = 0n, leaf = "", deadline = 0n, callDataHash = "";
  let found = false;

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "TransactionInitiated") {
        id = parsed.args.id as bigint;
        leaf = parsed.args.leaf as string;
        deadline = parsed.args.deadline as bigint;
        callDataHash = parsed.args.callDataHash as string;
        found = true;
        break;
      }
    } catch { /* skip non-matching logs */ }
  }

  if (!found) {
    throw new Error(`TransactionInitiated event not found for RealCrossChainBridge at ${bridgeAddress}`);
  }

  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, id, leaf, deadline, callDataHash };
}

/**
 * Execute real transaction on destination RealCrossChainBridge (pays out real native/ERC20 and/or executes target contract call).
 */
export async function executeRealBridgeTransaction(
  destBridgeAddress: string,
  destSigner: ethers.Signer,
  sourceChainId: bigint,
  header: BlockHeader,
  proof: string[],
  request: RealCrossChainRequest,
  callData: string = "0x"
): Promise<ethers.TransactionReceipt> {
  const bridge = new ethers.Contract(destBridgeAddress, REAL_BRIDGE_ABI, destSigner);
  const tx = await bridge.executeTransaction(sourceChainId, header, proof, request, callData);
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error("executeRealBridgeTransaction: no receipt returned");
  return receipt;
}


