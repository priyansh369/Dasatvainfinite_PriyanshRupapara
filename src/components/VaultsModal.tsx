import React, { useState } from "react";
import { X, ExternalLink, Copy, Check, ShieldCheck, Coins, RefreshCw } from "lucide-react";
import { DEFAULT_CONTRACTS } from "../config/networks";

interface VaultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sepoliaBalance: string;
  amoyBalance: string;
  onRefresh?: () => void;
}

export default function VaultsModal({
  isOpen,
  onClose,
  sepoliaBalance,
  amoyBalance,
  onRefresh,
}: VaultsModalProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(28, 11, 32, 0.45)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "18px",
          width: "100%",
          maxWidth: "540px",
          border: "1px solid rgba(176, 116, 159, 0.28)",
          boxShadow: "0 24px 60px rgba(70, 30, 80, 0.2)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid rgba(176, 116, 159, 0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(135deg, rgba(216, 97, 60, 0.05), rgba(176, 116, 159, 0.08))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "rgba(216, 97, 60, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--terracotta-600)",
              }}
            >
              <Coins size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "var(--text-primary)" }}>
                Protocol Liquidity Vaults
              </h3>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)" }}>
                Live Non-Custodial Reserve Contracts
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {onRefresh && (
              <button
                onClick={onRefresh}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(176, 116, 159, 0.25)",
                  borderRadius: "8px",
                  padding: "6px",
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  display: "flex",
                }}
                title="Refresh balances"
              >
                <RefreshCw size={14} />
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Sepolia Vault Card */}
          <div
            style={{
              border: "1px solid rgba(216, 97, 60, 0.25)",
              borderRadius: "14px",
              padding: "16px",
              background: "linear-gradient(135deg, rgba(216, 97, 60, 0.04), #ffffff)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px" }}>🔷</span>
                <div>
                  <div style={{ fontWeight: "800", fontSize: "14px", color: "var(--text-primary)" }}>
                    Ethereum Sepolia Vault
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Source Lock & Merkle Root Anchor
                  </div>
                </div>
              </div>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: "700",
                  color: "#059669",
                  background: "rgba(5, 150, 105, 0.1)",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#059669" }} />
                Operational
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "12px 0 8px" }}>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "600" }}>Live Reserve:</span>
              <span style={{ fontSize: "20px", fontWeight: "800", color: "var(--terracotta-700)", fontFamily: "var(--font-mono)" }}>
                {sepoliaBalance} ETH
              </span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#fbf9fc",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid rgba(176, 116, 159, 0.15)",
                fontSize: "12px",
              }}
            >
              <span className="mono" style={{ color: "var(--text-secondary)" }}>
                {DEFAULT_CONTRACTS.sepolia.realBridge.slice(0, 10)}...{DEFAULT_CONTRACTS.sepolia.realBridge.slice(-8)}
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => copyToClipboard(DEFAULT_CONTRACTS.sepolia.realBridge, "sepolia-vault")}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex" }}
                  title="Copy contract address"
                >
                  {copiedKey === "sepolia-vault" ? <Check size={13} color="#059669" /> : <Copy size={13} />}
                </button>
                <a
                  href={`https://sepolia.etherscan.io/address/${DEFAULT_CONTRACTS.sepolia.realBridge}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--terracotta-600)", display: "flex" }}
                  title="View on Sepolia Etherscan"
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            </div>
          </div>

          {/* Polygon Amoy Vault Card */}
          <div
            style={{
              border: "1px solid rgba(176, 116, 159, 0.3)",
              borderRadius: "14px",
              padding: "16px",
              background: "linear-gradient(135deg, rgba(176, 116, 159, 0.05), #ffffff)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px" }}>🟣</span>
                <div>
                  <div style={{ fontWeight: "800", fontSize: "14px", color: "var(--text-primary)" }}>
                    Polygon Amoy Settlement Bridge
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Destination Cryptographic Verifier & Liquidity Payout
                  </div>
                </div>
              </div>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: "700",
                  color: "#059669",
                  background: "rgba(5, 150, 105, 0.1)",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#059669" }} />
                Operational
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "12px 0 8px" }}>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "600" }}>Live Reserve:</span>
              <span style={{ fontSize: "20px", fontWeight: "800", color: "var(--plum-800)", fontFamily: "var(--font-mono)" }}>
                {amoyBalance} POL
              </span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#fbf9fc",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid rgba(176, 116, 159, 0.15)",
                fontSize: "12px",
              }}
            >
              <span className="mono" style={{ color: "var(--text-secondary)" }}>
                {DEFAULT_CONTRACTS.amoy.realBridge.slice(0, 10)}...{DEFAULT_CONTRACTS.amoy.realBridge.slice(-8)}
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => copyToClipboard(DEFAULT_CONTRACTS.amoy.realBridge, "amoy-vault")}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex" }}
                  title="Copy contract address"
                >
                  {copiedKey === "amoy-vault" ? <Check size={13} color="#059669" /> : <Copy size={13} />}
                </button>
                <a
                  href={`https://amoy.polygonscan.com/address/${DEFAULT_CONTRACTS.amoy.realBridge}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--mauve-600)", display: "flex" }}
                  title="View on Polygonscan Amoy"
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            </div>
          </div>

          {/* Non-Custodial Security Notice */}
          <div
            style={{
              padding: "10px 14px",
              background: "rgba(5, 150, 105, 0.08)",
              border: "1px solid rgba(5, 150, 105, 0.25)",
              borderRadius: "10px",
              fontSize: "12px",
              color: "#065f46",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <ShieldCheck size={18} color="#059669" style={{ flexShrink: 0 }} />
            <span>
              All vault balances are strictly non-custodial and governed by on-chain Merkle root state proofs with automated anti-double-spend timelocks.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
