import "./nictech-brand.css";

export function NicTechBrand({ size = "sidebar" }: { size?: "sidebar" | "titlebar" }) {
  return (
    <span className={`nictech-brand nictech-brand--${size}`}>
      <img
        className="nictech-brand__logo"
        src={`${import.meta.env.BASE_URL}brand/nictech-logo-color.png`}
        alt="NicTech"
        width={size === "sidebar" ? 126 : 89}
        height={size === "sidebar" ? 34 : 24}
        draggable={false}
      />
      <span className="nictech-brand__erp">ERP</span>
    </span>
  );
}
