import React, { useId, useMemo, useRef, useState } from "react";
import {
  type ErpArea,
  type ErpModuleDefinition,
  ERP_MODULES,
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
import { PosWorkspace } from "./features/pos/PosWorkspace";
import { CashWorkspace } from "./features/cash/CashWorkspace";
import { AccountsWorkspace } from "./features/finance/AccountsWorkspace";
import { AccountingWorkspace } from "./features/finance/AccountingWorkspace";
import { DashboardOverview } from "./features/dashboard/DashboardOverview";
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

const MODULE_CUSTOM_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  pos: Store,
  cash: CircleDollarSign,
  accounts: Users,
  accounting: Layers,
  catalog: Boxes,
  purchases: ShoppingCart,
  repairs: Wrench,
  users: Settings,
  audit: Sparkles,
};

const groupedModules = ERP_MODULES.reduce<Record<ErpArea, ErpModuleDefinition[]>>(
  (acc, module) => {
    if (!acc[module.area]) {
      acc[module.area] = [];
    }
    acc[module.area].push(module);
    return acc;
  },
  {} as Record<ErpArea, ErpModuleDefinition[]>,
);

export const App = () => {
  const [activeModuleId, setActiveModuleId] = useState<string>("dashboard");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchInputId = useId();

  const activeModule = useMemo(() => {
    return ERP_MODULES.find((m) => m.id === activeModuleId) ?? ERP_MODULES[0];
  }, [activeModuleId]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groupedModules;

    const result: Partial<Record<ErpArea, ErpModuleDefinition[]>> = {};
    for (const [area, modules] of Object.entries(groupedModules)) {
      const filtered = modules.filter(
        (m) =>
          m.label.toLowerCase().includes(query) ||
          m.description.toLowerCase().includes(query),
      );
      if (filtered.length > 0) {
        result[area as ErpArea] = filtered;
      }
    }
    return result;
  }, [searchQuery]);

  const selectModule = (id: string) => {
    setActiveModuleId(id);
    setNavOpen(false);
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
          {Object.entries(filteredGroups).map(([area, modules]) => {
            const typedArea = area as ErpArea;
            const AreaIcon = AREA_ICONS[typedArea] ?? Settings;

            return (
              <div key={area} className="nav-group">
                <div className="nav-group__label">{AREA_LABELS[typedArea]}</div>
                {modules?.map((module) => {
                  const isActive = module.id === activeModuleId;
                  const IconComponent = MODULE_CUSTOM_ICONS[module.id] ?? AreaIcon;

                  return (
                    <button
                      key={module.id}
                      type="button"
                      className={`nav-item ${isActive ? "nav-item--active" : ""}`}
                      onClick={() => selectModule(module.id)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <IconComponent size={17} />
                      <span>{module.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="nav-footer-menu">
          <button type="button" className="nav-footer-btn">
            <HelpCircle size={17} />
            <span>Ayuda</span>
          </button>
          <button type="button" className="nav-footer-btn">
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
            <h1>{activeModuleId === "dashboard" ? "ERP Overview" : activeModule.label}</h1>
            <p>
              {activeModuleId === "dashboard"
                ? "Real-time summary of your business operations"
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
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Buscar módulos y funciones"
              />
              <kbd>⌘ K</kbd>
            </div>

            {/* Action Buttons */}
            <button
              type="button"
              className="header-action-btn"
              aria-label="Crear nuevo registro"
              onClick={() => selectModule("pos")}
            >
              <Plus size={18} />
            </button>

            <button type="button" className="header-action-btn" aria-label="Notificaciones">
              <Bell size={18} />
              <span className="header-badge">3</span>
            </button>

            <button type="button" className="header-action-btn" aria-label="Mensajes">
              <MessageSquare size={18} />
            </button>

            <button type="button" className="topbar-avatar-btn" aria-label="Perfil de usuario">
              <span>RM</span>
            </button>

            <button
              type="button"
              className="header-action-btn md:hidden"
              aria-label="Abrir menú de navegación"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={18} />
            </button>
          </div>
        </header>

        {/* Module Content */}
        <main className="workspace-content">
          <ModuleContent moduleId={activeModuleId} onSelectModule={selectModule} />
        </main>
      </div>
    </div>
  );
};

const ModuleContent: React.FC<{ moduleId: string; onSelectModule: (id: string) => void }> = ({
  moduleId,
  onSelectModule,
}) => {
  if (moduleId === "dashboard") {
    return <DashboardOverview onSelectModule={onSelectModule} />;
  }

  const moduleDef = ERP_MODULES.find((m) => m.id === moduleId);

  if (moduleId === "pos") {
    return (
      <ErpAccessGate permission="sales.create">
        <PosWorkspace />
      </ErpAccessGate>
    );
  }

  if (moduleId === "cash") {
    return (
      <ErpAccessGate permission="cash.view">
        <CashWorkspace />
      </ErpAccessGate>
    );
  }

  if (moduleId === "accounts") {
    return (
      <ErpAccessGate permission="accounts_receivable.view">
        <AccountsWorkspace />
      </ErpAccessGate>
    );
  }

  if (moduleId === "accounting") {
    return (
      <ErpAccessGate permission="accounting.view">
        <AccountingWorkspace />
      </ErpAccessGate>
    );
  }

  return <ModuleEmptyState module={moduleDef} />;
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
