import React from "react";
import { CheckCircle2, AlertTriangle, Info, Sparkles, X, ExternalLink } from "lucide-react";

export interface ToastItem {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message?: string;
  link?: {
    url: string;
    label: string;
  };
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export default function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "20px",
        right: "20px",
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        maxWidth: "380px",
        width: "calc(100vw - 40px)",
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => {
        let borderColor = "rgba(176, 116, 159, 0.3)";
        let iconColor = "var(--terracotta-500)";
        let Icon = Info;
        let bg = "rgba(255, 255, 255, 0.95)";

        if (toast.type === "success") {
          borderColor = "rgba(5, 150, 105, 0.4)";
          iconColor = "#059669";
          Icon = CheckCircle2;
          bg = "linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(236, 253, 245, 0.95))";
        } else if (toast.type === "error") {
          borderColor = "rgba(239, 68, 68, 0.4)";
          iconColor = "#dc2626";
          Icon = AlertTriangle;
          bg = "linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(254, 242, 242, 0.95))";
        } else if (toast.type === "warning") {
          borderColor = "rgba(245, 158, 11, 0.4)";
          iconColor = "#d97706";
          Icon = AlertTriangle;
          bg = "linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(254, 243, 199, 0.95))";
        } else if (toast.type === "info") {
          borderColor = "rgba(176, 116, 159, 0.4)";
          iconColor = "var(--mauve-600)";
          Icon = Sparkles;
        }

        return (
          <div
            key={toast.id}
            style={{
              pointerEvents: "auto",
              background: bg,
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: `1px solid ${borderColor}`,
              borderRadius: "12px",
              padding: "12px 14px",
              boxShadow: "0 8px 24px rgba(70, 30, 80, 0.12)",
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              animation: "toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
              transition: "all 0.2s ease",
            }}
          >
            <div style={{ marginTop: "2px", flexShrink: 0 }}>
              <Icon size={18} color={iconColor} />
            </div>

            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: "700",
                  color: "var(--text-primary)",
                  marginBottom: toast.message ? "2px" : 0,
                }}
              >
                {toast.title}
              </div>
              {toast.message && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    lineHeight: "1.4",
                    wordBreak: "break-word",
                  }}
                >
                  {toast.message}
                </div>
              )}
              {toast.link && (
                <a
                  href={toast.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    marginTop: "6px",
                    fontSize: "11px",
                    fontWeight: "700",
                    color: "var(--terracotta-600)",
                    textDecoration: "none",
                  }}
                >
                  {toast.link.label}
                  <ExternalLink size={11} />
                </a>
              )}
            </div>

            <button
              onClick={() => onDismiss(toast.id)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "2px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
              title="Close notification"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
