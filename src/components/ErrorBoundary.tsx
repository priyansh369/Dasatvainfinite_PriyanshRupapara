import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught runtime error caught by ErrorBoundary:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleClearStorageAndReload = () => {
    try {
      localStorage.removeItem("cryptoxchange_tx_history_v1");
      sessionStorage.clear();
    } catch {
      // ignore
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#120815",
            color: "#f8fafc",
            padding: "24px",
            fontFamily: "var(--font-main, sans-serif)",
          }}
        >
          <div
            style={{
              maxWidth: "520px",
              width: "100%",
              backgroundColor: "#1a0c20",
              border: "1px solid rgba(216, 97, 60, 0.4)",
              borderRadius: "16px",
              padding: "32px",
              textAlign: "center",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.6)",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid #ef4444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px auto",
                color: "#f87171",
              }}
            >
              <AlertTriangle size={28} />
            </div>

            <h2 style={{ fontSize: "20px", fontWeight: "800", marginBottom: "8px" }}>
              Application Render Issue
            </h2>
            <p style={{ color: "rgba(255, 255, 255, 0.65)", fontSize: "14px", marginBottom: "20px", lineHeight: 1.5 }}>
              CryptoXchange encountered an unexpected client error. You can refresh the page or clear cached local state to restore normal operation.
            </p>

            {this.state.error && (
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.4)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "8px",
                  padding: "12px",
                  textAlign: "left",
                  fontSize: "12px",
                  color: "#fca5a5",
                  fontFamily: "monospace",
                  marginBottom: "24px",
                  maxHeight: "100px",
                  overflowY: "auto",
                  wordBreak: "break-word",
                }}
              >
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "center", gap: "12px", flexWrap: "wrap" }}>
              <button
                onClick={this.handleReload}
                style={{
                  background: "linear-gradient(135deg, #d8613c, #b0749f)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 18px",
                  fontSize: "13px",
                  fontWeight: "700",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <RotateCcw size={15} /> Reload Page
              </button>

              <button
                onClick={this.handleClearStorageAndReload}
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "#e2e8f0",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "8px",
                  padding: "10px 18px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Reset Cache & Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
