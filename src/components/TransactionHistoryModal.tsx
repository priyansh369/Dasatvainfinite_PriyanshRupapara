import React, { useState, useMemo } from "react";
import {
  History,
  X,
  Search,
  ExternalLink,
  Download,
  Copy,
  Check,
  Trash2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Layers,
  ArrowRight,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileJson,
} from "lucide-react";
import {
  BridgeTransaction,
  exportProofToJson,
  clearTransactions,
} from "../types/history";
import MerkleTreeVisualizer from "./MerkleTreeVisualizer";

interface TransactionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: BridgeTransaction[];
  onTransactionsChange: (updated: BridgeTransaction[]) => void;
  onTriggerDemo?: () => void;
}

export default function TransactionHistoryModal({
  isOpen,
  onClose,
  transactions,
  onTransactionsChange,
  onTriggerDemo,
}: TransactionHistoryModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "minted" | "locked" | "demo">("all");
  const [expandedProofTxId, setExpandedProofTxId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleClearAll = () => {
    clearTransactions();
    onTransactionsChange([]);
    setShowConfirmClear(false);
  };

  // Filtered & searched transactions
  const filteredTxs = useMemo(() => {
    return transactions.filter((tx) => {
      // Tab filter
      if (filterTab === "minted" && tx.status !== "minted") return false;
      if (filterTab === "locked" && tx.status !== "locked") return false;
      if (filterTab === "demo" && !tx.isDemo) return false;

      // Search query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        tx.id.toLowerCase().includes(q) ||
        tx.amount.toLowerCase().includes(q) ||
        tx.token.toLowerCase().includes(q) ||
        tx.recipient.toLowerCase().includes(q) ||
        (tx.sourceTxHash && tx.sourceTxHash.toLowerCase().includes(q)) ||
        (tx.destTxHash && tx.destTxHash.toLowerCase().includes(q)) ||
        tx.sourceChain.name.toLowerCase().includes(q) ||
        tx.destChain.name.toLowerCase().includes(q)
      );
    });
  }, [transactions, filterTab, searchQuery]);

  const counts = useMemo(() => {
    return {
      all: transactions.length,
      minted: transactions.filter((t) => t.status === "minted").length,
      locked: transactions.filter((t) => t.status === "locked").length,
      demo: transactions.filter((t) => t.isDemo).length,
    };
  }, [transactions]);

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" });
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    let relative = "";
    if (diffSec < 60) relative = `${diffSec}s ago`;
    else if (diffSec < 3600) relative = `${Math.floor(diffSec / 60)}m ago`;
    else if (diffSec < 86400) relative = `${Math.floor(diffSec / 3600)}h ago`;
    else relative = `${Math.floor(diffSec / 86400)}d ago`;

    return { full: `${dateStr}, ${timeStr}`, relative };
  };

  const truncateAddress = (addr?: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleExportAll = () => {
    if (transactions.length === 0) return;
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(transactions, null, 2)
    )}`;
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", jsonString);
    downloadAnchor.setAttribute("download", `cryptoxchange-all-history-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(18, 8, 21, 0.85)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "20px",
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "880px",
          maxHeight: "90vh",
          backgroundColor: "#160b1c",
          border: "1px solid rgba(216, 97, 60, 0.3)",
          borderRadius: "18px",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 70px rgba(0, 0, 0, 0.7), 0 0 40px rgba(176, 116, 159, 0.15)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(90deg, rgba(176, 116, 159, 0.12), rgba(216, 97, 60, 0.08))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, rgba(176, 116, 159, 0.3), rgba(216, 97, 60, 0.3))",
                border: "1px solid rgba(216, 97, 60, 0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--terracotta-400)",
              }}
            >
              <History size={22} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <h2 style={{ fontSize: "19px", fontWeight: "800", color: "#f8fafc", margin: 0 }}>
                  Cross-Chain History & Proof Explorer
                </h2>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: "700",
                    padding: "3px 8px",
                    borderRadius: "10px",
                    background: "rgba(176, 116, 159, 0.2)",
                    color: "var(--mauve-200)",
                    border: "1px solid rgba(176, 116, 159, 0.3)",
                  }}
                >
                  {transactions.length} Recorded
                </span>
              </div>
              <p style={{ margin: "3px 0 0 0", fontSize: "13px", color: "var(--text-muted)" }}>
                Cryptographic Merkle inclusion proofs, on-chain execution logs, and exportable receipts
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {transactions.length > 0 && (
              <button
                onClick={handleExportAll}
                title="Export all transactions as JSON"
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  color: "var(--text-secondary)",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  fontSize: "12px",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                <FileJson size={14} /> Export All
              </button>
            )}

            <button
              onClick={onClose}
              style={{
                background: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                color: "#e2e8f0",
                borderRadius: "8px",
                width: "36px",
                height: "36px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Toolbar: Search & Filter Tabs */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            background: "rgba(0, 0, 0, 0.25)",
          }}
        >
          {/* Filter Chips */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              onClick={() => setFilterTab("all")}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                border: "1px solid",
                borderColor: filterTab === "all" ? "var(--terracotta-500)" : "rgba(255, 255, 255, 0.08)",
                background: filterTab === "all" ? "rgba(216, 97, 60, 0.2)" : "transparent",
                color: filterTab === "all" ? "#fff" : "var(--text-muted)",
              }}
            >
              All ({counts.all})
            </button>
            <button
              onClick={() => setFilterTab("minted")}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                border: "1px solid",
                borderColor: filterTab === "minted" ? "#10b981" : "rgba(255, 255, 255, 0.08)",
                background: filterTab === "minted" ? "rgba(16, 185, 129, 0.18)" : "transparent",
                color: filterTab === "minted" ? "#34d399" : "var(--text-muted)",
              }}
            >
              ✓ Minted ({counts.minted})
            </button>
            <button
              onClick={() => setFilterTab("locked")}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                border: "1px solid",
                borderColor: filterTab === "locked" ? "#f59e0b" : "rgba(255, 255, 255, 0.08)",
                background: filterTab === "locked" ? "rgba(245, 158, 11, 0.18)" : "transparent",
                color: filterTab === "locked" ? "#fbbf24" : "var(--text-muted)",
              }}
            >
              ⏳ Locked ({counts.locked})
            </button>
            <button
              onClick={() => setFilterTab("demo")}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                border: "1px solid",
                borderColor: filterTab === "demo" ? "var(--mauve-400)" : "rgba(255, 255, 255, 0.08)",
                background: filterTab === "demo" ? "rgba(176, 116, 159, 0.2)" : "transparent",
                color: filterTab === "demo" ? "var(--mauve-200)" : "var(--text-muted)",
              }}
            >
              ⚡ Demo / Zero-Gas ({counts.demo})
            </button>
          </div>

          {/* Search Box & Clear History */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: "1 1 260px", justifyContent: "flex-end" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px",
                padding: "6px 12px",
                width: "100%",
                maxWidth: "280px",
              }}
            >
              <Search size={14} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="Search hash, address, token..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "#f8fafc",
                  fontSize: "13px",
                  width: "100%",
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {transactions.length > 0 && (
              <div>
                {!showConfirmClear ? (
                  <button
                    onClick={() => setShowConfirmClear(true)}
                    title="Clear history"
                    style={{
                      background: "rgba(239, 68, 68, 0.1)",
                      border: "1px solid rgba(239, 68, 68, 0.25)",
                      color: "#f87171",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <Trash2 size={13} /> Clear
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      onClick={handleClearAll}
                      style={{
                        background: "#ef4444",
                        border: "none",
                        color: "#fff",
                        borderRadius: "6px",
                        padding: "6px 10px",
                        fontSize: "12px",
                        fontWeight: "700",
                        cursor: "pointer",
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setShowConfirmClear(false)}
                      style={{
                        background: "rgba(255, 255, 255, 0.1)",
                        border: "none",
                        color: "#fff",
                        borderRadius: "6px",
                        padding: "6px 10px",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Transaction List Body */}
        <div
          style={{
            padding: "20px 24px",
            overflowY: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          {filteredTxs.length === 0 ? (
            /* Empty State */
            <div
              style={{
                textAlign: "center",
                padding: "48px 20px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: "60px",
                  height: "60px",
                  borderRadius: "16px",
                  background: "rgba(176, 116, 159, 0.1)",
                  border: "1px solid rgba(176, 116, 159, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--mauve-300)",
                  marginBottom: "16px",
                }}
              >
                <Layers size={30} />
              </div>
              <h3 style={{ fontSize: "17px", fontWeight: "700", color: "#f8fafc", margin: "0 0 6px 0" }}>
                {searchQuery || filterTab !== "all" ? "No matching transactions found" : "No cross-chain history yet"}
              </h3>
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: "14px",
                  maxWidth: "400px",
                  margin: "0 0 20px 0",
                  lineHeight: 1.5,
                }}
              >
                {searchQuery || filterTab !== "all"
                  ? "Try adjusting your search filters to find what you're looking for."
                  : "Execute a bridge transfer or try Demo Simulation Mode to generate, verify, and inspect real 8-depth Merkle proofs!"}
              </p>

              {onTriggerDemo && (
                <button
                  onClick={() => {
                    onClose();
                    onTriggerDemo();
                  }}
                  className="btn btn-primary"
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <Sparkles size={16} /> Run Zero-Gas Demo Transfer
                </button>
              )}
            </div>
          ) : (
            filteredTxs.map((tx) => {
              const time = formatTimestamp(tx.timestamp);
              const isProofExpanded = expandedProofTxId === tx.id;

              return (
                <div
                  key={tx.id}
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.025)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "14px",
                    padding: "18px 20px",
                    transition: "border-color 0.2s, background-color 0.2s",
                  }}
                >
                  {/* Top Row: Chains, Amount & Status */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "12px",
                      marginBottom: "14px",
                    }}
                  >
                    {/* Transfer Route */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "rgba(0, 0, 0, 0.35)",
                          padding: "6px 10px",
                          borderRadius: "8px",
                          border: "1px solid rgba(255, 255, 255, 0.08)",
                        }}
                      >
                        <span style={{ fontSize: "14px" }}>{tx.sourceChain.icon || "🔷"}</span>
                        <span style={{ fontSize: "13px", fontWeight: "700", color: "#f8fafc" }}>
                          {tx.amount} {tx.token}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          ({tx.sourceChain.name})
                        </span>
                      </div>

                      <div style={{ color: "var(--terracotta-400)", display: "flex", alignItems: "center" }}>
                        <ArrowRight size={16} />
                      </div>

                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "rgba(130, 71, 229, 0.12)",
                          padding: "6px 10px",
                          borderRadius: "8px",
                          border: "1px solid rgba(130, 71, 229, 0.3)",
                        }}
                      >
                        <span style={{ fontSize: "14px" }}>{tx.destChain.icon || "🟣"}</span>
                        <span style={{ fontSize: "13px", fontWeight: "700", color: "#c084fc" }}>
                          {tx.amount} wDEMO
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          ({tx.destChain.name})
                        </span>
                      </div>
                    </div>

                    {/* Status & Timestamp */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {tx.isDemo && (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: "700",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            background: "rgba(176, 116, 159, 0.2)",
                            color: "var(--mauve-200)",
                            border: "1px solid rgba(176, 116, 159, 0.35)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <Sparkles size={11} /> Simulated
                        </span>
                      )}

                      {tx.status === "minted" ? (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: "700",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            background: "rgba(16, 185, 129, 0.15)",
                            color: "#34d399",
                            border: "1px solid rgba(16, 185, 129, 0.35)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <CheckCircle2 size={12} /> Minted
                        </span>
                      ) : tx.status === "locked" ? (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: "700",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            background: "rgba(245, 158, 11, 0.15)",
                            color: "#fbbf24",
                            border: "1px solid rgba(245, 158, 11, 0.35)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <Clock size={12} /> Locked (Pending Amoy)
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: "700",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            background: "rgba(239, 68, 68, 0.15)",
                            color: "#f87171",
                            border: "1px solid rgba(239, 68, 68, 0.35)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <AlertTriangle size={12} /> Issue
                        </span>
                      )}

                      <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "4px" }} title={time.full}>
                        {time.relative}
                      </span>
                    </div>
                  </div>

                  {/* Middle Row: Hashes, Recipient, Benchmark */}
                  <div
                    style={{
                      background: "rgba(0, 0, 0, 0.22)",
                      borderRadius: "10px",
                      padding: "10px 14px",
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: "12px",
                      fontSize: "12px",
                    }}
                  >
                    <div>
                      <span style={{ color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>
                        Recipient Address:
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span className="mono" style={{ color: "#e2e8f0", fontWeight: "600" }}>
                          {truncateAddress(tx.recipient)}
                        </span>
                        <button
                          onClick={() => copyToClipboard(tx.recipient, `recip-${tx.id}`)}
                          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0 }}
                          title="Copy address"
                        >
                          {copiedKey === `recip-${tx.id}` ? <Check size={12} color="#34d399" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <span style={{ color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>
                        Source Tx (Sepolia):
                      </span>
                      {tx.sourceTxHash ? (
                        tx.isDemo ? (
                          <span className="mono" style={{ color: "var(--mauve-300)" }}>
                            {truncateAddress(tx.sourceTxHash)} (Simulated)
                          </span>
                        ) : (
                          <a
                            href={`https://sepolia.etherscan.io/tx/${tx.sourceTxHash}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: "var(--terracotta-400)",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              textDecoration: "none",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {truncateAddress(tx.sourceTxHash)}
                            <ExternalLink size={11} />
                          </a>
                        )
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>Pending</span>
                      )}
                    </div>

                    <div>
                      <span style={{ color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>
                        Destination Tx (Amoy):
                      </span>
                      {tx.destTxHash ? (
                        tx.isDemo ? (
                          <span className="mono" style={{ color: "var(--mauve-300)" }}>
                            {truncateAddress(tx.destTxHash)} (Simulated)
                          </span>
                        ) : (
                          <a
                            href={`https://amoy.polygonscan.com/tx/${tx.destTxHash}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: "#c084fc",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              textDecoration: "none",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {truncateAddress(tx.destTxHash)}
                            <ExternalLink size={11} />
                          </a>
                        )
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>Pending verification</span>
                      )}
                    </div>

                    <div>
                      <span style={{ color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>
                        Verification Latency:
                      </span>
                      {tx.elapsedSec ? (
                        <span style={{ color: "#34d399", fontWeight: "700" }}>
                          ⚡ {tx.elapsedSec}s{" "}
                          <span style={{ color: "var(--text-muted)", fontWeight: "400", fontSize: "11px" }}>
                            (vs 119.7s relayers)
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>In Progress</span>
                      )}
                    </div>
                  </div>

                  {/* Actions Strip: Proof Visualizer / Export Proof */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: "12px",
                      flexWrap: "wrap",
                      gap: "8px",
                    }}
                  >
                    <div style={{ display: "flex", gap: "8px" }}>
                      {tx.proofData && (
                        <button
                          onClick={() => setExpandedProofTxId(isProofExpanded ? null : tx.id)}
                          style={{
                            background: isProofExpanded ? "rgba(216, 97, 60, 0.25)" : "rgba(255, 255, 255, 0.05)",
                            border: "1px solid",
                            borderColor: isProofExpanded ? "var(--terracotta-500)" : "rgba(255, 255, 255, 0.1)",
                            color: isProofExpanded ? "#fff" : "var(--text-secondary)",
                            borderRadius: "8px",
                            padding: "6px 12px",
                            fontSize: "12px",
                            fontWeight: "600",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            transition: "all 0.2s",
                          }}
                        >
                          <ShieldCheck size={14} color="var(--terracotta-400)" />
                          {isProofExpanded ? "Hide Merkle Visualizer" : "Inspect 8-Depth Proof"}
                          {isProofExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}

                      <button
                        onClick={() => exportProofToJson(tx)}
                        style={{
                          background: "rgba(255, 255, 255, 0.05)",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          color: "var(--text-secondary)",
                          borderRadius: "8px",
                          padding: "6px 12px",
                          fontSize: "12px",
                          fontWeight: "600",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          transition: "all 0.2s",
                        }}
                      >
                        <Download size={13} /> Export Proof (.json)
                      </button>
                    </div>

                    {tx.proofData && (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <button
                          onClick={() => copyToClipboard(tx.proofData!.root, `root-${tx.id}`)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--text-muted)",
                            fontSize: "11px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          {copiedKey === `root-${tx.id}` ? <Check size={12} color="#34d399" /> : <Copy size={12} />}
                          Root: {tx.proofData.root.slice(0, 8)}...
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Collapsible Proof Visualizer for this specific transaction */}
                  {isProofExpanded && tx.proofData && (
                    <div
                      style={{
                        marginTop: "16px",
                        paddingTop: "16px",
                        borderTop: "1px dashed rgba(255, 255, 255, 0.1)",
                      }}
                    >
                      <MerkleTreeVisualizer
                        root={tx.proofData.root}
                        leaf={tx.proofData.leaf}
                        proof={tx.proofData.proof}
                        requestId={tx.proofData.requestId}
                        isInline={true}
                        autoAnimate={false}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer info note */}
        <div
          style={{
            padding: "12px 24px",
            borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            background: "rgba(0, 0, 0, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "12px",
            color: "var(--text-muted)",
          }}
        >
          <span>
            💡 All cryptographic proofs use <strong>depth-8 commutative Keccak-256</strong> trees verified on Polygon Amoy.
          </span>
          <span className="mono">Storage: localStorage v1</span>
        </div>
      </div>
    </div>
  );
}
