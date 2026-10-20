// Recrea el propietario QA del ERP en Supabase LOCAL después de un `db reset`.
//
// Solo para desarrollo local: `supabase db reset` reconstruye la base desde
// migraciones + `supabase/seed.sql`, y el seed no crea usuarios de Auth
// (ver `supabase/README.md`). Sin este script, cada reset borra las cuentas
// locales (p. ej. qa-erp-owner@nictech.local) y hay que recrearlas a mano.
//
// Uso:
//   $env:SUPABASE_SECRET_KEY = "<sb_secret_... de `npx supabase status`>"
//   npm run db:seed:qa-owner
//   # o todo junto:
//   npm run db:reset:qa
//
// Variables opcionales:
//   SUPABASE_URL            (default http://127.0.0.1:55421)
//   SUPABASE_PUBLISHABLE_KEY (para verificar el login al final; si falta, se omite)
//   ERP_QA_EMAIL            (default qa-erp-owner@nictech.local)
//   ERP_QA_PASSWORD         (default solo-local; usar otra en caso de duda)
//   ERP_ORG_ID              (default org NicTech del seed)

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:55421";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = process.env.ERP_QA_EMAIL ?? "qa-erp-owner@nictech.local";
const PASSWORD = process.env.ERP_QA_PASSWORD ?? "NicTech-QA-local-1";
const ORG_ID = process.env.ERP_ORG_ID ?? "10000000-0000-0000-0000-000000000001";

if (!SECRET_KEY) {
  console.error(
    "Falta SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY).\n" +
      "Obtenela con `npx supabase status` y exportala antes de correr el script.",
  );
  process.exit(1);
}

const adminHeaders = {
  apikey: SECRET_KEY,
  Authorization: `Bearer ${SECRET_KEY}`,
  "Content-Type": "application/json",
};

async function fail(step, res) {
  const body = await res.text();
  throw new Error(`${step} falló: HTTP ${res.status} ${body}`);
}

async function findUserByEmail(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { headers: adminHeaders });
  if (!res.ok) await fail("listar usuarios", res);
  const data = await res.json();
  const users = Array.isArray(data) ? data : (data.users ?? []);
  return users.find((u) => u.email === email) ?? null;
}

async function createUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "QA Owner local" },
    }),
  });
  if (res.status === 422) return null; // ya registrado: lo resolvemos por listado
  if (!res.ok) await fail("crear usuario", res);
  return res.json();
}

async function bootstrapOwner(authUserId, orgId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bootstrap_owner`, {
    method: "POST",
    headers: { ...adminHeaders, "Accept-Profile": "erp", "Content-Profile": "erp" },
    body: JSON.stringify({ auth_user_id: authUserId, target_organization_id: orgId }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (body.includes("already belongs to an organization")) {
      console.log("El perfil ya pertenece a una organización: se mantiene (idempotente).");
      return;
    }
    throw new Error(`bootstrap_owner falló: HTTP ${res.status} ${body}`);
  }
}

async function verifyLogin(email, password) {
  if (!PUBLISHABLE_KEY) {
    console.log("Sin SUPABASE_PUBLISHABLE_KEY: se omite la verificación de login.");
    return;
  }
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!tokenRes.ok) await fail("login de verificación", tokenRes);
  const { access_token } = await tokenRes.json();

  const ctxRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_current_erp_context`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
      "Accept-Profile": "erp",
      "Content-Profile": "erp",
    },
    body: JSON.stringify({}),
  });
  if (!ctxRes.ok) await fail("get_current_erp_context", ctxRes);
  const ctx = await ctxRes.json();
  console.log("Verificación OK:", {
    organization_id: ctx.organization_id,
    permissions: ctx.permissions?.length ?? ctx.permissions,
  });
}

const existing = await findUserByEmail(EMAIL);
const user = existing ?? (await createUser(EMAIL, PASSWORD)) ?? (await findUserByEmail(EMAIL));
if (!user) throw new Error("No se pudo crear ni encontrar el usuario QA.");
console.log(existing ? `Usuario existente: ${EMAIL} (${user.id})` : `Usuario creado: ${EMAIL} (${user.id})`);

await bootstrapOwner(user.id, ORG_ID);
console.log(`bootstrap_owner OK para org ${ORG_ID}.`);

await verifyLogin(EMAIL, PASSWORD);
console.log("Listo. Podés entrar al ERP local con esas credenciales.");
