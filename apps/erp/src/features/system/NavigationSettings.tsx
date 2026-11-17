import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { ERP_MODULES, getVisibleErpModules } from "@nictech/domain";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { guardarAjuste } from "./api";
import { NAVIGATION_SETTING_KEY, navigationQueryKey, navigationSchema, useNavigationSetting, visibleFromSetting, type NavigationForm } from "./navigation";

export const NavigationSettings = () => {
  const { organizationId, hasPermission } = useErpAuth();
  const query = useNavigationSetting();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm<NavigationForm>({ resolver: zodResolver(navigationSchema), defaultValues: { profile: "salida", visible: [...getVisibleErpModules()] } });
  const { reset } = form;
  useEffect(() => {
    if (query.data) reset({ profile: query.data.profile, visible: [...visibleFromSetting(query.data)] });
  }, [query.data, reset]);
  const profile = form.watch("profile");
  const canManage = hasPermission("system.manage");
  const submit = form.handleSubmit(async (value) => {
    if (!canManage) return;
    try {
      setMessage(null);
      await guardarAjuste(NAVIGATION_SETTING_KEY, { profile: value.profile, visible: [...new Set([...(value.visible ?? []), "settings"])] });
      await queryClient.invalidateQueries({ queryKey: navigationQueryKey(organizationId) });
      setMessage("Visibilidad de módulos guardada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la visibilidad.");
    }
  });
  return (
    <section className="flow-card" aria-labelledby="navigation-settings-title">
      <h2 id="navigation-settings-title" className="flow-card__title">Módulos visibles</h2>
      <p>El perfil de salida oculta módulos. Podés reactivarlos acá; sus permisos y datos no cambian.</p>
      {query.isError && <p role="alert">No se pudo leer la visibilidad. Se muestran todos los módulos; reintentá antes de guardar.</p>}
      {query.isLoading ? <p>Cargando perfil…</p> : (
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="module-profile">Perfil</label>{" "}
          <select id="module-profile" className="erp-form-select" {...form.register("profile", { onChange: (event) => {
            const next = event.target.value === "completo" ? "completo" : "salida";
            form.setValue("visible", [...getVisibleErpModules({ profile: next })]);
          } })} disabled={!canManage || query.isError}>
            <option value="salida">Salida</option>
            <option value="completo">Completo</option>
          </select>
          <fieldset disabled={!canManage || query.isError}>
            <legend>Personalizar módulos ({profile})</legend>
            {ERP_MODULES.map((module) => (
              <label key={module.id} style={{ display: "block", margin: "6px 0" }}>
                <input type="checkbox" value={module.id} {...form.register("visible")} disabled={module.id === "settings" || !canManage || query.isError} /> {module.label}
              </label>
            ))}
          </fieldset>
          {!canManage && <p>Necesitás permiso de administración para guardar.</p>}
          {message && <p role="status">{message}</p>}
          <button className="btn-primary" type="submit" disabled={!canManage || query.isError || form.formState.isSubmitting}>Guardar módulos</button>
        </form>
      )}
    </section>
  );
};

