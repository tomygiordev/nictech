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

export const ERP_MODULES: readonly ErpModuleDefinition[] = [
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
] as const;
