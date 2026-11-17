import React, { useState } from "react";
import {
  type LucideIcon,
  LayoutDashboard,
  ShoppingCart,
  Wallet,
  ShoppingBag,
  Boxes,
  Package,
  Wrench,
  Smartphone,
  Cpu,
  RefreshCw,
  FileText,
  CreditCard,
  Building2,
  Receipt,
  MessageSquare,
  Activity,
  ShieldCheck,
  Settings,
  Users,
  CheckCircle2,
  AlertTriangle,
  Info,
  Search,
  Plus,
  Minus,
  Trash2,
  Printer,
  QrCode,
  Banknote,
  ArrowRight,
  Clock,
  Sparkles,
  Barcode,
  Layers,
  Edit2,
  Check,
  XCircle,
  ShieldAlert,
  Send,
  Eye,
} from "lucide-react";

export interface TutorialStep {
  stepNumber: number;
  title: string;
  badge?: string;
  isIntroduction?: boolean;
  contentSummary?: string;
  operationalSense?: string;
  explanation: string;
  limitations?: string;
  mockComponent: React.ReactNode;
}

export interface ModuleTutorial {
  workspaceId: string;
  moduleName: string;
  area: string;
  icon: LucideIcon;
  tagline: string;
  steps: TutorialStep[];
}

// ============================================================================
// SIMULADORES INTERACTIVOS PROFUNDOS (END-TO-END)
// ============================================================================

// 1. POS INTERACTIVE
export const MockPosInteractive: React.FC = () => {
  const [cart, setCart] = useState<Array<{ id: string; name: string; price: number; qty: number; variant?: string }>>([
    { id: "1", name: "Cargador Rápido 20W USB-C", price: 18500, qty: 1 },
  ]);
  const [selectedVariant, setSelectedVariant] = useState<string>("Negro");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "qr" | "transfer">("cash");
  const [currency, setCurrency] = useState<"ARS" | "USD">("ARS");
  const [searchTerm, setSearchTerm] = useState("");
  const [saleFinished, setSaleFinished] = useState(false);

  const availableProducts = [
    { id: "2", name: "Cable USB-C a Lightning 1m", price: 9500, hasVariants: false },
    { id: "3", name: "Vidrio Templado 9D iPhone 13/14", price: 6000, hasVariants: false },
    { id: "4", name: "Funda Antigolpe Silicona", price: 12000, hasVariants: true },
  ];

  const addToCart = (product: { id: string; name: string; price: number; hasVariants?: boolean }) => {
    const variantName = product.hasVariants ? selectedVariant : undefined;
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id && item.variant === variantName);
      if (existing) {
        return prev.map((item) => (item === existing ? { ...item, qty: item.qty + 1 } : item));
      }
      return [...prev, { ...product, qty: 1, variant: variantName }];
    });
    setSaleFinished(false);
  };

  const updateQty = (id: string, variant: string | undefined, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => (item.id === id && item.variant === variant ? { ...item, qty: item.qty + delta } : item))
        .filter((item) => item.qty > 0)
    );
    setSaleFinished(false);
  };

  const totalArs = cart.reduce((acc, item) => acc + item.price * item.qty, 0);
  const totalUsd = Math.round(totalArs / 1380);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", height: "100%", fontSize: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-line)", paddingBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, color: "var(--brand-primary)" }}>
          <ShoppingCart size={15} />
          <span>Simulador de Mostrador: Terminal #01 (Salón NicTech)</span>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            type="button"
            onClick={() => setCurrency("ARS")}
            style={{
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 700,
              border: currency === "ARS" ? "1px solid var(--brand-primary)" : "1px solid var(--border-line)",
              background: currency === "ARS" ? "var(--brand-primary)" : "#fff",
              color: currency === "ARS" ? "#fff" : "var(--text-main)",
            }}
          >
            ARS $
          </button>
          <button
            type="button"
            onClick={() => setCurrency("USD")}
            style={{
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 700,
              border: currency === "USD" ? "1px solid var(--brand-primary)" : "1px solid var(--border-line)",
              background: currency === "USD" ? "var(--brand-primary)" : "#fff",
              color: currency === "USD" ? "#fff" : "var(--text-main)",
            }}
          >
            USD u$s
          </button>
        </div>
      </div>

      {/* Buscador y advertencia de escáner */}
      <div>
        <div style={{ position: "relative", marginBottom: "4px" }}>
          <Search size={13} style={{ position: "absolute", left: "9px", top: "8px", color: "var(--text-muted)" }} />
          <input
            type="text"
            placeholder="Escanear código de barras o buscar por nombre (Enter agrega)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: "100%", padding: "6px 8px 6px 28px", borderRadius: "6px", border: "1px solid var(--border-line)", fontSize: "11px" }}
          />
        </div>
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", padding: "5px 8px", borderRadius: "5px", color: "#c2410c", display: "flex", alignItems: "center", gap: "5px", fontSize: "10.5px" }}>
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          <span><strong>Aviso de Escáner:</strong> El lector óptico físico USB aún no está conectado. Tipeá el nombre o código interno a mano con teclado.</span>
        </div>
      </div>

      {/* Selector de variante y productos rápidos */}
      <div style={{ background: "var(--canvas-bg)", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border-line)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)" }}>Catálogo Rápido:</span>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Color p/ Fundas:</span>
            {(["Negro", "Azul", "Rosa"] as const).map((col) => (
              <button
                key={col}
                type="button"
                onClick={() => setSelectedVariant(col)}
                style={{
                  padding: "1px 5px",
                  fontSize: "9.5px",
                  borderRadius: "3px",
                  border: selectedVariant === col ? "1px solid var(--brand-primary)" : "1px solid var(--border-line)",
                  background: selectedVariant === col ? "var(--brand-primary)" : "#fff",
                  color: selectedVariant === col ? "#fff" : "var(--text-main)",
                }}
              >
                {col}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {availableProducts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addToCart(p)}
              style={{
                background: "#fff",
                border: "1px solid var(--border-line)",
                padding: "3px 6px",
                borderRadius: "4px",
                fontSize: "10.5px",
                cursor: "pointer",
              }}
            >
              + {p.name} {p.hasVariants ? `(${selectedVariant})` : ""} <strong>${p.price.toLocaleString("es-AR")}</strong>
            </button>
          ))}
        </div>
      </div>

      {/* Lista del carrito */}
      <div style={{ flex: 1, border: "1px solid var(--border-line)", borderRadius: "6px", padding: "6px", background: "#fff", overflowY: "auto", minHeight: "85px" }}>
        {cart.length === 0 ? (
          <p style={{ color: "var(--text-muted)", textAlign: "center", margin: "14px 0", fontSize: "11px" }}>Carrito vacío. Agregá productos arriba.</p>
        ) : (
          cart.map((item, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px", paddingBottom: "4px", borderBottom: "1px dashed #e2e8f0" }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{item.name}</span>
                {item.variant && <span style={{ marginLeft: "4px", fontSize: "9.5px", background: "var(--canvas-bg)", padding: "1px 4px", borderRadius: "3px" }}>{item.variant}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <button type="button" onClick={() => updateQty(item.id, item.variant, -1)} style={{ padding: "0 5px", border: "1px solid #cbd5e1", borderRadius: "3px", background: "var(--canvas-bg)" }}>-</button>
                <span style={{ fontWeight: 700, minWidth: "14px", textAlign: "center" }}>{item.qty}</span>
                <button type="button" onClick={() => updateQty(item.id, item.variant, 1)} style={{ padding: "0 5px", border: "1px solid #cbd5e1", borderRadius: "3px", background: "var(--canvas-bg)" }}>+</button>
                <span style={{ minWidth: "55px", textAlign: "right", fontWeight: 700 }}>${(item.price * item.qty).toLocaleString("es-AR")}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Medios de Pago y Total */}
      <div style={{ background: "var(--canvas-bg)", padding: "8px", borderRadius: "6px", border: "1px solid var(--border-line)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <span style={{ fontWeight: 600, fontSize: "11px" }}>Medio de pago:</span>
          <div style={{ display: "flex", gap: "3px" }}>
            {(["cash", "card", "qr", "transfer"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPaymentMethod(m)}
                style={{
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontSize: "10px",
                  border: paymentMethod === m ? "1px solid var(--brand-primary)" : "1px solid var(--border-line)",
                  background: paymentMethod === m ? "var(--brand-primary)" : "#fff",
                  color: paymentMethod === m ? "#fff" : "var(--text-main)",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {m === "cash" ? "Efectivo" : m === "card" ? "Tarjeta" : m === "qr" ? "QR MP" : "Transf."}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px dashed var(--border-line)", paddingTop: "6px" }}>
          <div>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Total a Cobrar:</span>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--brand-primary)" }}>
              {currency === "ARS" ? `$${totalArs.toLocaleString("es-AR")} ARS` : `u$s ${totalUsd} USD`}
            </div>
          </div>
          <button
            type="button"
            disabled={cart.length === 0}
            onClick={() => setSaleFinished(true)}
            style={{
              background: cart.length > 0 ? "var(--emerald-success)" : "#94a3b8",
              color: "#fff",
              border: "none",
              padding: "5px 12px",
              borderRadius: "6px",
              fontWeight: 700,
              cursor: cart.length > 0 ? "pointer" : "not-allowed",
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <CheckCircle2 size={13} /> Cobrar y Emitir Ticket
          </button>
        </div>
      </div>

      {saleFinished && (
        <div style={{ background: "var(--emerald-soft)", border: "1px solid var(--emerald-border)", padding: "6px 8px", borderRadius: "5px", color: "var(--emerald-hover)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
          <span><strong>¡Venta completada!</strong> Ticket #0001-000482 emitido. Stock descontado atómicamente.</span>
          <button type="button" onClick={() => setCart([])} style={{ fontSize: "9.5px", padding: "1px 5px", background: "#fff", border: "1px solid var(--emerald-border)", borderRadius: "3px" }}>Limpiar</button>
        </div>
      )}
    </div>
  );
};

// 2. CASH INTERACTIVE
export const MockCashInteractive: React.FC = () => {
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [openingAmount, setOpeningAmount] = useState(20000);
  const [movements, setMovements] = useState<Array<{ id: string; desc: string; amount: number; type: "in" | "out" }>>([
    { id: "1", desc: "Venta mostrador ticket #481", amount: 18500, type: "in" },
  ]);
  const [movementReason, setMovementReason] = useState("");
  const [movementAmount, setMovementAmount] = useState(3000);
  const [blindCount, setBlindCount] = useState(35500);
  const [closedSummary, setClosedSummary] = useState<string | null>(null);

  const totalIn = movements.filter((m) => m.type === "in").reduce((a, b) => a + b.amount, 0);
  const totalOut = movements.filter((m) => m.type === "out").reduce((a, b) => a + b.amount, 0);
  const theoreticalBalance = isSessionOpen ? openingAmount + totalIn - totalOut : 0;
  const difference = blindCount - theoreticalBalance;

  const handleOpen = () => {
    setIsSessionOpen(true);
    setClosedSummary(null);
  };

  const addManualMovement = (type: "in" | "out") => {
    if (!movementReason) return;
    setMovements((prev) => [
      ...prev,
      { id: String(Date.now()), desc: movementReason, amount: movementAmount, type },
    ]);
    setMovementReason("");
  };

  const handleClose = () => {
    const diffText = difference === 0 ? "¡Cuadre exacto ($0)!" : difference > 0 ? `Sobrante: +$${difference.toLocaleString("es-AR")}` : `Faltante: -$${Math.abs(difference).toLocaleString("es-AR")}`;
    setClosedSummary(`Caja cerrada por Operador NicTech. Teórico: $${theoreticalBalance.toLocaleString("es-AR")}. Contado: $${blindCount.toLocaleString("es-AR")}. Resultado: ${diffText}`);
    setIsSessionOpen(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", height: "100%", fontSize: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-line)", paddingBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, color: "var(--brand-primary)" }}>
          <Wallet size={15} />
          <span>Gestión de Turnos, Arqueo Ciego y Movimientos</span>
        </div>
        <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", background: isSessionOpen ? "var(--emerald-soft)" : "var(--rose-soft)", color: isSessionOpen ? "var(--emerald-hover)" : "var(--rose-accent)" }}>
          {isSessionOpen ? "● Turno Abierto" : "○ Caja Cerrada"}
        </span>
      </div>

      {!isSessionOpen ? (
        <div style={{ background: "#fff", border: "1px solid var(--border-line)", borderRadius: "8px", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <strong style={{ fontSize: "13px" }}>Paso Obligatorio: Apertura de Turno Matutino</strong>
          <p style={{ color: "var(--text-muted)", fontSize: "11px", margin: 0 }}>
            Antes de cobrar un solo peso en efectivo, contá los billetes en el cajón físico e ingresá el valor exacto como fondo de cambio.
          </p>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <label style={{ fontWeight: 600 }}>Fondo Inicial ($):</label>
            <input
              type="number"
              value={openingAmount}
              onChange={(e) => setOpeningAmount(Number(e.target.value))}
              style={{ width: "100px", padding: "5px", borderRadius: "4px", border: "1px solid var(--border-line)", fontWeight: 700 }}
            />
            <button
              type="button"
              onClick={handleOpen}
              style={{ background: "var(--brand-primary)", color: "#fff", border: "none", padding: "5px 12px", borderRadius: "5px", fontWeight: 700, cursor: "pointer" }}
            >
              Abrir Turno
            </button>
          </div>
          {closedSummary && (
            <div style={{ background: "var(--emerald-soft)", color: "var(--emerald-hover)", padding: "8px", borderRadius: "6px", fontSize: "11px", marginTop: "6px" }}>
              {closedSummary}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
            <div style={{ background: "#fff", padding: "6px", borderRadius: "6px", border: "1px solid var(--border-line)" }}>
              <span style={{ fontSize: "9.5px", color: "var(--text-muted)" }}>Fondo Inicial:</span>
              <div style={{ fontWeight: 700 }}>${openingAmount.toLocaleString("es-AR")}</div>
            </div>
            <div style={{ background: "#fff", padding: "6px", borderRadius: "6px", border: "1px solid var(--border-line)" }}>
              <span style={{ fontSize: "9.5px", color: "var(--emerald-hover)" }}>Ingresos / Ventas:</span>
              <div style={{ fontWeight: 700, color: "var(--emerald-hover)" }}>+${totalIn.toLocaleString("es-AR")}</div>
            </div>
            <div style={{ background: "#fff", padding: "6px", borderRadius: "6px", border: "1px solid var(--border-line)" }}>
              <span style={{ fontSize: "9.5px", color: "var(--rose-accent)" }}>Egresos / Gastos:</span>
              <div style={{ fontWeight: 700, color: "var(--rose-accent)" }}>-${totalOut.toLocaleString("es-AR")}</div>
            </div>
          </div>

          <div style={{ background: "var(--brand-soft)", padding: "6px 10px", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px" }}>Saldo Teórico Esperado en Cajón:</span>
            <strong style={{ fontSize: "14px", color: "var(--brand-navy)" }}>${theoreticalBalance.toLocaleString("es-AR")} ARS</strong>
          </div>

          <div style={{ border: "1px solid var(--border-line)", borderRadius: "6px", padding: "6px", background: "#fff" }}>
            <span style={{ fontSize: "10.5px", fontWeight: 700, display: "block", marginBottom: "4px" }}>
              Movimiento Manual (Gastos menores, cambio, etc.):
            </span>
            <div style={{ display: "flex", gap: "4px" }}>
              <input
                type="text"
                placeholder="Motivo (ej: Flete de repuestos, Café)..."
                value={movementReason}
                onChange={(e) => setMovementReason(e.target.value)}
                style={{ flex: 1, padding: "4px 6px", borderRadius: "4px", border: "1px solid var(--border-line)", fontSize: "10.5px" }}
              />
              <input
                type="number"
                value={movementAmount}
                onChange={(e) => setMovementAmount(Number(e.target.value))}
                style={{ width: "65px", padding: "4px", borderRadius: "4px", border: "1px solid var(--border-line)", fontSize: "10.5px" }}
              />
              <button
                type="button"
                onClick={() => addManualMovement("out")}
                style={{ background: "var(--rose-accent)", color: "#fff", border: "none", padding: "3px 6px", borderRadius: "4px", fontSize: "10px", cursor: "pointer", fontWeight: 600 }}
              >
                Egreso (-)
              </button>
              <button
                type="button"
                onClick={() => addManualMovement("in")}
                style={{ background: "var(--emerald-success)", color: "#fff", border: "none", padding: "3px 6px", borderRadius: "4px", fontSize: "10px", cursor: "pointer", fontWeight: 600 }}
              >
                Ingreso (+)
              </button>
            </div>
          </div>

          <div style={{ background: "var(--canvas-bg)", border: "1px solid var(--border-line)", padding: "8px", borderRadius: "6px", marginTop: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <strong style={{ fontSize: "11px" }}>Arqueo Ciego al Cierre de Turno:</strong>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ fontSize: "10.5px" }}>Contado físico: $</span>
                <input
                  type="number"
                  value={blindCount}
                  onChange={(e) => setBlindCount(Number(e.target.value))}
                  style={{ width: "80px", padding: "3px", borderRadius: "4px", border: "1px solid var(--border-line)", fontWeight: 700 }}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "10.5px", color: difference === 0 ? "var(--emerald-hover)" : "var(--rose-accent)", fontWeight: 700 }}>
                {difference === 0 ? "✓ Cuadre perfecto" : difference > 0 ? `Sobrante: +$${difference.toLocaleString("es-AR")}` : `Faltante: -$${Math.abs(difference).toLocaleString("es-AR")}`}
              </span>
              <button
                type="button"
                onClick={handleClose}
                style={{ background: "var(--brand-navy)", color: "#fff", border: "none", padding: "5px 12px", borderRadius: "5px", fontWeight: 700, cursor: "pointer", fontSize: "11px" }}
              >
                Cerrar Turno Definitivo
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// 3. REPAIRS INTERACTIVE
export const MockRepairsInteractive: React.FC = () => {
  const [deviceModel, setDeviceModel] = useState("iPhone 11");
  const [clientName, setClientName] = useState("Gonzalo Ramírez");
  const [issue, setIssue] = useState("Pantalla rota y batería agotada");
  const [trackingCode] = useState("NT-8492-X");
  const [status, setStatus] = useState<"recibido" | "diagnostico" | "reparacion" | "control" | "listo">("recibido");
  const [partConsumed, setPartConsumed] = useState(false);
  const [qcChecked, setQcChecked] = useState(false);

  const statuses = [
    { key: "recibido", label: "1. Recibido" },
    { key: "diagnostico", label: "2. Diagnóstico" },
    { key: "reparacion", label: "3. Taller" },
    { key: "control", label: "4. Control QC" },
    { key: "listo", label: "5. Listo p/ Entrega" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", height: "100%", fontSize: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-line)", paddingBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, color: "var(--brand-primary)" }}>
          <Wrench size={15} />
          <span>Ficha Técnica de Taller: Orden #OT-984</span>
        </div>
        <span style={{ fontSize: "11px", background: "var(--brand-soft)", color: "var(--brand-primary)", padding: "2px 8px", borderRadius: "6px", fontWeight: 700 }}>
          Tracking: {trackingCode}
        </span>
      </div>

      <div style={{ background: "#fff", border: "1px solid var(--border-line)", borderRadius: "6px", padding: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
        <div>
          <span style={{ fontSize: "9.5px", color: "var(--text-muted)" }}>Cliente / Contacto:</span>
          <div style={{ fontWeight: 700 }}>{clientName}</div>
        </div>
        <div>
          <span style={{ fontSize: "9.5px", color: "var(--text-muted)" }}>Dispositivo:</span>
          <div style={{ fontWeight: 700 }}>{deviceModel}</div>
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <span style={{ fontSize: "9.5px", color: "var(--text-muted)" }}>Falla manifestada en recepción:</span>
          <div style={{ fontWeight: 500 }}>{issue}</div>
        </div>
      </div>

      {/* Acciones de taller: Consumo de repuesto y Test QC */}
      <div style={{ display: "flex", gap: "6px" }}>
        <button
          type="button"
          onClick={() => setPartConsumed(!partConsumed)}
          style={{
            flex: 1,
            padding: "5px",
            borderRadius: "5px",
            border: "1px solid var(--border-line)",
            background: partConsumed ? "var(--emerald-soft)" : "var(--canvas-bg)",
            color: partConsumed ? "var(--emerald-hover)" : "var(--text-main)",
            fontWeight: 600,
            fontSize: "10.5px",
            cursor: "pointer",
          }}
        >
          {partConsumed ? "✓ Repuesto Asignado (Módulo OLED iPhone 11)" : "+ Asignar Repuesto de Stock"}
        </button>
        <button
          type="button"
          onClick={() => setQcChecked(!qcChecked)}
          style={{
            flex: 1,
            padding: "5px",
            borderRadius: "5px",
            border: "1px solid var(--border-line)",
            background: qcChecked ? "var(--emerald-soft)" : "var(--canvas-bg)",
            color: qcChecked ? "var(--emerald-hover)" : "var(--text-main)",
            fontWeight: 600,
            fontSize: "10.5px",
            cursor: "pointer",
          }}
        >
          {qcChecked ? "✓ Protocolo QC Aprobado (5/5 tests)" : "📋 Registrar Pruebas QC"}
        </button>
      </div>

      {/* Pipeline de estados */}
      <div>
        <span style={{ fontSize: "10.5px", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
          Avanzar estado del equipo (actualiza en vivo la web pública):
        </span>
        <div style={{ display: "flex", gap: "3px" }}>
          {statuses.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatus(s.key as any)}
              style={{
                flex: 1,
                padding: "5px 2px",
                borderRadius: "4px",
                fontSize: "9.5px",
                border: status === s.key ? "1px solid var(--brand-primary)" : "1px solid var(--border-line)",
                background: status === s.key ? "var(--brand-primary)" : "var(--canvas-bg)",
                color: status === s.key ? "#fff" : "var(--text-main)",
                fontWeight: status === s.key ? 700 : 500,
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Qué ve el cliente en la web */}
      <div style={{ background: "var(--canvas-bg)", border: "1px dashed var(--brand-border)", borderRadius: "6px", padding: "8px 10px", marginTop: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px", color: "var(--brand-navy)", fontWeight: 700, fontSize: "11px", marginBottom: "2px" }}>
          <Sparkles size={12} />
          <span>Lo que lee el cliente en nictech.com.ar/seguimiento ({trackingCode}):</span>
        </div>
        <p style={{ margin: 0, fontSize: "11px", color: "#334155" }}>
          {status === "recibido" && "Ingresado en mostrador. A la espera de apertura técnica y diagnóstico."}
          {status === "diagnostico" && "Técnico testeando placa y consumos. Presupuesto en confección."}
          {status === "reparacion" && "Reparación activa en taller. Instalando repuestos originales."}
          {status === "control" && "Pruebas de calidad post-reparación (cámaras, micrófono, carga y señal OK)."}
          {status === "listo" && "🎉 ¡Equipo listo para retirar en NicTech! Presentate con tu DNI físico."}
        </p>
      </div>
    </div>
  );
};

// 4. STOCK & ALMACÉN INTERACTIVE
export const MockStockInteractive: React.FC = () => {
  const [stockItem, setStockItem] = useState({ name: "Pantalla OLED iPhone 13 Original", stockReal: 6, stockReservado: 2 });
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", height: "100%", fontSize: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-line)", paddingBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, color: "var(--brand-primary)" }}>
          <Boxes size={15} />
          <span>Control de Existencias & Reservas: Depósito Central</span>
        </div>
        <span style={{ fontSize: "10.5px", background: "var(--emerald-soft)", color: "var(--emerald-hover)", padding: "2px 8px", borderRadius: "10px", fontWeight: 600 }}>
          Urdinarrain #01
        </span>
      </div>

      <div style={{ background: "#fff", border: "1px solid var(--border-line)", borderRadius: "8px", padding: "10px" }}>
        <strong style={{ fontSize: "12.5px" }}>{stockItem.name}</strong>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginTop: "8px" }}>
          <div style={{ background: "var(--canvas-bg)", padding: "6px", borderRadius: "4px" }}>
            <span style={{ fontSize: "9.5px", color: "var(--text-muted)" }}>Stock Físico Real:</span>
            <div style={{ fontSize: "15px", fontWeight: 800 }}>{stockItem.stockReal} un.</div>
          </div>
          <div style={{ background: "var(--amber-soft)", padding: "6px", borderRadius: "4px", color: "var(--amber-accent)" }}>
            <span style={{ fontSize: "9.5px" }}>Reservado Taller/Web:</span>
            <div style={{ fontSize: "15px", fontWeight: 800 }}>{stockItem.stockReservado} un.</div>
          </div>
          <div style={{ background: "var(--emerald-soft)", padding: "6px", borderRadius: "4px", color: "var(--emerald-hover)" }}>
            <span style={{ fontSize: "9.5px" }}>Disponible Mostrador:</span>
            <div style={{ fontSize: "15px", fontWeight: 800 }}>{stockItem.stockReal - stockItem.stockReservado} un.</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "6px" }}>
        <button
          type="button"
          onClick={() => {
            setStockItem((prev) => ({ ...prev, stockReal: prev.stockReal + 5 }));
            setFeedback("+5 unidades recepcionadas de proveedor mayorista.");
          }}
          style={{ flex: 1, background: "var(--brand-primary)", color: "#fff", border: "none", padding: "5px 10px", borderRadius: "5px", fontWeight: 600, cursor: "pointer", fontSize: "10.5px" }}
        >
          + Entrada Proveedor (+5)
        </button>
        <button
          type="button"
          onClick={() => {
            if (stockItem.stockReal > 0) {
              setStockItem((prev) => ({ ...prev, stockReal: prev.stockReal - 1 }));
              setFeedback("-1 unidad descontada por merma o rotura técnica.");
            }
          }}
          style={{ flex: 1, background: "#fff", border: "1px solid var(--rose-border)", color: "var(--rose-accent)", padding: "5px 10px", borderRadius: "5px", fontWeight: 600, cursor: "pointer", fontSize: "10.5px" }}
        >
          - Merma / Rotura (-1)
        </button>
      </div>

      {feedback && (
        <div style={{ background: "var(--canvas-bg)", border: "1px solid var(--border-line)", padding: "6px 8px", borderRadius: "5px", fontSize: "11px", color: "var(--brand-navy)" }}>
          {feedback}
        </div>
      )}

      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", padding: "8px", borderRadius: "6px", fontSize: "10.5px", color: "#92400e", marginTop: "auto" }}>
        <strong>⚠️ Aclaración Operativa:</strong> La pestaña <em>Conteo físico (pendiente)</em> no tiene aún backend de captura masiva en la nube. Para ajustar diferencias de conteo físico, usá siempre el botón <strong>Ajustar Stock</strong>.
      </div>
    </div>
  );
};

// ============================================================================
// DICCIONARIO COMPLETO DE LOS 19 MÓDULOS DEL ERP NIC-TECH
// ============================================================================

export const ERP_TUTORIALS: Record<string, ModuleTutorial> = {
  // 1. POS
  pos: {
    workspaceId: "pos",
    moduleName: "Punto de Venta (POS)",
    area: "operaciones",
    icon: ShoppingCart,
    tagline: "Ventas de mostrador rápidas, variantes de color y emisión de comprobantes",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido del Punto de Venta?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Buscador de productos, catálogo rápido con variantes (color/capacidad), carrito dinámico, cálculo automático de IVA y descuentos, panel de cobro (Efectivo, Tarjeta, QR MercadoPago, Transferencia) e impresión de ticket comprobante.",
        operationalSense: "Es la caja registradora inteligente del local. El sentido fundamental de este módulo es que NINGÚN producto salga del mostrador sin quedar asentado. Al presionar 'Cobrar', el ERP descuenta el stock de manera instantánea y atómica (para que nadie compre ese mismo producto en la página web simultáneamente) y suma el dinero a la caja del día.",
        explanation: "Acá estás parado cuando tenés a un cliente adelante en el mostrador comprando accesorios, celulares o repuestos. Todo lo que cobres acá impacta en tu caja y en el stock real de la empresa.",
        mockComponent: <MockPosInteractive />,
      },
      {
        stepNumber: 2,
        title: "Búsqueda y Aclaración sobre el Lector de Barras",
        badge: "Paso 2: Búsqueda y Carrito",
        explanation: "Para agregar un artículo a la venta, tipeás en la barra de búsqueda el nombre, marca o código interno del producto. Si el producto tiene variantes (por ejemplo: Auricular Negro o Auricular Blanco), el sistema te desplegará los botones para que elijas el color exacto que se lleva el cliente.",
        limitations: "En la barra de búsqueda verás el texto 'Escanear código de barras o buscar por nombre'. Tené en cuenta que la lectura automática mediante lector de código de barras físico o cámara aún NO está operativa en esta versión. El operador debe buscar escribiendo el nombre o código con el teclado.",
        mockComponent: <MockPosInteractive />,
      },
      {
        stepNumber: 3,
        title: "Cobro Multidivisa, Medios de Pago y Ticket",
        badge: "Paso 3: Cobro y Cierre de Venta",
        explanation: "Una vez cargados los productos, seleccionás la forma de pago:\n• Efectivo: se suma al arqueo del turno actual de Caja.\n• Tarjeta Débito / Crédito: pasás la tarjeta por el posnet físico y confirmás en el ERP.\n• QR MercadoPago: el cliente escanea el QR en mostrador.\nAl presionar 'Cobrar', se emite el comprobante y el stock queda descontado.",
        mockComponent: <MockPosInteractive />,
      },
    ],
  },

  // 2. CAJA
  cash: {
    workspaceId: "cash",
    moduleName: "Caja y Arqueo de Fondos",
    area: "operaciones",
    icon: Wallet,
    tagline: "Apertura obligatoria de turno, control de efectivo, gastos y arqueo ciego",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y por qué es vital el módulo de Caja?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Pantalla de apertura de turno con conteo inicial (fondo de cambio), panel de balance en tiempo real, registro de ingresos/egresos manuales con motivo, historial de cierres y arqueo ciego comparativo.",
        operationalSense: "Sin control de caja no hay negocio sano. El sentido de este módulo es evitar faltantes de plata, robos hormiga y descontrol al final del día. Cada turno de trabajo es una 'caja cerrada': el que abre cuenta cuánto dinero recibe de cambio, todas las ventas en efectivo entran automáticamente acá, y cada peso que se saca para comprar insumos o pagar envíos se anota como egreso.",
        explanation: "Si no abrís la caja a la mañana, el sistema no te dejará procesar ventas en efectivo porque no tiene dónde imputarlas. A la noche, contás la plata real que hay en el cajón y el sistema te dice si sobra, si coincide o si falta un solo centavo.",
        mockComponent: <MockCashInteractive />,
      },
      {
        stepNumber: 2,
        title: "Apertura de Turno & Fondo de Cambio",
        badge: "Paso 2: Inicio de Turno",
        explanation: "Al comenzar la jornada o tu turno laboral:\n1. Contá físicamente los billetes que dejó el turno anterior en el cajón.\n2. Presioná 'Abrir Turno' e ingresá ese monto exacto como Fondo Inicial.\n3. A partir de ese segundo, tu terminal queda habilitada para cobrar en efectivo.",
        limitations: "No abras dos turnos en la misma terminal sin cerrar el anterior. Si hay cambio de operador a la tarde, se cierra el turno de la mañana con su arqueo y el nuevo operador abre su propio turno.",
        mockComponent: <MockCashInteractive />,
      },
      {
        stepNumber: 3,
        title: "Movimientos Manuales y Arqueo Ciego al Cierre",
        badge: "Paso 3: Cierre y Arqueo",
        explanation: "¿Tuviste que pagarle $3.000 al cadete de la moto o comprar cinta de embalar? Tenés que registrar un 'Egreso Manual' indicando el motivo. Si no lo registrás, a la noche te va a faltar plata en el arqueo y el responsable sos vos.\nAl cerrar el turno, contás los billetes reales en el cajón y le das a 'Cerrar Turno'. El ERP archiva el informe inmutable comparando el teórico contra el real.",
        mockComponent: <MockCashInteractive />,
      },
    ],
  },

  // 3. REPARACIONES
  repairs: {
    workspaceId: "repairs",
    moduleName: "Servicio Técnico & Taller",
    area: "taller",
    icon: Wrench,
    tagline: "Recepción con checklist, asignación de repuestos, tracking web y garantías",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Reparaciones?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Fichas de ingreso de equipos con datos del cliente y clave de desbloqueo, checklist de recepción (estado estético, cámaras, encendido), seguimiento por estados, vinculación de repuestos consumidos, cotización y código de seguimiento web.",
        operationalSense: "La principal queja en un taller de celulares y PC es la desconfianza del cliente ('mi celular andaba bien y me lo rompieron') o la pérdida de tiempo atendiendo mensajes de '¿ya está listo mi teléfono?'. Este módulo resuelve ambos problemas: genera una constancia formal de cómo entró el equipo, y crea un código de seguimiento para que el cliente lo consulte solo desde la web.",
        explanation: "Cada equipo que te dejan en el mostrador para reparar tiene que entrar por acá. Nunca recibas un equipo 'de palabra' ni en un papelito.",
        mockComponent: <MockRepairsInteractive />,
      },
      {
        stepNumber: 2,
        title: "Ingreso, Checklist & Código de Seguimiento",
        badge: "Paso 2: Recepción",
        explanation: "Al ingresar un dispositivo:\n1. Cargás Nombre, DNI y Teléfono del cliente.\n2. Seleccionás Marca, Modelo y falla informada.\n3. Hacés el checklist rápido: ¿La pantalla está astillada? ¿Las cámaras andan? ¿Enciende?\n4. El sistema genera el 'Código de Seguimiento' (ej: NT-8492-X). Entregale este código al cliente para que vea el progreso en nictech.com.ar/seguimiento.",
        mockComponent: <MockRepairsInteractive />,
      },
      {
        stepNumber: 3,
        title: "Consumo de Repuestos, Pruebas QC y Garantía",
        badge: "Paso 3: Taller y Entrega",
        explanation: "Cuando el técnico desarmó el equipo y sabe qué repuesto necesita, asigna la pieza desde el stock del ERP (quedando reservada para esta orden). Al terminar el trabajo, ejecuta las pruebas de calidad (QC). Finalmente se marca como 'Listo para retirar' y se cobra al entregar con su garantía oficial de 90 días.",
        mockComponent: <MockRepairsInteractive />,
      },
    ],
  },

  // 4. STOCK
  stock: {
    workspaceId: "stock",
    moduleName: "Stock y Almacén",
    area: "inventario",
    icon: Boxes,
    tagline: "Existencias en tiempo real, múltiples depósitos, reserva de repuestos y ajustes",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido del módulo de Stock?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Vista de inventario disponible por sucursal y depósito, desglose entre stock físico real y stock comprometido (reservado para taller o pedidos web), ajustes manuales de entrada/salida y trazabilidad por número de serie / IMEI.",
        operationalSense: "El sentido de este módulo es saber con precisión matemática qué mercadería tenés físicamente en el local para no vender cosas que no existen. Además, distingue el 'Stock Disponible' del 'Stock Reservado' (por ejemplo, si una pantalla ya está asignada a la reparación de un cliente, no se le puede vender a alguien que entra al local).",
        explanation: "Acá consultás si hay stock de cualquier funda, cable, cargador o repuesto antes de confirmarle a un cliente.",
        mockComponent: <MockStockInteractive />,
      },
      {
        stepNumber: 2,
        title: "Entradas, Mermas y Ajustes de Stock",
        badge: "Paso 2: Movimientos",
        explanation: "Si llegó mercadería de un distribuidor que compraste directamente en efectivo o si un técnico rompió un módulo probándolo, usá 'Ajuste de Stock'. Cada ajuste te pide un motivo obligatorio para que los socios o encargados sepan por qué subió o bajó el inventario.",
        limitations: "La funcionalidad de 'Conteo físico masivo' con planilla de auditoría figura como 'pendiente' en la solapa superior porque se está refinando el backend para la Etapa 3. Si necesitas regularizar el stock de un producto ahora, hacelo con el botón 'Ajustar Stock'.",
        mockComponent: <MockStockInteractive />,
      },
    ],
  },

  // 5. PEDIDOS ONLINE
  "online-orders": {
    workspaceId: "online-orders",
    moduleName: "Pedidos Online (Web Storefront)",
    area: "operaciones",
    icon: ShoppingBag,
    tagline: "Compras de la web con MercadoPago, apartado de mercadería y entrega segura",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Pedidos Online?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Bandeja de pedidos que ingresan desde la tienda online (nictech.com.ar/tienda), verificación del estado del pago en MercadoPago, preparación de paquetes, y validación contra DNI físico al momento del retiro en tienda.",
        operationalSense: "Conecta la tienda virtual con el depósito del local físico. Cuando alguien compra por internet a la madrugada, el pedido aparece acá. El sentido es que el personal del local empaquete y separe el producto de las estanterías antes de que alguien en el local físico se lo lleve.",
        explanation: "Apenas llegás al local a la mañana, abrís esta pantalla para ver qué compras entraron por la web y dejarlas preparadas en una bolsa con el nombre del cliente.",
        mockComponent: <MockPosInteractive />,
      },
      {
        stepNumber: 2,
        title: "Protocolo de Entrega en Mostrador (Anti-Fraude)",
        badge: "Paso 2: Entrega Segura",
        explanation: "Cuando el cliente llega al local a retirar su compra web:\n1. Pedile el DNI físico original del titular.\n2. Verificá que el nombre y número coincidan con la orden en pantalla.\n3. Marcá el pedido como 'Entregado' en el ERP.\n¡Nunca entregues una compra web sin verificar el DNI!",
        mockComponent: <MockPosInteractive />,
      },
    ],
  },

  // 6. DASHBOARD
  dashboard: {
    workspaceId: "dashboard",
    moduleName: "Centro Operativo (Dashboard)",
    area: "operaciones",
    icon: LayoutDashboard,
    tagline: "Resumen diario de facturación, estado de cajas y alertas de stock",
    steps: [
      {
        stepNumber: 1,
        title: "¿Para qué sirve el Centro Operativo?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Resumen ejecutivo del día: total facturado en mostrador, cantidad de cajas abiertas, reparaciones ingresadas hoy, pedidos online pendientes de embalar y alertas de stock bajo.",
        operationalSense: "Es la pantalla de inicio del ERP. Su sentido es darte una radiografía de 5 segundos sobre cómo está funcionando el negocio hoy. Te avisa inmediatamente si hay alguna anomalía (por ejemplo, si son las 11 de la mañana y ninguna caja está abierta, o si hay un pedido web demorado).",
        explanation: "No es una pantalla de carga de datos, sino de lectura y supervisión general para dueños, encargados y operadores.",
        mockComponent: <MockCashInteractive />,
      },
    ],
  },

  // 7. CATALOGO
  catalog: {
    workspaceId: "catalog",
    moduleName: "Catálogo y Precios",
    area: "inventario",
    icon: Package,
    tagline: "Catálogo maestro, precios base en USD y cotización automática en pesos",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido del Catálogo?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Fichas técnicas de productos y repuestos, gestión de precios en USD con cotización automática a pesos argentinos, porcentaje de IVA, marcas, categorías y variantes de color/almacenamiento.",
        operationalSense: "En tecnología los costos cambian todo el tiempo al ritmo del dólar. El sentido de este módulo es que puedas fijar el costo de un producto en dólares (ej: Pantalla OLED $30 USD), y el sistema calcula automáticamente el precio de venta en pesos según la cotización del día, sin tener que remarcar 500 productos a mano.",
        explanation: "Acá se da de alta un producto nuevo antes de que pueda ser vendido en el mostrador o en la web.",
        mockComponent: <MockStockInteractive />,
      },
    ],
  },

  // 8. PC BUILDS
  "pc-builds": {
    workspaceId: "pc-builds",
    moduleName: "Armados de PC",
    area: "taller",
    icon: Cpu,
    tagline: "Armados a medida, chequeo de compatibilidad de sockets y reserva de componentes",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Armados de PC?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Selector guiado de hardware (Procesador, Motherboard, RAM, Placa de Video, Fuente, Gabinete, Almacenamiento), chequeo automático de socket y consumo eléctrico (Watts), y reserva de componentes en stock por 48 horas.",
        operationalSense: "Armar una PC gamer o de oficina requiere asegurar que las piezas sean compatibles (que el procesador entre en el socket del mother, que la fuente soporte el consumo de la placa de video) y apartar esas piezas para que no se vendan sueltas mientras el cliente aprueba la compra.",
        explanation: "Si viene un cliente pidiendo presupuesto para armar una computadora completa, lo cargás acá para no cometer errores técnicos.",
        mockComponent: <MockRepairsInteractive />,
      },
    ],
  },

  // 9. TRADE INS
  "trade-ins": {
    workspaceId: "trade-ins",
    moduleName: "Equipos Usados & Canjes (Trade-Ins)",
    area: "taller",
    icon: RefreshCw,
    tagline: "Plan canje de celulares, verificación de IMEI/iCloud y cuarentena técnica",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Equipos Usados?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Ficha de evaluación técnica de dispositivos usados que los clientes entregan como parte de pago para comprar uno nuevo (trade-in), cálculo de valor de toma según desgaste estético y salud de batería, y envío a cuarentena técnica.",
        operationalSense: "Evita que el local acepte teléfonos con cuentas bloqueadas (iCloud / Google), celulares denunciados como robados, o equipos con fallas ocultas que después no se puedan vender.",
        explanation: "Cuando un cliente dice '¿cuánto me tomás este iPhone 11 por el 13?', abrís este módulo, hacés el checklist y el sistema te da el valor máximo que podés descontarle.",
        mockComponent: <MockRepairsInteractive />,
      },
    ],
  },

  // 10. COMPRAS
  purchases: {
    workspaceId: "purchases",
    moduleName: "Compras y Proveedores",
    area: "comercial",
    icon: Building2,
    tagline: "Órdenes de compra a mayoristas, ingreso de remitos y actualización de stock",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Compras?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Fichas de proveedores mayoristas, emisión de órdenes de compra, control de recepciones contra remitos y registración de facturas de compra para actualizar automáticamente el stock y los costos de reposición.",
        operationalSense: "Garantiza que cada caja que llega del correo o del distribuidor sea cotejada contra lo que realmente se pagó. Al confirmar la recepción, el stock ingresa a los depósitos sin tener que cargar ítem por ítem a mano.",
        explanation: "Se utiliza cada vez que comprás repuestos o accesorios a los proveedores mayoristas.",
        mockComponent: <MockStockInteractive />,
      },
    ],
  },

  // 11. CLIENTES
  customers: {
    workspaceId: "customers",
    moduleName: "Clientes & Historial",
    area: "comercial",
    icon: Users,
    tagline: "Base de datos unificada, historial de compras, reparaciones y cuentas corrientes",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido del módulo de Clientes?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Directorio de clientes particulares y empresas, historial completo de todas sus compras y reparaciones anteriores, equipos que tiene registrados y estado de su saldo deudor.",
        operationalSense: "Saber quién te está comprando. Si entra un cliente diciendo 'se me rompió de vuelta lo que me arreglaron el mes pasado', buscas su DNI o apellido acá y ves al instante qué día vino, qué técnico lo atendió y si está en garantía.",
        explanation: "Toda venta o reparación registrada en el ERP vincula automáticamente al cliente a esta base unificada.",
        mockComponent: <MockRepairsInteractive />,
      },
    ],
  },

  // 12. PRESUPUESTOS
  quotes: {
    workspaceId: "quotes",
    moduleName: "Presupuestos Comerciales",
    area: "comercial",
    icon: FileText,
    tagline: "Cotizaciones formales en PDF con fecha de validez para empresas y clientes",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Presupuestos?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Emisión de presupuestos formales para reparaciones complejas, armados de PC o ventas corporativas, con plazo de validez estricto (ej: válido por 5 días) y exportación directa en formato PDF para enviar por WhatsApp.",
        operationalSense: "En Argentina los precios varían seguido. Un presupuesto formal fija las condiciones por unos días para que el cliente decida sin riesgo de que le cambies el precio mañana, pero vence automáticamente para proteger el margen de la empresa si el dólar se dispara.",
        explanation: "Si una empresa o un particular te pide una cotización por escrito, la generás acá.",
        mockComponent: <MockPosInteractive />,
      },
    ],
  },

  // 13. CUENTAS CORRIENTES
  accounts: {
    workspaceId: "accounts",
    moduleName: "Cuentas Corrientes & Financiación",
    area: "finanzas",
    icon: CreditCard,
    tagline: "Control de saldos fiados, cuotas fijas, límites de crédito y cobranzas",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Cuentas Corrientes?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Gestión de clientes de confianza y empresas a las que se les permite retirar mercadería o retirar equipos reparados 'a cuenta', registrando entregas de dinero a cuenta, saldos pendientes y fechas límites de cobro.",
        operationalSense: "Permite 'fiar' de manera profesional y controlada. Cada peso que un cliente queda debiendo queda registrado con fecha y hora. El operador puede ver de un vistazo qué clientes están morosos y bloquearles nuevos retiros.",
        explanation: "Acá registrás cuando un cliente viene a pagar una parte de lo que debía ('te dejo $20.000 a cuenta').",
        mockComponent: <MockCashInteractive />,
      },
    ],
  },

  // 14. CONTABILIDAD
  accounting: {
    workspaceId: "accounting",
    moduleName: "Contabilidad y Rentabilidad",
    area: "finanzas",
    icon: Activity,
    tagline: "Libro diario automático, margen neto limpio y balances de rentabilidad",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Contabilidad?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Asientos contables automáticos por partida doble generados por ventas, compras y pagos, libro diario de períodos mensuales y cálculo de rentabilidad neta (precio de venta menos costo real del repuesto).",
        operationalSense: "Saber si el negocio está ganando plata de verdad. Facturar mucho no siempre significa ganar: si un repuesto te costó $40.000 y lo cobraste $45.000 pero gastaste $8.000 en impuestos y flete, perdiste plata. Este módulo te muestra el margen real limpio.",
        explanation: "Módulo financiero para contadores, socios y administración.",
        mockComponent: <MockCashInteractive />,
      },
    ],
  },

  // 15. DOCUMENTOS Y FACTURAS
  documents: {
    workspaceId: "documents",
    moduleName: "Documentos y Facturación",
    area: "integraciones",
    icon: Receipt,
    tagline: "Emisión de comprobantes de venta, tickets de mostrador y facturación",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Documentos?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Bandeja centralizada de todos los comprobantes emitidos en el ERP (tickets de mostrador, recibos de seña, órdenes de servicio y notas de crédito), con reimpresión térmica o formato A4.",
        operationalSense: "Es el archivo legal y operativo de las operaciones. Si un cliente viene a reclamar un ticket que perdió, acá lo buscas por fecha o importe y lo reimprimís al instante.",
        explanation: "Todo comprobante emitido en el POS o en Reparaciones queda guardado acá inmutablemente.",
        limitations: "Actualmente los comprobantes son de emisión local/interna garantizada en el ERP. La sincronización en línea con los webservices de AFIP/ARCA para Factura Electrónica directa está preparada en arquitectura y su activación depende de la carga de certificados fiscales en producción.",
        mockComponent: <MockPosInteractive />,
      },
    ],
  },

  // 16. WHATSAPP
  whatsapp: {
    workspaceId: "whatsapp",
    moduleName: "WhatsApp y Mensajería",
    area: "integraciones",
    icon: MessageSquare,
    tagline: "Notificaciones automáticas al cliente sobre el estado de su reparación o pedido",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de WhatsApp?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Integración con la API de WhatsApp para disparar mensajes automáticos al celular del cliente: 'Hola Juan, tu equipo ya está listo para retirar en NicTech', 'Presupuesto de tu reparación disponible', o 'Pedido web embalado'.",
        operationalSense: "Ahorra horas de trabajo humano llamando por teléfono o mandando audios uno por uno. El cliente se entera de inmediato en la aplicación que usa todo el día (WhatsApp).",
        explanation: "Si está configurada la instancia, las notificaciones se disparan solas al cambiar de estado en Reparaciones.",
        limitations: "Requiere que la instancia de Evolution API / WhatsApp del local esté conectada con el código QR. Si el celular del local está apagado o sin internet, los mensajes quedan en cola de reintento.",
        mockComponent: <MockRepairsInteractive />,
      },
    ],
  },

  // 17. INTEGRATION HEALTH
  "integration-health": {
    workspaceId: "integration-health",
    moduleName: "Salud de Integraciones & Webhooks",
    area: "integraciones",
    icon: Activity,
    tagline: "Monitoreo en tiempo real de webhooks de Mercado Pago, fallas y reintentos",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Integraciones?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Monitor técnico de eventos entrantes de Mercado Pago, webhooks de pedidos web, colas de sincronización y estado de servicios externos.",
        operationalSense: "Si un cliente dice 'pagué en la web pero me sigue diciendo pendiente', venís acá y ves si Mercado Pago mandó el aviso o si hubo un error de red.",
        explanation: "Módulo de diagnóstico técnico para resolver trabas en pagos online.",
        mockComponent: <MockPosInteractive />,
      },
    ],
  },

  // 18. SISTEMA
  system: {
    workspaceId: "system",
    moduleName: "Configuración, Usuarios y Sucursales",
    area: "sistema",
    icon: Settings,
    tagline: "Permisos de operadores, roles, sucursales físicas y parámetros del ERP",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Configuración?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Alta y baja de operadores y técnicos, asignación de roles (Vendedor, Técnico, Encargado, Administrador), permisos para ver u ocultar costos, y definición de sucursales físicas.",
        operationalSense: "Permite que cada empleado vea únicamente lo que necesita para trabajar. Por ejemplo, un vendedor de mostrador tiene acceso al POS y a Caja, pero no puede ver los costos de los proveedores ni cambiar la configuración fiscal.",
        explanation: "Solo los usuarios con rol de Administrador o Dueño tienen acceso a este módulo.",
        mockComponent: <MockCashInteractive />,
      },
    ],
  },

  // 19. AUDITORIA
  audit: {
    workspaceId: "audit",
    moduleName: "Auditoría del Sistema",
    area: "sistema",
    icon: ShieldCheck,
    tagline: "Registro inmutable de quién hizo qué, cuándo, desde qué terminal y qué cambió",
    steps: [
      {
        stepNumber: 1,
        title: "¿Qué es y cuál es el sentido de Auditoría?",
        badge: "Paso 1: Sentido Operativo",
        isIntroduction: true,
        contentSummary: "Bitácora de seguridad que registra cada acción crítica: modificación de precios, borrado de productos, apertura de caja, cambios de estado en reparaciones y ajustes de stock.",
        operationalSense: "En un sistema donde trabajan varias personas, cuando 'desaparece plata' o 'se modifica un precio sin autorización', nadie suele admitir la culpa. La auditoría es la caja negra del avión: registra con nombre de usuario, fecha exacta e IP quién realizó cada modificación. No se puede borrar ni alterar.",
        explanation: "Módulo de seguridad para dueños y administradores del sistema.",
        mockComponent: <MockStockInteractive />,
      },
    ],
  },
};

export const KEYBOARD_SHORTCUTS = [
  { key: "F2 / Ctrl + K", action: "Abrir buscador rápido general de módulos o workspaces" },
  { key: "Escape", action: "Cerrar modal activo, salir del tutorial o cancelar búsqueda" },
  { key: "Alt + P / Botón '+'", action: "Acceso directo instantáneo al Punto de Venta (POS)" },
  { key: "Alt + C", action: "Ir directo al módulo de Caja y Arqueo" },
  { key: "Alt + T", action: "Ir directo a Servicio Técnico / Taller" },
  { key: "Alt + S", action: "Ir directo al módulo de Stock y Almacén" },
];
