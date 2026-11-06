/* Configuração do Supabase (login e sincronização).
   URL do projeto e chave publicável: são públicas por natureza; a proteção
   dos dados vem das regras de acesso (RLS) em supabase/schema.sql.
   NUNCA coloque aqui a secret key / service_role key. */
window.MIAUMIGO_CONFIG = {
  supabaseUrl: 'https://kmfjldbkkipsvgpkdrfi.supabase.co',
  supabaseKey: 'sb_publishable_1NEl8teWECwIOGE8RCx1lA_xl0TyABF',
  // Login com Google: ligue depois de configurar o provedor no Supabase (ver supabase/CONFIGURAR.md)
  googleLogin: true,
};
