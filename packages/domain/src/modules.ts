export type ErpArea =
  | "operaciones"
  | "inventario"
  | "taller"
  | "comercial"
  | "finanzas"
  | "integraciones"
  | "sistema";

export interface ErpModuleDefinition {
  id: string;
  area: ErpArea;
  label: string;
  description: string;
  permission: string;
  stage: number;
}

export const ERP_MODULES = [
  { id: "dashboard", area: "operaciones", label: "Centro operativo", description: "Tareas, excepciones y estado diario", permission: "dashboard.view", stage: 10 },
  { id: "pos", area: "operaciones", label: "Punto de venta", description: "Ventas presenciales y pagos", permission: "sales.create", stage: 5 },
  { id: "cash", area: "operaciones", label: "Caja", description: "Apertura, movimientos, arqueo y cierre", permission: "cash.view", stage: 5 },
  { id: "online-orders", area: "operaciones", label: "Pedidos online", description: "Preparacion, entrega y devoluciones", permission: "orders.view", stage: 5 },
  { id: "catalog", area: "inventario", label: "Productos y servicios", description: "Catalogo interno y publicacion web", permission: "catalog.view", stage: 2 },
  { id: "stock", area: "inventario", label: "Existencias", description: "Ubicaciones, reservas y movimientos", permission: "stock.view", stage: 3 },
  { id: "stock-counts", area: "inventario", label: "Inventarios fisicos", description: "Conteos, diferencias y ajustes", permission: "stock_counts.view", stage: 3 },
  { id: "labels", area: "inventario", label: "Codigos y etiquetas", description: "Barras, QR, series e IMEI", permission: "labels.print", stage: 3 },
  { id: "purchases", area: "comercial", label: "Compras", description: "Ordenes, recepciones y costos", permission: "purchases.view", stage: 4 },
  { id: "suppliers", area: "comercial", label: "Proveedores", description: "Condiciones, deuda e historial", permission: "suppliers.view", stage: 4 },
  { id: "customers", area: "comercial", label: "Clientes", description: "Historial unificado y equipos", permission: "customers.view", stage: 2 },
  { id: "quotes", area: "comercial", label: "Presupuestos", description: "Versiones, aprobacion y vigencia", permission: "quotes.view", stage: 6 },
  { id: "repairs", area: "taller", label: "Reparaciones", description: "Ingreso, diagnostico, trabajo y entrega", permission: "repairs.view", stage: 6 },
  { id: "repair-tests", area: "taller", label: "Pruebas tecnicas", description: "Protocolos de ingreso y egreso", permission: "repair_tests.view", stage: 6 },
  { id: "pc-builds", area: "taller", label: "Armados de PC", description: "Compatibilidad, reservas y pruebas", permission: "pc_builds.view", stage: 7 },
  { id: "trade-ins", area: "taller", label: "Equipos usados", description: "Canjes, evaluacion y cuarentena", permission: "trade_ins.view", stage: 7 },
  { id: "warranties", area: "taller", label: "Garantias", description: "Ingresos, diagnostico y resolucion", permission: "warranties.view", stage: 6 },
  { id: "pricing", area: "finanzas", label: "Precios y monedas", description: "Cotizaciones, listas y reglas", permission: "pricing.view", stage: 4 },
  { id: "accounts", area: "finanzas", label: "Cuentas corrientes", description: "Saldos, cuotas y vencimientos", permission: "accounts_receivable.view", stage: 9 },
  { id: "accounting", area: "finanzas", label: "Contabilidad", description: "Asientos, periodos y conciliacion", permission: "accounting.view", stage: 9 },
  { id: "profitability", area: "finanzas", label: "Rentabilidad", description: "Costos, margenes y resultados", permission: "profitability.view", stage: 10 },
  { id: "reports", area: "finanzas", label: "Reportes", description: "Gestion, exportaciones e inteligencia", permission: "reports.view", stage: 10 },
  { id: "documents", area: "integraciones", label: "Documentos y ARCA", description: "Comprobantes, CAE y entregas", permission: "documents.view", stage: 8 },
  { id: "whatsapp", area: "integraciones", label: "WhatsApp", description: "Conversaciones y automatizaciones", permission: "messages.view", stage: 8 },
  { id: "integration-health", area: "integraciones", label: "Integraciones", description: "Intentos, errores y reintentos", permission: "integrations.view", stage: 8 },
  { id: "users", area: "sistema", label: "Usuarios y permisos", description: "Roles, excepciones y alcance", permission: "users.view", stage: 1 },
  { id: "locations", area: "sistema", label: "Sucursales y ubicaciones", description: "Estructura fisica y operativa", permission: "locations.view", stage: 2 },
  { id: "settings", area: "sistema", label: "Configuracion", description: "Reglas, plantillas y parametros", permission: "configuration.view", stage: 1 },
  { id: "audit", area: "sistema", label: "Auditoria", description: "Actores, cambios y correlacion", permission: "audit.view", stage: 1 },
] as const satisfies readonly ErpModuleDefinition[];

export type ErpModuleId = (typeof ERP_MODULES)[number]["id"];

export type ErpWorkspaceId =
  | "dashboard"
  | "pos"
  | "cash"
  | "online-orders"
  | "catalog"
  | "stock"
  | "purchases"
  | "customers"
  | "quotes"
  | "repairs"
  | "pc-builds"
  | "trade-ins"
  | "accounts"
  | "accounting"
  | "documents"
  | "whatsapp"
  | "integration-health"
  | "system"
  | "audit";

export interface ErpWorkspaceDefinition {
  id: ErpWorkspaceId;
  area: ErpArea;
  label: string;
  description: string;
  moduleIds: readonly ErpModuleId[];
}

export const ERP_WORKSPACES = [
  {
    id: "dashboard",
    area: "operaciones",
    label: "Centro operativo",
    description: "Tareas, excepciones y estado diario",
    moduleIds: ["dashboard"],
  },
  {
    id: "pos",
    area: "operaciones",
    label: "Punto de venta",
    description: "Ventas presenciales y pagos",
    moduleIds: ["pos"],
  },
  {
    id: "cash",
    area: "operaciones",
    label: "Caja",
    description: "Apertura, movimientos, arqueo y cierre",
    moduleIds: ["cash"],
  },
  {
    id: "online-orders",
    area: "operaciones",
    label: "Pedidos online",
    description: "Preparación, entrega y devoluciones",
    moduleIds: ["online-orders"],
  },
  {
    id: "catalog",
    area: "inventario",
    label: "Catálogo y precios",
    description: "Catálogo maestro de artículos, servicios y listas de precios",
    moduleIds: ["catalog", "pricing"],
  },
  {
    id: "stock",
    area: "inventario",
    label: "Stock y almacén",
    description: "Ubicaciones, depósitos, inventarios físicos y etiquetas",
    moduleIds: ["stock", "stock-counts", "labels"],
  },
  {
    id: "purchases",
    area: "comercial",
    label: "Compras y proveedores",
    description: "Órdenes de compra, recepción de mercadería y proveedores",
    moduleIds: ["purchases", "suppliers"],
  },
  {
    id: "customers",
    area: "comercial",
    label: "Clientes",
    description: "Historial unificado de clientes y equipos vinculados",
    moduleIds: ["customers"],
  },
  {
    id: "quotes",
    area: "comercial",
    label: "Presupuestos",
    description: "Presupuestos comerciales, versiones y vigencia",
    moduleIds: ["quotes"],
  },
  {
    id: "repairs",
    area: "taller",
    label: "Servicio técnico",
    description: "Órdenes de reparación, pruebas técnicas y garantías",
    moduleIds: ["repairs", "repair-tests", "warranties"],
  },
  {
    id: "pc-builds",
    area: "taller",
    label: "Armados de PC",
    description: "Compatibilidad, reservas y pruebas de ensamblado",
    moduleIds: ["pc-builds"],
  },
  {
    id: "trade-ins",
    area: "taller",
    label: "Equipos usados",
    description: "Canjes, evaluación técnica y cuarentena",
    moduleIds: ["trade-ins"],
  },
  {
    id: "accounts",
    area: "finanzas",
    label: "Cuentas corrientes",
    description: "Saldos, cuotas y vencimientos por cliente",
    moduleIds: ["accounts"],
  },
  {
    id: "accounting",
    area: "finanzas",
    label: "Contabilidad y análisis",
    description: "Libro diario, períodos, rentabilidad e informes",
    moduleIds: ["accounting", "profitability", "reports"],
  },
  {
    id: "documents",
    area: "integraciones",
    label: "Documentos y ARCA",
    description: "Comprobantes fiscales electrónicos, CAE y entregas",
    moduleIds: ["documents"],
  },
  {
    id: "whatsapp",
    area: "integraciones",
    label: "WhatsApp",
    description: "Conversaciones, avisos y automatizaciones",
    moduleIds: ["whatsapp"],
  },
  {
    id: "integration-health",
    area: "integraciones",
    label: "Integraciones",
    description: "Estado de webhooks, intentos y reintentos",
    moduleIds: ["integration-health"],
  },
  {
    id: "system",
    area: "sistema",
    label: "Configuración y accesos",
    description: "Usuarios, sucursales y parámetros generales del sistema",
    moduleIds: ["users", "locations", "settings"],
  },
  {
    id: "audit",
    area: "sistema",
    label: "Auditoría",
    description: "Registro inmutable de actores, cambios y correlación",
    moduleIds: ["audit"],
  },
] as const satisfies readonly ErpWorkspaceDefinition[];

export const getErpModuleById = (id: string): ErpModuleDefinition | undefined => {
  return ERP_MODULES.find((m) => m.id === id);
};

export const getErpWorkspaceById = (id: string): ErpWorkspaceDefinition | undefined => {
  return ERP_WORKSPACES.find((w) => w.id === id);
};

export const getErpWorkspaceByModuleId = (moduleId: string): ErpWorkspaceDefinition | undefined => {
  return ERP_WORKSPACES.find((w) => (w.moduleIds as readonly string[]).includes(moduleId));
};
