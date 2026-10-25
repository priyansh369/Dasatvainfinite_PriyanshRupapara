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
  LogOut,
  Wallet,
  Plus,
  RefreshCw,
  Sparkles,
  History,
} from "lucide-react";

import {
  submitRequest,
  waitForConfirmations,
  buildProof,
  submitToVerifier,
  reclaimRequest,
  buildDemoProof,
  CrossChainConfig,
  ProofResult,
  SubmitResult,
  WRAPPED_DEMO_ABI,
} from "./lib/crossChain";
import {
  NETWORKS,
  DEFAULT_CONTRACTS,
  COORDINATOR_CHAIN_BASELINE_SECONDS,
  getChainInfo,
} from "./config/networks";
import MerkleTreeVisualizer from "./components/MerkleTreeVisualizer";
import TransactionHistoryModal from "./components/TransactionHistoryModal";
import {
  BridgeTransaction,
  loadTransactions,
  saveTransaction,
  updateTransaction,
} from "./types/history";

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

  // Synchronized chain metadata based on active MetaMask network
  const chainInfo = getChainInfo(chainId);

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
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [transactions, setTransactions] = useState<BridgeTransaction[]>(() => loadTransactions());
  const [activeTxId, setActiveTxId] = useState<string | null>(null);

  // Custom contract overrides
  const [routerAddress, setRouterAddress] = useState<string>(DEFAULT_CONTRACTS.sepolia.router);
  const [verifierAddress, setVerifierAddress] = useState<string>(DEFAULT_CONTRACTS.amoy.verifier);
  const [wrappedDemoAddress, setWrappedDemoAddress] = useState<string>(DEFAULT_CONTRACTS.amoy.wrappedDemo);

  // ── Token & Wallet Balances State ─────────────────────────────────────────
  const [connectedNativeBalance, setConnectedNativeBalance] = useState<string>("0.000");
  const [nativeBalance, setNativeBalance] = useState<string>("0.000");
  const [wDemoTokenBalance, setWDemoTokenBalance] = useState<string>("0.000");
  const [selectedToken, setSelectedToken] = useState<string>("ETH");
  const [isRefreshingBalances, setIsRefreshingBalances] = useState<boolean>(false);
  const [tokenImported, setTokenImported] = useState<boolean>(false);

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

  // ── Fetch Token Balances from MetaMask ───────────────────────────────────
  const fetchBalances = async (accountAddr?: string) => {
    const targetAddr = accountAddr || account;
    if (!targetAddr) return;
    setIsRefreshingBalances(true);

    try {
      // 0. Fetch active connected network native balance (real-time from MetaMask)
      if (window.ethereum) {
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        const bal = await browserProvider.getBalance(targetAddr);
        setConnectedNativeBalance(parseFloat(ethers.formatEther(bal)).toFixed(4));
      }
    } catch (e) {
      console.warn("Connected network balance fetch:", e);
    }

    try {
      // 1. Fetch Sepolia Native ETH balance
      const n1 = getN1Provider();
      const n1Bal = await n1.getBalance(targetAddr);
      setNativeBalance(parseFloat(ethers.formatEther(n1Bal)).toFixed(4));
    } catch (e) {
      console.warn("N1 balance fetch:", e);
    }

    try {
      // 2. Fetch Amoy wDEMO balance
      const n2 = getN2Provider();
      const wDemo = new ethers.Contract(wrappedDemoAddress, WRAPPED_DEMO_ABI, n2);
      const wDemoBal = await wDemo.balanceOf(targetAddr);
      const dec = await wDemo.decimals();
      setWDemoTokenBalance(parseFloat(ethers.formatUnits(wDemoBal, dec)).toFixed(4));
    } catch (e) {
      console.warn("wDEMO balance fetch:", e);
    } finally {
      setIsRefreshingBalances(false);
    }
  };

  // Add wDEMO token directly to user's MetaMask extension assets
  const importWDEMOToMetaMask = async () => {
    if (!window.ethereum) return;
    try {
      const wasAdded = await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: wrappedDemoAddress,
            symbol: "wDEMO",
            decimals: 18,
            image: "https://cryptologos.cc/logos/ethereum-eth-logo.png",
          },
        },
      });
      if (wasAdded) {
        setTokenImported(true);
        setTimeout(() => setTokenImported(false), 3000);
      }
    } catch (err: unknown) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleMax = () => {
    if (selectedToken === chainInfo.symbol) {
      const maxVal = Math.max(0, parseFloat(connectedNativeBalance) - 0.002);
      setAmountEth(maxVal > 0 ? maxVal.toFixed(4) : connectedNativeBalance);
    } else if (selectedToken === "ETH") {
      const maxVal = Math.max(0, parseFloat(nativeBalance) - 0.002);
      setAmountEth(maxVal > 0 ? maxVal.toFixed(4) : nativeBalance);
    } else {
      setAmountEth(wDemoTokenBalance);
    }
  };

  // ── MetaMask Listeners ───────────────────────────────────────────────────
  useEffect(() => {
    if (window.ethereum) {
      const isDisconnected = sessionStorage.getItem("wallet_disconnected") === "true";
      if (!isDisconnected) {
        window.ethereum.request({ method: "eth_accounts" }).then((accounts: string[]) => {
          if (accounts.length > 0) {
            setAccount(accounts[0]);
            if (!recipient) setRecipient(accounts[0]);
            if (phase === "CONNECT") setPhase("PHASE1_FORM");
            fetchBalances(accounts[0]);
          }
        }).catch(console.error);
      }

      window.ethereum.request({ method: "eth_chainId" }).then((cId: string) => {
        setChainId(parseInt(cId, 16));
      }).catch(console.error);

      const handleAccounts = (accounts: string[]) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          fetchBalances(accounts[0]);
        } else {
          setAccount("");
          setPhase("CONNECT");
        }
      };

      const handleChainChanged = (cId: string) => {
        setChainId(parseInt(cId, 16));
        fetchBalances();
      };

      window.ethereum.on("accountsChanged", handleAccounts);
      window.ethereum.on("chainChanged", handleChainChanged);

      return () => {
        window.ethereum?.removeListener("accountsChanged", handleAccounts);
        window.ethereum?.removeListener("chainChanged", handleChainChanged);
      };
    }
  }, [phase, recipient]);

  // Connect Wallet — Prompt MetaMask extension window automatically
  const connectWallet = async () => {
    sessionStorage.removeItem("wallet_disconnected");
    if (!window.ethereum) {
      window.open("https://metamask.io/download/", "_blank");
      return;
    }
    setIsConnecting(true);
    setErrorMessage("");
    try {
      let accounts: string[] = [];
      // Request permissions to ensure MetaMask browser extension window pops open automatically
      try {
        const permissions = await window.ethereum.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const accPerm = permissions?.find((p: any) => p.parentCapability === "eth_accounts");
        if (accPerm) {
          accounts = await window.ethereum.request({ method: "eth_accounts" });
        }
      } catch {
        // Fallback to standard request
        accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      }

      if (accounts && accounts.length > 0) {
        setAccount(accounts[0]);
        if (!recipient) setRecipient(accounts[0]);
        setPhase("PHASE1_FORM");
        await fetchBalances(accounts[0]);
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

    // 🎮 Demo Simulation Mode (Zero gas & instant execution)
    if (isDemoMode) {
      startStopwatch();
      try {
        const demo = buildDemoProof(account, recipient || account, amountEth);
        const txId = `demo-${Date.now()}`;
        setActiveTxId(txId);
        setSubmitResult(demo.submitResult);
        setProofResult({ proof: demo.proof, header: demo.header, request: demo.request });
        setCurrentConfirmations(1);

        // Record in transaction history
        const newTx: BridgeTransaction = {
          id: txId,
          timestamp: Date.now(),
          status: "locked",
          isDemo: true,
          amount: amountEth,
          token: selectedToken,
          recipient: recipient || account,
          sender: account,
          sourceChain: {
            id: chainId || 11155111,
            name: chainInfo.name,
            symbol: chainInfo.symbol,
            icon: chainInfo.icon,
          },
          destChain: {
            id: 80002,
            name: "Polygon Amoy",
            symbol: "POL",
            icon: "🟣",
          },
          sourceTxHash: demo.submitResult.txHash,
          proofData: {
            root: demo.header.root,
            leaf: demo.submitResult.leaf,
            proof: demo.proof,
            requestId: demo.submitResult.id.toString(),
          },
        };
        const updatedTxs = saveTransaction(newTx);
        setTransactions(updatedTxs);

        // Immediately show the live step-by-step Merkle Tree Visualizer!
        setPhase("PHASE1_PROOF");

        // Simulate block confirmations advancing in parallel
        setTimeout(() => setCurrentConfirmations(2), 1200);
        setTimeout(() => setCurrentConfirmations(3), 2400);
      } catch (err: unknown) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        stopStopwatch();
        setPhase("FAILED");
      } finally {
        setIsBusy(false);
      }
      return;
    }

    // 🌐 Live Network Flow
    try {
      // Ensure on Sepolia or Localhost N1
      const targetChainId = networkMode === "testnet" ? NETWORKS.sepolia.chainIdDec : 31337;
      if (chainId !== targetChainId) {
        await switchNetwork("sepolia");
      }

      startStopwatch();

      const { browserProvider, signer } = await getBrowserSignerAndProvider();

      // Pre-flight validation: check if contract is actually deployed
      const code = await browserProvider.getCode(routerAddress);
      if (!code || code === "0x" || code === "0x0") {
        throw new Error(
          `No Router smart contract is deployed at ${routerAddress} on ${
            networkMode === "testnet" ? "Ethereum Sepolia" : "Chain #" + chainId
          }. Please toggle to "Demo Simulation Mode" above to test with zero gas, or deploy Router.sol and configure its address in Settings (⚙️).`
        );
      }

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
      setCurrentConfirmations(1);

      // 2. Build proof off-chain using bounded block window
      const proof = await buildProof(config, sub.id, sub.blockNumber);
      setProofResult(proof);

      const txId = sub.id.toString();
      setActiveTxId(txId);

      // Record in transaction history
      const newTx: BridgeTransaction = {
        id: txId,
        timestamp: Date.now(),
        status: "locked",
        isDemo: false,
        amount: amountEth,
        token: selectedToken,
        recipient,
        sender: account,
        sourceChain: {
          id: chainId || 11155111,
          name: chainInfo.name,
          symbol: chainInfo.symbol,
          icon: chainInfo.icon,
        },
        destChain: {
          id: 80002,
          name: "Polygon Amoy",
          symbol: "POL",
          icon: "🟣",
        },
        sourceTxHash: sub.txHash,
        proofData: {
          root: proof.header.root,
          leaf: sub.leaf,
          proof: proof.proof,
          requestId: sub.id.toString(),
          blockNumber: sub.blockNumber,
        },
      };
      const updatedTxs = saveTransaction(newTx);
      setTransactions(updatedTxs);

      // Immediately display live Merkle Tree step-by-step calculation!
      setPhase("PHASE1_PROOF");

      // 3. Continue polling confirmations in background if needed
      if (targetConfirmations > 1) {
        waitForConfirmations(
          browserProvider,
          sub.txHash,
          targetConfirmations,
          (current) => setCurrentConfirmations(current),
          undefined,
          1500
        ).catch(console.warn);
      }
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

    // 🎮 Demo Simulation Mode
    if (isDemoMode) {
      try {
        setPhase("PHASE2_VERIFYING");
        await new Promise((r) => setTimeout(r, 1400));
        const fakeAmoyTx = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        setVerifyTxHash(fakeAmoyTx);
        setWDemoBalance(amountEth);
        stopStopwatch();

        const elapsed = startTimeRef.current ? Number(((Date.now() - startTimeRef.current) / 1000).toFixed(1)) : 1.4;
        if (activeTxId) {
          const updated = updateTransaction(activeTxId, {
            status: "minted",
            destTxHash: fakeAmoyTx,
            elapsedSec: elapsed,
          });
          setTransactions(updated);
        }

        setPhase("SUCCESS");
      } catch (err: unknown) {
        if (activeTxId) {
          const updated = updateTransaction(activeTxId, { status: "failed" });
          setTransactions(updated);
        }
        setErrorMessage(err instanceof Error ? err.message : String(err));
        stopStopwatch();
        setPhase("FAILED");
      } finally {
        setIsBusy(false);
      }
      return;
    }

    // 🌐 Live Network Flow
    try {
      // Ensure on Polygon Amoy or Localhost N2
      const targetChainId = networkMode === "testnet" ? NETWORKS.amoy.chainIdDec : 31337;
      if (chainId !== targetChainId) {
        await switchNetwork("amoy");
      }

      const { browserProvider, signer } = await getBrowserSignerAndProvider();

      // Pre-flight check: ensure Verifier contract is deployed
      const verifierCode = await browserProvider.getCode(verifierAddress);
      if (!verifierCode || verifierCode === "0x" || verifierCode === "0x0") {
        throw new Error(
          `No Verifier contract found at ${verifierAddress} on Polygon Amoy. Please enable "Demo Simulation Mode" or configure the address in Settings.`
        );
      }

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

      const elapsed = startTimeRef.current ? Number(((Date.now() - startTimeRef.current) / 1000).toFixed(1)) : 2.5;
      if (activeTxId) {
        const updated = updateTransaction(activeTxId, {
          status: "minted",
          destTxHash: receipt.hash,
          elapsedSec: elapsed,
        });
        setTransactions(updated);
      }

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
      if (activeTxId) {
        const updated = updateTransaction(activeTxId, { status: "failed" });
        setTransactions(updated);
      }
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
    setActiveTxId(null);
  };

  const logoutWallet = () => {
    sessionStorage.setItem("wallet_disconnected", "true");
    setAccount("");
    setChainId(null);
    setPhase("CONNECT");
    setRecipient("");
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
              <h1 className="brand-title">CryptoXchange</h1>
              <span className="brand-badge">User-Mediated</span>
            </div>
            <p className="brand-subtitle">
              Decentralized Cross-Chain Transaction Verification · No Relayers · Zero Coordinator Chain
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Mode Switcher: Live vs Demo Simulation */}
          <div style={{ display: "flex", background: "rgba(0,0,0,0.3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", padding: "2px" }}>
            <button
              type="button"
              className={`btn ${!isDemoMode ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "5px 12px", fontSize: "11px", border: "none" }}
              onClick={() => setIsDemoMode(false)}
              title="Live on-chain interactions with MetaMask transactions"
            >
              🌐 Live On-Chain
            </button>
            <button
              type="button"
              className={`btn ${isDemoMode ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "5px 12px", fontSize: "11px", border: "none", gap: "4px" }}
              onClick={() => setIsDemoMode(true)}
              title="Instant cryptographic demo with zero gas needed"
            >
              <Sparkles size={12} />
              Demo Simulation
            </button>
          </div>

          {account ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                className={`badge ${chainInfo.isPolygon ? "badge-amoy" : "badge-sepolia"}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  borderColor: chainInfo.color,
                  boxShadow: `0 0 12px ${chainInfo.color}33`,
                  background: chainInfo.isPolygon
                    ? "rgba(176, 116, 159, 0.25)"
                    : chainInfo.isEthereum
                    ? "rgba(216, 97, 60, 0.25)"
                    : "rgba(255, 255, 255, 0.08)",
                  fontWeight: "700",
                }}
              >
                <span style={{ fontSize: "13px" }}>{chainInfo.icon}</span>
                <span>{chainInfo.name}</span>
              </span>
              <div className="badge mono" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-subtle)" }}>
                {account.slice(0, 6)}...{account.slice(-4)}
              </div>
              <button
                className="btn btn-danger"
                style={{ padding: "6px 12px", fontSize: "12px", gap: "6px" }}
                onClick={logoutWallet}
                title="Disconnect MetaMask Wallet"
              >
                <LogOut size={13} />
                Logout
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={connectWallet} disabled={isConnecting}>
              {isConnecting ? "Connecting..." : "Connect MetaMask"}
            </button>
          )}

          <button
            className="btn btn-secondary"
            style={{ padding: "8px 12px", position: "relative" }}
            onClick={() => setShowHistory(true)}
            title="Transaction History & Cryptographic Proof Explorer"
          >
            <History size={18} />
            {transactions.length > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: "-4px",
                  right: "-4px",
                  background: "var(--terracotta-500)",
                  color: "#fff",
                  fontSize: "10px",
                  fontWeight: "800",
                  borderRadius: "10px",
                  minWidth: "18px",
                  height: "18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 4px",
                  boxShadow: "0 0 8px rgba(216, 97, 60, 0.6)",
                }}
              >
                {transactions.length}
              </span>
            )}
          </button>

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

      {/* ── Demo Mode Active Indicator Banner ────────────────────────────────── */}
      {isDemoMode && (
        <div style={{ background: "rgba(176, 116, 159, 0.15)", border: "1px solid var(--mauve-500)", borderRadius: "var(--radius-md)", padding: "10px 16px", marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Sparkles size={16} style={{ color: "var(--mauve-300)" }} />
            <span style={{ fontSize: "13px", color: "var(--mauve-100)" }}>
              <strong>Demo Simulation Mode Active:</strong> Generates real cryptographic depth-8 Merkle proofs off-chain with simulated latency. Zero testnet gas or contract deployment required!
            </span>
          </div>
          <button
            className="btn btn-secondary"
            style={{ padding: "4px 10px", fontSize: "11px" }}
            onClick={() => setIsDemoMode(false)}
          >
            Switch to Live On-Chain
          </button>
        </div>
      )}

      {/* ── Collapsible Configuration Drawer ─────────────────────────────────── */}
      {showConfig && (
        <div className="benchmark-card" style={{ marginBottom: "24px", borderColor: "var(--mauve-600)", background: "rgba(18, 8, 21, 0.95)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
                <Settings size={18} style={{ color: "var(--terracotta-400)" }} />
                Developer & Smart Contract Settings
              </h3>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                These are the on-chain smart contract addresses power the cross-chain bridge. You <strong>do not need to change these</strong> unless you deployed your own contracts.
              </p>
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <div style={{ display: "flex", background: "rgba(0,0,0,0.3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", padding: "2px" }}>
                <button
                  type="button"
                  className={`btn ${networkMode === "testnet" ? "btn-primary" : "btn-secondary"}`}
                  style={{ padding: "5px 12px", fontSize: "11px", border: "none" }}
                  onClick={() => setNetworkMode("testnet")}
                >
                  Sepolia / Amoy Testnet
                </button>
                <button
                  type="button"
                  className={`btn ${networkMode === "local" ? "btn-primary" : "btn-secondary"}`}
                  style={{ padding: "5px 12px", fontSize: "11px", border: "none" }}
                  onClick={() => setNetworkMode("local")}
                >
                  Local Hardhat Nodes
                </button>
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "5px 10px", fontSize: "11px" }}
                onClick={() => setShowConfig(false)}
              >
                Close ✕
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginTop: "16px" }}>
            <div style={{ background: "rgba(0,0,0,0.25)", padding: "12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label className="input-label" style={{ marginBottom: 0, fontWeight: "700", color: "var(--terracotta-300)" }}>
                  🔷 N1 Router Contract (Sepolia)
                </label>
                <span className="badge badge-sepolia" style={{ fontSize: "10px" }}>Source Chain</span>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", lineHeight: 1.4 }}>
                Locks native ETH into a vault and appends the transaction leaf into the on-chain Merkle tree.
              </p>
              <input
                className="input-field mono"
                style={{ fontSize: "11px" }}
                value={routerAddress}
                onChange={(e) => setRouterAddress(e.target.value)}
                placeholder="0x..."
              />
            </div>

            <div style={{ background: "rgba(0,0,0,0.25)", padding: "12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label className="input-label" style={{ marginBottom: 0, fontWeight: "700", color: "var(--mauve-300)" }}>
                  🟣 N2 Verifier Contract (Amoy)
                </label>
                <span className="badge badge-amoy" style={{ fontSize: "10px" }}>Destination Chain</span>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", lineHeight: 1.4 }}>
                Verifies the 8-depth Merkle proof submitted by your browser and authorizes the token minting.
              </p>
              <input
                className="input-field mono"
                style={{ fontSize: "11px" }}
                value={verifierAddress}
                onChange={(e) => setVerifierAddress(e.target.value)}
                placeholder="0x..."
              />
            </div>

            <div style={{ background: "rgba(0,0,0,0.25)", padding: "12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label className="input-label" style={{ marginBottom: 0, fontWeight: "700", color: "var(--mauve-200)" }}>
                  🪙 WrappedDemo Token (wDEMO)
                </label>
                <span className="badge" style={{ fontSize: "10px", background: "rgba(255,255,255,0.08)" }}>ERC-20</span>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", lineHeight: 1.4 }}>
                The synthetic bridged token on Polygon Amoy minted directly to your destination recipient address.
              </p>
              <input
                className="input-field mono"
                style={{ fontSize: "11px" }}
                value={wrappedDemoAddress}
                onChange={(e) => setWrappedDemoAddress(e.target.value)}
                placeholder="0x..."
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Benchmark Stopwatch & Comparison Banner ──────────────────────────── */}
      <div className="benchmark-card glow-terracotta">
        <div className="benchmark-header">
          <div className="benchmark-title">
            <Zap size={16} style={{ color: "var(--terracotta-400)" }} />
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
              {timerRunning && <span style={{ color: "var(--terracotta-400)", fontWeight: "bold" }}>● LIVE</span>}
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

      {/* ── MetaMask Token Portfolio Bar ───────────────────────────────────────── */}
      {account && (
        <div className="token-portfolio-bar">
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Wallet size={16} style={{ color: "var(--terracotta-400)" }} />
              <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--mauve-200)" }}>
                MetaMask Assets:
              </span>
            </div>

            <div className="token-list">
              {/* Connected Active Chain Asset */}
              <div
                className={`token-chip ${selectedToken === chainInfo.symbol ? "active" : ""}`}
                onClick={() => setSelectedToken(chainInfo.symbol)}
                title={`Active balance on ${chainInfo.name}`}
              >
                <span>{chainInfo.icon}</span>
                <span className="token-chip-symbol">{chainInfo.name}:</span>
                <span className="token-chip-balance">{connectedNativeBalance} {chainInfo.symbol}</span>
              </div>

              {/* Sepolia ETH (if active network is not Sepolia) */}
              {chainId !== NETWORKS.sepolia.chainIdDec && (
                <div
                  className={`token-chip ${selectedToken === "ETH" ? "active" : ""}`}
                  onClick={() => setSelectedToken("ETH")}
                  title="Sepolia ETH"
                >
                  <span>🔷</span>
                  <span className="token-chip-symbol">Sepolia ETH:</span>
                  <span className="token-chip-balance">{nativeBalance} ETH</span>
                </div>
              )}

              {/* Amoy wDEMO */}
              <div
                className={`token-chip ${selectedToken === "wDEMO" ? "active" : ""}`}
                onClick={() => setSelectedToken("wDEMO")}
                title="Amoy wDEMO"
              >
                <span>🟣</span>
                <span className="token-chip-symbol">Amoy wDEMO:</span>
                <span className="token-chip-balance">{wDemoTokenBalance} wDEMO</span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              className="btn-import-token"
              onClick={importWDEMOToMetaMask}
              title="Add wDEMO token into your MetaMask extension"
            >
              {tokenImported ? <Check size={13} color="#34d399" /> : <Plus size={13} />}
              {tokenImported ? "Added to MetaMask!" : "Add wDEMO to MetaMask"}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "6px 10px" }}
              onClick={() => fetchBalances()}
              disabled={isRefreshingBalances}
              title="Refresh balances from MetaMask"
            >
              <RefreshCw size={13} className={isRefreshingBalances ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      )}

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
              <span
                className={`badge ${chainInfo.isPolygon ? "badge-amoy" : "badge-sepolia"}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  borderColor: chainInfo.color,
                  fontWeight: "700",
                }}
              >
                <span>{chainInfo.icon}</span>
                <span>Active: {chainInfo.name}</span>
              </span>
            </div>

            {chainInfo.isPolygon && (
              <div style={{ background: "rgba(176, 116, 159, 0.15)", border: "1px solid var(--mauve-500)", borderRadius: "var(--radius-md)", padding: "10px 16px", marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                <span style={{ fontSize: "13px", color: "var(--mauve-100)" }}>
                  🟣 <strong>{chainInfo.name} Active in MetaMask:</strong> You are currently on Polygon ({connectedNativeBalance} {chainInfo.symbol}). When ready to initiate a cross-chain lock on Sepolia, click Switch to Sepolia or use Demo Simulation.
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "4px 10px", fontSize: "11px" }}
                  onClick={() => switchNetwork("sepolia")}
                >
                  Switch to Sepolia ➔
                </button>
              </div>
            )}

            {/* Token Selector & Asset Balance Selection */}
            <div style={{ marginBottom: "20px" }}>
              <label className="input-label">Select Asset to Lock & Bridge</label>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                {/* Active Connected Token Chip */}
                {chainInfo.symbol !== "ETH" && (
                  <div
                    className={`token-chip ${selectedToken === chainInfo.symbol ? "active" : ""}`}
                    onClick={() => setSelectedToken(chainInfo.symbol)}
                  >
                    <span>{chainInfo.icon}</span>
                    <span className="token-chip-symbol">{chainInfo.symbol} ({chainInfo.name})</span>
                    <span className="token-chip-balance">{connectedNativeBalance} {chainInfo.symbol}</span>
                  </div>
                )}

                <div
                  className={`token-chip ${selectedToken === "ETH" ? "active" : ""}`}
                  onClick={() => setSelectedToken("ETH")}
                >
                  <span>🔷</span>
                  <span className="token-chip-symbol">ETH (Sepolia Native)</span>
                  <span className="token-chip-balance">{nativeBalance} ETH</span>
                </div>

                <div
                  className={`token-chip ${selectedToken === "wDEMO" ? "active" : ""}`}
                  onClick={() => setSelectedToken("wDEMO")}
                >
                  <span>🟣</span>
                  <span className="token-chip-symbol">wDEMO (Polygon Amoy)</span>
                  <span className="token-chip-balance">{wDemoTokenBalance} wDEMO</span>
                </div>

                <button
                  type="button"
                  className="btn-import-token"
                  onClick={importWDEMOToMetaMask}
                  title="Add wDEMO token into your MetaMask wallet"
                >
                  {tokenImported ? <Check size={12} color="#34d399" /> : <Plus size={12} />}
                  {tokenImported ? "Added to MetaMask!" : "Add wDEMO to MetaMask"}
                </button>
              </div>
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <label className="input-label" style={{ marginBottom: 0 }}>
                    Lock Value ({selectedToken})
                  </label>
                  <span style={{ fontSize: "12px", color: "var(--mauve-300)" }}>
                    Available: <span className="mono" style={{ color: "var(--terracotta-300)" }}>{selectedToken === "ETH" ? nativeBalance : wDemoTokenBalance} {selectedToken}</span>
                  </span>
                </div>
                <div className="input-wrapper">
                  <input
                    type="number"
                    step="0.0001"
                    className="input-field mono"
                    value={amountEth}
                    onChange={(e) => setAmountEth(e.target.value)}
                  />
                  <button type="button" className="btn-max" onClick={handleMax}>
                    MAX
                  </button>
                </div>
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

        {/* State 3: Direct Live Merkle Tree Visualizer & Phase 2 Actions */}
        {(phase === "PHASE1_CONFIRMING" || phase === "PHASE1_PROOF" || phase === "PHASE2_SWITCH") && proofResult && submitResult && (
          <div>
            {/* Live Block Confirmation Banner */}
            <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "16px 20px", marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div className="brand-icon animate-pulse-glow" style={{ width: "36px", height: "36px", fontSize: "16px" }}>
                    <Clock size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)" }}>
                      Sepolia Block #{submitResult.blockNumber} Finality
                    </div>
                    <div className="mono" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                      Tx:{" "}
                      <a
                        href={`${NETWORKS.sepolia.blockExplorerUrl}/tx/${submitResult.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="explorer-link"
                      >
                        {submitResult.txHash.slice(0, 14)}...{submitResult.txHash.slice(-8)}
                        <ExternalLink size={10} />
                      </a>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span className="mono" style={{ fontSize: "13px", fontWeight: "700", color: "var(--terracotta-400)" }}>
                    {currentConfirmations} / {targetConfirmations} Confirmations
                  </span>
                  <span className="badge badge-success">✓ On-Chain Lock</span>
                </div>
              </div>

              <div className="progress-bar-bg" style={{ height: "6px" }}>
                <div
                  className="progress-bar-fill"
                  style={{ width: `${Math.min(100, (currentConfirmations / targetConfirmations) * 100)}%` }}
                />
              </div>
            </div>

            {/* Direct Step-by-Step Merkle Tree Visualizer Hero */}
            <div style={{ marginBottom: "20px" }}>
              <MerkleTreeVisualizer
                root={proofResult.header.root}
                leaf={submitResult.leaf}
                proof={proofResult.proof}
                requestId={submitResult.id}
                isInline={true}
                autoAnimate={true}
              />
            </div>

            {/* Action Bar: Network Switch / Submit to Polygon Amoy */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "24px", flexWrap: "wrap", gap: "14px" }}>
              <div>
                {chainId !== NETWORKS.amoy.chainIdDec && (
                  <span style={{ fontSize: "13px", color: "var(--terracotta-400)" }}>
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

            <div style={{ display: "flex", justifyContent: "center", gap: "12px", flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={resetFlow}>
                <RotateCcw size={16} /> Execute Another Transfer
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setShowHistory(true)}
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <History size={16} /> View in Proof Explorer
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
              {errorMessage?.includes("No Router") || errorMessage?.includes("bytecode") || errorMessage?.includes("No RequestCreated")
                ? "Contract Not Deployed on This Network"
                : "Transaction Issue Detected"}
            </h2>

            {/* Diagnostic Message Box */}
            <div style={{ color: "var(--text-secondary)", fontSize: "14px", maxWidth: "600px", margin: "0 auto 24px auto", background: "rgba(0,0,0,0.3)", padding: "16px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", textAlign: "left" }}>
              <div style={{ fontWeight: "700", color: "#fca5a5", marginBottom: "6px" }}>Diagnostic Details:</div>
              <div className="mono" style={{ fontSize: "12px", color: "var(--text-muted)", wordBreak: "break-word", lineHeight: 1.5 }}>
                {errorMessage || "An unexpected error occurred during execution."}
              </div>
              <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: "13px", color: "var(--mauve-200)" }}>
                💡 <strong>Instant Solution:</strong> Click <strong>"Switch to Demo Simulation Mode"</strong> below to execute the complete cryptographic cross-chain transfer (Merkle proof generation + verification) instantly with zero gas!
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: "12px", flexWrap: "wrap" }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setIsDemoMode(true);
                  resetFlow();
                }}
              >
                <Sparkles size={16} />
                Switch to Demo Simulation Mode & Run
              </button>
              {submitResult && (
                <button className="btn btn-danger" onClick={handleReclaim} disabled={isBusy}>
                  <RotateCcw size={16} />
                  {isBusy ? "Reclaiming..." : "Reclaim Locked ETH (Sepolia)"}
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => setShowConfig(true)}
              >
                <Settings size={16} />
                Configure Contracts
              </button>
              <button className="btn btn-secondary" onClick={resetFlow}>
                Restart Flow
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Transaction History & Proof Explorer Modal ──────────────────────── */}
      <TransactionHistoryModal
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        transactions={transactions}
        onTransactionsChange={setTransactions}
        onTriggerDemo={() => {
          setIsDemoMode(true);
          resetFlow();
        }}
      />

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer style={{ marginTop: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
        <p>CryptoXchange · OpenZeppelin Incremental MerkleTree ^5.1 · Ethers v6 · User-Mediated Verification Demo</p>
      </footer>
    </div>
  );
}
