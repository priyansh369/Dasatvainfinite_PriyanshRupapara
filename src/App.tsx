import React, { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  RotateCcw,
  Zap,
  Lock,
  Layers,
  ChevronDown,
  ChevronUp,
  Settings,
  HelpCircle,
  Coins,
  Cpu,
} from "lucide-react";

import {
  submitRequest,
  waitForConfirmations,
  buildProof,
  submitToVerifier,
  reclaimRequest,
  CrossChainConfig,
  ProofResult,
  SubmitResult,
  WRAPPED_DEMO_ABI,
} from "./lib/crossChain";
import {
  NETWORKS,
  DEFAULT_CONTRACTS,
  COORDINATOR_CHAIN_BASELINE_SECONDS,
} from "./config/networks";

// Global window ethereum typing
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ethereum?: any;
  }
}

type StepPhase = "CONNECT" | "PHASE1_FORM" | "PHASE1_CONFIRMING" | "PHASE1_PROOF" | "PHASE2_SWITCH" | "PHASE2_VERIFYING" | "SUCCESS" | "FAILED";

export default function App() {
  // ── Wallet State ─────────────────────────────────────────────────────────
  const [account, setAccount] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  // ── Flow State ───────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<StepPhase>("CONNECT");
  const [recipient, setRecipient] = useState<string>("");
  const [amountEth, setAmountEth] = useState<string>("0.001");
  const [targetConfirmations, setTargetConfirmations] = useState<number>(3);
  const [currentConfirmations, setCurrentConfirmations] = useState<number>(0);

  // ── Results & Proof ──────────────────────────────────────────────────────
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [proofResult, setProofResult] = useState<ProofResult | null>(null);
  const [verifyTxHash, setVerifyTxHash] = useState<string>("");
  const [wDemoBalance, setWDemoBalance] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isBusy, setIsBusy] = useState<boolean>(false);

  // ── Timer & Benchmark ────────────────────────────────────────────────────
  const [timerRunning, setTimerRunning] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const startTimeRef = useRef<number | null>(null);

  // ── UI Helpers ───────────────────────────────────────────────────────────
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [showProofDetails, setShowProofDetails] = useState<boolean>(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [networkMode, setNetworkMode] = useState<"testnet" | "local">("testnet");

  // Custom contract overrides
  const [routerAddress, setRouterAddress] = useState<string>(DEFAULT_CONTRACTS.sepolia.router);
  const [verifierAddress, setVerifierAddress] = useState<string>(DEFAULT_CONTRACTS.amoy.verifier);
  const [wrappedDemoAddress, setWrappedDemoAddress] = useState<string>(DEFAULT_CONTRACTS.amoy.wrappedDemo);

  // ── Timer Effect ─────────────────────────────────────────────────────────
  useEffect(() => {
    let interval: number;
    if (timerRunning) {
      interval = window.setInterval(() => {
        if (startTimeRef.current) {
          setElapsedMs(Date.now() - startTimeRef.current);
        }
      }, 50);
    }
    return () => clearInterval(interval);
  }, [timerRunning]);

  const startStopwatch = () => {
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    setTimerRunning(true);
  };

  const stopStopwatch = () => {
    setTimerRunning(false);
  };

  // ── Ethers Providers & Signers from MetaMask ─────────────────────────────
  const getBrowserSignerAndProvider = async () => {
    if (!window.ethereum) throw new Error("MetaMask is not installed.");
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    const signer = await browserProvider.getSigner();
    return { browserProvider, signer };
  };

  // Static read provider for N1 (Sepolia or Local)
  const getN1Provider = () => {
    const rpc = networkMode === "testnet"
      ? NETWORKS.sepolia.rpcUrls[0]
      : NETWORKS.localN1.rpcUrls[0];
    return new ethers.JsonRpcProvider(rpc);
  };

  // Static read provider for N2 (Amoy or Local)
  const getN2Provider = () => {
    const rpc = networkMode === "testnet"
      ? NETWORKS.amoy.rpcUrls[0]
      : NETWORKS.localN2.rpcUrls[0];
    return new ethers.JsonRpcProvider(rpc);
  };

  // ── MetaMask Listeners ───────────────────────────────────────────────────
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.request({ method: "eth_accounts" }).then((accounts: string[]) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          if (!recipient) setRecipient(accounts[0]);
          if (phase === "CONNECT") setPhase("PHASE1_FORM");
        }
      }).catch(console.error);

      window.ethereum.request({ method: "eth_chainId" }).then((cId: string) => {
        setChainId(parseInt(cId, 16));
      }).catch(console.error);

      const handleAccounts = (accounts: string[]) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
        } else {
          setAccount("");
          setPhase("CONNECT");
        }
      };

      const handleChainChanged = (cId: string) => {
        setChainId(parseInt(cId, 16));
      };

      window.ethereum.on("accountsChanged", handleAccounts);
      window.ethereum.on("chainChanged", handleChainChanged);

      return () => {
        window.ethereum?.removeListener("accountsChanged", handleAccounts);
        window.ethereum?.removeListener("chainChanged", handleChainChanged);
      };
    }
  }, [phase, recipient]);

  // Connect Wallet
  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Please install MetaMask to interact with this dApp.");
      return;
    }
    setIsConnecting(true);
    setErrorMessage("");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (accounts.length > 0) {
        setAccount(accounts[0]);
        if (!recipient) setRecipient(accounts[0]);
        setPhase("PHASE1_FORM");
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnecting(false);
    }
  };

  // Network Switch Helper
  const switchNetwork = async (targetNetworkKey: "sepolia" | "amoy") => {
    if (!window.ethereum) return;
    const target = NETWORKS[targetNetworkKey];
    setErrorMessage("");
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: target.chainIdHex }],
      });
    } catch (switchError: unknown) {
      // 4902 code indicates chain has not been added yet
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((switchError as any)?.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: target.chainIdHex,
                chainName: target.name,
                rpcUrls: target.rpcUrls,
                nativeCurrency: {
                  name: target.symbol,
                  symbol: target.symbol,
                  decimals: 18,
                },
                blockExplorerUrls: target.blockExplorerUrl ? [target.blockExplorerUrl] : [],
              },
            ],
          });
        } catch (addError: unknown) {
          setErrorMessage(addError instanceof Error ? addError.message : String(addError));
        }
      } else {
        setErrorMessage(switchError instanceof Error ? switchError.message : String(switchError));
      }
    }
  };

  // ── Step 1: Submit on Sepolia (Lock ETH) ──────────────────────────────────
  const handleLockEth = async () => {
    if (!account) return;
    setIsBusy(true);
    setErrorMessage("");
    try {
      // Ensure on Sepolia or Localhost N1
      const targetChainId = networkMode === "testnet" ? NETWORKS.sepolia.chainIdDec : 31337;
      if (chainId !== targetChainId) {
        await switchNetwork("sepolia");
      }

      startStopwatch();

      const { browserProvider, signer } = await getBrowserSignerAndProvider();
      const n2Provider = getN2Provider();

      const config: CrossChainConfig = {
        routerAddress,
        n1Provider: browserProvider,
        n1Signer: signer,
        verifierAddress,
        n2Provider,
        n2Signer: signer, // will be replaced in Phase 2 with Amoy signer
      };

      // 1. Submit Request
      const sub = await submitRequest(config, recipient, amountEth);
      setSubmitResult(sub);
      setPhase("PHASE1_CONFIRMING");

      // 2. Wait for confirmations
      setCurrentConfirmations(1);
      await waitForConfirmations(
        browserProvider,
        sub.txHash,
        targetConfirmations,
        (current) => setCurrentConfirmations(current),
        undefined,
        1500
      );

      // 3. Build proof off-chain
      setPhase("PHASE1_PROOF");
      // Use n1Provider to rebuild tree from on-chain logs
      const proof = await buildProof(config, sub.id);
      setProofResult(proof);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      stopStopwatch();
      setPhase("FAILED");
    } finally {
      setIsBusy(false);
    }
  };

  // ── Step 2: Submit to Verifier on Amoy ────────────────────────────────────
  const handleSubmitProof = async () => {
    if (!proofResult || !submitResult) return;
    setIsBusy(true);
    setErrorMessage("");
    try {
      // Ensure on Polygon Amoy or Localhost N2
      const targetChainId = networkMode === "testnet" ? NETWORKS.amoy.chainIdDec : 31337;
      if (chainId !== targetChainId) {
        await switchNetwork("amoy");
      }

      const { browserProvider, signer } = await getBrowserSignerAndProvider();
      const n1Provider = getN1Provider();

      const config: CrossChainConfig = {
        routerAddress,
        n1Provider,
        n1Signer: signer,
        verifierAddress,
        n2Provider: browserProvider,
        n2Signer: signer,
      };

      setPhase("PHASE2_VERIFYING");

      const receipt = await submitToVerifier(
        config,
        proofResult.header,
        proofResult.proof,
        proofResult.request
      );

      setVerifyTxHash(receipt.hash);
      stopStopwatch();

      // Read updated wDEMO balance
      try {
        const wDemo = new ethers.Contract(wrappedDemoAddress, WRAPPED_DEMO_ABI, browserProvider);
        const bal: bigint = await wDemo.balanceOf(recipient);
        const dec: bigint = await wDemo.decimals();
        setWDemoBalance(ethers.formatUnits(bal, dec));
      } catch {
        setWDemoBalance(amountEth);
      }

      setPhase("SUCCESS");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      stopStopwatch();
      setPhase("FAILED");
    } finally {
      setIsBusy(false);
    }
  };

  // ── Step 3: Reclaim on Failure / Timeout ──────────────────────────────────
  const handleReclaim = async () => {
    if (!submitResult) return;
    setIsBusy(true);
    setErrorMessage("");
    try {
      if (chainId !== NETWORKS.sepolia.chainIdDec) {
        await switchNetwork("sepolia");
      }
      const { signer } = await getBrowserSignerAndProvider();
      await reclaimRequest(routerAddress, signer, submitResult.id);
      alert("Successfully reclaimed locked ETH!");
      setPhase("PHASE1_FORM");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const resetFlow = () => {
    setPhase("PHASE1_FORM");
    setSubmitResult(null);
    setProofResult(null);
    setVerifyTxHash("");
    setWDemoBalance("");
    setErrorMessage("");
    setElapsedMs(0);
    setTimerRunning(false);
    startTimeRef.current = null;
  };

  const elapsedSec = (elapsedMs / 1000).toFixed(1);
  const baselineSec = COORDINATOR_CHAIN_BASELINE_SECONDS.toFixed(1);
  const isFaster = parseFloat(elapsedSec) > 0 && parseFloat(elapsedSec) < COORDINATOR_CHAIN_BASELINE_SECONDS;
  const speedupMultiplier = parseFloat(elapsedSec) > 0 ? (COORDINATOR_CHAIN_BASELINE_SECONDS / parseFloat(elapsedSec)).toFixed(1) : "—";

  return (
    <div className="app-container">
      {/* ── App Header ──────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">⚡</div>
          <div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <h1 className="brand-title">VECNAVERSE</h1>
              <span className="brand-badge">User-Mediated</span>
            </div>
            <p className="brand-subtitle">
              Decentralized Cross-Chain Transaction Verification · No Relayers · Zero Coordinator Chain
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {account ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className={`badge ${chainId === NETWORKS.amoy.chainIdDec ? "badge-amoy" : "badge-sepolia"}`}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: chainId === NETWORKS.amoy.chainIdDec ? "#a855f7" : "#f43f5e" }} />
                {chainId === NETWORKS.amoy.chainIdDec
                  ? "Polygon Amoy"
                  : chainId === NETWORKS.sepolia.chainIdDec
                  ? "Sepolia"
                  : `Chain #${chainId}`}
              </span>
              <div className="badge mono" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-subtle)" }}>
                {account.slice(0, 6)}...{account.slice(-4)}
              </div>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={connectWallet} disabled={isConnecting}>
              {isConnecting ? "Connecting..." : "Connect MetaMask"}
            </button>
          )}

          <button
            className="btn btn-secondary"
            style={{ padding: "8px 12px" }}
            onClick={() => setShowConfig(!showConfig)}
            title="Contract & Network Configuration"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* ── Collapsible Configuration Drawer ─────────────────────────────────── */}
      {showConfig && (
        <div className="benchmark-card" style={{ marginBottom: "24px", borderColor: "var(--crimson-700)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
              <Settings size={16} /> Deployments & Network Override
            </h3>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                className={`btn ${networkMode === "testnet" ? "btn-primary" : "btn-secondary"}`}
                style={{ padding: "6px 14px", fontSize: "12px" }}
                onClick={() => setNetworkMode("testnet")}
              >
                Testnets (Sepolia / Amoy)
              </button>
              <button
                className={`btn ${networkMode === "local" ? "btn-primary" : "btn-secondary"}`}
                style={{ padding: "6px 14px", fontSize: "12px" }}
                onClick={() => setNetworkMode("local")}
              >
                Localhost (Port 8545 / 8546)
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
            <div>
              <label className="input-label">N1 Router Address (Sepolia)</label>
              <input
                className="input-field mono"
                value={routerAddress}
                onChange={(e) => setRouterAddress(e.target.value)}
              />
            </div>
            <div>
              <label className="input-label">N2 Verifier Address (Amoy)</label>
              <input
                className="input-field mono"
                value={verifierAddress}
                onChange={(e) => setVerifierAddress(e.target.value)}
              />
            </div>
            <div>
              <label className="input-label">N2 WrappedDemo Token Address (wDEMO)</label>
              <input
                className="input-field mono"
                value={wrappedDemoAddress}
                onChange={(e) => setWrappedDemoAddress(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Benchmark Stopwatch & Comparison Banner ──────────────────────────── */}
      <div className="benchmark-card glow-crimson">
        <div className="benchmark-header">
          <div className="benchmark-title">
            <Zap size={16} style={{ color: "var(--crimson-400)" }} />
            End-to-End Latency vs Coordinator Baseline
          </div>
          {isFaster && (
            <div className="benchmark-badge-speedup">
              ⚡ {speedupMultiplier}x Faster than Coordinator Chain
            </div>
          )}
        </div>

        <div className="benchmark-metrics">
          {/* User-Mediated Timer */}
          <div className="metric-box">
            <div className="metric-label">
              <span>USER-MEDIATED E2E LATENCY</span>
              {timerRunning && <span style={{ color: "var(--crimson-400)", fontWeight: "bold" }}>● LIVE</span>}
            </div>
            <div className={`metric-value ${phase === "SUCCESS" ? "completed" : timerRunning ? "active" : ""}`}>
              {elapsedSec} s
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
              Client proof generation + direct submission
            </div>
          </div>

          {/* Baseline Timer */}
          <div className="metric-box">
            <div className="metric-label">
              <span>COORDINATOR CHAIN BASELINE</span>
              <span className="badge" style={{ background: "rgba(255,255,255,0.06)", fontSize: "10px" }}>Axelar / LayerZero</span>
            </div>
            <div className="metric-value baseline">
              {baselineSec} s
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
              Relayer quorum polling + secondary chain finality
            </div>
          </div>
        </div>

        {/* Visual Progress Bar Comparing Latency */}
        <div className="progress-bar-bg" style={{ height: "8px" }}>
          <div
            className="progress-bar-fill"
            style={{
              width: `${Math.min(100, (parseFloat(elapsedSec) / COORDINATOR_CHAIN_BASELINE_SECONDS) * 100)}%`,
              background: phase === "SUCCESS" ? "linear-gradient(90deg, #10b981, #34d399)" : undefined,
            }}
          />
        </div>
      </div>

      {/* ── 2-Phase Stepper Navigation ────────────────────────────────────────── */}
      <div className="stepper-nav">
        {/* Step 1: Sepolia Lock */}
        <div className={`step-card ${phase === "PHASE1_FORM" || phase === "PHASE1_CONFIRMING" || phase === "PHASE1_PROOF" ? "active" : phase === "PHASE2_SWITCH" || phase === "PHASE2_VERIFYING" || phase === "SUCCESS" ? "completed" : ""}`}>
          <div className="step-number">
            {phase === "PHASE2_SWITCH" || phase === "PHASE2_VERIFYING" || phase === "SUCCESS" ? (
              <Check size={18} />
            ) : (
              "1"
            )}
          </div>
          <div className="step-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="step-title">Phase 1: Sepolia Lock & Proof</div>
              <span className="badge badge-sepolia">N1</span>
            </div>
            <div className="step-subtitle">
              User locks native ETH into Router.sol; leaf is pushed to on-chain Merkle tree.
            </div>
          </div>
        </div>

        {/* Step 2: Amoy Verification */}
        <div className={`step-card ${phase === "PHASE2_SWITCH" || phase === "PHASE2_VERIFYING" ? "active" : phase === "SUCCESS" ? "completed" : ""}`}>
          <div className="step-number">
            {phase === "SUCCESS" ? <Check size={18} /> : "2"}
          </div>
          <div className="step-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="step-title">Phase 2: Polygon Amoy Verify</div>
              <span className="badge badge-amoy">N2</span>
            </div>
            <div className="step-subtitle">
              Client submits Merkle proof off-chain to Verifier.sol; mints wDEMO tokens.
            </div>
          </div>
        </div>
      </div>

      {/* ── Error Banner ──────────────────────────────────────────────────────── */}
      {errorMessage && (
        <div style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.4)", borderRadius: "var(--radius-md)", padding: "16px 20px", marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: "700", color: "#f87171", fontSize: "14px", marginBottom: "2px" }}>Transaction Error</div>
            <div style={{ color: "#fca5a5", fontSize: "13px" }}>{errorMessage}</div>
          </div>
          <button className="btn btn-secondary" style={{ padding: "6px 12px", fontSize: "12px" }} onClick={() => setErrorMessage("")}>
            Dismiss
          </button>
        </div>
      )}

      {/* ── Main Dynamic Card ─────────────────────────────────────────────────── */}
      <div className="main-card">
        {/* State 0: Connect Wallet */}
        {!account && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div className="brand-icon" style={{ width: "64px", height: "64px", margin: "0 auto 20px auto", fontSize: "32px" }}>
              ⚡
            </div>
            <h2 style={{ fontSize: "24px", fontWeight: "800", marginBottom: "10px" }}>Connect MetaMask to Begin</h2>
            <p style={{ color: "var(--text-muted)", maxWidth: "480px", margin: "0 auto 24px auto", fontSize: "14px" }}>
              Experience instant, client-mediated cross-chain verification between Ethereum Sepolia and Polygon Amoy without third-party relayer trust.
            </p>
            <button className="btn btn-primary" onClick={connectWallet} disabled={isConnecting}>
              {isConnecting ? "Connecting..." : "Connect MetaMask"}
            </button>
          </div>
        )}

        {/* State 1: Phase 1 Input Form */}
        {account && phase === "PHASE1_FORM" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: "800" }}>Initiate Cross-Chain Request</h2>
                <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                  Lock native ETH on Sepolia. Your client will construct an inclusion proof off-chain.
                </p>
              </div>
              <span className="badge badge-sepolia">Sepolia (N1)</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px", marginBottom: "24px" }}>
              <div className="input-group">
                <label className="input-label">Destination Recipient Address (Amoy N2)</label>
                <input
                  className="input-field mono"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x..."
                />
              </div>

              <div className="input-group">
                <label className="input-label">Lock Value (Sepolia ETH)</label>
                <input
                  type="number"
                  step="0.0001"
                  className="input-field mono"
                  value={amountEth}
                  onChange={(e) => setAmountEth(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="input-label">Confirmations to Wait (Default: 3)</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  className="input-field mono"
                  value={targetConfirmations}
                  onChange={(e) => setTargetConfirmations(parseInt(e.target.value) || 1)}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                className="btn btn-primary"
                onClick={handleLockEth}
                disabled={isBusy || !recipient || !amountEth}
              >
                <Lock size={16} />
                {isBusy ? "Initiating on Sepolia..." : "Lock ETH & Generate Proof"}
              </button>
            </div>
          </div>
        )}

        {/* State 2: Live Confirmation Counter */}
        {phase === "PHASE1_CONFIRMING" && submitResult && (
          <div style={{ padding: "20px 0" }}>
            <div style={{ textAlign: "center", marginBottom: "28px" }}>
              <div className="brand-icon animate-pulse-glow" style={{ width: "56px", height: "56px", margin: "0 auto 16px auto" }}>
                <Clock size={28} />
              </div>
              <h2 style={{ fontSize: "22px", fontWeight: "800", marginBottom: "8px" }}>
                Awaiting Block Confirmations
              </h2>
              <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                Transaction included in Block #{submitResult.blockNumber}. Polling for finalized blocks...
              </p>
            </div>

            {/* Confirmation Progress */}
            <div style={{ maxWidth: "480px", margin: "0 auto 28px auto", textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontWeight: "700", fontSize: "14px" }}>
                <span>Confirmations</span>
                <span className="mono" style={{ color: "var(--crimson-400)" }}>
                  {currentConfirmations} / {targetConfirmations}
                </span>
              </div>
              <div className="progress-bar-bg">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${Math.min(100, (currentConfirmations / targetConfirmations) * 100)}%` }}
                />
              </div>
            </div>

            <div className="proof-box" style={{ maxWidth: "600px", margin: "0 auto" }}>
              <div className="proof-item">
                <span className="proof-label">Sepolia Tx Hash:</span>
                <a
                  href={`${NETWORKS.sepolia.blockExplorerUrl}/tx/${submitResult.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="explorer-link"
                >
                  {submitResult.txHash.slice(0, 16)}...{submitResult.txHash.slice(-10)}
                  <ExternalLink size={12} />
                </a>
              </div>
              <div className="proof-item">
                <span className="proof-label">Request ID:</span>
                <span className="proof-val">{submitResult.id.toString()}</span>
              </div>
              <div className="proof-item">
                <span className="proof-label">Leaf Hash:</span>
                <span className="proof-val">{submitResult.leaf}</span>
              </div>
            </div>
          </div>
        )}

        {/* State 3: Proof Viewer & Switch to Polygon Amoy */}
        {(phase === "PHASE1_PROOF" || phase === "PHASE2_SWITCH") && proofResult && submitResult && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: "800", display: "flex", alignItems: "center", gap: "10px" }}>
                  <ShieldCheck size={22} style={{ color: "#34d399" }} />
                  Inclusion Proof Generated Off-Chain
                </h2>
                <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                  Reconstructed depth-8 Merkle tree matches Router.root(). Ready to verify on Polygon Amoy.
                </p>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <span className="badge badge-success">✓ Tree Validated</span>
                <span className="badge badge-amoy">Target: Amoy (N2)</span>
              </div>
            </div>

            {/* Proof Card */}
            <div className="proof-box">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid rgba(225,29,72,0.15)", paddingBottom: "10px" }}>
                <span style={{ fontSize: "14px", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
                  <Layers size={16} /> Merkle Verification Payload
                </span>
                <button
                  className="btn btn-secondary"
                  style={{ padding: "4px 10px", fontSize: "11px" }}
                  onClick={() => setShowProofDetails(!showProofDetails)}
                >
                  {showProofDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showProofDetails ? "Collapse Sibling Nodes" : "View 8 Sibling Nodes"}
                </button>
              </div>

              <div className="proof-item">
                <span className="proof-label">Merkle Root (Header):</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="proof-val">{proofResult.header.root}</span>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "2px 6px" }}
                    onClick={() => copyToClipboard(proofResult.header.root, "root")}
                  >
                    {copiedKey === "root" ? <Check size={12} color="#34d399" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              <div className="proof-item">
                <span className="proof-label">Leaf Hash (Request Data):</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="proof-val">{submitResult.leaf}</span>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "2px 6px" }}
                    onClick={() => copyToClipboard(submitResult.leaf, "leaf")}
                  >
                    {copiedKey === "leaf" ? <Check size={12} color="#34d399" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              {/* Sibling Array Breakdown */}
              {showProofDetails && (
                <div style={{ marginTop: "12px", background: "rgba(0,0,0,0.4)", borderRadius: "var(--radius-sm)", padding: "12px" }}>
                  <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "8px" }}>
                    Sibling Hashes (Depth 8 Proof Path):
                  </div>
                  {proofResult.proof.map((sibling, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", padding: "4px 0", borderBottom: i < 7 ? "1px dashed rgba(255,255,255,0.06)" : "none" }}>
                      <span className="mono" style={{ color: "var(--crimson-400)" }}>[Level {i}]</span>
                      <span className="mono" style={{ color: "var(--text-muted)" }}>{sibling}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Bar: Network Switch / Submit */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "24px", flexWrap: "wrap", gap: "14px" }}>
              <div>
                {chainId !== NETWORKS.amoy.chainIdDec && (
                  <span style={{ fontSize: "13px", color: "var(--crimson-300)" }}>
                    ⚠️ MetaMask currently connected to Chain #{chainId}. Please switch to Polygon Amoy.
                  </span>
                )}
              </div>

              <div style={{ display: "flex", gap: "12px" }}>
                {chainId !== NETWORKS.amoy.chainIdDec ? (
                  <button
                    className="btn btn-polygon"
                    onClick={() => switchNetwork("amoy")}
                  >
                    Switch to Polygon Amoy (N2)
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={handleSubmitProof}
                    disabled={isBusy}
                  >
                    <Coins size={16} />
                    {isBusy ? "Submitting Proof..." : "Submit Proof & Mint wDEMO"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* State 4: Verifying on Amoy */}
        {phase === "PHASE2_VERIFYING" && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div className="brand-icon animate-spin" style={{ width: "56px", height: "56px", margin: "0 auto 20px auto" }}>
              <Cpu size={28} />
            </div>
            <h2 style={{ fontSize: "22px", fontWeight: "800", marginBottom: "8px" }}>
              Verifying Proof on Polygon Amoy
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px", maxWidth: "480px", margin: "0 auto" }}>
              Calling <code>Verifier.verifyAndExecute()</code>. Contract will verify Merkle inclusion against the header root and mint wDEMO to {recipient.slice(0, 6)}...{recipient.slice(-4)}.
            </p>
          </div>
        )}

        {/* State 5: Success State */}
        {phase === "SUCCESS" && submitResult && (
          <div className="success-banner">
            <div className="success-icon">
              <CheckCircle2 size={36} />
            </div>
            <h2 style={{ fontSize: "26px", fontWeight: "800", color: "#34d399", marginBottom: "8px" }}>
              Cross-Chain Verification Succeeded!
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "15px", marginBottom: "24px" }}>
              wDEMO tokens have been minted on Polygon Amoy directly via user-mediated Merkle proof.
            </p>

            <div className="proof-box" style={{ maxWidth: "640px", margin: "0 auto 28px auto", textAlign: "left" }}>
              <div className="proof-item">
                <span className="proof-label">Minted to Recipient:</span>
                <span className="proof-val">{recipient}</span>
              </div>
              <div className="proof-item">
                <span className="proof-label">Amount Minted:</span>
                <span className="proof-val" style={{ color: "#34d399", fontWeight: "bold" }}>
                  {wDemoBalance || amountEth} wDEMO
                </span>
              </div>
              {verifyTxHash && (
                <div className="proof-item">
                  <span className="proof-label">Amoy Tx Hash:</span>
                  <a
                    href={`${NETWORKS.amoy.blockExplorerUrl}/tx/${verifyTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="explorer-link"
                  >
                    {verifyTxHash.slice(0, 16)}...{verifyTxHash.slice(-10)}
                    <ExternalLink size={12} />
                  </a>
                </div>
              )}
              <div className="proof-item">
                <span className="proof-label">Sepolia Tx Hash:</span>
                <a
                  href={`${NETWORKS.sepolia.blockExplorerUrl}/tx/${submitResult.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="explorer-link"
                >
                  {submitResult.txHash.slice(0, 16)}...{submitResult.txHash.slice(-10)}
                  <ExternalLink size={12} />
                </a>
              </div>
              <div className="proof-item">
                <span className="proof-label">Total End-to-End Time:</span>
                <span className="proof-val" style={{ color: "#34d399" }}>
                  {elapsedSec} s (vs 119.7 s baseline)
                </span>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
              <button className="btn btn-primary" onClick={resetFlow}>
                <RotateCcw size={16} /> Execute Another Transfer
              </button>
            </div>
          </div>
        )}

        {/* State 6: Failed / Expired State with Reclaim Button */}
        {phase === "FAILED" && (
          <div style={{ textAlign: "center", padding: "30px 20px" }}>
            <div className="brand-icon" style={{ width: "56px", height: "56px", margin: "0 auto 16px auto", background: "rgba(239, 68, 68, 0.2)", borderColor: "#ef4444" }}>
              <HelpCircle size={28} color="#ef4444" />
            </div>
            <h2 style={{ fontSize: "22px", fontWeight: "800", color: "#f87171", marginBottom: "8px" }}>
              Transaction Failed or Expired
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px", maxWidth: "480px", margin: "0 auto 24px auto" }}>
              If your request on Sepolia has passed its deadline (+ 1 hour), you can safely reclaim your locked ETH from Router.sol.
            </p>

            <div style={{ display: "flex", justifyContent: "center", gap: "14px" }}>
              {submitResult && (
                <button className="btn btn-danger" onClick={handleReclaim} disabled={isBusy}>
                  <RotateCcw size={16} />
                  {isBusy ? "Reclaiming..." : "Reclaim Locked ETH (Sepolia)"}
                </button>
              )}
              <button className="btn btn-secondary" onClick={resetFlow}>
                Restart Flow
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer style={{ marginTop: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
        <p>VECNAVERSE · OpenZeppelin Incremental MerkleTree ^5.1 · Ethers v6 · User-Mediated Verification Demo</p>
      </footer>
    </div>
  );
}
