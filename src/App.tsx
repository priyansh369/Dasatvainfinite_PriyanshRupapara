import React, { useState, useEffect, useRef, useMemo } from "react";
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
  ArrowUpDown,
  TrendingUp,
  Volume2,
  VolumeX,
  User,
  Code,
} from "lucide-react";

import {
  submitRequest,
  waitForConfirmations,
  buildProof,
  submitToVerifier,
  reclaimRequest,
  buildDemoProof,
  parseContractError,
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
import ToastContainer, { ToastItem } from "./components/ToastContainer";
import VaultsModal from "./components/VaultsModal";
import { fireConfetti } from "./lib/confetti";
import {
  playClickSound,
  playProofSound,
  playSuccessSound,
  isSoundEnabled,
  setSoundEnabled,
} from "./lib/sound";
import {
  BridgeTransaction,
  loadTransactions,
  saveTransaction,
  updateTransaction,
} from "./types/history";

// ── Multi-Currency Crypto Exchange Model (e.g. 1 USD = 94.95 INR) ───────────
export interface SupportedCurrency {
  code: string;
  name: string;
  symbol: string;
  icon: string;
  usdRate: number; // USD value per 1 unit of this currency
}

export const SUPPORTED_CURRENCIES: Record<string, SupportedCurrency> = {
  USD: { code: "USD", name: "US Dollar", symbol: "$", icon: "💵", usdRate: 1.0 },
  INR: { code: "INR", name: "Indian Rupee", symbol: "₹", icon: "🇮🇳", usdRate: 1 / 94.95 },
  USDT: { code: "USDT", name: "Tether USD", symbol: "USDT", icon: "🟢", usdRate: 1.0 },
  ETH: { code: "ETH", name: "Ethereum", symbol: "ETH", icon: "🔷", usdRate: 2650.0 },
  POL: { code: "POL", name: "Polygon", symbol: "POL", icon: "🟣", usdRate: 0.36 },
  wDEMO: { code: "wDEMO", name: "Wrapped Demo", symbol: "wDEMO", icon: "🪙", usdRate: 1.0 },
};

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
  const [showProofDetails, setShowProofDetails] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [networkMode, setNetworkMode] = useState<"testnet" | "local">("testnet");
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [showBenchmark, setShowBenchmark] = useState<boolean>(false);
  const [useSelfRecipient, setUseSelfRecipient] = useState<boolean>(true);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [showVaultsModal, setShowVaultsModal] = useState<boolean>(false);
  const [showRouteDetails, setShowRouteDetails] = useState<boolean>(false);
  const [sepoliaVaultBalance, setSepoliaVaultBalance] = useState<string>("0.0977");
  const [amoyVaultBalance, setAmoyVaultBalance] = useState<string>("0.5240");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [transactions, setTransactions] = useState<BridgeTransaction[]>(() => loadTransactions());
  const [activeTxId, setActiveTxId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => isSoundEnabled());
  const [uiMode, setUiMode] = useState<"simple" | "pro">("simple");

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabledState(next);
    setSoundEnabled(next);
    if (next) playClickSound();
  };

  // ── Currency Exchange Engine State ─────────────────────────────────────────
  const [sendCurrency, setSendCurrency] = useState<string>("ETH");
  const [receiveCurrency, setReceiveCurrency] = useState<string>("POL");
  const [exchangeAmount, setExchangeAmount] = useState<string>("0.001");

  // Calculate live receive amount strictly matching on-chain cryptographic settlement
  const calculateReceiveAmount = (
    amountStr: string,
    fromCode: string,
    toCode: string
  ): string => {
    const val = parseFloat(amountStr);
    if (isNaN(val) || val <= 0) return "0.0000";

    // Cross-chain settlement for native testnet assets
    if (
      (fromCode === "ETH" && toCode === "POL") ||
      (fromCode === "POL" && toCode === "ETH") ||
      fromCode === toCode
    ) {
      return amountStr;
    }

    // For fiat-based currency conversions
    const fromRate = SUPPORTED_CURRENCIES[fromCode]?.usdRate || 1.0;
    const toRate = SUPPORTED_CURRENCIES[toCode]?.usdRate || 1.0;
    const converted = (val * fromRate) / toRate;
    if (converted >= 100) return converted.toFixed(2);
    if (converted >= 1) return converted.toFixed(4);
    return converted.toFixed(6);
  };

  const receiveAmount = calculateReceiveAmount(exchangeAmount, sendCurrency, receiveCurrency);

  const exchangeRateString = useMemo(() => {
    if (
      (sendCurrency === "ETH" && receiveCurrency === "POL") ||
      (sendCurrency === "POL" && receiveCurrency === "ETH")
    ) {
      return `1 ${sendCurrency} = 1 ${receiveCurrency} (Direct Bridge)`;
    }
    const fromRate = SUPPORTED_CURRENCIES[sendCurrency]?.usdRate || 1.0;
    const toRate = SUPPORTED_CURRENCIES[receiveCurrency]?.usdRate || 1.0;
    const rate = fromRate / toRate;
    if (rate >= 1) {
      return `1 ${sendCurrency} = ${rate.toFixed(2)} ${receiveCurrency}`;
    } else {
      return `1 ${sendCurrency} = ${rate.toFixed(4)} ${receiveCurrency}`;
    }
  }, [sendCurrency, receiveCurrency]);

  const handleInvertCurrencies = () => {
    playClickSound();
    const oldSend = sendCurrency;
    const oldRecv = receiveCurrency;
    setSendCurrency(oldRecv);
    setReceiveCurrency(oldSend);
    setExchangeAmount(exchangeAmount || "0.001");
    setTransferDirection((prev) => (prev === "sepolia-to-amoy" ? "amoy-to-sepolia" : "sepolia-to-amoy"));
  };

  // ── Unread History Notifications (Clears when user views logs) ───────────
  const [lastSeenTxCount, setLastSeenTxCount] = useState<number>(() => {
    try {
      return parseInt(localStorage.getItem("cryptoxchange_last_seen_tx_count") || "0", 10);
    } catch {
      return 0;
    }
  });

  const unreadCount = Math.max(0, transactions.length - lastSeenTxCount);

  const openHistoryModal = () => {
    setShowHistory(true);
    setLastSeenTxCount(transactions.length);
    try {
      localStorage.setItem("cryptoxchange_last_seen_tx_count", transactions.length.toString());
    } catch {
      // ignore
    }
  };

  const HARDHAT_DEFAULT = "0x5FbDB2315678afecb367f032d93F642f64180aa3".toLowerCase();

  // Live RealCrossChainBridge contract addresses
  const [routerAddress, setRouterAddress] = useState<string>(DEFAULT_CONTRACTS.sepolia.realBridge);
  const [verifierAddress, setVerifierAddress] = useState<string>(DEFAULT_CONTRACTS.amoy.realBridge);
  const [wrappedDemoAddress, setWrappedDemoAddress] = useState<string>(DEFAULT_CONTRACTS.amoy.wrappedDemo);

  // ── Explicit Transfer Direction State (Never mutated by MetaMask network switches!) ──
  const [transferDirection, setTransferDirection] = useState<"sepolia-to-amoy" | "amoy-to-sepolia">("sepolia-to-amoy");
  const isAmoyToSepolia = transferDirection === "amoy-to-sepolia";

  // Active Route Snapshot (Locked when transfer begins in Phase 1)
  const [activeTransferRoute, setActiveTransferRoute] = useState<{
    sourceNetworkKey: "sepolia" | "amoy";
    destNetworkKey: "sepolia" | "amoy";
    sourceBridge: string;
    destBridge: string;
    isAmoyToSepolia: boolean;
  } | null>(null);

  // Auto-clean any stale hardhat address from browser cache
  useEffect(() => {
    if (routerAddress.toLowerCase() === HARDHAT_DEFAULT) {
      setRouterAddress(DEFAULT_CONTRACTS.sepolia.realBridge);
    }
    if (verifierAddress.toLowerCase() === HARDHAT_DEFAULT) {
      setVerifierAddress(DEFAULT_CONTRACTS.amoy.realBridge);
    }
  }, [routerAddress, verifierAddress]);

  // Auto-recover from stale error screen
  useEffect(() => {
    if (errorMessage && errorMessage.includes("0x5FbDB")) {
      setErrorMessage("");
      setPhase("PHASE1_FORM");
      setRouterAddress(DEFAULT_CONTRACTS.sepolia.realBridge);
      setVerifierAddress(DEFAULT_CONTRACTS.amoy.realBridge);
    }
  }, [errorMessage]);

  const sourceNetworkKey: "sepolia" | "amoy" = isAmoyToSepolia ? "amoy" : "sepolia";
  const destNetworkKey: "sepolia" | "amoy"   = isAmoyToSepolia ? "sepolia" : "amoy";

  const sourceNetwork = NETWORKS[sourceNetworkKey];
  const destNetwork   = NETWORKS[destNetworkKey];

  const currentSourceBridgeAddress = useMemo(() => {
    const defaultAddr = isAmoyToSepolia ? DEFAULT_CONTRACTS.amoy.realBridge : DEFAULT_CONTRACTS.sepolia.realBridge;
    if (!routerAddress || routerAddress.toLowerCase() === HARDHAT_DEFAULT) {
      return defaultAddr;
    }
    return isAmoyToSepolia ? (DEFAULT_CONTRACTS.amoy.realBridge || routerAddress) : routerAddress;
  }, [isAmoyToSepolia, routerAddress]);

  const currentDestBridgeAddress = useMemo(() => {
    const defaultAddr = isAmoyToSepolia ? DEFAULT_CONTRACTS.sepolia.realBridge : DEFAULT_CONTRACTS.amoy.realBridge;
    if (!verifierAddress || verifierAddress.toLowerCase() === HARDHAT_DEFAULT) {
      return defaultAddr;
    }
    return isAmoyToSepolia ? (DEFAULT_CONTRACTS.sepolia.realBridge || verifierAddress) : verifierAddress;
  }, [isAmoyToSepolia, verifierAddress]);

  // Dynamic presets based on currency
  const presets = useMemo(() => {
    if (sendCurrency === "ETH" || sendCurrency === "POL") {
      return ["0.001", "0.002", "0.005", "0.01"];
    }
    if (sendCurrency === "INR") {
      return ["50", "100", "500", "1000"];
    }
    return ["1", "5", "10", "20"];
  }, [sendCurrency]);

  const selectSendCurrency = (code: string) => {
    playClickSound();
    setSendCurrency(code);
    if (code === "ETH") {
      setTransferDirection("sepolia-to-amoy");
      setReceiveCurrency("POL");
      setExchangeAmount("0.001");
    } else if (code === "POL") {
      setTransferDirection("amoy-to-sepolia");
      setReceiveCurrency("ETH");
      setExchangeAmount("0.001");
    } else if (code === "INR") {
      setExchangeAmount("100");
    } else {
      setExchangeAmount("1");
    }
  };

  const effectiveAmount = useMemo(() => {
    if (sendCurrency === "ETH" || sendCurrency === "POL") {
      return exchangeAmount || "0.001";
    }
    const rate = isAmoyToSepolia ? 0.36 : 2650;
    const val = parseFloat(exchangeAmount || "0") / rate;
    return (Math.max(0.0001, val)).toFixed(6);
  }, [sendCurrency, exchangeAmount, isAmoyToSepolia]);

  // ── Token & Wallet Balances State ─────────────────────────────────────────
  const [connectedNativeBalance, setConnectedNativeBalance] = useState<string>("0.000");
  const [nativeBalance, setNativeBalance] = useState<string>("0.000");
  const [wDemoTokenBalance, setWDemoTokenBalance] = useState<string>("0.000");
  const [selectedToken, setSelectedToken] = useState<string>("ETH");
  const [isRefreshingBalances, setIsRefreshingBalances] = useState<boolean>(false);
  const [tokenImported, setTokenImported] = useState<boolean>(false);

  const currentSourceBalance = isAmoyToSepolia ? connectedNativeBalance : nativeBalance;
  const isBalanceInsufficient = Boolean(
    account &&
    !isDemoMode &&
    parseFloat(currentSourceBalance) > 0 &&
    parseFloat(effectiveAmount) > parseFloat(currentSourceBalance)
  );

  const targetSourceChainId = networkMode === "testnet" ? sourceNetwork.chainIdDec : 31337;
  const isWrongChain = chainId !== targetSourceChainId;

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

  // Resilient multi-endpoint read provider for Sepolia (N1) with automatic fallback
  const getN1Provider = (): ethers.Provider => {
    if (window.ethereum && chainId === NETWORKS.sepolia.chainIdDec) {
      try {
        return new ethers.BrowserProvider(window.ethereum);
      } catch { /* fallback to RPC pool */ }
    }
    const net = NETWORKS.sepolia;
    const urls = networkMode === "testnet" ? net.rpcUrls : NETWORKS.localN1.rpcUrls;
    const providers = urls.map(
      (url) => new ethers.JsonRpcProvider(url, undefined, { staticNetwork: ethers.Network.from(net.chainIdDec) })
    );
    if (providers.length === 1) return providers[0];
    return new ethers.FallbackProvider(
      providers.map((p, i) => ({ provider: p, priority: i + 1, weight: 1, stallTimeout: 2500 })),
      1
    );
  };

  // Resilient multi-endpoint read provider for Polygon Amoy (N2) with automatic fallback
  const getN2Provider = (): ethers.Provider => {
    if (window.ethereum && chainId === NETWORKS.amoy.chainIdDec) {
      try {
        return new ethers.BrowserProvider(window.ethereum);
      } catch { /* fallback to RPC pool */ }
    }
    const net = NETWORKS.amoy;
    const urls = networkMode === "testnet" ? net.rpcUrls : NETWORKS.localN2.rpcUrls;
    const providers = urls.map(
      (url) => new ethers.JsonRpcProvider(url, undefined, { staticNetwork: ethers.Network.from(net.chainIdDec) })
    );
    if (providers.length === 1) return providers[0];
    return new ethers.FallbackProvider(
      providers.map((p, i) => ({ provider: p, priority: i + 1, weight: 1, stallTimeout: 2500 })),
      1
    );
  };

  // In-App Toast Notification Trigger
  const showToast = (
    type: "success" | "error" | "info" | "warning",
    title: string,
    message?: string,
    link?: { url: string; label: string }
  ) => {
    const id = Date.now().toString() + Math.random().toString().slice(2, 6);
    setToasts((prev) => [...prev, { id, type, title, message, link }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  // Fetch Live Liquidity Vault Balances
  const fetchVaultBalances = async () => {
    try {
      const n1 = getN1Provider();
      const sBal = await n1.getBalance(DEFAULT_CONTRACTS.sepolia.realBridge);
      setSepoliaVaultBalance(parseFloat(ethers.formatEther(sBal)).toFixed(4));
    } catch { /* retain existing */ }

    try {
      const n2 = getN2Provider();
      const aBal = await n2.getBalance(DEFAULT_CONTRACTS.amoy.realBridge);
      setAmoyVaultBalance(parseFloat(ethers.formatEther(aBal)).toFixed(4));
    } catch { /* retain existing */ }
  };

  // ── Fetch Token Balances from MetaMask ───────────────────────────────────
  const fetchBalances = async (accountAddr?: string) => {
    const targetAddr = accountAddr || account;
    if (!targetAddr) return;
    setIsRefreshingBalances(true);

    try {
      fetchVaultBalances();
    } catch { /* ignore */ }

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
      setErrorMessage(parseContractError(err));
    }
  };

  const handleMax = () => {
    if (sendCurrency === "ETH") {
      const maxVal = Math.min(0.02, Math.max(0, parseFloat(nativeBalance) - 0.002));
      setExchangeAmount(maxVal > 0 ? maxVal.toFixed(4) : "0.001");
    } else if (sendCurrency === "POL") {
      const maxVal = Math.min(0.02, Math.max(0, parseFloat(connectedNativeBalance) - 0.002));
      setExchangeAmount(maxVal > 0 ? maxVal.toFixed(4) : "0.005");
    } else if (sendCurrency === "wDEMO") {
      setExchangeAmount(wDemoTokenBalance);
    } else if (sendCurrency === "USD") {
      setExchangeAmount("10");
    } else if (sendCurrency === "INR") {
      setExchangeAmount("500");
    } else {
      setExchangeAmount("1");
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
      setErrorMessage(parseContractError(err));
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
          setErrorMessage(parseContractError(addError));
        }
      } else {
        setErrorMessage(parseContractError(switchError));
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
        const demo = buildDemoProof(account, recipient || account, effectiveAmount);
        const txId = `demo-${Date.now()}`;
        setActiveTxId(txId);
        setSubmitResult(demo.submitResult);
        setProofResult({ proof: demo.proof, header: demo.header, request: demo.request });
        setCurrentConfirmations(1);

        // Record in transaction history with currency exchange values
        const newTx: BridgeTransaction = {
          id: txId,
          timestamp: Date.now(),
          status: "locked",
          isDemo: true,
          amount: exchangeAmount,
          token: sendCurrency,
          receiveAmount: receiveAmount,
          receiveToken: receiveCurrency,
          exchangeRate: exchangeRateString,
          recipient: recipient || account,
          sender: account,
          sourceChain: {
            id: sourceNetwork.chainIdDec,
            name: sourceNetwork.name,
            symbol: sourceNetwork.symbol,
            icon: sourceNetwork.icon,
          },
          destChain: {
            id: destNetwork.chainIdDec,
            name: destNetwork.name,
            symbol: destNetwork.symbol,
            icon: destNetwork.icon,
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
        playProofSound();
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
      // Ensure connected on source network
      const targetChainId = networkMode === "testnet" ? sourceNetwork.chainIdDec : 31337;
      if (chainId !== targetChainId) {
        await switchNetwork(sourceNetworkKey);
        setIsBusy(false);
        return;
      }

      startStopwatch();

      // Snapshot active route so Phase 2 is 100% resilient to network switches & state changes
      const currentRoute = {
        sourceNetworkKey,
        destNetworkKey,
        sourceBridge: currentSourceBridgeAddress,
        destBridge: currentDestBridgeAddress,
        isAmoyToSepolia,
      };
      setActiveTransferRoute(currentRoute);

      const { browserProvider, signer } = await getBrowserSignerAndProvider();

      // Pre-flight validation: check if contract is actually deployed
      const code = await browserProvider.getCode(currentSourceBridgeAddress);
      if (!code || code === "0x" || code === "0x0") {
        throw new Error(
          `No Bridge smart contract is deployed at ${currentSourceBridgeAddress} on ${sourceNetwork.name}.`
        );
      }

      const destProvider = isAmoyToSepolia ? getN1Provider() : getN2Provider();

      const config: CrossChainConfig = {
        routerAddress: currentSourceBridgeAddress,
        n1Provider: browserProvider,
        n1Signer: signer,
        verifierAddress: currentDestBridgeAddress,
        n2Provider: destProvider,
        n2Signer: signer,
      };

      // 1. Submit Request
      const sub = await submitRequest(config, recipient || account, effectiveAmount);
      setSubmitResult(sub);
      setCurrentConfirmations(1);

      // 2. Build proof off-chain using bounded block window
      const proof = await buildProof(config, sub.id, sub.blockNumber);
      setProofResult(proof);

      const txId = sub.id.toString();
      setActiveTxId(txId);

      // Record in transaction history with currency exchange values
      const newTx: BridgeTransaction = {
        id: txId,
        timestamp: Date.now(),
        status: "locked",
        isDemo: false,
        amount: exchangeAmount,
        token: sendCurrency,
        receiveAmount: receiveAmount,
        receiveToken: receiveCurrency,
        exchangeRate: exchangeRateString,
        recipient: recipient || account,
        sender: account,
        sourceChain: {
          id: sourceNetwork.chainIdDec,
          name: sourceNetwork.name,
          symbol: sourceNetwork.symbol,
          icon: sourceNetwork.icon,
        },
        destChain: {
          id: destNetwork.chainIdDec,
          name: destNetwork.name,
          symbol: destNetwork.symbol,
          icon: destNetwork.icon,
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
      playProofSound();
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
      setErrorMessage(parseContractError(err));
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
        setWDemoBalance(`${receiveAmount} ${receiveCurrency}`);
        stopStopwatch();

        const elapsed = startTimeRef.current ? Number(((Date.now() - startTimeRef.current) / 1000).toFixed(1)) : 1.4;
        if (activeTxId) {
          const updated = updateTransaction(activeTxId, {
            status: "minted",
            destTxHash: fakeAmoyTx,
            elapsedSec: elapsed,
            receiveAmount: receiveAmount,
            receiveToken: receiveCurrency,
            exchangeRate: exchangeRateString,
          });
          setTransactions(updated);
        }

        setPhase("SUCCESS");
        fireConfetti();
        playSuccessSound();
        showToast(
          "success",
          "Demo Simulation Completed!",
          `${receiveAmount} ${receiveCurrency} settled on Polygon Amoy (Zero Gas • 1.4s proof verified)`
        );
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
      const targetDestKey = activeTransferRoute?.destNetworkKey || destNetworkKey;
      const targetDestNetwork = NETWORKS[targetDestKey];
      const targetDestBridge = activeTransferRoute?.destBridge || currentDestBridgeAddress;
      const targetSourceBridge = activeTransferRoute?.sourceBridge || currentSourceBridgeAddress;
      const targetIsAmoyToSepolia = activeTransferRoute ? activeTransferRoute.isAmoyToSepolia : isAmoyToSepolia;

      // Ensure on destination network
      const targetChainId = networkMode === "testnet" ? targetDestNetwork.chainIdDec : 31337;
      if (chainId !== targetChainId) {
        await switchNetwork(targetDestKey);
        setIsBusy(false);
        return;
      }

      const { browserProvider, signer } = await getBrowserSignerAndProvider();
      const actualNet = await browserProvider.getNetwork();
      if (Number(actualNet.chainId) !== targetChainId) {
        await switchNetwork(targetDestKey);
        setIsBusy(false);
        return;
      }

      // Pre-flight check: ensure destination Bridge contract is deployed
      const verifierCode = await browserProvider.getCode(targetDestBridge);
      if (!verifierCode || verifierCode === "0x" || verifierCode === "0x0") {
        throw new Error(
          `No Bridge contract found at ${targetDestBridge} on ${targetDestNetwork.name}. Please ensure your wallet is connected to ${targetDestNetwork.name}.`
        );
      }

      const sourceProvider = targetIsAmoyToSepolia ? getN2Provider() : getN1Provider();

      const config: CrossChainConfig = {
        routerAddress: targetSourceBridge,
        n1Provider: sourceProvider,
        n1Signer: signer,
        verifierAddress: targetDestBridge,
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
          receiveAmount: receiveAmount,
          receiveToken: receiveCurrency,
          exchangeRate: exchangeRateString,
        });
        setTransactions(updated);
      }

      // Read updated real native balance on destination chain
      try {
        const bal = await browserProvider.getBalance(recipient || account);
        const payoutSymbol = isAmoyToSepolia ? "ETH" : "POL";
        setWDemoBalance(`${ethers.formatEther(bal).slice(0, 7)} ${payoutSymbol}`);
      } catch {
        setWDemoBalance(`${receiveAmount} ${receiveCurrency}`);
      }

      setPhase("SUCCESS");
      fireConfetti();
      playSuccessSound();
      showToast(
        "success",
        "Settlement Completed!",
        `${receiveAmount} ${receiveCurrency} disbursed to your wallet on ${targetDestNetwork.name}!`,
        {
          url: `${targetDestNetwork.explorerUrl}/tx/${receipt.hash}`,
          label: `View on ${targetDestNetwork.shortName} Explorer`,
        }
      );
    } catch (err: unknown) {
      if (activeTxId) {
        const updated = updateTransaction(activeTxId, { status: "failed" });
        setTransactions(updated);
      }
      setErrorMessage(parseContractError(err));
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
      if (isDemoMode) {
        if (activeTxId) {
          updateTransaction(activeTxId, { status: "reclaimed" });
          setTransactions(loadTransactions());
        }
        showToast("success", "Demo Refund Complete", "Funds successfully restored to your demo balance.");
        resetFlow();
        return;
      }

      const activeRoute = activeTransferRoute;
      const targetSourceKey = activeRoute ? activeRoute.sourceNetworkKey : sourceNetworkKey;
      const targetSourceNet = NETWORKS[targetSourceKey];
      const targetSourceBridge = activeRoute ? activeRoute.sourceBridge : currentSourceBridgeAddress;

      if (chainId !== targetSourceNet.chainIdDec) {
        await switchNetwork(targetSourceKey);
      }

      const { browserProvider, signer } = await getBrowserSignerAndProvider();
      const actualNet = await browserProvider.getNetwork();
      if (Number(actualNet.chainId) !== targetSourceNet.chainIdDec) {
        setErrorMessage(`Please switch your MetaMask network to ${targetSourceNet.name} to confirm the refund transaction.`);
        setIsBusy(false);
        return;
      }

      await reclaimRequest(targetSourceBridge, signer, submitResult.id);
      if (activeTxId) {
        updateTransaction(activeTxId, { status: "reclaimed" });
        setTransactions(loadTransactions());
      }
      showToast("success", "Locked Funds Reclaimed!", `Successfully refunded to your wallet on ${targetSourceNet.name}`);
      resetFlow();
      await fetchBalances();
    } catch (err: unknown) {
      setErrorMessage(parseContractError(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleHistoryReclaim = async (tx: BridgeTransaction) => {
    try {
      setIsBusy(true);
      setErrorMessage("");
      if (tx.isDemo) {
        updateTransaction(tx.id, { status: "reclaimed" });
        setTransactions(loadTransactions());
        showToast("success", "Demo Refund Complete", "Funds restored to demo account.");
        return;
      }

      const isAmoySource = tx.sourceChain.id === 80002;
      const targetKey: "sepolia" | "amoy" = isAmoySource ? "amoy" : "sepolia";
      const targetNet = NETWORKS[targetKey];
      const bridgeAddress = isAmoySource ? DEFAULT_CONTRACTS.amoy.realBridge : DEFAULT_CONTRACTS.sepolia.realBridge;

      if (chainId !== targetNet.chainIdDec) {
        await switchNetwork(targetKey);
      }

      const { browserProvider, signer } = await getBrowserSignerAndProvider();
      const actualNet = await browserProvider.getNetwork();
      if (Number(actualNet.chainId) !== targetNet.chainIdDec) {
        showToast("warning", "Network Switch Required", `Please switch MetaMask to ${targetNet.name} to reclaim this transaction.`);
        return;
      }

      const reqId = BigInt(tx.id.replace(/\D/g, "") || "0");
      await reclaimRequest(bridgeAddress, signer, reqId);
      updateTransaction(tx.id, { status: "reclaimed" });
      setTransactions(loadTransactions());
      showToast("success", "Locked Funds Reclaimed!", `Successfully refunded on ${targetNet.name}!`);
      await fetchBalances();
    } catch (err: unknown) {
      showToast("error", "Reclaim Notice", parseContractError(err));
    } finally {
      setIsBusy(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    showToast("info", "Copied to Clipboard", text.length > 28 ? `${text.slice(0, 16)}...` : text);
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
    setRouterAddress(DEFAULT_CONTRACTS.sepolia.realBridge);
    setVerifierAddress(DEFAULT_CONTRACTS.amoy.realBridge);
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
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h1 className="brand-title">VecnaBridge</h1>
              <span className="brand-badge">Protocol v2.0</span>
            </div>
            <p className="brand-subtitle">
              High-Speed Stateless Cross-Chain Liquidity · Sub-2s Finality · Zero Relayer Vulnerabilities
            </p>
          </div>
        </div>

        {/* ── Navigation Actions & Live Wallet Controls ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Quick Nav Links */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "rgba(176, 116, 159, 0.08)", padding: "3px 6px", borderRadius: "var(--radius-full)", border: "1px solid var(--border-subtle)" }}>
            <button
              type="button"
              className={`nav-link-btn ${phase !== "FAILED" ? "active" : ""}`}
              onClick={() => { if (phase === "SUCCESS" || phase === "FAILED") resetFlow(); }}
            >
              Bridge
            </button>
            <button
              type="button"
              className="nav-link-btn"
              onClick={openHistoryModal}
              title="Recent Bridge Transfers"
            >
              <History size={14} />
              <span>Activity</span>
              {unreadCount > 0 && (
                <span
                  style={{
                    background: "var(--terracotta-500)",
                    color: "#fff",
                    fontSize: "10px",
                    fontWeight: "800",
                    borderRadius: "10px",
                    minWidth: "16px",
                    height: "16px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 4px",
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              className={`nav-link-btn ${showBenchmark ? "active" : ""}`}
              onClick={() => setShowBenchmark(!showBenchmark)}
              title="Real-Time Finality vs Coordinator Baseline"
            >
              <Zap size={14} style={{ color: "var(--terracotta-500)" }} />
              <span>⚡ 1.4s</span>
            </button>
            <button
              type="button"
              className={`nav-link-btn ${showVaultsModal ? "active" : ""}`}
              onClick={() => {
                fetchVaultBalances();
                setShowVaultsModal(true);
              }}
              title="Inspect Live Liquidity Vaults"
            >
              <Coins size={14} style={{ color: "var(--terracotta-500)" }} />
              <span>Vaults</span>
            </button>
          </div>

          {/* Mode Switcher: Live vs Demo Simulation */}
          <div style={{ display: "flex", background: "rgba(0,0,0,0.3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", padding: "2px" }}>
            <button
              type="button"
              className={`btn ${!isDemoMode ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "5px 11px", fontSize: "11px", border: "none" }}
              onClick={() => setIsDemoMode(false)}
              title="Live on-chain interactions with MetaMask transactions"
            >
              🌐 Live
            </button>
            <button
              type="button"
              className={`btn ${isDemoMode ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "5px 11px", fontSize: "11px", border: "none", gap: "4px" }}
              onClick={() => setIsDemoMode(true)}
              title="Instant cryptographic demo with zero gas needed"
            >
              <Sparkles size={12} />
              Demo
            </button>
          </div>

          {/* Consumer (Wise) vs Judge (Pro) Mode Switcher */}
          <div style={{ display: "flex", background: "rgba(0,0,0,0.3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", padding: "2px" }}>
            <button
              type="button"
              className={`btn ${uiMode === "simple" ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "5px 10px", fontSize: "11px", border: "none", gap: "4px" }}
              onClick={() => {
                playClickSound();
                setUiMode("simple");
              }}
              title="Wise / Consumer-friendly simplified view"
            >
              <User size={12} />
              Consumer
            </button>
            <button
              type="button"
              className={`btn ${uiMode === "pro" ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "5px 10px", fontSize: "11px", border: "none", gap: "4px" }}
              onClick={() => {
                playClickSound();
                setUiMode("pro");
                setShowProofDetails(true);
              }}
              title="Full cryptographic Merkle tree & judge telemetry"
            >
              <Code size={12} />
              Judge View
            </button>
          </div>

          {/* Web3 Audio Effects Toggle */}
          <button
            type="button"
            className="btn btn-secondary"
            style={{
              padding: "5px 9px",
              fontSize: "12px",
              border: "1px solid var(--border-subtle)",
              color: soundEnabled ? "var(--terracotta-600)" : "var(--text-muted)",
              background: soundEnabled ? "rgba(216, 97, 60, 0.1)" : "rgba(255, 255, 255, 0.05)",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
            onClick={toggleSound}
            title={soundEnabled ? "Mute Web3 Audio" : "Unmute Web3 Audio"}
          >
            {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
          </button>

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
              <div className="badge mono" style={{ background: "#ffffff", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: "6px", padding: "4px 10px" }}>
                <span>{account.slice(0, 6)}...{account.slice(-4)}</span>
                <span style={{ color: "var(--text-muted)" }}>·</span>
                <span style={{ fontWeight: "800", color: "var(--text-primary)" }}>{connectedNativeBalance} {chainInfo.symbol}</span>
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
        </div>
      </header>

      {/* ── Demo Mode Active Indicator Banner ────────────────────────────────── */}
      {isDemoMode && (
        <div style={{ background: "rgba(176, 116, 159, 0.15)", border: "1px solid var(--mauve-500)", borderRadius: "var(--radius-md)", padding: "10px 16px", marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Sparkles size={16} style={{ color: "var(--mauve-300)" }} />
            <span style={{ fontSize: "13px", color: "var(--mauve-100)" }}>
              <strong>Demo Simulation Mode Active:</strong> Generates verified cryptographic state proofs off-chain with simulated finality. Zero gas or wallet signatures required!
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
        <div className="benchmark-card" style={{ marginBottom: "24px", borderColor: "var(--mauve-400)", background: "#ffffff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
                <Settings size={18} style={{ color: "var(--terracotta-500)" }} />
                Developer & Smart Contract Settings
              </h3>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                These are the on-chain smart contract addresses power the cross-chain bridge. You <strong>do not need to change these</strong> unless you deployed your own contracts.
              </p>
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <div style={{ display: "flex", background: "#f0eaf1", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", padding: "2px" }}>
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
                onClick={() => {
                  setRouterAddress(DEFAULT_CONTRACTS.sepolia.realBridge);
                  setVerifierAddress(DEFAULT_CONTRACTS.amoy.realBridge);
                  setWrappedDemoAddress(DEFAULT_CONTRACTS.amoy.wrappedDemo);
                  setErrorMessage("");
                }}
              >
                Reset to Defaults
              </button>
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
            <div style={{ background: "#fbf9fc", padding: "14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label className="input-label" style={{ marginBottom: 0, fontWeight: "700", color: "var(--terracotta-700)" }}>
                  🔷 Sepolia Liquidity Vault
                </label>
                <span className="badge badge-sepolia" style={{ fontSize: "10px" }}>Source Chain</span>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", lineHeight: 1.4 }}>
                Locks native ETH and commits the outgoing transaction state on Ethereum Sepolia.
              </p>
              <input
                className="input-field mono"
                style={{ fontSize: "11px" }}
                value={routerAddress}
                onChange={(e) => setRouterAddress(e.target.value)}
                placeholder="0x..."
              />
            </div>

            <div style={{ background: "#fbf9fc", padding: "14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label className="input-label" style={{ marginBottom: 0, fontWeight: "700", color: "var(--mauve-700)" }}>
                  🟣 Polygon Amoy Settlement Bridge
                </label>
                <span className="badge badge-amoy" style={{ fontSize: "10px" }}>Destination Chain</span>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", lineHeight: 1.4 }}>
                Verifies the consensus state proof and executes the real native asset payout to the recipient.
              </p>
              <input
                className="input-field mono"
                style={{ fontSize: "11px" }}
                value={verifierAddress}
                onChange={(e) => setVerifierAddress(e.target.value)}
                placeholder="0x..."
              />
            </div>

            <div style={{ background: "#fbf9fc", padding: "14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label className="input-label" style={{ marginBottom: 0, fontWeight: "700", color: "var(--plum-800)" }}>
                  🪙 WrappedDemo Token (wDEMO)
                </label>
                <span className="badge" style={{ fontSize: "10px", background: "rgba(176, 116, 159, 0.15)" }}>ERC-20</span>
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

      {/* ── 2-Step Pipeline Progress Indicator ─────────────────────────────────── */}
      <div className="stepper-nav">
        {/* Step 1: Deposit */}
        <div className={`step-card ${phase === "PHASE1_FORM" || phase === "PHASE1_CONFIRMING" || phase === "PHASE1_PROOF" ? "active" : phase === "PHASE2_SWITCH" || phase === "PHASE2_VERIFYING" || phase === "SUCCESS" ? "completed" : ""}`}>
          <div className="step-number">
            {phase === "PHASE2_SWITCH" || phase === "PHASE2_VERIFYING" || phase === "SUCCESS" ? (
              <Check size={16} />
            ) : (
              "1"
            )}
          </div>
          <div className="step-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="step-title">Step 1: Deposit & Sign</div>
              <span className="badge badge-sepolia" style={{ fontSize: "10px" }}>Sepolia</span>
            </div>
            <div className="step-subtitle">
              Lock funds & generate off-chain cryptographic inclusion proof.
            </div>
          </div>
        </div>

        {/* Step 2: Receive */}
        <div className={`step-card ${phase === "PHASE2_SWITCH" || phase === "PHASE2_VERIFYING" ? "active" : phase === "SUCCESS" ? "completed" : ""}`}>
          <div className="step-number">
            {phase === "SUCCESS" ? <Check size={16} /> : "2"}
          </div>
          <div className="step-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="step-title">Step 2: Receive Payout</div>
              <span className="badge badge-amoy" style={{ fontSize: "10px" }}>Polygon Amoy</span>
            </div>
            <div className="step-subtitle">
              Verify proof on-chain & mint synthetic funds directly to recipient.
            </div>
          </div>
        </div>
      </div>

      {/* ── Collapsible Benchmark Drawer (Toggled from Header Pill) ─────────────── */}
      {showBenchmark && (
        <div className="benchmark-card glow-terracotta" style={{ marginBottom: "22px" }}>
          <div className="benchmark-header">
            <div className="benchmark-title">
              <Zap size={16} style={{ color: "var(--terracotta-500)" }} />
              Real-Time End-to-End Latency vs Coordinator Baseline
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {isFaster && (
                <div className="benchmark-badge-speedup">
                  ⚡ {speedupMultiplier}x Faster than Coordinator Chain
                </div>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "3px 8px", fontSize: "11px" }}
                onClick={() => setShowBenchmark(false)}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="benchmark-metrics">
            {/* User-Mediated Timer */}
            <div className="metric-box">
              <div className="metric-label">
                <span>USER-MEDIATED E2E LATENCY</span>
                {timerRunning && <span style={{ color: "var(--terracotta-500)", fontWeight: "bold" }}>● LIVE</span>}
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
                <span className="badge" style={{ background: "rgba(176, 116, 159, 0.15)", fontSize: "10px" }}>Axelar / LayerZero</span>
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
                background: phase === "SUCCESS" ? "linear-gradient(90deg, #059669, #10b981)" : undefined,
              }}
            />
          </div>
        </div>
      )}

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
                <h2 style={{ fontSize: "20px", fontWeight: "800" }}>Cross-Chain Bridge</h2>
                <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                  Instant native asset bridge. State proofs are verified directly by destination smart contracts.
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

            {/* ── Mode-Specific Dashboard Presentation (Consumer vs Judge) ── */}
            {uiMode === "simple" ? (
              <>
                {/* Consumer Delivery Timeline (Pizza Tracker) */}
                <div
                  style={{
                    background: "linear-gradient(135deg, rgba(216, 97, 60, 0.04), rgba(176, 116, 159, 0.06))",
                    border: "1px solid rgba(176, 116, 159, 0.22)",
                    borderRadius: "14px",
                    padding: "14px 18px",
                    marginBottom: "16px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "800", color: "var(--text-secondary)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                      Instant Consumer Settlement (Wise-Grade Experience)
                    </span>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "#059669", display: "flex", alignItems: "center", gap: "4px" }}>
                      <ShieldCheck size={13} /> 100% Money-Back Guarantee
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                    {/* Step 1 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#ffffff", padding: "8px 10px", borderRadius: "8px", border: "1px solid rgba(176, 116, 159, 0.15)" }}>
                      <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "var(--terracotta-500)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "800", flexShrink: 0 }}>
                        1
                      </div>
                      <div style={{ fontSize: "11px", lineHeight: "1.2" }}>
                        <div style={{ fontWeight: "700", color: "var(--text-primary)" }}>You Send</div>
                        <div style={{ color: "var(--text-muted)" }}>{sourceNetwork.shortName} Vault</div>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#ffffff", padding: "8px 10px", borderRadius: "8px", border: "1px solid rgba(176, 116, 159, 0.15)" }}>
                      <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "var(--mauve-600)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "800", flexShrink: 0 }}>
                        2
                      </div>
                      <div style={{ fontSize: "11px", lineHeight: "1.2" }}>
                        <div style={{ fontWeight: "700", color: "var(--text-primary)" }}>State Proof</div>
                        <div style={{ color: "var(--text-muted)" }}>~1.4s Verification</div>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#ffffff", padding: "8px 10px", borderRadius: "8px", border: "1px solid rgba(176, 116, 159, 0.15)" }}>
                      <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#059669", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "800", flexShrink: 0 }}>
                        3
                      </div>
                      <div style={{ fontSize: "11px", lineHeight: "1.2" }}>
                        <div style={{ fontWeight: "700", color: "var(--text-primary)" }}>Delivered</div>
                        <div style={{ color: "var(--text-muted)" }}>{destNetwork.shortName} Payout</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Judge Inspector Switch Prompt */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "rgba(176, 116, 159, 0.08)",
                    border: "1px dashed rgba(176, 116, 159, 0.35)",
                    borderRadius: "10px",
                    padding: "8px 14px",
                    marginBottom: "16px",
                    fontSize: "12px",
                  }}
                >
                  <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>🔬</span>
                    <span><strong>Hackathon Judge?</strong> Inspect the live 8-Depth Incremental Merkle Tree & Cryptographic Root</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      playClickSound();
                      setUiMode("pro");
                      setShowProofDetails(true);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--terracotta-600)",
                      fontWeight: "800",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: "12px",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    Switch to Judge View ➔
                  </button>
                </div>
              </>
            ) : (
              /* Judge Pro Inspector Dashboard */
              <div
                style={{
                  background: "linear-gradient(135deg, rgba(28, 11, 32, 0.95), rgba(45, 20, 50, 0.95))",
                  border: "1px solid var(--terracotta-500)",
                  borderRadius: "14px",
                  padding: "16px 20px",
                  marginBottom: "16px",
                  color: "#ffffff",
                  boxShadow: "0 4px 20px rgba(216, 97, 60, 0.15)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "800", color: "var(--terracotta-400)", letterSpacing: "0.5px", textTransform: "uppercase", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>🔬</span> Cryptographic State Machine Inspector (Judge View)
                  </span>
                  <span className="badge" style={{ background: "rgba(216, 97, 60, 0.25)", color: "#fff", fontSize: "11px", border: "1px solid var(--terracotta-500)" }}>
                    Depth 8 Merkle Tree (256 Leaves)
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.85)", lineHeight: "1.5", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
                  Leaf Commitment: keccak256(srcChain, srcBridge, dstChain, id, sender, recipient, token, amount, targetCall, callDataHash, deadline)
                </div>
                <div style={{ display: "flex", gap: "14px", marginTop: "10px", fontSize: "11px", color: "rgba(255, 255, 255, 0.6)", flexWrap: "wrap" }}>
                  <span>Source Vault: 0xB59e...355B (Sepolia)</span>
                  <span>·</span>
                  <span>Verifier: 0x17B6...AB51 (Amoy)</span>
                  <span>·</span>
                  <span style={{ color: "#34d399", fontWeight: "700" }}>Stateless Zero Relayer Protocol</span>
                </div>
              </div>
            )}

            {/* ── Minimalist Native Cross-Chain Transfer Engine ── */}
            <div style={{ marginBottom: "22px" }}>
              {/* Send Box */}
              <div
                style={{
                  background: "#fbf9fc",
                  border: "1px solid rgba(176, 116, 159, 0.25)",
                  borderRadius: "14px",
                  padding: "18px 20px",
                  marginBottom: "8px",
                  position: "relative",
                  boxShadow: "0 2px 10px rgba(70, 30, 80, 0.02)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-secondary)" }}>
                      {uiMode === "simple" ? `You Send (From ${sourceNetwork.name})` : "You Send"}
                    </span>
                    <span className={`badge ${sourceNetworkKey === "sepolia" ? "badge-sepolia" : "badge-amoy"}`} style={{ fontSize: "11px" }}>
                      {sourceNetwork.icon} {sourceNetwork.name}
                    </span>
                  </div>

                  {/* Active Balance & MAX */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                      Balance: <strong style={{ color: "var(--text-primary)" }}>{currentSourceBalance} {sourceNetwork.symbol}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={handleMax}
                      style={{
                        background: "rgba(216, 97, 60, 0.1)",
                        border: "1px solid var(--terracotta-500)",
                        color: "var(--terracotta-700)",
                        padding: "2px 8px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: "800",
                        cursor: "pointer",
                      }}
                    >
                      MAX
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
                  <div style={{ flex: "1 1 200px" }}>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={exchangeAmount}
                      onChange={(e) => setExchangeAmount(e.target.value)}
                      placeholder="0.001"
                      style={{
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        fontSize: "32px",
                        fontWeight: "800",
                        color: "var(--text-primary)",
                        fontFamily: "var(--font-mono)",
                        width: "100%",
                      }}
                    />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "#ffffff",
                      border: "1px solid rgba(176, 116, 159, 0.3)",
                      borderRadius: "10px",
                      padding: "8px 14px",
                      fontWeight: "800",
                      fontSize: "15px",
                      color: "var(--text-primary)",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                    }}
                  >
                    <span>{sourceNetwork.icon}</span>
                    <span>{sourceNetwork.symbol}</span>
                  </div>
                </div>

                {/* Quick Presets */}
                <div style={{ display: "flex", gap: "6px", marginTop: "10px", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", marginRight: "4px" }}>Quick:</span>
                  {presets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setExchangeAmount(preset)}
                      style={{
                        background: exchangeAmount === preset ? "rgba(216, 97, 60, 0.12)" : "#ffffff",
                        border: "1px solid",
                        borderColor: exchangeAmount === preset ? "var(--terracotta-500)" : "rgba(176, 116, 159, 0.25)",
                        color: exchangeAmount === preset ? "var(--terracotta-700)" : "var(--text-secondary)",
                        padding: "3px 10px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {preset} {sourceNetwork.symbol}
                    </button>
                  ))}
                </div>
              </div>

              {/* Swap Invert Button */}
              <div style={{ display: "flex", justifyContent: "center", margin: "-16px 0", position: "relative", zIndex: 2 }}>
                <button
                  type="button"
                  onClick={handleInvertCurrencies}
                  title="Invert bridge direction"
                  style={{
                    width: "38px",
                    height: "38px",
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #d8613c, #b0749f)",
                    border: "3px solid #ffffff",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    boxShadow: "0 4px 14px rgba(216, 97, 60, 0.25)",
                    transition: "transform 0.2s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = "rotate(180deg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = "rotate(0deg)")}
                >
                  <ArrowUpDown size={16} />
                </button>
              </div>

              {/* Receive Box */}
              <div
                style={{
                  background: "#fbf9fc",
                  border: "1px solid rgba(176, 116, 159, 0.25)",
                  borderRadius: "14px",
                  padding: "18px 20px",
                  marginTop: "8px",
                  boxShadow: "0 2px 10px rgba(70, 30, 80, 0.02)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-secondary)" }}>
                      {uiMode === "simple" ? `Recipient Receives (On ${destNetwork.name})` : "You Receive (Destination Payout)"}
                    </span>
                    <span className={`badge ${destNetworkKey === "amoy" ? "badge-amoy" : "badge-sepolia"}`} style={{ fontSize: "11px" }}>
                      {destNetwork.icon} {destNetwork.name}
                    </span>
                  </div>
                  <span style={{ fontSize: "11px", color: "#059669", fontWeight: "700", display: "flex", alignItems: "center", gap: "4px" }}>
                    <TrendingUp size={12} /> Guaranteed Rate
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
                  <div>
                    <div
                      style={{
                        fontSize: "32px",
                        fontWeight: "800",
                        color: "#059669",
                        fontFamily: "var(--font-mono)",
                        letterSpacing: "-0.5px",
                      }}
                    >
                      {receiveAmount}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "rgba(5, 150, 105, 0.08)",
                      border: "1px solid rgba(5, 150, 105, 0.25)",
                      borderRadius: "10px",
                      padding: "8px 14px",
                      fontWeight: "800",
                      fontSize: "15px",
                      color: "#059669",
                    }}
                  >
                    <span>{destNetwork.icon}</span>
                    <span>{destNetwork.symbol}</span>
                  </div>
                </div>

                {/* Valuation & Settlement Note */}
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                  <span>
                    Valuation: <strong>${(parseFloat(effectiveAmount || "0") * (sourceNetworkKey === "sepolia" ? 2650 : 0.36)).toFixed(2)} USD</strong> (₹{(parseFloat(effectiveAmount || "0") * (sourceNetworkKey === "sepolia" ? 2650 : 0.36) * 94.95).toFixed(2)} INR)
                  </span>
                  <span>·</span>
                  <span style={{ color: "#059669", fontWeight: "600" }}>Zero Relayer Fee</span>
                  <span>·</span>
                  <span>Stateless Consensus Verification</span>
                </div>
              </div>
            </div>

            {/* Route & Fee Breakdown Accordion */}
            <div style={{ marginBottom: "16px" }}>
              <button
                type="button"
                onClick={() => setShowRouteDetails(!showRouteDetails)}
                style={{
                  width: "100%",
                  background: "rgba(176, 116, 159, 0.06)",
                  border: "1px solid rgba(176, 116, 159, 0.2)",
                  borderRadius: "10px",
                  padding: "9px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: "700",
                  color: "var(--text-secondary)",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <ShieldCheck size={14} color="#059669" />
                  Route Details & Economic Guarantees
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--mauve-700)" }}>
                  {showRouteDetails ? "Hide" : "Inspect"}
                  {showRouteDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
              </button>

              {showRouteDetails && (
                <div
                  style={{
                    background: "#fbf9fc",
                    border: "1px solid rgba(176, 116, 159, 0.2)",
                    borderTop: "none",
                    borderRadius: "0 0 10px 10px",
                    padding: "12px 16px",
                    fontSize: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Protocol Relayer Fee:</span>
                    <span style={{ fontWeight: "700", color: "#059669" }}>$0.00 (Zero-Relayer Client Proving)</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Expected Finality:</span>
                    <span style={{ fontWeight: "700", color: "var(--terracotta-600)" }}>~1.4s (Sub-2s Proofs)</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Protocol Slippage:</span>
                    <span style={{ fontWeight: "700", color: "var(--text-primary)" }}>0.00% (Guaranteed Direct Rate)</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Cryptographic Method:</span>
                    <span style={{ fontWeight: "600", color: "var(--plum-800)" }}>8-Depth Incremental Merkle Trees</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Anti-Double-Spend Protection:</span>
                    <span style={{ fontWeight: "600", color: "#059669" }}>On-Chain Timelock Enabled</span>
                  </div>
                </div>
              )}
            </div>

            {/* Recipient Address (Smart Default: Connected Wallet) */}
            <div style={{ background: "#fbf9fc", border: "1px solid rgba(176, 116, 159, 0.22)", borderRadius: "var(--radius-md)", padding: "14px 18px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>
                  <input
                    type="checkbox"
                    checked={useSelfRecipient}
                    onChange={(e) => {
                      setUseSelfRecipient(e.target.checked);
                      if (e.target.checked && account) {
                        setRecipient(account);
                      }
                    }}
                    style={{ accentColor: "var(--terracotta-500)", width: "16px", height: "16px", cursor: "pointer" }}
                  />
                  <span>Receive directly into my connected wallet ({account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Connect wallet"})</span>
                </label>

                {!useSelfRecipient && (
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Custom Polygon Amoy Recipient
                  </span>
                )}
              </div>

              {!useSelfRecipient && (
                <div style={{ marginTop: "10px" }}>
                  <input
                    className="input-field mono"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="Enter custom 0x... destination recipient address"
                    style={{ fontSize: "13px" }}
                  />
                </div>
              )}
            </div>

            {/* Collapsible Advanced Options (Confirmations to wait) */}
            <div style={{ marginBottom: "20px" }}>
              <button
                type="button"
                onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  fontSize: "12px",
                  fontWeight: "700",
                  color: "var(--mauve-700)",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: "pointer",
                }}
              >
                <Settings size={13} />
                <span>Advanced Transfer Options</span>
                {showAdvancedSettings ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>

              {showAdvancedSettings && (
                <div style={{ marginTop: "10px", padding: "12px 16px", background: "#fbf9fc", border: "1px solid rgba(176, 116, 159, 0.22)", borderRadius: "var(--radius-md)" }}>
                  <label className="input-label" style={{ marginBottom: "6px" }}>
                    Confirmations to Wait (Default: 3 blocks)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    className="input-field mono"
                    value={targetConfirmations}
                    onChange={(e) => setTargetConfirmations(parseInt(e.target.value) || 1)}
                    style={{ maxWidth: "200px" }}
                  />
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                    Number of source network block confirmations before generating cryptographic consensus proof.
                  </p>
                </div>
              )}
            </div>

            {isBalanceInsufficient && (
              <div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "10px", fontWeight: "600", display: "flex", alignItems: "center", gap: "6px" }}>
                ⚠️ Insufficient balance: You have {currentSourceBalance} {sourceNetwork.symbol}, but trying to send {effectiveAmount} {sourceNetwork.symbol}. Click a preset (e.g. {presets[0]}) or MAX.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              {isWrongChain ? (
                <button
                  type="button"
                  className="btn btn-polygon"
                  onClick={() => switchNetwork(sourceNetworkKey)}
                  style={{ padding: "14px 28px", fontSize: "15px", fontWeight: "700", width: "100%" }}
                >
                  <ArrowRight size={16} />
                  Switch MetaMask to {sourceNetwork.name}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleLockEth}
                  disabled={
                    isBusy ||
                    (!recipient && !account) ||
                    !exchangeAmount ||
                    parseFloat(exchangeAmount) <= 0 ||
                    isBalanceInsufficient
                  }
                  style={{ padding: "14px 28px", fontSize: "15px", fontWeight: "700", width: "100%", boxShadow: "0 4px 18px var(--terracotta-glow)" }}
                >
                  <Lock size={16} />
                  {isBusy
                    ? "Locking Funds on Chain..."
                    : `Bridge ${exchangeAmount} ${sourceNetwork.symbol} ➔ ${receiveAmount} ${destNetwork.symbol} on ${destNetwork.name}`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* State 3: Direct Live Action Card & Consensus Proof Explorer */}
        {(phase === "PHASE1_CONFIRMING" || phase === "PHASE1_PROOF" || phase === "PHASE2_SWITCH") && proofResult && submitResult && (
          <div>
            {/* ── Prominent Step 2 Action Card (Right at the Top) ── */}
            {chainId !== (activeTransferRoute ? NETWORKS[activeTransferRoute.destNetworkKey].chainIdDec : destNetwork.chainIdDec) ? (
              <div
                style={{
                  background: "linear-gradient(135deg, rgba(176, 116, 159, 0.12), rgba(150, 90, 132, 0.2))",
                  border: "2px solid var(--mauve-500)",
                  borderRadius: "var(--radius-lg)",
                  padding: "24px 28px",
                  marginBottom: "20px",
                  textAlign: "center",
                  boxShadow: "0 8px 30px rgba(176, 116, 159, 0.15)",
                }}
              >
                <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(176, 116, 159, 0.2)", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "12px", fontWeight: "800", color: "var(--mauve-800)", marginBottom: "10px" }}>
                  <span>🔒 Step 1 Complete: {effectiveAmount} {sourceNetwork.symbol} Locked</span>
                </div>
                <h3 style={{ fontSize: "20px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "8px" }}>
                  👉 Switch to {activeTransferRoute ? NETWORKS[activeTransferRoute.destNetworkKey].name : destNetwork.name} to Claim {receiveAmount} {destNetwork.symbol}
                </h3>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "560px", margin: "0 auto 18px auto" }}>
                  Your deposit has been committed to the source vault. Switch your MetaMask network to {activeTransferRoute ? NETWORKS[activeTransferRoute.destNetworkKey].name : destNetwork.name} to submit the consensus proof and release your payout.
                </p>
                <button
                  className="btn btn-polygon"
                  onClick={() => switchNetwork(activeTransferRoute ? activeTransferRoute.destNetworkKey : destNetworkKey)}
                  style={{ padding: "14px 32px", fontSize: "16px", fontWeight: "800", boxShadow: "0 4px 20px rgba(176, 116, 159, 0.4)" }}
                >
                  Switch MetaMask to {activeTransferRoute ? NETWORKS[activeTransferRoute.destNetworkKey].name : destNetwork.name}
                  <ArrowRight size={18} />
                </button>
              </div>
            ) : (
              <div
                style={{
                  background: "linear-gradient(135deg, rgba(5, 150, 105, 0.08), rgba(16, 185, 129, 0.15))",
                  border: "2px solid #059669",
                  borderRadius: "var(--radius-lg)",
                  padding: "24px 28px",
                  marginBottom: "20px",
                  textAlign: "center",
                  boxShadow: "0 8px 30px rgba(5, 150, 105, 0.15)",
                }}
              >
                <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(5, 150, 105, 0.15)", padding: "4px 12px", borderRadius: "var(--radius-full)", fontSize: "12px", fontWeight: "800", color: "#059669", marginBottom: "10px" }}>
                  <span>✓ On Destination Network</span>
                </div>
                <h3 style={{ fontSize: "20px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "8px" }}>
                  🎉 Ready to Claim {receiveAmount} {destNetwork.symbol}!
                </h3>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "560px", margin: "0 auto 18px auto" }}>
                  Your cryptographic state proof is constructed off-chain. Submit it directly to the settlement smart contract to receive your payout.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={handleSubmitProof}
                  disabled={isBusy}
                  style={{
                    padding: "14px 32px",
                    fontSize: "16px",
                    fontWeight: "800",
                    background: "linear-gradient(135deg, #059669, #10b981)",
                    border: "none",
                    boxShadow: "0 4px 20px rgba(5, 150, 105, 0.35)",
                  }}
                >
                  <Coins size={18} />
                  {isBusy ? "Submitting Proof to Verifier..." : `Submit Proof & Claim ${receiveAmount} ${destNetwork.symbol} ⚡`}
                </button>
              </div>
            )}

            {/* Live Block Confirmation Banner */}
            <div style={{ background: "#fbf9fc", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "16px 20px", marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div className="brand-icon animate-pulse-glow" style={{ width: "36px", height: "36px", fontSize: "16px" }}>
                    <Clock size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)" }}>
                      {sourceNetwork.name} Block #{submitResult.blockNumber} Finality
                    </div>
                    <div className="mono" style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "3px" }}>
                      <span>Tx:</span>
                      <a
                        href={`${sourceNetwork.blockExplorerUrl}/tx/${submitResult.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="explorer-link"
                      >
                        {submitResult.txHash.slice(0, 10)}...{submitResult.txHash.slice(-6)}
                        <ExternalLink size={10} />
                      </a>
                      <a
                        href={`${sourceNetwork.blockExplorerUrl}/tx/${submitResult.txHash}#eventlog`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          background: "rgba(216, 97, 60, 0.1)",
                          color: "var(--terracotta-700)",
                          border: "1px solid rgba(216, 97, 60, 0.25)",
                          borderRadius: "4px",
                          padding: "1px 6px",
                          fontSize: "11px",
                          fontWeight: "700",
                          textDecoration: "none",
                        }}
                      >
                        📜 View Event Logs on {sourceNetwork.name.includes("Polygon") ? "Polygonscan" : "Etherscan"}
                        <ExternalLink size={10} />
                      </a>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span className="mono" style={{ fontSize: "13px", fontWeight: "700", color: "var(--terracotta-700)" }}>
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

            {/* Collapsible Consensus Proof Explorer Accordion */}
            <div style={{ marginTop: "16px" }}>
              <button
                type="button"
                onClick={() => setShowProofDetails(!showProofDetails)}
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#fbf9fc",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  padding: "12px 18px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "700",
                  color: "var(--text-secondary)",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Layers size={16} style={{ color: "var(--terracotta-500)" }} />
                  <span>Inspect Consensus State Proof & Verification Tree</span>
                  <span className="badge" style={{ background: "rgba(176, 116, 159, 0.15)", fontSize: "11px" }}>
                    Root: {proofResult.header.root.slice(0, 10)}...
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)" }}>
                  <span>{showProofDetails ? "Hide Tree" : "View Tree"}</span>
                  {showProofDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </button>

              {(showProofDetails || uiMode === "pro") && (
                <div style={{ marginTop: "14px" }}>
                  <MerkleTreeVisualizer
                    root={proofResult.header.root}
                    leaf={submitResult.leaf}
                    proof={proofResult.proof}
                    requestId={submitResult.id}
                    isInline={true}
                    autoAnimate={true}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* State 4: Verifying on Destination Network */}
        {phase === "PHASE2_VERIFYING" && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div className="brand-icon animate-spin" style={{ width: "56px", height: "56px", margin: "0 auto 20px auto" }}>
              <Cpu size={28} />
            </div>
            <h2 style={{ fontSize: "22px", fontWeight: "800", marginBottom: "8px" }}>
              Verifying Proof on {destNetwork.name}
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px", maxWidth: "480px", margin: "0 auto" }}>
              Calling <code>RealCrossChainBridge.executeTransaction()</code>. Smart contract verifies cryptographic consensus state against the block header and releases payout to {recipient.slice(0, 6)}...{recipient.slice(-4)}.
            </p>
          </div>
        )}

        {/* State 5: Success State */}
        {phase === "SUCCESS" && submitResult && (
          <div className="success-banner">
            <div className="success-icon">
              <CheckCircle2 size={36} />
            </div>
            <h2 style={{ fontSize: "26px", fontWeight: "800", color: "#059669", marginBottom: "8px" }}>
              Cross-Chain Verification Succeeded!
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "15px", marginBottom: "24px" }}>
              {receiveAmount} {destNetwork.symbol} settled on {destNetwork.name} directly via trustless client verification.
            </p>

            <div className="proof-box" style={{ maxWidth: "640px", margin: "0 auto 28px auto", textAlign: "left" }}>
              <div className="proof-item">
                <span className="proof-label">Cross-Chain Route:</span>
                <span className="proof-val" style={{ color: "var(--text-primary)", fontWeight: "bold" }}>
                  {sourceNetwork.name} ({exchangeAmount} {sourceNetwork.symbol}) ➔ {destNetwork.name} ({receiveAmount} {destNetwork.symbol})
                </span>
              </div>
              <div className="proof-item">
                <span className="proof-label">Settlement Rate:</span>
                <span className="proof-val" style={{ color: "var(--terracotta-700)", fontWeight: "bold" }}>
                  Direct Settlement (Zero Slippage)
                </span>
              </div>
              <div className="proof-item">
                <span className="proof-label">Recipient:</span>
                <span className="proof-val mono">{recipient}</span>
              </div>
              <div className="proof-item">
                <span className="proof-label">Payout Settled:</span>
                <span className="proof-val" style={{ color: "#059669", fontWeight: "bold" }}>
                  {receiveAmount} {destNetwork.symbol}
                </span>
              </div>
              {verifyTxHash && (
                <div className="proof-item" style={{ alignItems: "center" }}>
                  <span className="proof-label">{destNetwork.shortName} Settlement Tx:</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <a
                      href={`${destNetwork.blockExplorerUrl}/tx/${verifyTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="explorer-link"
                    >
                      {verifyTxHash.slice(0, 12)}...{verifyTxHash.slice(-8)}
                      <ExternalLink size={12} />
                    </a>
                    <a
                      href={`${destNetwork.blockExplorerUrl}/tx/${verifyTxHash}#eventlog`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        background: "rgba(5, 150, 105, 0.1)",
                        color: "#059669",
                        border: "1px solid rgba(5, 150, 105, 0.3)",
                        borderRadius: "5px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: "700",
                        textDecoration: "none",
                      }}
                    >
                      📜 View Event Logs on {destNetwork.name.includes("Polygon") ? "Polygonscan" : "Etherscan"}
                      <ExternalLink size={10} />
                    </a>
                  </div>
                </div>
              )}
              <div className="proof-item" style={{ alignItems: "center" }}>
                <span className="proof-label">{sourceNetwork.shortName} Lock Tx:</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <a
                    href={`${sourceNetwork.blockExplorerUrl}/tx/${submitResult.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="explorer-link"
                  >
                    {submitResult.txHash.slice(0, 12)}...{submitResult.txHash.slice(-8)}
                    <ExternalLink size={12} />
                  </a>
                  <a
                    href={`${sourceNetwork.blockExplorerUrl}/tx/${submitResult.txHash}#eventlog`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      background: "rgba(216, 97, 60, 0.1)",
                      color: "var(--terracotta-700)",
                      border: "1px solid rgba(216, 97, 60, 0.25)",
                      borderRadius: "5px",
                      padding: "2px 8px",
                      fontSize: "11px",
                      fontWeight: "700",
                      textDecoration: "none",
                    }}
                  >
                    📜 View Event Logs on {sourceNetwork.name.includes("Polygon") ? "Polygonscan" : "Etherscan"}
                    <ExternalLink size={10} />
                  </a>
                </div>
              </div>
              <div className="proof-item">
                <span className="proof-label">Total End-to-End Time:</span>
                <span className="proof-val" style={{ color: "#059669" }}>
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
                onClick={openHistoryModal}
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
              {errorMessage?.includes("Expired")
                ? "Transaction Validity Window Expired"
                : errorMessage?.includes("Timelock")
                ? "Refund Security Timelock Active"
                : errorMessage?.includes("Cancelled")
                ? "Transaction Cancelled in Wallet"
                : errorMessage?.includes("Insufficient Gas")
                ? "Insufficient Gas in Connected Wallet"
                : errorMessage?.includes("Insufficient")
                ? "Insufficient Destination Vault Liquidity"
                : errorMessage?.includes("No Router") || errorMessage?.includes("bytecode")
                ? "Contract Not Deployed on This Network"
                : "Transaction Issue Detected"}
            </h2>

            {/* Diagnostic Message Box */}
            <div style={{ color: "var(--text-secondary)", fontSize: "14px", maxWidth: "600px", margin: "0 auto 24px auto", background: "rgba(0,0,0,0.3)", padding: "16px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", textAlign: "left" }}>
              <div style={{ fontWeight: "700", color: "#fca5a5", marginBottom: "6px" }}>Diagnostic Details:</div>
              <div className="mono" style={{ fontSize: "12px", color: "var(--text-muted)", wordBreak: "break-word", lineHeight: 1.5 }}>
                {errorMessage || "An unexpected error occurred during execution."}
              </div>
              {errorMessage?.includes("Expired") ? (
                <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: "13px", color: "#6ee7b7" }}>
                  ✅ <strong>Safe Refund:</strong> Your locked funds on {sourceNetwork.name} are fully protected on-chain. Click <strong>"Reclaim Locked Funds"</strong> below to claim them back to your wallet.
                </div>
              ) : errorMessage?.includes("Timelock") ? (
                <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: "13px", color: "#6ee7b7" }}>
                  🛡️ <strong>Protocol Protection Active:</strong> Your deposit is 100% safe inside the audited Sepolia Vault contract. Cross-chain protocols enforce a temporary timelock to guarantee the recipient cannot double-spend before the refund unlocks. Once the timelock elapses, clicking <strong>"Reclaim Locked Funds"</strong> will immediately disburse 100% of your funds back to your wallet.
                </div>
              ) : errorMessage?.includes("Cancelled") ? (
                <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: "13px", color: "var(--mauve-200)" }}>
                  💡 <strong>No Funds Lost:</strong> Because you cancelled or rejected the confirmation prompt in MetaMask, zero gas or funds were debited. You can click <strong>"Start Fresh Transfer"</strong> or retry whenever you're ready.
                </div>
              ) : (
                <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: "13px", color: "var(--mauve-200)" }}>
                  💡 <strong>Recommendation:</strong> Click <strong>"Start Fresh Transfer"</strong> to initiate a new live transaction with smaller test amounts (e.g. 0.001 ETH / POL), or click <strong>"Switch to Demo Simulation Mode"</strong> for instant zero-gas execution.
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: "12px", flexWrap: "wrap" }}>
              {submitResult && (
                <button className="btn btn-danger" onClick={handleReclaim} disabled={isBusy}>
                  <RotateCcw size={16} />
                  {isBusy ? "Reclaiming..." : `Reclaim Locked Funds (${sourceNetwork.shortName})`}
                </button>
              )}
              <button className="btn btn-primary" onClick={resetFlow}>
                <RotateCcw size={16} /> Start Fresh Transfer
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setIsDemoMode(true);
                  resetFlow();
                }}
              >
                <Sparkles size={16} />
                Switch to Demo Simulation Mode
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setShowConfig(true)}
              >
                <Settings size={16} />
                Configure Contracts
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Transaction History & Proof Explorer Modal ──────────────────────── */}
      {showHistory && (
        <TransactionHistoryModal
          isOpen={showHistory}
          onClose={() => setShowHistory(false)}
          transactions={transactions}
          onTransactionsChange={(updated) => {
            setTransactions(updated);
            setLastSeenTxCount(updated.length);
            try {
              localStorage.setItem("cryptoxchange_last_seen_tx_count", updated.length.toString());
            } catch {
              // ignore
            }
          }}
          onTriggerDemo={() => {
            setIsDemoMode(true);
            resetFlow();
          }}
          onReclaim={handleHistoryReclaim}
        />
      )}

      {/* ── Liquidity Vaults Modal ─────────────────────────────────────────── */}
      {showVaultsModal && (
        <VaultsModal
          isOpen={showVaultsModal}
          onClose={() => setShowVaultsModal(false)}
          sepoliaBalance={sepoliaVaultBalance}
          amoyBalance={amoyVaultBalance}
          onRefresh={fetchVaultBalances}
        />
      )}

      {/* ── Global In-App Toast Notifications ───────────────────────────────── */}
      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />

      {/* ── Industry-Ready Multi-Column Footer ───────────────────────────────── */}
      <footer className="app-footer">
        <div className="footer-grid">
          {/* Column 1: Brand & Status */}
          <div className="footer-brand">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div className="brand-icon" style={{ width: "28px", height: "28px", fontSize: "14px" }}>⚡</div>
              <span style={{ fontSize: "16px", fontWeight: "800", color: "var(--text-primary)" }}>VecnaBridge</span>
              <span className="badge" style={{ fontSize: "10px", padding: "1px 6px" }}>v2.0</span>
            </div>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5, maxWidth: "300px" }}>
              Next-generation stateless liquidity protocol. Enables instant cross-chain settlement via client-side consensus state verification with zero relayer trust.
            </p>
            <div className="footer-status-indicator">
              <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#059669" }} />
              <span>All Systems Operational</span>
            </div>
          </div>

          {/* Column 2: Audited Contracts */}
          <div>
            <div className="footer-col-title">Verified Contracts</div>
            <ul className="footer-links-list">
              <li>
                <a
                  href={`${NETWORKS.sepolia.blockExplorerUrl}/address/${DEFAULT_CONTRACTS.sepolia.realBridge}#eventlog`}
                  target="_blank"
                  rel="noreferrer"
                  className="footer-link-item"
                >
                  <span>🔷 Sepolia Vault</span>
                  <ExternalLink size={11} />
                </a>
              </li>
              <li>
                <a
                  href={`${NETWORKS.amoy.blockExplorerUrl}/address/${DEFAULT_CONTRACTS.amoy.realBridge}#eventlog`}
                  target="_blank"
                  rel="noreferrer"
                  className="footer-link-item"
                >
                  <span>🟣 Amoy Settlement Bridge</span>
                  <ExternalLink size={11} />
                </a>
              </li>
              <li>
                <span className="footer-link-item" style={{ cursor: "default", opacity: 0.8 }}>
                  <span>🛡️ Header Consensus Verifier</span>
                </span>
              </li>
            </ul>
          </div>

          {/* Column 3: Architecture Specs */}
          <div>
            <div className="footer-col-title">Architecture</div>
            <ul className="footer-links-list">
              <li className="footer-link-item" style={{ cursor: "default" }}>
                <span>⚡ Sub-2s Latency (99.8x Faster)</span>
              </li>
              <li className="footer-link-item" style={{ cursor: "default" }}>
                <span>🔒 Zero Relayer Attack Surface</span>
              </li>
              <li className="footer-link-item" style={{ cursor: "default" }}>
                <span>💎 Non-Custodial Native Vaults</span>
              </li>
              <li className="footer-link-item" style={{ cursor: "default" }}>
                <span>🛡️ Non-Reentrant Protection</span>
              </li>
            </ul>
          </div>

          {/* Column 4: Resources */}
          <div>
            <div className="footer-col-title">Resources</div>
            <ul className="footer-links-list">
              <li>
                <button
                  type="button"
                  onClick={openHistoryModal}
                  className="footer-link-item"
                  style={{ background: "none", border: "none", padding: 0 }}
                >
                  <span>Transaction Explorer</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setShowConfig(true)}
                  className="footer-link-item"
                  style={{ background: "none", border: "none", padding: 0 }}
                >
                  <span>Developer Settings</span>
                </button>
              </li>
              <li>
                <a
                  href="https://github.com/priyansh369/Interoperability"
                  target="_blank"
                  rel="noreferrer"
                  className="footer-link-item"
                >
                  <span>GitHub Repository</span>
                  <ExternalLink size={11} />
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom row */}
        <div className="footer-bottom-row">
          <div>
            © {new Date().getFullYear()} VecnaBridge Interoperability Protocol. OpenZeppelin ^5.1 & Ethers v6.
          </div>
          <div style={{ display: "flex", gap: "16px" }}>
            <span>Ethereum Sepolia (N1)</span>
            <span>·</span>
            <span>Polygon Amoy (N2)</span>
            <span>·</span>
            <span>Decentralized & Stateless</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
