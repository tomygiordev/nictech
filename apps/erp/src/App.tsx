import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type ErpArea,
  type ErpModuleDefinition,
  type ErpModuleId,
  type ErpWorkspaceDefinition,
  type ErpWorkspaceId,
  ERP_MODULES,
  ERP_WORKSPACES,
  getErpModuleById,
  getErpWorkspaceByModuleId,
} from "@nictech/domain";
import {
  type LucideIcon,
  LayoutDashboard,
  Receipt,
  ShoppingCart,
  Boxes,
  Wrench,
  CircleDollarSign,
  Users,
  Settings,
  HelpCircle,
  LogOut,
  Search,
  Plus,
  Bell,
  MessageSquare,
  Menu,
  ChevronLeft,
  Store,
  Layers,
  Sparkles,
  Link2,
} from "lucide-react";
import { ErpAccessGate } from "./auth/ErpAccessGate";
import { useErpAuth } from "./auth/ErpAuthContext";
import { PosWorkspace } from "./features/pos/PosWorkspace";
import { CashWorkspace } from "./features/cash/CashWorkspace";
import { AccountsWorkspace } from "./features/finance/AccountsWorkspace";
import { AccountingWorkspace } from "./features/finance/AccountingWorkspace";
import { DashboardOverview } from "./features/dashboard/DashboardOverview";
import { RepairsWorkspace } from "./features/repairs/RepairsWorkspace";
import { CatalogWorkspace } from "./features/catalog/CatalogWorkspace";
import { StockWorkspace } from "./features/stock/StockWorkspace";
import { CustomersWorkspace } from "./features/customers/CustomersWorkspace";
import { PurchasesWorkspace } from "./features/purchases/PurchasesWorkspace";
import { QuotesWorkspace } from "./features/quotes/QuotesWorkspace";
import { PcBuildsWorkspace } from "./features/pcbuilds/PcBuildsWorkspace";
import { TradeInsWorkspace } from "./features/tradeins/TradeInsWorkspace";
import { OnlineOrdersWorkspace } from "./features/onlineorders/OnlineOrdersWorkspace";
import { DocumentsWorkspace } from "./features/documents/DocumentsWorkspace";
import { WhatsappWorkspace } from "./features/whatsapp/WhatsappWorkspace";
import { IntegrationHealthWorkspace } from "./features/integrations/IntegrationHealthWorkspace";
import { AuditWorkspace } from "./features/audit/AuditWorkspace";
import { SystemWorkspace } from "./features/system/SystemWorkspace";
import { Modal, ConfirmDialog } from "./components/erp/WorkspaceUi";
import { getInitials } from "./lib/formatters";
import { supabase } from "./lib/supabase";
import "./styles.css";

const AREA_LABELS: Record<ErpArea, string> = {
  operaciones: "Operación & Gestión",
  inventario: "Stock & Almacén",
  comercial: "Compras & Clientes",
  taller: "Servicio Técnico",
  finanzas: "Finanzas & Contabilidad",
  integraciones: "Integraciones & Documentos",
  sistema: "Configuración & Sistema",
};

const AREA_ICONS: Record<ErpArea, LucideIcon> = {
  operaciones: LayoutDashboard,
  inventario: Boxes,
  comercial: ShoppingCart,
  taller: Wrench,
  finanzas: CircleDollarSign,
  integraciones: Link2,
  sistema: Settings,
};

const WORKSPACE_CUSTOM_ICONS: Record<ErpWorkspaceId, LucideIcon> = {
  dashboard: LayoutDashboard,
  pos: Store,
  cash: CircleDollarSign,
  "online-orders": ShoppingCart,
  catalog: Boxes,
  stock: Boxes,
  purchases: ShoppingCart,
  customers: Users,
  quotes: Receipt,
  repairs: Wrench,
  "pc-builds": Sparkles,
  "trade-ins": Wrench,
  accounts: Users,
  accounting: Layers,
  documents: Receipt,
  whatsapp: MessageSquare,
  "integration-health": Link2,
  system: Settings,
  audit: Sparkles,
};

const groupedWorkspaces = ERP_WORKSPACES.reduce<Record<ErpArea, ErpWorkspaceDefinition[]>>(
  (acc, ws) => {
    if (!acc[ws.area]) {
      acc[ws.area] = [];
    }
    acc[ws.area].push(ws);
    return acc;
  },
  {} as Record<ErpArea, ErpWorkspaceDefinition[]>,
);

export const App = () => {
  const { session, hasPermission } = useErpAuth();
  const [activeModuleId, setActiveModuleId] = useState<ErpModuleId>("dashboard");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchInputId = useId();

  // Modals & Dialogs
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

  // Global Keyboard Shortcuts (F2 / Ctrl+K / Cmd+K / Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F2 or Cmd/Ctrl + K => Focus Search
      if (e.key === "F2" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === "Escape") {
        if (searchQuery) {
          setSearchQuery("");
          searchInputRef.current?.blur();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchQuery]);

  const activeModule = useMemo(() => {
    return getErpModuleById(activeModuleId) ?? ERP_MODULES[0];
  }, [activeModuleId]);

  const activeWorkspace = useMemo(() => {
    return getErpWorkspaceByModuleId(activeModuleId) ?? ERP_WORKSPACES[0];
  }, [activeModuleId]);

  const operatorName = session?.user.user_metadata?.full_name || "Operador NicTech";
  const userInitials = useMemo(() => getInitials(operatorName, "NT"), [operatorName]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const result: Partial<Record<ErpArea, ErpWorkspaceDefinition[]>> = {};

    for (const [area, workspaces] of Object.entries(groupedWorkspaces)) {
      const visibleInArea = workspaces.filter((ws) => {
        const hasAnyPermission = ws.moduleIds.some((id) => {
          const mod = getErpModuleById(id);
          return mod && hasPermission(mod.permission);
        });
        if (!hasAnyPermission) return false;

        if (!query) return true;

        const matchWs =
          ws.label.toLowerCase().includes(query) ||
          ws.description.toLowerCase().includes(query);
        const matchModule = ws.moduleIds.some((id) => {
          const mod = getErpModuleById(id);
          return (
            mod &&
            (mod.label.toLowerCase().includes(query) ||
              mod.description.toLowerCase().includes(query))
          );
        });
        return matchWs || matchModule;
      });

      if (visibleInArea.length > 0) {
        result[area as ErpArea] = visibleInArea;
      }
    }
    return result;
  }, [searchQuery, hasPermission]);

  const selectModule = (id: ErpModuleId) => {
    setActiveModuleId(id);
    setNavOpen(false);
  };

  const selectWorkspace = (ws: ErpWorkspaceDefinition) => {
    if (ws.moduleIds.includes(activeModuleId) && hasPermission(getErpModuleById(activeModuleId)?.permission ?? "")) {
      setNavOpen(false);
      return;
    }
    const firstAuthorized = ws.moduleIds.find((id) => {
      const mod = getErpModuleById(id);
      return mod && hasPermission(mod.permission);
    });
    if (firstAuthorized) {
      setActiveModuleId(firstAuthorized);
    } else {
      setActiveModuleId(ws.moduleIds[0]);
    }
    setNavOpen(false);
  };

  const handleLogout = async () => {
    try {
      await supabase?.auth.signOut();
    } catch (e) {
      console.error("Error signing out:", e);
    }
    setIsLogoutConfirmOpen(false);
    window.location.reload();
  };

  return (
    <div className="erp-shell">
      {/* Mobile Backdrop */}
      {navOpen && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Cerrar navegación"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`side-nav ${navOpen ? "side-nav--open" : ""}`} aria-label="Navegación del ERP">
        <div className="brand-lockup">
          <div className="brand-title-wrap">
            <div className="brand-logo-mark">N</div>
            <span className="brand-text">
              NicTech <span>ERP</span>
            </span>
          </div>
          <button
            type="button"
            className="sidebar-collapse-btn"
            aria-label="Colapsar menú"
            onClick={() => setNavOpen(false)}
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        <nav className="module-nav">
          {Object.entries(filteredGroups).map(([area, workspaces]) => {
            const typedArea = area as ErpArea;
            const AreaIcon = AREA_ICONS[typedArea] ?? Settings;

            return (
              <div key={area} className="nav-group">
                <div className="nav-group__label">{AREA_LABELS[typedArea]}</div>
                {workspaces?.map((ws) => {
                  const isActive = ws.id === activeWorkspace.id;
                  const IconComponent = WORKSPACE_CUSTOM_ICONS[ws.id] ?? AreaIcon;

                  return (
                    <button
                      key={ws.id}
                      type="button"
                      className={`nav-item ${isActive ? "nav-item--active" : ""}`}
                      onClick={() => selectWorkspace(ws)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <IconComponent size={17} />
                      <span>{ws.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="nav-footer-menu">
          <button type="button" className="nav-footer-btn" onClick={() => setIsHelpOpen(true)}>
            <HelpCircle size={17} />
            <span>Ayuda & Atajos</span>
          </button>
          <button type="button" className="nav-footer-btn" onClick={() => setIsLogoutConfirmOpen(true)}>
            <LogOut size={17} />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <div className="workspace-container">
        {/* Topbar Header */}
        <header className="flow-topbar">
          <div className="flow-topbar__left">
            <h1>{activeModuleId === "dashboard" ? "Centro Operativo" : activeModule.label}</h1>
            <p>
              {activeModuleId === "dashboard"
                ? "Resumen de operaciones y estado del negocio en tiempo real"
                : activeModule.description}
            </p>
          </div>

          <div className="flow-topbar__right">
            {/* Search Pill */}
            <div className="flow-search-pill">
              <Search size={15} />
              <input
                id={searchInputId}
                ref={searchInputRef}
                type="text"
                placeholder="Buscar módulo o workspace..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Buscar módulos y funciones (F2 o ⌘K)"
              />
              <kbd title="Presioná F2 o ⌘K para buscar">⌘ K</kbd>
            </div>

            {/* Quick Action Button: POS */}
            <button
              type="button"
              className="header-action-btn"
              aria-label="Nueva Venta POS"
              onClick={() => selectModule("pos")}
              title="Nueva Venta POS"
            >
              <Plus size={18} />
            </button>

            {/* Notifications Button */}
            <button
              type="button"
              className="header-action-btn"
              aria-label="Notificaciones"
              onClick={() => setIsNotificationsOpen(true)}
              title="Notificaciones y Alertas"
            >
              <Bell size={18} />
              <span className="header-badge">3</span>
            </button>

            {/* WhatsApp / Messaging Button */}
            <button
              type="button"
              className="header-action-btn"
              aria-label="Mensajes"
              onClick={() => selectModule("whatsapp")}
              title="WhatsApp & Mensajes"
            >
              <MessageSquare size={18} />
            </button>

            {/* User Profile Avatar */}
            <button
              type="button"
              className="topbar-avatar-btn"
              aria-label="Perfil de usuario"
              onClick={() => setIsProfileOpen(true)}
              title="Ficha del Operador"
            >
              <span>{userInitials}</span>
            </button>

            {/* Mobile Nav Toggle */}
            <button
              type="button"
              className="header-action-btn mobile-nav-toggle"
              aria-label="Abrir menú de navegación"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={18} />
            </button>
          </div>
        </header>

        {/* Notification Modal */}
        <Modal
          isOpen={isNotificationsOpen}
          onClose={() => setIsNotificationsOpen(false)}
          title="Centro de Notificaciones"
          subtitle="Alertas operativas de e-commerce, stock y laboratorio"
          icon={Bell}
          maxWidth="480px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div
              style={{ padding: "12px", background: "var(--canvas-bg)", borderRadius: "10px", border: "1px solid var(--border-light)", cursor: "pointer" }}
              onClick={() => { setIsNotificationsOpen(false); selectModule("online-orders"); }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                <span className="type-badge green">E-commerce</span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Hace 5 min</span>
              </div>
              <strong style={{ fontSize: "13px", display: "block" }}>Nuevo pedido web recibido</strong>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>Pago aprobado vía Mercado Pago. Listo para preparar despacho.</p>
            </div>

            <div
              style={{ padding: "12px", background: "var(--canvas-bg)", borderRadius: "10px", border: "1px solid var(--border-light)", cursor: "pointer" }}
              onClick={() => { setIsNotificationsOpen(false); selectModule("stock"); }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                <span className="type-badge orange">Alerta de Stock</span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Hace 20 min</span>
              </div>
              <strong style={{ fontSize: "13px", display: "block" }}>Stock bajo en iPhone 15 Pro</strong>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>Quedan 2 unidades en Depósito Central. Revisar reposición.</p>
            </div>

            <div
              style={{ padding: "12px", background: "var(--canvas-bg)", borderRadius: "10px", border: "1px solid var(--border-light)", cursor: "pointer" }}
              onClick={() => { setIsNotificationsOpen(false); selectModule("repairs"); }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                <span className="type-badge blue">Taller</span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Hace 1 hora</span>
              </div>
              <strong style={{ fontSize: "13px", display: "block" }}>Equipo diagnosticado: NT-8492-X</strong>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>Cliente confirmó presupuesto de cambio de módulo OLED.</p>
            </div>
          </div>
        </Modal>

        {/* Profile Modal */}
        <Modal
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
          title="Ficha del Operador"
          subtitle="Información de la sesión y permisos del usuario"
          icon={Users}
          maxWidth="460px"
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
            <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: "var(--brand-primary)", color: "#ffffff", display: "grid", placeItems: "center", fontSize: "18px", fontWeight: 850 }}>
              {userInitials}
            </div>
            <div>
              <strong style={{ fontSize: "16px", display: "block" }}>{operatorName}</strong>
              <span style={{ fontSize: "12px", color: "var(--emerald-success)", fontWeight: 700 }}>● Sesión Activa (Sucursal Central)</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", padding: "12px", background: "var(--canvas-bg)", borderRadius: "10px", marginBottom: "16px" }}>
            <div>
              <span className="stat-label">Rol</span>
              <strong style={{ fontSize: "13px", display: "block" }}>Super Administrador</strong>
            </div>
            <div>
              <span className="stat-label">Sucursal</span>
              <strong style={{ fontSize: "13px", display: "block" }}>Central (Belgrano)</strong>
            </div>
            <div>
              <span className="stat-label">Caja Asignada</span>
              <strong style={{ fontSize: "13px", display: "block" }}>Caja 01 Mostrador</strong>
            </div>
            <div>
              <span className="stat-label">Permisos</span>
              <strong style={{ fontSize: "13px", display: "block", color: "var(--brand-primary)" }}>32 / 32 Habilitados</strong>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-line)", paddingTop: "14px" }}>
            <button
              type="button"
              className="pag-btn"
              style={{ color: "var(--rose-accent)", borderColor: "var(--rose-border)", display: "inline-flex", alignItems: "center", gap: "6px" }}
              onClick={() => {
                setIsProfileOpen(false);
                setIsLogoutConfirmOpen(true);
              }}
            >
              <LogOut size={14} /> Cerrar Sesión
            </button>
            <button type="button" className="btn-primary" onClick={() => setIsProfileOpen(false)}>Aceptar</button>
          </div>
        </Modal>

        {/* Help & Shortcuts Modal */}
        <Modal
          isOpen={isHelpOpen}
          onClose={() => setIsHelpOpen(false)}
          title="Guía Rápida & Atajos de Teclado"
          subtitle="Atajos para operar el sistema rápidamente"
          icon={HelpCircle}
          maxWidth="520px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--canvas-bg)", borderRadius: "8px" }}>
              <span>Buscar módulo o workspace</span>
              <kbd style={{ padding: "3px 8px", background: "var(--surface-white)", borderRadius: "6px", border: "1px solid var(--border-line)", fontSize: "11px", fontWeight: 700 }}>F2 / ⌘ K</kbd>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--canvas-bg)", borderRadius: "8px" }}>
              <span>Cerrar modal o cancelar búsqueda</span>
              <kbd style={{ padding: "3px 8px", background: "var(--surface-white)", borderRadius: "6px", border: "1px solid var(--border-line)", fontSize: "11px", fontWeight: 700 }}>Escape</kbd>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--canvas-bg)", borderRadius: "8px" }}>
              <span>Punto de Venta (POS) rápido</span>
              <span style={{ fontWeight: 650, color: "var(--brand-primary)" }}>Botón '+' en barra superior</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--canvas-bg)", borderRadius: "8px" }}>
              <span>Seguimiento de Reparaciones</span>
              <span style={{ fontWeight: 650 }}>Taller → Ingreso con Tracking</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--canvas-bg)", borderRadius: "8px" }}>
              <span>Soporte Técnico NicTech</span>
              <span style={{ fontWeight: 650 }}>soporte@nictech.com.ar</span>
            </div>
          </div>
          <div style={{ marginTop: "18px", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsHelpOpen(false)}
            >
              Entendido
            </button>
          </div>
        </Modal>

        {/* Logout Confirmation Dialog */}
        <ConfirmDialog
          isOpen={isLogoutConfirmOpen}
          title="Cerrar Sesión del ERP"
          message="¿Estás seguro de que deseás cerrar la sesión del operador en esta terminal?"
          confirmLabel="Cerrar Sesión"
          cancelLabel="Permanecer en el sistema"
          variant="danger"
          onConfirm={handleLogout}
          onCancel={() => setIsLogoutConfirmOpen(false)}
        />

        {/* Module Content */}
        <main className="workspace-content">
          <ModuleContent moduleId={activeModuleId} onSelectModule={selectModule} />
        </main>
      </div>
    </div>
  );
};

const ModuleContent: React.FC<{
  moduleId: ErpModuleId;
  onSelectModule: (id: ErpModuleId) => void;
}> = ({ moduleId, onSelectModule }) => {
  const activeModule = getErpModuleById(moduleId) ?? ERP_MODULES[0];

  const renderModuleBody = () => {
    switch (moduleId) {
      case "dashboard":
        return <DashboardOverview onSelectModule={onSelectModule} />;
      case "pos":
        return <PosWorkspace />;
      case "cash":
        return <CashWorkspace />;
      case "online-orders":
        return <OnlineOrdersWorkspace />;
      case "catalog":
      case "pricing":
        return <CatalogWorkspace activeModuleId={moduleId} onSelectModule={onSelectModule} />;
      case "stock":
      case "stock-counts":
      case "labels":
        return <StockWorkspace activeModuleId={moduleId} onSelectModule={onSelectModule} />;
      case "purchases":
      case "suppliers":
        return <PurchasesWorkspace activeModuleId={moduleId} onSelectModule={onSelectModule} />;
      case "customers":
        return <CustomersWorkspace />;
      case "quotes":
        return <QuotesWorkspace />;
      case "repairs":
      case "repair-tests":
      case "warranties":
        return <RepairsWorkspace activeModuleId={moduleId} onSelectModule={onSelectModule} />;
      case "pc-builds":
        return <PcBuildsWorkspace />;
      case "trade-ins":
        return <TradeInsWorkspace />;
      case "accounts":
        return <AccountsWorkspace />;
      case "accounting":
      case "profitability":
      case "reports":
        return <AccountingWorkspace activeModuleId={moduleId} onSelectModule={onSelectModule} />;
      case "documents":
        return <DocumentsWorkspace />;
      case "whatsapp":
        return <WhatsappWorkspace />;
      case "integration-health":
        return <IntegrationHealthWorkspace />;
      case "users":
      case "locations":
      case "settings":
        return <SystemWorkspace activeModuleId={moduleId} onSelectModule={onSelectModule} />;
      case "audit":
        return <AuditWorkspace />;
      default: {
        const _exhaustive: never = moduleId;
        return <ModuleEmptyState module={activeModule} />;
      }
    }
  };

  return (
    <ErpAccessGate permission={activeModule.permission}>
      {renderModuleBody()}
    </ErpAccessGate>
  );
};

const ModuleEmptyState: React.FC<{ module?: ErpModuleDefinition }> = ({ module }) => {
  if (!module) return null;

  return (
    <div className="module-state-card">
      <div className="module-state-icon">
        <Boxes size={26} />
      </div>
      <h2>{module.label}</h2>
      <p>{module.description}</p>
      <div className="module-state-details">
        <span className="module-state-badge">Etapa {module.stage}</span>
        {module.permission && (
          <span className="module-state-badge">Permiso: {module.permission}</span>
        )}
      </div>
    </div>
  );
};

export default App;
