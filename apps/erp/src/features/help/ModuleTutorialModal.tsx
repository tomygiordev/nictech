import React, { useState, useEffect } from "react";
import {
  HelpCircle,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Keyboard,
  FileDown,
  AlertTriangle,
  Sparkles,
  Info,
  CheckCircle2,
} from "lucide-react";
import {
  ERP_TUTORIALS,
  KEYBOARD_SHORTCUTS,
  type ModuleTutorial,
} from "./tutorialData";

export interface ModuleTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentWorkspaceId?: string;
  onNavigateToWorkspace?: (workspaceId: string) => void;
}

export const ModuleTutorialModal: React.FC<ModuleTutorialModalProps> = ({
  isOpen,
  onClose,
  currentWorkspaceId = "pos",
  onNavigateToWorkspace,
}) => {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(currentWorkspaceId);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<"tutorial" | "shortcuts" | "manual">("tutorial");
  const [moduleSearch, setModuleSearch] = useState<string>("");

  // Sync with currentWorkspaceId when opened or changed
  useEffect(() => {
    if (isOpen && currentWorkspaceId) {
      // Find if we have a tutorial for this workspace or fallback to pos
      const targetId = ERP_TUTORIALS[currentWorkspaceId] ? currentWorkspaceId : "pos";
      setSelectedWorkspaceId(targetId);
      setCurrentStepIndex(0);
      setActiveTab("tutorial");
    }
  }, [isOpen, currentWorkspaceId]);

  if (!isOpen) return null;

  const currentTutorial: ModuleTutorial =
    ERP_TUTORIALS[selectedWorkspaceId] ?? ERP_TUTORIALS["pos"];
  const steps = currentTutorial.steps;
  const currentStep = steps[currentStepIndex] ?? steps[0];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  const handleNext = () => {
    if (!isLastStep) setCurrentStepIndex((prev) => prev + 1);
  };

  const handlePrev = () => {
    if (!isFirstStep) setCurrentStepIndex((prev) => prev - 1);
  };

  const handleSelectWorkspace = (id: string) => {
    setSelectedWorkspaceId(id);
    setCurrentStepIndex(0);
    setActiveTab("tutorial");
  };

  const handleOpenPdf = () => {
    const manualUrl = new URL("Manual_Operativo_ERP_NicTech.pdf", document.baseURI);
    window.open(manualUrl.href, "_blank");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ayuda y Tutoriales del ERP"
      data-erp-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(3, 32, 104, 0.45)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "1080px",
          height: "92vh",
          maxHeight: "750px",
          background: "var(--surface-white, #ffffff)",
          borderRadius: "16px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid var(--border-line, #e2e8f0)",
          color: "var(--text-main, #0f172a)",
        }}
      >
        {/* HEADER MODAL */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border-line, #e2e8f0)",
            background: "linear-gradient(90deg, #032068 0%, #005bd5 100%)",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "rgba(255, 255, 255, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <HelpCircle size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#fff" }}>
                Centro de Ayuda & Tutorial Operativo
              </h2>
              <p style={{ margin: 0, fontSize: "11px", color: "rgba(255, 255, 255, 0.8)" }}>
                Explicación punto por punto de cada módulo sin vueltas ni tecnicismos confusos
              </p>
            </div>
          </div>

          {/* Selector de pestañas superiores */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <button
              type="button"
              onClick={() => setActiveTab("tutorial")}
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                border: "none",
                background: activeTab === "tutorial" ? "#ffffff" : "rgba(255, 255, 255, 0.15)",
                color: activeTab === "tutorial" ? "#032068" : "#ffffff",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <BookOpen size={14} />
              <span>Tutorial de Módulos</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("shortcuts")}
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                border: "none",
                background: activeTab === "shortcuts" ? "#ffffff" : "rgba(255, 255, 255, 0.15)",
                color: activeTab === "shortcuts" ? "#032068" : "#ffffff",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <Keyboard size={14} />
              <span>Atajos de Teclado</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("manual")}
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                border: "none",
                background: activeTab === "manual" ? "#ffffff" : "rgba(255, 255, 255, 0.15)",
                color: activeTab === "manual" ? "#032068" : "#ffffff",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <FileDown size={14} />
              <span>Manual Completo</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar modal"
              style={{
                background: "rgba(255, 255, 255, 0.15)",
                border: "none",
                color: "#fff",
                borderRadius: "8px",
                padding: "6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                marginLeft: "8px",
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* CONTENIDO PRINCIPAL SEGÚN PESTAÑA */}
        {activeTab === "tutorial" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Barra de Módulos (Sub-navegación horizontal rápida con buscador) */}
            <div
              style={{
                padding: "8px 16px",
                background: "var(--canvas-bg, #f8fafc)",
                borderBottom: "1px solid var(--border-line, #e2e8f0)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                overflowX: "auto",
                whiteSpace: "nowrap",
              }}
            >
              <div style={{ position: "relative", minWidth: "140px" }}>
                <Search size={12} style={{ position: "absolute", left: "7px", top: "7px", color: "var(--text-muted, #64748b)" }} />
                <input
                  type="text"
                  placeholder="Filtrar módulo..."
                  value={moduleSearch}
                  onChange={(e) => setModuleSearch(e.target.value)}
                  style={{
                    padding: "3px 8px 3px 22px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-line, #cbd5e1)",
                    fontSize: "11px",
                    width: "115px",
                    background: "#ffffff",
                  }}
                />
              </div>

              {Object.values(ERP_TUTORIALS)
                .filter((t) => {
                  if (!moduleSearch.trim()) return true;
                  const q = moduleSearch.toLowerCase();
                  return t.moduleName.toLowerCase().includes(q) || t.area.toLowerCase().includes(q) || t.tagline.toLowerCase().includes(q);
                })
                .map((t) => {
                  const IconComponent = t.icon;
                  const isSelected = t.workspaceId === selectedWorkspaceId;
                  return (
                    <button
                      key={t.workspaceId}
                      type="button"
                      onClick={() => handleSelectWorkspace(t.workspaceId)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: isSelected ? 700 : 500,
                        border: isSelected ? "1px solid var(--brand-primary, #005bd5)" : "1px solid var(--border-line, #e2e8f0)",
                        background: isSelected ? "var(--brand-soft, #e8f1fd)" : "var(--surface-white, #ffffff)",
                        color: isSelected ? "var(--brand-primary, #005bd5)" : "var(--text-main, #0f172a)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                        flexShrink: 0,
                      }}
                    >
                      <IconComponent size={13} />
                      <span>{t.moduleName}</span>
                    </button>
                  );
                })}
            </div>

            {/* Cuerpo del Tutorial: 2 columnas (Izquierda: Explicación didáctica / Derecha: Screen interactiva) */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {/* Panel Izquierdo: Explicación textual clara */}
              <div
                style={{
                  width: "45%",
                  borderRight: "1px solid var(--border-line, #e2e8f0)",
                  padding: "20px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                  background: "var(--surface-white, #ffffff)",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        background: "var(--brand-soft, #e8f1fd)",
                        color: "var(--brand-primary, #005bd5)",
                        padding: "2px 8px",
                        borderRadius: "12px",
                      }}
                    >
                      {currentStep.badge ?? `Paso ${currentStepIndex + 1} de ${steps.length}`}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--text-muted, #64748b)" }}>
                      Área: {currentTutorial.area.toUpperCase()}
                    </span>
                  </div>
                  <h3 style={{ margin: "0 0 6px 0", fontSize: "18px", fontWeight: 800, color: "var(--brand-navy, #032068)" }}>
                    {currentStep.title}
                  </h3>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted, #64748b)" }}>
                    {currentTutorial.tagline}
                  </p>
                </div>

                {/* Si es el primer paso: Explicación de Contenido y Sentido en la vida real */}
                {currentStep.isIntroduction && (
                  <>
                    <div
                      style={{
                        background: "var(--brand-soft, #e8f1fd)",
                        border: "1px solid var(--brand-border, #9ec5fe)",
                        borderRadius: "10px",
                        padding: "12px",
                      }}
                    >
                      <strong style={{ fontSize: "12px", color: "var(--brand-navy, #032068)", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                        <Sparkles size={14} /> ¿Cuál es el sentido de este módulo en el día a día?
                      </strong>
                      <p style={{ margin: 0, fontSize: "12px", lineHeight: "1.5", color: "var(--text-main, #0f172a)" }}>
                        {currentStep.operationalSense}
                      </p>
                    </div>

                    <div
                      style={{
                        background: "var(--canvas-bg, #f8fafc)",
                        border: "1px solid var(--border-line, #e2e8f0)",
                        borderRadius: "10px",
                        padding: "12px",
                      }}
                    >
                      <strong style={{ fontSize: "11px", color: "var(--text-muted, #64748b)", textTransform: "uppercase", display: "block", marginBottom: "4px" }}>
                        Contenido y herramientas incluidas:
                      </strong>
                      <p style={{ margin: 0, fontSize: "12px", lineHeight: "1.4" }}>
                        {currentStep.contentSummary}
                      </p>
                    </div>
                  </>
                )}

                {/* Explicación paso a paso */}
                <div style={{ fontSize: "13px", lineHeight: "1.6", whiteSpace: "pre-line", color: "#334155" }}>
                  {currentStep.explanation}
                </div>

                {/* Alerta de faltante o desarrollo pendiente */}
                {currentStep.limitations && (
                  <div
                    style={{
                      background: "#fffbeb",
                      border: "1px solid #fde68a",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      color: "#92400e",
                      fontSize: "12px",
                      lineHeight: "1.4",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, marginBottom: "4px" }}>
                      <AlertTriangle size={15} />
                      <span>Aclaración Operativa / En Desarrollo:</span>
                    </div>
                    <div>{currentStep.limitations}</div>
                  </div>
                )}
              </div>

              {/* Panel Derecho: Screen interactiva recreada */}
              <div
                style={{
                  width: "55%",
                  background: "var(--canvas-bg, #f8fafc)",
                  padding: "16px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "var(--text-muted, #64748b)",
                    marginBottom: "8px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Info size={13} />
                  <span>Pantalla interactiva simulada (Podés hacer clic y probarla):</span>
                </div>
                <div
                  style={{
                    flex: 1,
                    background: "var(--surface-white, #ffffff)",
                    borderRadius: "12px",
                    border: "1px solid var(--border-line, #e2e8f0)",
                    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
                    padding: "12px",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {currentStep.mockComponent}
                </div>
              </div>
            </div>

            {/* FOOTER DEL TUTORIAL (PAGINACIÓN) */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--border-line, #e2e8f0)",
                background: "var(--surface-white, #ffffff)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              {/* Indicador de bolitas de pasos */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {steps.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setCurrentStepIndex(idx)}
                    style={{
                      height: "8px",
                      width: idx === currentStepIndex ? "24px" : "8px",
                      borderRadius: "4px",
                      background: idx === currentStepIndex ? "var(--brand-primary, #005bd5)" : "var(--border-line, #cbd5e1)",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                    title={`Ir al paso ${idx + 1}`}
                  />
                ))}
                <span style={{ fontSize: "11px", color: "var(--text-muted, #64748b)", marginLeft: "8px" }}>
                  Paso {currentStepIndex + 1} de {steps.length}
                </span>
              </div>

              {/* Controles Anterior / Siguiente */}
              <div style={{ display: "flex", gap: "8px" }}>
                {onNavigateToWorkspace && (
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateToWorkspace(selectedWorkspaceId);
                      onClose();
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--brand-border, #9ec5fe)",
                      background: "var(--brand-soft, #e8f1fd)",
                      color: "var(--brand-primary, #005bd5)",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title="Cierra el tutorial y te lleva a la pantalla real de este módulo"
                  >
                    <span>Abrir módulo real</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={isFirstStep}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-line, #e2e8f0)",
                    background: "var(--surface-white, #ffffff)",
                    color: isFirstStep ? "var(--text-muted, #94a3b8)" : "var(--text-main, #0f172a)",
                    cursor: isFirstStep ? "not-allowed" : "pointer",
                    fontSize: "12px",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <ChevronLeft size={16} /> Anterior
                </button>

                {isLastStep ? (
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      padding: "6px 16px",
                      borderRadius: "8px",
                      border: "none",
                      background: "var(--emerald-success, #10b981)",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <CheckCircle2 size={16} /> ¡Entendido, cerrar!
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleNext}
                    style={{
                      padding: "6px 16px",
                      borderRadius: "8px",
                      border: "none",
                      background: "var(--brand-primary, #005bd5)",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    Siguiente paso <ChevronRight size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PESTAÑA: ATAJOS DE TECLADO */}
        {activeTab === "shortcuts" && (
          <div style={{ flex: 1, padding: "24px", overflowY: "auto", background: "var(--canvas-bg, #f8fafc)" }}>
            <div style={{ maxWidth: "650px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ marginBottom: "8px" }}>
                <h3 style={{ margin: "0 0 4px 0", fontSize: "18px", fontWeight: 800, color: "var(--brand-navy, #032068)" }}>
                  Atajos de Teclado del Operador
                </h3>
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted, #64748b)" }}>
                  Memorizar estos atajos te permite operar a máxima velocidad en el mostrador sin soltar las manos del teclado.
                </p>
              </div>

              {KEYBOARD_SHORTCUTS.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 16px",
                    background: "var(--surface-white, #ffffff)",
                    borderRadius: "8px",
                    border: "1px solid var(--border-line, #e2e8f0)",
                  }}
                >
                  <span style={{ fontSize: "13px", fontWeight: 500 }}>{item.action}</span>
                  <kbd
                    style={{
                      padding: "4px 10px",
                      background: "var(--brand-soft, #e8f1fd)",
                      color: "var(--brand-primary, #005bd5)",
                      borderRadius: "6px",
                      border: "1px solid var(--brand-border, #9ec5fe)",
                      fontSize: "12px",
                      fontWeight: 700,
                    }}
                  >
                    {item.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PESTAÑA: MANUAL COMPLETO (PDF) */}
        {activeTab === "manual" && (
          <div style={{ flex: 1, padding: "24px", overflowY: "auto", background: "var(--canvas-bg, #f8fafc)" }}>
            <div style={{ maxWidth: "750px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ background: "var(--surface-white, #ffffff)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border-line, #e2e8f0)" }}>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "18px", fontWeight: 800, color: "var(--brand-navy, #032068)" }}>
                  Manual de Uso Operativo del ERP NicTech (PDF)
                </h3>
                <p style={{ margin: "0 0 16px 0", fontSize: "12px", color: "var(--text-muted, #64748b)" }}>
                  Documento exhaustivo con índice funcional, protocolos de caja, cobro en mostrador, servicio técnico, trazabilidad de stock y normativas internas del local.
                </p>

                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                  <button
                    type="button"
                    onClick={handleOpenPdf}
                    style={{
                      background: "var(--brand-primary, #005bd5)",
                      color: "#fff",
                      border: "none",
                      padding: "10px 18px",
                      borderRadius: "8px",
                      fontWeight: 700,
                      fontSize: "13px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <FileDown size={16} /> Abrir / Descargar Manual en PDF
                  </button>
                </div>

                <h4 style={{ margin: "16px 0 8px 0", fontSize: "13px", fontWeight: 700 }}>
                  Índice Funcional del Manual:
                </h4>
                <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "12px", color: "#334155", lineHeight: "1.8" }}>
                  <li><strong>Capítulo 1:</strong> Acceso, Seguridad y Bloqueos de Seguridad</li>
                  <li><strong>Capítulo 2:</strong> Punto de Venta (POS) - Protocolo de cobro y tickets</li>
                  <li><strong>Capítulo 3:</strong> Gestión de Caja - Aperturas, arqueo ciego y cierres diarios</li>
                  <li><strong>Capítulo 4:</strong> Servicio Técnico - Recepción con checklist y tracking web</li>
                  <li><strong>Capítulo 5:</strong> Stock y Almacén - Múltiples depósitos, reservas y ajustes</li>
                  <li><strong>Capítulo 6:</strong> Pedidos Tienda Web - Pagos MercadoPago y retiro seguro</li>
                  <li><strong>Capítulo 7:</strong> Armados de PC & Equipos Usados (Trade-ins)</li>
                  <li><strong>Capítulo 8:</strong> Cuentas Corrientes, Finanzas y Comprobantes</li>
                  <li><strong>Capítulo 9:</strong> Tabla de Aclaraciones Operativas y Faltantes en Desarrollo</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
