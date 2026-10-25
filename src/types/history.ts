export interface ChainMetadata {
  id: number;
  name: string;
  symbol: string;
  icon?: string;
}

export interface MerkleProofData {
  root: string;
  leaf: string;
  proof: string[];
  requestId: string;
  blockNumber?: number;
}

export interface BridgeTransaction {
  id: string; // unique request ID or demo ID
  timestamp: number;
  status: "locked" | "minted" | "failed";
  isDemo: boolean;
  amount: string;
  token: string;
  sender?: string;
  recipient: string;
  sourceChain: ChainMetadata;
  destChain: ChainMetadata;
  sourceTxHash?: string;
  destTxHash?: string;
  elapsedSec?: number;
  proofData?: MerkleProofData;
}

const STORAGE_KEY = "cryptoxchange_tx_history_v1";

/**
 * Load all stored bridge transactions from localStorage.
 */
export function loadTransactions(): BridgeTransaction[] {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is BridgeTransaction =>
          Boolean(item && typeof item === "object" && typeof item.id === "string")
      );
    }
    return [];
  } catch (err) {
    console.error("Failed to load transactions from localStorage:", err);
    return [];
  }
}

/**
 * Save or update a single transaction. Prepends if new, replaces if existing.
 */
export function saveTransaction(tx: BridgeTransaction): BridgeTransaction[] {
  try {
    const current = loadTransactions();
    const existingIndex = current.findIndex((item) => item.id === tx.id);
    let updated: BridgeTransaction[];
    if (existingIndex >= 0) {
      updated = [...current];
      updated[existingIndex] = { ...updated[existingIndex], ...tx };
    } else {
      updated = [tx, ...current];
    }
    // Limit to latest 100 transactions
    if (updated.length > 100) {
      updated = updated.slice(0, 100);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.error("Failed to save transaction to localStorage:", err);
    return [];
  }
}

/**
 * Update an existing transaction by ID.
 */
export function updateTransaction(
  id: string,
  updates: Partial<BridgeTransaction>
): BridgeTransaction[] {
  try {
    const current = loadTransactions();
    const existingIndex = current.findIndex((item) => item.id === id);
    if (existingIndex >= 0) {
      current[existingIndex] = { ...current[existingIndex], ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    }
    return current;
  } catch (err) {
    console.error("Failed to update transaction:", err);
    return [];
  }
}

/**
 * Clear all transaction history from localStorage.
 */
export function clearTransactions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error("Failed to clear transactions:", err);
  }
}

/**
 * Export proof and transaction details as a downloadable JSON file.
 */
export function exportProofToJson(tx: BridgeTransaction): void {
  const exportPayload = {
    protocol: "CryptoXchange - User-Mediated Verification",
    version: "2.0",
    exportDate: new Date().toISOString(),
    transaction: {
      id: tx.id,
      timestamp: new Date(tx.timestamp).toISOString(),
      status: tx.status,
      isDemo: tx.isDemo,
      amount: tx.amount,
      token: tx.token,
      sender: tx.sender || "N/A",
      recipient: tx.recipient,
      sourceChain: tx.sourceChain,
      destChain: tx.destChain,
      sourceTxHash: tx.sourceTxHash || "N/A",
      destTxHash: tx.destTxHash || "N/A",
      elapsedSec: tx.elapsedSec ?? "N/A",
    },
    cryptographicProof: tx.proofData
      ? {
          merkleTreeDepth: 8,
          hashFunction: "Keccak-256 (OpenZeppelin commutive)",
          merkleRoot: tx.proofData.root,
          leaf: tx.proofData.leaf,
          requestId: tx.proofData.requestId,
          blockNumber: tx.proofData.blockNumber,
          siblingProofPath: tx.proofData.proof,
          siblingCount: tx.proofData.proof.length,
        }
      : null,
  };

  const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
    JSON.stringify(exportPayload, null, 2)
  )}`;
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", jsonString);
  const cleanId = tx.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16);
  downloadAnchor.setAttribute("download", `cryptoxchange-proof-${cleanId || "tx"}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}
