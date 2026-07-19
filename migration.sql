-- =========================================================================
-- MIGRAÇÃO DE BANCO DE DADOS: DASHBOARD ANALYTICS SAAS (TWITTEZ)
-- Cole e execute este script no SQL Editor do seu projeto Supabase.
-- =========================================================================

-- 1. Sessões de Visitantes (para Analytics de Tráfego e Geolocalização)
CREATE TABLE IF NOT EXISTS visitor_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT null,
  session_id text UNIQUE,
  ip text,
  pais text DEFAULT 'Brasil',
  estado text,
  cidade text,
  dispositivo text,
  navegador text,
  so text,
  screen_resolution text,
  origem_trafego text DEFAULT 'Direto',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  url_entrada text,
  duracao_segundos integer DEFAULT 0,
  rejeitado boolean DEFAULT true,
  last_active timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT null
);

-- 2. Histórico de Replay de Sessões (Gravações de movimento, clique e scroll)
CREATE TABLE IF NOT EXISTS session_replays (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text REFERENCES visitor_sessions(session_id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT null,
  events jsonb NOT null
);

-- 3. Cliques para Mapa de Calor (Heatmap)
CREATE TABLE IF NOT EXISTS heatmap_clicks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text,
  page_url text,
  x_pct numeric, 
  y_px integer,  
  screen_width integer,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT null
);

-- 4. Logs de Ações Administrativas (Segurança)
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user text NOT null,
  action text NOT null,
  ip text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT null
);

-- 5. Usuários com Níveis de Acesso
CREATE TABLE IF NOT EXISTS admin_roles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  username text UNIQUE NOT null,
  role text NOT null DEFAULT 'operator', 
  tfa_secret text, 
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT null
);

-- 6. Habilitar permissões básicas para as tabelas (RLS e Grants)
ALTER TABLE visitor_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE session_replays DISABLE ROW LEVEL SECURITY;
ALTER TABLE heatmap_clicks DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_roles DISABLE ROW LEVEL SECURITY;
