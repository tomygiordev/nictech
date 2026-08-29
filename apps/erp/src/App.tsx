import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Boxes,
  Building2,
  ChevronDown,
  CircleDollarSign,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Wrench,
  X,
} from "lucide-react";
import {
  ERP_MODULES,
  type ErpArea,
  type ErpModuleDefinition,
} from "@nictech/domain";
import { ErpAccessGate } from "./auth/ErpAccessGate";
import { AccountsWorkspace } from "./features/finance/AccountsWorkspace";
import { AccountingWorkspace } from "./features/finance/AccountingWorkspace";
import { PosWorkspace } from "./features/pos/PosWorkspace";
import { CashWorkspace } from "./features/cash/CashWorkspace";

const AREA_LABELS: Record<ErpArea, string> = {
  operaciones: "Operaciones",
  inventario: "Inventario",
  taller: "Taller",
  comercial: "Comercial",
  finanzas: "Finanzas",
  integraciones: "Integraciones",
  sistema: "Sistema",
};

const AREA_ICONS: Record<ErpArea, typeof Activity> = {
  operaciones: Activity,
  inventario: Boxes,
  taller: Wrench,
  comercial: Store,
  finanzas: CircleDollarSign,
  integraciones: Building2,
  sistema: Settings,
};

const AREAS = Object.keys(AREA_LABELS) as ErpArea[];

const App = () => {
  const [activeModuleId, setActiveModuleId] = useState("dashboard");
  const [query, setQuery] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusModuleSearch = (event: KeyboardEvent) => {
      if (event.key !== "F2") return;
      event.preventDefault();
      setMobileNavOpen(true);
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    };

    window.addEventListener("keydown", focusModuleSearch);
    return () => window.removeEventListener("keydown", focusModuleSearch);
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const visibleModules = normalizedQuery
    ? ERP_MODULES.filter((module) =>
        `${module.label} ${module.description}`
          .toLocaleLowerCase("es")
          .includes(normalizedQuery),
      )
    : ERP_MODULES;

  const activeModule =
    ERP_MODULES.find((module) => module.id === activeModuleId) ?? ERP_MODULES[0];

  const selectModule = (module: ErpModuleDefinition) => {
    setActiveModuleId(module.id);
    setMobileNavOpen(false);
  };

  return (
    <div className="erp-shell">
      <aside className={`side-nav ${mobileNavOpen ? "side-nav--open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">N</div>
          <div>
            <strong>NicTech</strong>
            <span>Gestion</span>
          </div>
          <button
            className="icon-button side-nav__close"
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Cerrar navegacion"
          >
            <X size={20} />
          </button>
        </div>

        <label className="nav-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Buscar modulo</span>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar modulo"
          />
          <kbd>F2</kbd>
        </label>

        <nav className="module-nav" aria-label="Modulos del ERP">
          {AREAS.map((area) => {
            const modules = visibleModules.filter((module) => module.area === area);
            if (modules.length === 0) return null;
            const Icon = AREA_ICONS[area];

            return (
              <section className="nav-group" key={area}>
                <div className="nav-group__label">
                  <Icon size={15} aria-hidden="true" />
                  <span>{AREA_LABELS[area]}</span>
                </div>
                {modules.map((module) => (
                  <button
                    className={`nav-item ${module.id === activeModule.id ? "nav-item--active" : ""}`}
                    key={module.id}
                    type="button"
                    onClick={() => selectModule(module)}
                  >
                    <span>{module.label}</span>
                    <span className="nav-item__stage">E{module.stage}</span>
                  </button>
                ))}
              </section>
            );
          })}
        </nav>

        <div className="session-card">
          <div className="session-card__avatar" aria-hidden="true">LO</div>
          <div>
            <strong>Operador local</strong>
            <span>Entorno de desarrollo</span>
          </div>
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          className="nav-backdrop"
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Cerrar navegacion"
        />
      )}

      <main className="workspace">
        <header className="topbar">
          <button
            className="icon-button topbar__menu"
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Abrir navegacion"
          >
            <Menu size={21} />
          </button>
          <button className="branch-switcher" type="button">
            <Building2 size={17} aria-hidden="true" />
            <span>Sucursal local</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <div className="environment-state">
            <span className="environment-state__dot" />
            Sin conexion remota
          </div>
        </header>

        <div className="workspace-grid">
          <section className="ledger-pane" aria-labelledby="module-title">
            <div className="module-heading">
              <div>
                <p>{AREA_LABELS[activeModule.area]}</p>
                <h1 id="module-title">{activeModule.label}</h1>
                <span>{activeModule.description}</span>
              </div>
              <div className="stage-badge">Etapa {activeModule.stage}</div>
            </div>

            <ModuleContent module={activeModule} />
          </section>

          <aside className="attention-rail" aria-label="Estado de la base local">
            <div className="attention-rail__heading">
              <h2>Base de trabajo</h2>
              <span>Local</span>
            </div>
            <ol className="readiness-list">
              <li className="readiness-item readiness-item--ready">
                <ShieldCheck size={18} aria-hidden="true" />
                <div>
                  <strong>Aplicacion separada</strong>
                  <span>La gestion ya tiene build y entrada propios.</span>
                </div>
              </li>
              <li className="readiness-item readiness-item--ready">
                <ShieldCheck size={18} aria-hidden="true" />
                <div>
                  <strong>Contratos compartidos</strong>
                  <span>Modulos y permisos viven fuera de la UI.</span>
                </div>
              </li>
              <li className="readiness-item">
                <span className="readiness-item__number">3</span>
                <div>
                  <strong>Datos operativos</strong>
                  <span>Se habilitan al conectar el esquema local.</span>
                </div>
              </li>
            </ol>
            <div className="rail-note">
              <strong>Entorno protegido</strong>
              <p>No se consulta ni modifica el Supabase real desde esta aplicacion.</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};

const DashboardEmptyState = () => (
  <div className="dashboard-state">
    <div className="status-strip" aria-label="Estado operativo">
      <div>
        <span>Caja</span>
        <strong>Sin apertura</strong>
      </div>
      <div>
        <span>Pedidos web</span>
        <strong>Sin datos</strong>
      </div>
      <div>
        <span>Reparaciones</span>
        <strong>Sin datos</strong>
      </div>
      <div>
        <span>Alertas de stock</span>
        <strong>Sin datos</strong>
      </div>
    </div>

    <section className="activity-ledger">
      <div className="section-heading">
        <div>
          <h2>Libro de actividad</h2>
          <p>Ventas, movimientos, reparaciones y cobros apareceran en orden temporal.</p>
        </div>
        <span>Hoy</span>
      </div>
      <div className="empty-ledger">
        <Activity size={24} aria-hidden="true" />
        <strong>Todavia no hay operaciones locales</strong>
        <p>La actividad se mostrara cuando el primer flujo transaccional quede conectado.</p>
      </div>
    </section>
  </div>
);

const ModuleContent = ({ module }: { module: ErpModuleDefinition }) => {
  if (module.id === "dashboard") return <DashboardEmptyState />;
  if (module.id === "accounts") {
    return <ErpAccessGate permission="accounts_receivable.view"><AccountsWorkspace /></ErpAccessGate>;
  }
  if (module.id === "accounting") {
    return <ErpAccessGate permission="accounting.view"><AccountingWorkspace /></ErpAccessGate>;
  }
  if (module.id === "pos") {
    return <ErpAccessGate permission="sales.create"><PosWorkspace /></ErpAccessGate>;
  }
  if (module.id === "cash") {
    return <ErpAccessGate permission="cash.view"><CashWorkspace /></ErpAccessGate>;
  }
  return <ModuleEmptyState module={module} />;
};

const ModuleEmptyState = ({ module }: { module: ErpModuleDefinition }) => (
  <div className="module-state">
    <div className="module-state__index">{module.stage}</div>
    <div>
      <h2>Contrato preparado, flujo pendiente</h2>
      <p>
        Este modulo forma parte del alcance completo y se habilitara sobre permisos,
        auditoria y transacciones locales verificadas.
      </p>
      <dl>
        <div>
          <dt>Permiso requerido</dt>
          <dd>{module.permission}</dd>
        </div>
        <div>
          <dt>Etapa del programa</dt>
          <dd>{module.stage}</dd>
        </div>
      </dl>
    </div>
  </div>
);

export default App;
