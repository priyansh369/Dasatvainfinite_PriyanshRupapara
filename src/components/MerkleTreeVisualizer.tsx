import React, { useState, useMemo } from "react";
import { ethers } from "ethers";
import {
  Layers,
  ShieldCheck,
  Check,
  Copy,
  ChevronRight,
  Play,
  RotateCcw,
  Sparkles,
  Info,
  GitFork,
  ArrowUp,
  X,
} from "lucide-react";
import { computeZeroHashes, TREE_DEPTH } from "../lib/crossChain";

interface MerkleTreeVisualizerProps {
  root?: string;
  leaf?: string;
  proof?: string[];
  requestId?: bigint | number | string;
  onClose?: () => void;
  isInline?: boolean;
  autoAnimate?: boolean;
  onAnimationComplete?: () => void;
}

function commutativeKeccak256(a: string, b: string): { result: string; lo: string; hi: string; isALo: boolean } {
  const ab = ethers.getBytes(a);
  const bb = ethers.getBytes(b);
  let lo = a, hi = b;
  let isALo = true;
  for (let i = 0; i < 32; i++) {
    if (ab[i] < bb[i]) { lo = a; hi = b; isALo = true; break; }
    if (ab[i] > bb[i]) { lo = b; hi = a; isALo = false; break; }
  }
  return {
    result: ethers.keccak256(ethers.concat([lo, hi])),
    lo,
    hi,
    isALo,
  };
}

export default function MerkleTreeVisualizer({
  root,
  leaf,
  proof,
  requestId = 0n,
  onClose,
  isInline = false,
  autoAnimate = true,
  onAnimationComplete,
}: MerkleTreeVisualizerProps) {
  const [activeStep, setActiveStep] = useState<number>(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"ladder" | "tree">("ladder");
  const [isPlaying, setIsPlaying] = useState<boolean>(autoAnimate);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  // Fallback sample data if opened without an active transaction proof
  const sampleData = useMemo(() => {
    const dummyLeaf = ethers.keccak256(ethers.toUtf8Bytes("CryptoXchange_Sample_Leaf_0"));
    const zeros = computeZeroHashes(TREE_DEPTH);
    const dummyProof = zeros.slice(0, TREE_DEPTH);
    return { dummyLeaf, dummyProof };
  }, []);

  const activeLeaf = leaf || sampleData.dummyLeaf;
  const activeProof = proof && proof.length === TREE_DEPTH ? proof : sampleData.dummyProof;

  // Derive each level of the proof ladder step by step
  const verificationSteps = useMemo(() => {
    const steps: Array<{
      level: number;
      current: string;
      sibling: string;
      parent: string;
      lo: string;
      hi: string;
      isCurrentLo: boolean;
    }> = [];

    let currentHash = activeLeaf;
    for (let lvl = 0; lvl < TREE_DEPTH; lvl++) {
      const siblingHash = activeProof[lvl];
      const { result, lo, hi, isALo } = commutativeKeccak256(currentHash, siblingHash);
      steps.push({
        level: lvl,
        current: currentHash,
        sibling: siblingHash,
        parent: result,
        lo,
        hi,
        isCurrentLo: isALo,
      });
      currentHash = result;
    }

    return { steps, computedRoot: currentHash };
  }, [activeLeaf, activeProof]);

  // Automated step-by-step playback timer
  React.useEffect(() => {
    let timer: number;
    if (isPlaying && !isCompleted) {
      timer = window.setInterval(() => {
        setActiveStep((prev) => {
          if (prev < TREE_DEPTH - 1) {
            return prev + 1;
          } else {
            setIsPlaying(false);
            setIsCompleted(true);
            onAnimationComplete?.();
            return prev;
          }
        });
      }, 700);
    }
    return () => clearInterval(timer);
  }, [isPlaying, isCompleted, onAnimationComplete]);

  const targetRoot = root || verificationSteps.computedRoot;
  const isRootMatching = verificationSteps.computedRoot.toLowerCase() === targetRoot.toLowerCase();

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleNextStep = () => {
    setIsPlaying(false);
    setActiveStep((prev) => (prev < TREE_DEPTH - 1 ? prev + 1 : 0));
  };

  const handleReplay = () => {
    setActiveStep(0);
    setIsCompleted(false);
    setIsPlaying(true);
  };

  const currentStepData = verificationSteps.steps[activeStep];

  return (
    <div
      className={isInline ? "merkle-visualizer-inline" : "merkle-visualizer-modal"}
      style={{
        background: "#ffffff",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: "24px",
        boxShadow: "0 10px 35px rgba(70, 30, 80, 0.06)",
        color: "var(--text-primary)",
      }}
    >
      {/* ── Visualizer Header ────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "20px" }}>🌳</span>
            <h3 style={{ fontSize: "18px", fontWeight: "800", color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
              Interactive Merkle Tree Visualizer
            </h3>
            <span className="badge badge-success" style={{ fontSize: "11px" }}>
              OZ MerkleTree (Depth 8)
            </span>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
            Real-time off-chain cryptographic proof reconstruction with commutative Keccak-256 validation.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* View Mode Toggle */}
          <div style={{ display: "flex", background: "#f0eaf1", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", padding: "2px" }}>
            <button
              type="button"
              className={`btn ${viewMode === "ladder" ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "4px 10px", fontSize: "11px", border: "none" }}
              onClick={() => setViewMode("ladder")}
            >
              🪜 Proof Ladder
            </button>
            <button
              type="button"
              className={`btn ${viewMode === "tree" ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "4px 10px", fontSize: "11px", border: "none" }}
              onClick={() => setViewMode("tree")}
            >
              🌲 Tree Hierarchy
            </button>
          </div>

          {onClose && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "6px", borderRadius: "50%" }}
              onClick={onClose}
              title="Close Visualizer"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ── Root Verification Badge ───────────────────────────────────────── */}
      <div
        style={{
          background: isRootMatching ? "rgba(5, 150, 105, 0.08)" : "rgba(239, 68, 68, 0.08)",
          border: `1px solid ${isRootMatching ? "rgba(5, 150, 105, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
          borderRadius: "var(--radius-md)",
          padding: "12px 16px",
          marginBottom: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <ShieldCheck size={18} color={isRootMatching ? "#059669" : "#dc2626"} />
          <div>
            <div style={{ fontSize: "12px", fontWeight: "700", color: isRootMatching ? "#059669" : "#dc2626" }}>
              {isRootMatching ? "Cryptographic Root Matches On-Chain Router" : "Root Divergence Detected"}
            </div>
            <div className="mono" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              Target Root: {targetRoot.slice(0, 18)}...{targetRoot.slice(-10)}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: "3px 8px", fontSize: "11px" }}
          onClick={() => copyToClipboard(targetRoot, "root")}
        >
          {copiedKey === "root" ? <Check size={12} color="#059669" /> : <Copy size={12} />}
          Copy Root
        </button>
      </div>

      {/* ── View 1: Step-by-Step Proof Ladder View ────────────────────────── */}
      {viewMode === "ladder" && (
        <div>
          {/* Level Progress Stepper Bar */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "6px", marginBottom: "20px" }}>
            {verificationSteps.steps.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveStep(idx)}
                style={{
                  background: activeStep === idx
                    ? "var(--terracotta-500)"
                    : activeStep > idx
                    ? "var(--mauve-500)"
                    : "#f4eff5",
                  color: activeStep === idx || activeStep > idx ? "#ffffff" : "var(--text-secondary)",
                  border: activeStep === idx ? "1px solid var(--terracotta-500)" : "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  padding: "8px 2px",
                  fontSize: "11px",
                  fontWeight: "700",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  textAlign: "center",
                }}
              >
                <div>Lvl {s.level}</div>
                <div style={{ fontSize: "9px", opacity: 0.85 }}>
                  {s.level === 0 ? "Leaf" : s.level === 7 ? "Root" : `Node`}
                </div>
              </button>
            ))}
          </div>

          {/* Active Level Detail Box */}
          <div
            style={{
              background: "#fbf9fc",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              padding: "20px",
              marginBottom: "20px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="badge badge-sepolia" style={{ fontSize: "12px", padding: "4px 10px" }}>
                  Level {currentStepData.level} Verification Step
                </span>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                  {currentStepData.level === 0
                    ? "Combining User Request Leaf with Sibling 0"
                    : currentStepData.level === 7
                    ? "Final Level: Combining Subtree Hash with Sibling 7 to reach Root"
                    : `Combining Intermediate Node with Sibling ${currentStepData.level}`}
                </span>
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`btn ${isPlaying ? "btn-primary" : "btn-secondary"}`}
                  style={{ padding: "5px 12px", fontSize: "12px", gap: "6px" }}
                  onClick={() => setIsPlaying(!isPlaying)}
                  title={isPlaying ? "Pause live step calculation" : "Play step-by-step animation"}
                >
                  {isPlaying ? (
                    <>
                      <span className="animate-pulse" style={{ display: "inline-block" }}>●</span>
                      Stepping (Lvl {activeStep}/7)...
                    </>
                  ) : (
                    <>
                      <Play size={13} />
                      Play Animation
                    </>
                  )}
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "5px 10px", fontSize: "12px" }}
                  onClick={handleReplay}
                  title="Replay verification from Level 0"
                >
                  <RotateCcw size={13} />
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "5px 12px", fontSize: "12px" }}
                  onClick={handleNextStep}
                >
                  Next Level <ChevronRight size={14} />
                </button>
              </div>
            </div>

            {/* Visual Formula Block */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: "10px", alignItems: "center", background: "#ffffff", border: "1px solid rgba(176, 116, 159, 0.22)", borderRadius: "var(--radius-sm)", padding: "16px", marginBottom: "16px" }}>
              {/* Left / Accumulator Node */}
              <div style={{ background: "rgba(216, 97, 60, 0.08)", border: "1px solid var(--terracotta-500)", borderRadius: "var(--radius-sm)", padding: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--terracotta-700)", marginBottom: "4px" }}>
                  {currentStepData.level === 0 ? "🔷 User Request Leaf" : `Level ${currentStepData.level} Accumulator`}
                </div>
                <div className="mono" style={{ fontSize: "11px", color: "var(--text-primary)", wordBreak: "break-all" }}>
                  {currentStepData.current}
                </div>
              </div>

              {/* Operator */}
              <div style={{ fontSize: "16px", fontWeight: "900", color: "var(--mauve-700)" }}>
                ⊕
              </div>

              {/* Sibling Hash */}
              <div style={{ background: "rgba(176, 116, 159, 0.1)", border: "1px solid var(--mauve-500)", borderRadius: "var(--radius-sm)", padding: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--mauve-800)", marginBottom: "4px" }}>
                  🟣 Sibling Hash [Level {currentStepData.level}]
                </div>
                <div className="mono" style={{ fontSize: "11px", color: "var(--text-primary)", wordBreak: "break-all" }}>
                  {currentStepData.sibling}
                </div>
              </div>

              {/* Equals Arrow */}
              <div style={{ fontSize: "16px", fontWeight: "900", color: "var(--terracotta-600)" }}>
                ➔
              </div>

              {/* Computed Parent Hash */}
              <div style={{ background: "rgba(5, 150, 105, 0.08)", border: "1px solid #059669", borderRadius: "var(--radius-sm)", padding: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "#059669", marginBottom: "4px" }}>
                  {currentStepData.level === 7 ? "👑 Merkle Root (Level 8)" : `Parent Hash [Level ${currentStepData.level + 1}]`}
                </div>
                <div className="mono" style={{ fontSize: "11px", color: "var(--text-primary)", wordBreak: "break-all" }}>
                  {currentStepData.parent}
                </div>
              </div>
            </div>

            {/* Commutative Explanation Note */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "12px", color: "var(--text-muted)" }}>
              <Info size={16} style={{ color: "var(--mauve-600)", flexShrink: 0, marginTop: "2px" }} />
              <div>
                <strong>OpenZeppelin Commutative Keccak-256:</strong> In OpenZeppelin <code>MerkleTree.sol</code>, nodes are sorted as unsigned big-endian 256-bit integers before hashing:{" "}
                <code>keccak256(concat(min(a, b), max(a, b)))</code>.
                In this step,{" "}
                <span className="mono" style={{ color: "var(--terracotta-700)", fontWeight: "700" }}>
                  {currentStepData.isCurrentLo ? "Accumulator < Sibling (Accumulator placed first)" : "Sibling < Accumulator (Sibling placed first)"}
                </span>.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── View 2: Tree Hierarchy Graphic View ───────────────────────────── */}
      {viewMode === "tree" && (
        <div style={{ background: "#fbf9fc", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "20px", marginBottom: "20px" }}>
          <div style={{ textAlign: "center", marginBottom: "16px", fontSize: "13px", color: "var(--text-muted)" }}>
            Visualizing the binary proof branch from your leaf through depth 8 up to the single Merkle Root.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
            {/* Top Root */}
            <div style={{ background: "rgba(5, 150, 105, 0.1)", border: "2px solid #059669", borderRadius: "var(--radius-sm)", padding: "10px 20px", textAlign: "center", minWidth: "320px", boxShadow: "0 0 15px rgba(5, 150, 105, 0.15)" }}>
              <div style={{ fontSize: "12px", fontWeight: "800", color: "#059669" }}>👑 Merkle Root (Level 8)</div>
              <div className="mono" style={{ fontSize: "11px", color: "var(--text-primary)" }}>
                {targetRoot.slice(0, 14)}...{targetRoot.slice(-10)}
              </div>
            </div>

            <ArrowUp size={16} color="var(--mauve-600)" />

            {/* Tree Branch Levels (Descending from 7 to 0) */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", maxWidth: "620px" }}>
              {verificationSteps.steps.slice().reverse().map((s) => (
                <div
                  key={s.level}
                  onClick={() => {
                    setActiveStep(s.level);
                    setViewMode("ladder");
                  }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: activeStep === s.level ? "rgba(216, 97, 60, 0.12)" : "#ffffff",
                    border: activeStep === s.level ? "1px solid var(--terracotta-500)" : "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    padding: "8px 14px",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span className="mono" style={{ fontSize: "11px", color: "var(--terracotta-700)", fontWeight: "700" }}>
                      Level {s.level}
                    </span>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      {s.level === 0 ? "Leaf Layer" : `Branch Node ${s.level}`}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--mauve-500)" }} />
                      <span className="mono" style={{ fontSize: "11px", color: "var(--mauve-700)" }}>
                        Sibling: {s.sibling.slice(0, 8)}...{s.sibling.slice(-6)}
                      </span>
                    </div>

                    <ChevronRight size={14} color="var(--text-muted)" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Stats Footer ────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", paddingTop: "14px", borderTop: "1px solid var(--border-subtle)", fontSize: "12px" }}>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Tree Depth:</span>{" "}
          <strong style={{ color: "var(--terracotta-300)" }}>8 Levels</strong> (256 Leaves max)
        </div>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Proof Size:</span>{" "}
          <strong style={{ color: "var(--mauve-200)" }}>8 Hashes (256 bytes)</strong>
        </div>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Verification Gas:</span>{" "}
          <strong style={{ color: "#34d399" }}>~24,000 gas on Polygon Amoy</strong>
        </div>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Relayer Trust:</span>{" "}
          <strong style={{ color: "#34d399" }}>Zero (Client-Mediated)</strong>
        </div>
      </div>
    </div>
  );
}
