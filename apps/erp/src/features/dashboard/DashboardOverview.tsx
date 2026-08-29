import React, { useState } from "react";
import {
  DollarSign,
  ShoppingCart,
  Layers,
  FileText,
  TrendingUp,
  FileCheck,
  Package,
  ShieldCheck,
  UserPlus,
  ChevronDown,
  Warehouse,
} from "lucide-react";

export interface DashboardOverviewProps {
  onSelectModule: (moduleId: string) => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ onSelectModule }) => {
  const [selectedPeriod] = useState<string>("This Year");

  return (
    <div className="flow-dashboard">
      {/* 4 KPI Metrics Row */}
      <section className="kpi-grid" aria-label="Métricas Principales">
        {/* KPI 1: Total Revenue */}
        <div className="flow-kpi-card">
          <div className="flow-kpi-card__icon-box green">
            <DollarSign size={20} />
          </div>
          <div className="flow-kpi-card__content">
            <span className="flow-kpi-card__label">Total Revenue</span>
            <div className="flow-kpi-card__val-row">
              <strong className="flow-kpi-card__val">$ 2,45,680</strong>
              <span className="flow-trend-tag positive">
                <TrendingUp size={12} /> 18.6%
              </span>
            </div>
            <span className="flow-kpi-card__sub">vs last month</span>
          </div>
        </div>

        {/* KPI 2: Purchase Orders */}
        <div className="flow-kpi-card">
          <div className="flow-kpi-card__icon-box navy">
            <ShoppingCart size={20} />
          </div>
          <div className="flow-kpi-card__content">
            <span className="flow-kpi-card__label">Purchase Orders</span>
            <div className="flow-kpi-card__val-row">
              <strong className="flow-kpi-card__val">128</strong>
              <span className="flow-trend-tag positive">
                <TrendingUp size={12} /> 12.4%
              </span>
            </div>
            <span className="flow-kpi-card__sub">vs last month</span>
          </div>
        </div>

        {/* KPI 3: Inventory Value */}
        <div className="flow-kpi-card">
          <div className="flow-kpi-card__icon-box steel">
            <Layers size={20} />
          </div>
          <div className="flow-kpi-card__content">
            <span className="flow-kpi-card__label">Inventory Value</span>
            <div className="flow-kpi-card__val-row">
              <strong className="flow-kpi-card__val">$ 1,86,540</strong>
              <span className="flow-trend-tag positive">
                <TrendingUp size={12} /> 7.8%
              </span>
            </div>
            <span className="flow-kpi-card__sub">vs last month</span>
          </div>
        </div>

        {/* KPI 4: Pending Invoices */}
        <div className="flow-kpi-card">
          <div className="flow-kpi-card__icon-box dark">
            <FileText size={20} />
          </div>
          <div className="flow-kpi-card__content">
            <span className="flow-kpi-card__label">Pending Invoices</span>
            <div className="flow-kpi-card__val-row">
              <strong className="flow-kpi-card__val">34</strong>
              <span className="flow-trend-tag negative">
                <TrendingUp size={12} /> 8.3%
              </span>
            </div>
            <span className="flow-kpi-card__sub">vs last month</span>
          </div>
        </div>
      </section>

      {/* Main Grid: Left (Performance Chart + Recent Orders) | Right (Profile, Actions, Stock) */}
      <div className="flow-dashboard-grid">
        {/* Left Column */}
        <div className="flow-dashboard-main">
          {/* Business Performance Dual-Axis Chart */}
          <section className="flow-card flow-performance-card" aria-label="Rendimiento del Negocio">
            <div className="flow-card__header">
              <div>
                <h3 className="flow-card__title">Business Performance</h3>
                <p className="flow-card__subtitle">Monthly order value (USD)</p>
              </div>
              <div className="flow-select-pill">
                <span>{selectedPeriod}</span>
                <ChevronDown size={14} />
              </div>
            </div>

            <div className="flow-chart-container">
              <svg className="flow-chart-svg" viewBox="0 0 700 220" preserveAspectRatio="none" aria-label="Gráfico de Rendimiento Mensual">
                {/* Horizontal Grid lines */}
                <line x1="45" y1="20" x2="680" y2="20" stroke="#F1F5F9" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="45" y1="60" x2="680" y2="60" stroke="#F1F5F9" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="45" y1="100" x2="680" y2="100" stroke="#F1F5F9" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="45" y1="140" x2="680" y2="140" stroke="#F1F5F9" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="45" y1="180" x2="680" y2="180" stroke="#E2E8F0" strokeWidth="1" />

                {/* Y-Axis Left (Order Value) */}
                <text x="40" y="24" textAnchor="end" className="chart-axis-label">$250k</text>
                <text x="40" y="64" textAnchor="end" className="chart-axis-label">$200k</text>
                <text x="40" y="104" textAnchor="end" className="chart-axis-label">$150k</text>
                <text x="40" y="144" textAnchor="end" className="chart-axis-label">$100k</text>
                <text x="40" y="184" textAnchor="end" className="chart-axis-label">$0</text>

                {/* Y-Axis Right (Orders) */}
                <text x="685" y="24" textAnchor="start" className="chart-axis-label">250</text>
                <text x="685" y="64" textAnchor="start" className="chart-axis-label">200</text>
                <text x="685" y="104" textAnchor="start" className="chart-axis-label">150</text>
                <text x="685" y="144" textAnchor="start" className="chart-axis-label">100</text>
                <text x="685" y="184" textAnchor="start" className="chart-axis-label">0</text>

                {/* Vertical Soft Blue Bars (Order Value) */}
                {[
                  { x: 80, h: 65 },
                  { x: 135, h: 80 },
                  { x: 190, h: 105 },
                  { x: 245, h: 120 },
                  { x: 300, h: 135 },
                  { x: 355, h: 155 },
                  { x: 410, h: 140 },
                  { x: 465, h: 110 },
                  { x: 520, h: 125 },
                  { x: 575, h: 160 },
                  { x: 630, h: 145 },
                ].map((bar, i) => (
                  <rect
                    key={i}
                    x={bar.x - 7}
                    y={180 - bar.h}
                    width="14"
                    height={bar.h}
                    rx="4"
                    fill="#DCE8F2"
                  />
                ))}

                {/* Green Smooth Spline Curve for Orders */}
                <path
                  d="M 80 145 C 110 142, 115 130, 135 130 C 160 130, 170 95, 190 100 C 215 105, 230 130, 245 130 C 270 130, 280 80, 300 70 C 325 60, 335 85, 355 90 C 380 95, 390 115, 410 120 C 435 125, 445 75, 465 70 C 490 65, 505 110, 520 110 C 545 110, 555 60, 575 50 C 600 40, 615 65, 630 65"
                  fill="none"
                  stroke="#84CC16"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />

                {/* Curve Data Point Dots */}
                {[
                  { cx: 80, cy: 145 },
                  { cx: 135, cy: 130 },
                  { cx: 190, cy: 100 },
                  { cx: 245, cy: 130 },
                  { cx: 300, cy: 70 },
                  { cx: 355, cy: 90 },
                  { cx: 410, cy: 120 },
                  { cx: 465, cy: 70 },
                  { cx: 520, cy: 110 },
                  { cx: 575, cy: 50 },
                  { cx: 630, cy: 65 },
                ].map((pt, i) => (
                  <circle key={i} cx={pt.cx} cy={pt.cy} r="4.5" fill="#84CC16" stroke="#FFFFFF" strokeWidth="2" />
                ))}

                {/* Month Labels on X Axis */}
                {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => (
                  <text key={m} x={80 + i * 50} y="202" textAnchor="middle" className="chart-x-label">
                    {m}
                  </text>
                ))}
              </svg>
            </div>

            {/* Chart Legend */}
            <div className="flow-chart-legend">
              <div className="legend-item">
                <span className="legend-dot blue" />
                <span>Order Value</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot green" />
                <span>Orders</span>
              </div>
            </div>
          </section>

          {/* Recent Orders Table */}
          <section className="flow-card" aria-label="Órdenes Recientes">
            <div className="flow-card__header">
              <div>
                <h3 className="flow-card__title">Recent Orders</h3>
                <p className="flow-card__subtitle">Latest sales and purchase orders</p>
              </div>
              <button type="button" className="flow-link-btn" onClick={() => onSelectModule("pos")}>
                View All
              </button>
            </div>

            <div className="flow-table-wrapper">
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Client</th>
                    <th>Department</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="order-id-cell">
                        <span className="type-badge green">SO</span>
                        <strong>SO-2024-1025</strong>
                      </div>
                    </td>
                    <td>Metro Retail Ltd.</td>
                    <td>Sales</td>
                    <td>24 May, 2024</td>
                    <td>
                      <span className="flow-status-pill completed">Completed</span>
                    </td>
                    <td className="text-right amount-val">$12,450</td>
                  </tr>
                  <tr>
                    <td>
                      <div className="order-id-cell">
                        <span className="type-badge blue">PO</span>
                        <strong>PO-2024-0876</strong>
                      </div>
                    </td>
                    <td>Global Supplies Inc.</td>
                    <td>Purchase</td>
                    <td>23 May, 2024</td>
                    <td>
                      <span className="flow-status-pill confirmed">Confirmed</span>
                    </td>
                    <td className="text-right amount-val">$8,760</td>
                  </tr>
                  <tr>
                    <td>
                      <div className="order-id-cell">
                        <span className="type-badge purple">SO</span>
                        <strong>SO-2024-1024</strong>
                      </div>
                    </td>
                    <td>Bright Electronics</td>
                    <td>Sales</td>
                    <td>22 May, 2024</td>
                    <td>
                      <span className="flow-status-pill processing">Processing</span>
                    </td>
                    <td className="text-right amount-val">$15,230</td>
                  </tr>
                  <tr>
                    <td>
                      <div className="order-id-cell">
                        <span className="type-badge orange">PO</span>
                        <strong>PO-2024-0875</strong>
                      </div>
                    </td>
                    <td>Packwell Materials</td>
                    <td>Purchase</td>
                    <td>21 May, 2024</td>
                    <td>
                      <span className="flow-status-pill pending">Pending</span>
                    </td>
                    <td className="text-right amount-val">$4,890</td>
                  </tr>
                  <tr>
                    <td>
                      <div className="order-id-cell">
                        <span className="type-badge green">SO</span>
                        <strong>SO-2024-1023</strong>
                      </div>
                    </td>
                    <td>Alpha Traders</td>
                    <td>Sales</td>
                    <td>21 May, 2024</td>
                    <td>
                      <span className="flow-status-pill completed">Completed</span>
                    </td>
                    <td className="text-right amount-val">$6,540</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="flow-table-footer">
              <span>Showing 1 to 5 of 15 entries</span>
              <div className="flow-pagination">
                <button type="button" className="pag-btn">&lt;</button>
                <button type="button" className="pag-btn active">1</button>
                <button type="button" className="pag-btn">2</button>
                <button type="button" className="pag-btn">3</button>
                <button type="button" className="pag-btn">&gt;</button>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="flow-dashboard-sidebar">
          {/* Operator Profile Card */}
          <section className="flow-card operator-card" aria-label="Perfil del Operador">
            <div className="operator-card__header">
              <div className="operator-avatar-wrapper">
                <div className="operator-avatar">
                  <span className="avatar-initials">RM</span>
                </div>
                <span className="online-dot" />
              </div>
              <div className="operator-info">
                <strong>Rahul Mehta</strong>
                <span className="operator-role-tag">Operations Manager</span>
              </div>
            </div>

            <div className="operator-metrics-grid">
              <div className="operator-stat">
                <span className="stat-label">Team</span>
                <strong className="stat-val">18</strong>
              </div>
              <div className="operator-stat">
                <span className="stat-label">Department</span>
                <strong className="stat-val">Operations</strong>
              </div>
              <div className="operator-stat">
                <span className="stat-label">Location</span>
                <strong className="stat-val">Mumbai</strong>
              </div>
              <div className="operator-stat">
                <span className="stat-label">Role</span>
                <strong className="stat-val">Manager</strong>
              </div>
            </div>
          </section>

          {/* Quick Actions Grid */}
          <section className="flow-card" aria-label="Acciones Rápidas">
            <h3 className="flow-card__title">Quick Actions</h3>
            <div className="quick-actions-grid">
              <button
                type="button"
                className="quick-action-tile"
                onClick={() => onSelectModule("pos")}
              >
                <div className="tile-icon">
                  <FileCheck size={20} color="#16a34a" />
                </div>
                <span>Create Invoice</span>
              </button>

              <button
                type="button"
                className="quick-action-tile"
                onClick={() => onSelectModule("purchases")}
              >
                <div className="tile-icon">
                  <ShoppingCart size={20} color="#16a34a" />
                </div>
                <span>New PO</span>
              </button>

              <button
                type="button"
                className="quick-action-tile"
                onClick={() => onSelectModule("catalog")}
              >
                <div className="tile-icon">
                  <Package size={20} color="#16a34a" />
                </div>
                <span>Add Product</span>
              </button>

              <button
                type="button"
                className="quick-action-tile"
                onClick={() => onSelectModule("cash")}
              >
                <div className="tile-icon">
                  <ShieldCheck size={20} color="#16a34a" />
                </div>
                <span>Approve Payment</span>
              </button>

              <button
                type="button"
                className="quick-action-tile"
                onClick={() => onSelectModule("users")}
              >
                <div className="tile-icon">
                  <UserPlus size={20} color="#16a34a" />
                </div>
                <span>Add Employee</span>
              </button>
            </div>
          </section>

          {/* Low Stock Alerts */}
          <section className="flow-card" aria-label="Alertas de Stock Bajo">
            <div className="flow-card__header">
              <h3 className="flow-card__title">Low Stock Alerts</h3>
              <button type="button" className="flow-link-btn" onClick={() => onSelectModule("stock")}>
                View All
              </button>
            </div>

            <div className="low-stock-list">
              <div className="low-stock-item">
                <div className="item-thumbnail">
                  <Warehouse size={18} color="#64748b" />
                </div>
                <div className="item-details">
                  <strong>Stainless Steel Sheet</strong>
                  <span>WH-01 • Shelf A2</span>
                </div>
                <div className="item-qty-badge">
                  <strong className="qty-val">18</strong>
                  <span className="qty-unit">Units Left</span>
                </div>
              </div>

              <div className="low-stock-item">
                <div className="item-thumbnail">
                  <Package size={18} color="#64748b" />
                </div>
                <div className="item-details">
                  <strong>Hydraulic Pump</strong>
                  <span>WH-02 • Rack B1</span>
                </div>
                <div className="item-qty-badge">
                  <strong className="qty-val">7</strong>
                  <span className="qty-unit">Units Left</span>
                </div>
              </div>

              <div className="low-stock-item">
                <div className="item-thumbnail">
                  <Layers size={18} color="#64748b" />
                </div>
                <div className="item-details">
                  <strong>Packing Tape 48mm</strong>
                  <span>WH-03 • Shelf C3</span>
                </div>
                <div className="item-qty-badge">
                  <strong className="qty-val">12</strong>
                  <span className="qty-unit">Units Left</span>
                </div>
              </div>
            </div>

            <div className="low-stock-footer">
              <span className="items-count-text">3 items low in stock</span>
              <button
                type="button"
                className="view-inventory-btn"
                onClick={() => onSelectModule("stock")}
              >
                View Inventory
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
