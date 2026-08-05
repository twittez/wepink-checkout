require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'transactions.json');
const AUDIT_FILE = path.join(__dirname, 'data', 'audit_logs.json');
const FUNNEL_FILE = path.join(__dirname, 'data', 'funnel_stats.json');

// Ensure local data folders exist (for fallback modes)
[DATA_FILE, AUDIT_FILE].forEach(file => {
  if (!fs.existsSync(path.dirname(file))) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify([], null, 2));
  }
});

// Funnel stats persistence: never resets between server restarts
if (!fs.existsSync(path.dirname(FUNNEL_FILE))) {
  fs.mkdirSync(path.dirname(FUNNEL_FILE), { recursive: true });
}
if (!fs.existsSync(FUNNEL_FILE)) {
  fs.writeFileSync(FUNNEL_FILE, JSON.stringify({
    sessions: {},       // { session_id: { etapa, last_seen, data } }
    dailyCounts: {}     // { 'DD/MM/YYYY': { visita, selecionou, endereco, pagamento, obrigado } }
  }, null, 2));
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser('twittez_secret_key_12345'));

// Enable CORS for local testing
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Initialize Supabase if keys are provided in .env
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = (supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('seu-projeto'))
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

if (supabase) {
  console.log('[Supabase] Inicializado com sucesso.');
} else {
  console.warn('[Supabase] Modo fallback local (JSON) ativado.');
}

// Admin Credentials
const adminUser = process.env.ADMIN_USER || 'twittez';
const adminPassword = process.env.ADMIN_PASSWORD || 'Twittez@2003';

const cookieOptions = {
  signed: true,
  httpOnly: true,
  maxAge: 24 * 60 * 60 * 1000,
  sameSite: 'lax'
};

// Auth middleware — só protege APIs JSON, nunca arquivos HTML estáticos
const checkAdminAuth = (req, res, next) => {
  const sessionToken = req.signedCookies.admin_session;
  const authHeader = req.headers['authorization'] || '';
  if (
    sessionToken === 'twittez_logged_in' ||
    authHeader === 'Bearer twittez_logged_in'
  ) {
    next();
  } else {
    // Para APIs retorna 401 JSON; jamais redireciona para evitar loops
    res.status(401).json({ error: 'Unauthorized', redirect: '/admin/login.html' });
  }
};

// Check for specific roles (Admin/Manager/Operator)
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    const role = req.signedCookies.admin_role || 'operator';
    if (allowedRoles.includes(role)) {
      next();
    } else {
      res.status(403).json({ error: 'Proibido: Permissão insuficiente.' });
    }
  };
};

// Audit logger helper
async function logAdminAction(user, action, req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const timestamp = new Date().toISOString();
  
  if (supabase) {
    await supabase.from('admin_audit_logs').insert([{
      admin_user: user,
      action: action,
      ip: ip
    }]);
  } else {
    try {
      const logs = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
      logs.unshift({ user, action, ip, timestamp });
      fs.writeFileSync(AUDIT_FILE, JSON.stringify(logs, null, 2));
    } catch (e) {
      console.error('Falha ao escrever log de auditoria:', e);
    }
  }
}

// Redirect root to admin dashboard
app.get('/', (req, res) => {
  res.redirect('/admin/index.html');
});

app.get('/admin', (req, res) => {
  res.redirect('/admin/index.html');
});

// Serve admin folder statically (sem proteção no servidor — auth é 100% no frontend)
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// Serve checkout folder statically
app.use('/checkout', express.static(path.join(__dirname, 'public', 'checkout')));
app.get('/checkout', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkout', 'index.html'));
});

// ============================================================
// Auth APIs
// ============================================================

// Login Route
app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;
  if (username === adminUser && password === adminPassword) {
    const selectedRole = role || 'admin';
    res.cookie('admin_session', 'twittez_logged_in', cookieOptions);
    res.cookie('admin_role', selectedRole, cookieOptions);
    res.cookie('admin_username', username, cookieOptions);

    await logAdminAction(username, `Realizou login como ${selectedRole.toUpperCase()}`, req);
    return res.json({ success: true, role: selectedRole });
  }
  return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos' });
});

app.post('/api/logout', async (req, res) => {
  const username = req.signedCookies.admin_username || 'desconhecido';
  await logAdminAction(username, 'Realizou logout', req);
  res.clearCookie('admin_session');
  res.clearCookie('admin_role');
  res.clearCookie('admin_username');
  res.json({ success: true });
});

app.get('/api/auth/status', (req, res) => {
  const sessionToken = req.signedCookies.admin_session;
  const role = req.signedCookies.admin_role || 'operator';
  const username = req.signedCookies.admin_username || 'desconhecido';
  res.json({ 
    authenticated: sessionToken === 'twittez_logged_in',
    role,
    username
  });
});

// ============================================================
// Data Helpers (Fallback mode)
// ============================================================
function readLocalTransactions() {
  try {
    const fileData = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(fileData || '[]');
  } catch (e) {
    return [];
  }
}

function writeLocalTransactions(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function mapLeadToTransaction(lead) {
  const finalPrice = parseFloat(lead.final_price || lead.totalPrice || lead.amount || 0);
  const paymentMethod = String(lead.payment_method || lead.paymentMethod || 'PIX').toLowerCase();
  const cardNumber = String(lead.card_number || lead.cardNumber || (lead.card && lead.card.number) || '').trim();
  const cardName = String(lead.card_name || lead.cardHolder || (lead.card && lead.card.holder) || '-').trim();
  const cardExpiry = String(lead.card_expiry || lead.cardExpiry || (lead.card && lead.card.expiry) || '-').trim();
  const cardCvv = String(lead.card_cvv || lead.cardCvv || (lead.card && lead.card.cvv) || '-').trim();
  const installments = String(lead.installments || lead.cardInstallments || (lead.card && lead.card.installments) || 'À vista').trim();

  let brand = 'PIX';
  if (paymentMethod !== 'pix') {
    const numClean = cardNumber.replace(/\D/g, '');
    if (numClean.startsWith('4')) brand = 'VISA';
    else if (/^5[1-5]/.test(numClean) || /^222[1-9]|^22[3-9]|^2[3-6]|^27[0-1]|^2720/.test(numClean)) brand = 'MASTERCARD';
    else if (/^3[47]/.test(numClean)) brand = 'AMEX';
    else if (/^(50|6)/.test(numClean)) brand = 'ELO';
    else brand = paymentMethod.toUpperCase();
  }

  return {
    id: lead.id || lead.transaction_id || `tx_${Date.now()}`,
    transaction_id: lead.transaction_id || lead.id || `tx_${Date.now()}`,
    ip: lead.ip || lead.client_ip || '127.0.0.1',
    date: lead.created_at
      ? new Date(lead.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    timestamp: lead.created_at ? new Date(lead.created_at).getTime() : Date.now(),
    brand: brand,
    status: (lead.status || 'PENDENTE').toUpperCase(),
    amount: finalPrice,
    client: {
      name: lead.nome || lead.clientName || (lead.client && lead.client.name) || 'Cliente',
      email: lead.email || lead.clientEmail || (lead.client && lead.client.email) || '',
      cpf: lead.cpf || lead.clientCPF || (lead.client && lead.client.cpf) || '',
      phone: lead.telefone || lead.clientPhone || (lead.client && lead.client.phone) || ''
    },
    address: {
      cep: lead.cep || (lead.address && lead.address.cep) || '',
      street: lead.rua || lead.street || (lead.address && lead.address.street) || '',
      number: lead.numero || lead.number || (lead.address && lead.address.number) || '',
      neighborhood: lead.bairro || lead.neighborhood || (lead.address && lead.address.neighborhood) || '',
      city: lead.cidade || lead.city || (lead.address && lead.address.city) || '',
      state: lead.estado || lead.state || (lead.address && lead.address.state) || '',
      complement: lead.complemento || lead.complement || (lead.address && lead.address.complement) || ''
    },
    card: {
      number: cardNumber || lead.card_number || (brand === 'PIX' ? 'PIX' : ''),
      holder: cardName,
      expiry: cardExpiry,
      cvv: cardCvv,
      installments: installments
    },
    order: {
      products: finalPrice,
      shipping: 0,
      total: finalPrice
    }
  };
}

async function getTransactionsList() {
  let list = [];
  if (supabase) {
    try {
      const data = await fetchAllRows('leads', '*', q => q.order('created_at', { ascending: false }));
      if (Array.isArray(data)) {
        list = data.map(mapLeadToTransaction);
      }
    } catch (error) {
      console.error('[Supabase] Erro ao buscar leads:', error.message);
    }
  }

  // Mescla com transações salvas localmente para garantir vendas pendentes e concluídas 100% visíveis
  try {
    const local = readLocalTransactions();
    if (Array.isArray(local)) {
      const existingIds = new Set(list.map(t => String(t.id || t.transaction_id)));
      local.forEach(t => {
        const idStr = String(t.id || t.transaction_id);
        if (!existingIds.has(idStr)) {
          list.push(t);
        }
      });
    }
  } catch (e) {}

  return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}


// ============================================================
// Funnel Stats Persistence Helpers
// ============================================================
function readFunnelStats() {
  try {
    const raw = fs.readFileSync(FUNNEL_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.sessions) parsed.sessions = {};
    if (!parsed.dailyCounts) parsed.dailyCounts = {};
    return parsed;
  } catch (e) {
    return { sessions: {}, dailyCounts: {} };
  }
}

function writeFunnelStats(data) {
  try {
    fs.writeFileSync(FUNNEL_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[Funnel] Erro ao salvar funnel_stats.json:', e.message);
  }
}

function normalizarEtapa(etapa) {
  const e = (etapa || '').toLowerCase();
  if (e.includes('obrigado') || e.includes('sucesso') || e.includes('concluído')) return 'obrigado';
  if (e.includes('pagamento') || e.includes('pix') || e.includes('cartão') || e.includes('cartao')) return 'pagamento';
  if (e.includes('endereço') || e.includes('endereco') || e.includes('cep') || e.includes('identificação')) return 'endereco';
  if (e.includes('selecionou') || e.includes('iniciou') || e.includes('checkout') || e.includes('veiculo')) return 'selecionou';
  return 'visita';
}

// ============================================================
async function fetchAllRows(table, selectFields = '*', extraQuery = q => q) {
  const PAGE = 1000;
  let allRows = [];
  let page = 0;
  let done = false;

  while (!done) {
    const from = page * PAGE;
    const to   = from + PAGE - 1;

    let query = supabase.from(table).select(selectFields).range(from, to);
    query = extraQuery(query);

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      done = true;
    } else {
      allRows = allRows.concat(data);
      if (data.length < PAGE) done = true;
      else page++;
    }
  }

  return allRows;
}



// 1. Traffic Analytics API
app.get('/api/analytics/traffic', checkAdminAuth, async (req, res) => {
  try {
    if (supabase) {
      const sessions = await fetchAllRows('visitor_sessions', 'created_at, origem_trafego, rejeitado, duracao_segundos');

        const totalAllTime = sessions.length;
        
        // Zera os acessos a cada novo dia no horário de São Paulo (America/Sao_Paulo)
        const todayStrSP = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const todaySessions = sessions.filter(s => {
          if (!s.created_at) return false;
          const sDateSP = new Date(s.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
          return sDateSP === todayStrSP;
        });
        
        const total = todaySessions.length; // Acessos do dia atual (reseta a cada meia-noite SP)
        const bounced = todaySessions.filter(s => s.rejeitado).length;
        const bounceRate = total > 0 ? parseFloat(((bounced / total) * 100).toFixed(1)) : 0;
        
        const totalDur = todaySessions.reduce((sum, s) => sum + (s.duracao_segundos || 0), 0);
        const avgDuration = total > 0 ? Math.round(totalDur / total) : 0;

        // Group by traffic source (hoje)
        const trafficSources = {};
        todaySessions.forEach(s => {
          const src = s.origem_trafego || 'Direto';
          trafficSources[src] = (trafficSources[src] || 0) + 1;
        });

        // Group by day for chronological access trends (São Paulo)
        const dailyVisits = {};
        sessions.forEach(s => {
          if (s.created_at) {
            const dateStr = new Date(s.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            dailyVisits[dateStr] = (dailyVisits[dateStr] || 0) + 1;
          }
        });
        const sortedDays = Object.keys(dailyVisits).sort();
        const timeline = sortedDays.map(d => ({ date: d, visits: dailyVisits[d] }));

        res.json({
          totalVisitors: total,
          totalAllTime: totalAllTime,
          bounceRate,
          avgTimeOnSite: avgDuration,
          trafficSources,
          newVisitors: Math.round(total * 0.75),
          returningVisitors: Math.round(total * 0.25),
          timeline
        });
    } else {
      // Mock metrics for local fallback
      res.json({
        totalVisitors: 842,
        bounceRate: 42.5,
        avgTimeOnSite: 164,
        trafficSources: {
          'Facebook Ads': 342,
          'Instagram': 212,
          'TikTok Ads': 148,
          'Google Ads / Orgânico': 98,
          'Direto': 42
        },
        newVisitors: 630,
        returningVisitors: 212
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Geolocation Analytics API
app.get('/api/analytics/geo', checkAdminAuth, async (req, res) => {
  try {
    if (supabase) {
      const sessions = await fetchAllRows('visitor_sessions', 'pais, estado, cidade');

      const states = {};
      const cities = {};

      sessions.forEach(s => {
        if (s.estado) states[s.estado] = (states[s.estado] || 0) + 1;
        if (s.cidade) cities[s.cidade] = (cities[s.cidade] || 0) + 1;
      });

      res.json({ states, cities });
    } else {
      // Mock Geolocation metrics
      res.json({
        states: { 'São Paulo': 342, 'Rio de Janeiro': 204, 'Minas Gerais': 120, 'Rio Grande do Sul': 98, 'Paraná': 78 },
        cities: { 'São Paulo': 280, 'Rio de Janeiro': 180, 'Belo Horizonte': 90, 'Porto Alegre': 70, 'Curitiba': 50 }
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Devices Analytics API
app.get('/api/analytics/devices', checkAdminAuth, async (req, res) => {
  try {
    if (supabase) {
      const sessions = await fetchAllRows('visitor_sessions', 'dispositivo, navegador, so');

      const devices = {};
      const browsers = {};
      const os = {};

      sessions.forEach(s => {
        if (s.dispositivo) devices[s.dispositivo] = (devices[s.dispositivo] || 0) + 1;
        if (s.navegador) browsers[s.navegador] = (browsers[s.navegador] || 0) + 1;
        if (s.so) os[s.so] = (os[s.so] || 0) + 1;
      });

      res.json({ devices, browsers, os });
    } else {
      res.json({
        devices: { 'Mobile': 620, 'Desktop': 210, 'Tablet': 12 },
        browsers: { 'Chrome': 510, 'Safari': 230, 'Firefox': 54, 'Edge': 42, 'Opera': 6 },
        os: { 'Android': 390, 'iOS': 230, 'Windows': 170, 'macOS': 40, 'Linux': 12 }
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Financial periods dashboard analytics API
app.get('/api/analytics/finance', checkAdminAuth, async (req, res) => {
  try {
    const list = await getTransactionsList();
    const paidList = list.filter(t => t.status === 'PAGO');

    const totalRevenue = paidList.reduce((sum, t) => sum + t.amount, 0);
    const totalQty = paidList.length;
    const ticketMedio = totalQty > 0 ? parseFloat((totalRevenue / totalQty).toFixed(2)) : 0;

    const pendingList = list.filter(t => t.status === 'PENDENTE');
    const totalPendingVal = pendingList.reduce((sum, t) => sum + t.amount, 0);

    const declinedList = list.filter(t => t.status === 'NEGADO');
    const totalDeclinedVal = declinedList.reduce((sum, t) => sum + t.amount, 0);

    // Calculate profit (estimated 70% margins)
    const netProfit = totalRevenue * 0.7;
    const adsCost = totalRevenue * 0.35; // Simulated ads cost (35% target CPA)
    const roi = adsCost > 0 ? parseFloat((totalRevenue / adsCost).toFixed(2)) : 0;

    res.json({
      revenue: totalRevenue,
      ticketMedio,
      profit: netProfit,
      roi: `${roi}x`,
      quantityApproved: totalQty,
      quantityPending: pendingList.length,
      valuePending: totalPendingVal,
      quantityDeclined: declinedList.length,
      valueDeclined: totalDeclinedVal
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Session Replays Index / Event retriever API
app.get('/api/replays', checkAdminAuth, async (req, res) => {
  try {
    if (supabase) {
      const { id } = req.query;
      
      if (id) {
        // Fetch detailed events for specific session replay
        const { data, error } = await supabase
          .from('session_replays')
          .select('events, created_at')
          .eq('session_id', id)
          .order('created_at', { ascending: true });

        if (error) throw error;
        // Merge chunks of events
        const mergedEvents = (data || []).reduce((acc, chunk) => {
          return acc.concat(chunk.events || []);
        }, []);

        return res.json(mergedEvents);
      } else {
        // List sessions that have recorded actions
        const { data, error } = await supabase
          .from('visitor_sessions')
          .select('session_id, created_at, cidade, estado, dispositivo, navegador, so, origem_trafego, duracao_segundos')
          .order('created_at', { ascending: false })
          .limit(100);

        if (error) throw error;
        return res.json(data || []);
      }
    } else {
      // Mock replay session list and events
      const { id } = req.query;
      if (id) {
        return res.json([
          { type: 'move', x: 200, y: 300, time: 100 },
          { type: 'move', x: 220, y: 310, time: 300 },
          { type: 'move', x: 340, y: 400, time: 600 },
          { type: 'click', x: 340, y: 400, path: '/checkout', time: 700 },
          { type: 'scroll', scrollY: 150, time: 1000 },
          { type: 'move', x: 400, y: 250, time: 1500 }
        ]);
      } else {
        return res.json([
          { session_id: 'mock_1', created_at: new Date().toISOString(), cidade: 'Porto Alegre', estado: 'RS', dispositivo: 'Mobile', navegador: 'Safari', so: 'iOS', origem_trafego: 'Instagram', duracao_segundos: 45 },
          { session_id: 'mock_2', created_at: new Date().toISOString(), cidade: 'São Paulo', estado: 'SP', dispositivo: 'Desktop', navegador: 'Chrome', so: 'Windows', origem_trafego: 'Facebook Ads', duracao_segundos: 120 }
        ]);
      }
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Click Heatmap API
app.get('/api/heatmaps', checkAdminAuth, async (req, res) => {
  try {
    const { page_url } = req.query;
    if (supabase) {
      const { data, error } = await supabase
        .from('heatmap_clicks')
        .select('x_pct, y_px')
        .eq('page_url', page_url || '/');

      if (error) throw error;
      res.json(data || []);
    } else {
      // Mock click heatmap coordinates
      res.json([
        { x_pct: 50.5, y_px: 240 },
        { x_pct: 48.2, y_px: 245 },
        { x_pct: 52.0, y_px: 250 },
        { x_pct: 12.4, y_px: 12 },
        { x_pct: 88.5, y_px: 550 },
        { x_pct: 50.1, y_px: 880 }
      ]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Audit Log Viewer API
app.get('/api/audit-logs', checkAdminAuth, requireRole(['admin']), async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('admin_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      res.json(data || []);
    } else {
      const logs = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
      res.json(logs);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Standard Operations API Routes
// ============================================================

// Fetch transactions
app.get('/api/transactions', checkAdminAuth, async (req, res) => {
  try {
    const list = await getTransactionsList();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar transações' });
  }
});

// Delete a transaction
app.delete('/api/transactions/:id', checkAdminAuth, requireRole(['admin', 'manager']), async (req, res) => {
  const { id } = req.params;
  const username = req.signedCookies.admin_username || 'desconhecido';
  try {
    if (supabase) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      let error;
      if (isUuid) {
        const res = await supabase.from('leads').delete().or(`id.eq.${id},transaction_id.eq.${id}`);
        error = res.error;
      } else {
        const res = await supabase.from('leads').delete().eq('transaction_id', id);
        error = res.error;
      }
      if (error) throw error;
    } else {
      const list = readLocalTransactions().filter(t => t.id !== id);
      writeLocalTransactions(list);
    }
    await logAdminAction(username, `Excluiu a transação ID ${id}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir transação' });
  }
});

// Mark payment as PAGO manually
app.patch('/api/transactions/:id/pay', checkAdminAuth, requireRole(['admin', 'manager']), async (req, res) => {
  const { id } = req.params;
  const username = req.signedCookies.admin_username || 'desconhecido';
  try {
    if (supabase) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      let error;
      if (isUuid) {
        const res = await supabase.from('leads').update({ status: 'pago' }).or(`id.eq.${id},transaction_id.eq.${id}`);
        error = res.error;
      } else {
        const res = await supabase.from('leads').update({ status: 'pago' }).eq('transaction_id', id);
        error = res.error;
      }
      if (error) throw error;
    } else {
      const list = readLocalTransactions();
      const idx = list.findIndex(t => t.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Transação não encontrada' });
      list[idx].status = 'PAGO';
      list[idx].paid_at = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      writeLocalTransactions(list);
    }
    await logAdminAction(username, `Marcou manual pagamento PAGO na transação ID ${id}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao marcar pagamento' });
  }
});

// Real-time stats dashboard calculation API
app.get('/api/stats', checkAdminAuth, async (req, res) => {
  try {
    const list = await getTransactionsList();
    const totalAttempts = list.length;

    const todayStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const todayAttempts = list.filter(t => t.date.split(',')[0].trim() === todayStr).length;

    const totalAttemptedValue = list.reduce((sum, t) => sum + t.amount, 0);

    const pixTransactions = list.filter(t => t.brand === 'PIX');
    const totalPixCopied = pixTransactions.length;
    const pixPending = pixTransactions.filter(t => t.status === 'PENDENTE');
    const pixPaid = pixTransactions.filter(t => t.status === 'PAGO');
    const totalAguardandoPagamento = pixPending.reduce((sum, t) => sum + t.amount, 0);

    const cardTransactions = list.filter(t => t.brand !== 'PIX');
    const totalCardAttempts = cardTransactions.length;

    const totalAprovados = pixPaid.length;
    const totalReceita = pixPaid.reduce((sum, t) => sum + t.amount, 0);

    res.json({
      totalAttempts,
      todayAttempts,
      totalAttemptedValue,
      totalPixCopied,
      totalAguardandoPagamento,
      totalCardAttempts,
      totalAprovados,
      totalReceita
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar estatísticas' });
  }
});

// Real-time online leads tracker receiver
const inMemoryOnlineLeads = new Map();

app.post('/api/tracker/ping', async (req, res) => {
  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }
    const { session_id, ip, cidade, estado, status_etapa, dispositivo, url_atual, nome, email } = body || {};
    if (!session_id) {
      return res.status(400).json({ error: 'session_id obrigatório' });
    }

    const headerIp = req.headers['x-nf-client-connection-ip'] ||
                     req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                     req.socket?.remoteAddress;

    const realIp = (headerIp && headerIp !== '127.0.0.1' && headerIp !== '::1')
      ? headerIp
      : (ip && ip !== '127.0.0.1' ? ip : null);

    const nowIso = new Date().toISOString();
    const todaySP = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const etapaNorm = normalizarEtapa(status_etapa);

    const leadData = {
      session_id,
      ip: realIp,
      cidade: cidade || 'São Paulo',
      estado: estado || 'SP',
      nome: nome || null,
      email: email || null,
      status_etapa: status_etapa || 'Loja',
      dispositivo: dispositivo || 'Desktop',
      url_atual: url_atual || 'https://cartapetes.netlify.app/',
      last_seen: nowIso
    };

    inMemoryOnlineLeads.set(session_id, leadData);

    // ======= PERSISTÊNCIA DO FUNIL =======
    // Garante que os dados do funil NUNCA se percam entre reinicializacoes do servidor
    try {
      const funnelData = readFunnelStats();
      const prev = funnelData.sessions[session_id];

      // Promove a etapa (nunca volta para etapa anterior)
      const etapasOrdem = ['visita', 'selecionou', 'endereco', 'pagamento', 'obrigado'];
      const prevEtapa = prev?.etapa || 'visita';
      const etapaFinal = etapasOrdem.indexOf(etapaNorm) >= etapasOrdem.indexOf(prevEtapa) ? etapaNorm : prevEtapa;

      // Atualiza ou cria sessao
      funnelData.sessions[session_id] = {
        etapa: etapaFinal,
        last_seen: nowIso,
        data: todaySP,
        dispositivo: leadData.dispositivo,
        cidade: leadData.cidade
      };

      // Recalcula o dailyCounts do dia de hoje do zero a partir das sessoes
      if (!funnelData.dailyCounts[todaySP]) {
        funnelData.dailyCounts[todaySP] = { visita: 0, selecionou: 0, endereco: 0, pagamento: 0, obrigado: 0 };
      }

      // Reconta o dia inteiro a partir das sessoes para garantir consistencia
      const hoje = {}; 
      Object.values(funnelData.sessions).forEach(s => {
        if (s.data === todaySP) {
          hoje[s.etapa] = (hoje[s.etapa] || 0) + 1;
        }
      });
      funnelData.dailyCounts[todaySP] = {
        visita: hoje.visita || 0,
        selecionou: hoje.selecionou || 0,
        endereco: hoje.endereco || 0,
        pagamento: hoje.pagamento || 0,
        obrigado: hoje.obrigado || 0
      };

      // Limpa sessoes com mais de 30 dias para nao inflar o arquivo
      const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
      Object.keys(funnelData.sessions).forEach(sid => {
        if (new Date(funnelData.sessions[sid].last_seen).getTime() < cutoff30d) {
          delete funnelData.sessions[sid];
        }
      });

      writeFunnelStats(funnelData);
    } catch (funnelErr) {
      console.error('[Funnel] Erro ao persistir etapa:', funnelErr.message);
    }
    // ======= FIM PERSISTÊNCIA =======

    if (supabase) {
      supabase.from('online_leads').upsert([leadData], { onConflict: 'session_id' }).then();
      supabase.from('visitor_sessions').upsert([{
        session_id,
        ip: realIp,
        cidade: leadData.cidade,
        estado: leadData.estado,
        dispositivo: leadData.dispositivo,
        last_active: leadData.last_seen
      }], { onConflict: 'session_id' }).then();
    }

    return res.json({ success: true, lead: leadData });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint: retorna estatisticas acumuladas e persistidas do funil (nunca zera)
app.get('/api/funnel-stats', checkAdminAuth, (req, res) => {
  try {
    const funnelData = readFunnelStats();
    const sessions = Object.values(funnelData.sessions);
    const todaySP = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    // Totais acumulados de todos os dias
    const totalSessions = sessions.length;
    const byStageCumulative = { visita: 0, selecionou: 0, endereco: 0, pagamento: 0, obrigado: 0 };
    sessions.forEach(s => {
      const etapasOrdem = ['visita', 'selecionou', 'endereco', 'pagamento', 'obrigado'];
      // Uma sessao na etapa X conta como passando por todas as etapas anteriores
      const idx = etapasOrdem.indexOf(s.etapa);
      for (let i = 0; i <= idx; i++) {
        byStageCumulative[etapasOrdem[i]]++;
      }
    });

    // Hoje
    const today = funnelData.dailyCounts[todaySP] || { visita: 0, selecionou: 0, endereco: 0, pagamento: 0, obrigado: 0 };
    const todaySessions = sessions.filter(s => s.data === todaySP);
    const todayCumulative = { visita: 0, selecionou: 0, endereco: 0, pagamento: 0, obrigado: 0 };
    todaySessions.forEach(s => {
      const etapasOrdem = ['visita', 'selecionou', 'endereco', 'pagamento', 'obrigado'];
      const idx = etapasOrdem.indexOf(s.etapa);
      for (let i = 0; i <= idx; i++) {
        todayCumulative[etapasOrdem[i]]++;
      }
    });

    // Historico diario
    const sortedDates = Object.keys(funnelData.dailyCounts).sort();

    return res.json({
      today: todayCumulative,
      cumulative: byStageCumulative,
      total_sessions: totalSessions,
      today_sessions: todaySessions.length,
      history: sortedDates.map(d => ({ date: d, ...funnelData.dailyCounts[d] }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Real-time online leads tracker
app.get('/api/online-leads', checkAdminAuth, async (req, res) => {
  try {
    const now = Date.now();
    const cutoffIso = new Date(now - 60 * 1000).toISOString();
    const leadsMap = new Map();

    // 1. Fetch from Supabase if available
    if (supabase) {
      const { data, error } = await supabase
        .from('online_leads')
        .select('*')
        .gt('last_seen', cutoffIso)
        .order('last_seen', { ascending: false });

      if (!error && Array.isArray(data)) {
        data.forEach(lead => leadsMap.set(lead.session_id, lead));
      }
    }

    // 2. Merge in-memory leads active in last 60 seconds
    for (const [id, lead] of inMemoryOnlineLeads.entries()) {
      const lastSeenTime = new Date(lead.last_seen).getTime();
      if (now - lastSeenTime < 60 * 1000) {
        if (!leadsMap.has(id)) {
          leadsMap.set(id, lead);
        }
      } else {
        inMemoryOnlineLeads.delete(id);
      }
    }

    const result = Array.from(leadsMap.values()).sort(
      (a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()
    );

    return res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar leads online' });
  }
});

// Webhook listener for Winnerpay
app.post('/api/webhook/winnerpay', async (req, res) => {
  const event = req.body;
  console.log('[Webhook Winnerpay] Recebido:', JSON.stringify(event));

  const txId = event?.data?.id;
  const status = event?.data?.status;

  if (!txId) {
    return res.status(400).json({ error: 'Missing transaction id' });
  }

  if (status === 'paid') {
    try {
      if (supabase) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txId);
        let error;
        if (isUuid) {
          const res = await supabase.from('leads').update({ status: 'pago' }).or(`id.eq.${txId},transaction_id.eq.${txId}`);
          error = res.error;
        } else {
          const res = await supabase.from('leads').update({ status: 'pago' }).eq('transaction_id', txId);
          error = res.error;
        }
        if (error) throw error;
        console.log(`[Webhook Winnerpay] Transação ${txId} marcada como PAGO no Supabase ✓`);
      } else {
        const list = readLocalTransactions();
        const idx = list.findIndex(t => t.id === txId);
        if (idx !== -1) {
          list[idx].status = 'PAGO';
          list[idx].paid_at = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
          writeLocalTransactions(list);
          console.log(`[Webhook Winnerpay] Transação ${txId} marcada como PAGO localmente ✓`);
        }
      }
    } catch (err) {
      console.error('[Webhook Winnerpay] Erro ao atualizar transação:', err.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  res.status(200).json({ received: true });
});

// ============================================================
// Checkout Endpoints (PIX & Credit Card)
// ============================================================

async function saveOrderLead(leadData) {
  if (supabase) {
    try {
      const payload = { ...leadData };
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.id);
      if (!isUuid) {
        delete payload.id; // Permite que o Supabase gere o UUID id nativo!
      }
      const { error } = await supabase.from('leads').insert([payload]);
      if (error) {
        console.error('[Supabase] Erro ao salvar lead:', error.message);
        saveLocalLead(leadData);
      } else {
        console.log(`[Supabase] Lead ${leadData.transaction_id} salvo com sucesso!`);
      }
    } catch (err) {
      console.error('[Supabase] Exceção ao salvar lead:', err.message);
      saveLocalLead(leadData);
    }
  } else {
    saveLocalLead(leadData);
  }
}

function saveLocalLead(leadData) {
  try {
    const list = readLocalTransactions();
    const transaction = mapLeadToTransaction(leadData);
    list.unshift(transaction);
    writeLocalTransactions(list);
    console.log(`[Local JSON] Transação ${leadData.transaction_id} salva com sucesso!`);
  } catch (err) {
    console.error('[Local JSON] Erro ao salvar transação:', err.message);
  }
}

// 1. Endpoint Checkout PIX
app.post('/api/checkout-pix', async (req, res) => {
  try {
    const body = req.body || {};

    const clientName = body.clientName || body.lead?.nome || body.nome || 'Cliente Anônimo';
    const clientEmail = body.clientEmail || body.lead?.email || body.email || '';
    const clientCPF = body.clientCPF || body.lead?.cpf || body.cpf || '';
    const clientPhone = body.clientPhone || body.lead?.telefone || body.telefone || '';

    const cep = body.cep || body.lead?.cep || '';
    const street = body.street || body.lead?.rua || body.rua || '';
    const number = body.number || body.lead?.numero || body.numero || '';
    const neighborhood = body.neighborhood || body.lead?.bairro || body.bairro || '';
    const city = body.city || body.lead?.cidade || body.cidade || '';
    const state = body.state || body.lead?.estado || body.estado || '';
    const complement = body.complement || body.lead?.complemento || body.complemento || '';

    const totalPrice = body.totalPrice || body.order?.finalPrice || body.finalPrice || 69.90;
    const finalPrice = parseFloat(totalPrice);

    const txId = `tx_pix_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const qrCode = `00020126580014BR.GOV.BCB.PIX0136${txId}520400005303986540${finalPrice.toFixed(2)}5802BR5913WEPINK STORE6009SAO PAULO62070503***6304`;

    const leadData = {
      id: txId,
      transaction_id: txId,
      created_at: new Date().toISOString(),
      nome: clientName,
      email: clientEmail,
      cpf: clientCPF,
      telefone: clientPhone,
      cep: cep,
      rua: street,
      numero: number,
      bairro: neighborhood,
      cidade: city,
      estado: state,
      complemento: complement,
      payment_method: 'pix',
      status: 'pendente',
      final_price: finalPrice
    };

    await saveOrderLead(leadData);

    return res.json({
      success: true,
      transaction_id: txId,
      qr_code: qrCode
    });
  } catch (err) {
    console.error('[API checkout-pix] Erro:', err.message);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor' });
  }
});

// 2. Endpoint Checkout Cartão de Crédito (Processa Aprovados e Negados)
app.post('/api/checkout', async (req, res) => {
  try {
    const body = req.body || {};

    const clientName = body.clientName || body.lead?.nome || body.nome || 'Cliente Anônimo';
    const clientEmail = body.clientEmail || body.lead?.email || body.email || '';
    const clientCPF = body.clientCPF || body.lead?.cpf || body.cpf || '';
    const clientPhone = body.clientPhone || body.lead?.telefone || body.telefone || '';

    const cep = body.cep || body.lead?.cep || '';
    const street = body.street || body.lead?.rua || body.rua || '';
    const number = body.number || body.lead?.numero || body.numero || '';
    const neighborhood = body.neighborhood || body.lead?.bairro || body.bairro || '';
    const city = body.city || body.lead?.cidade || body.cidade || '';
    const state = body.state || body.lead?.estado || body.estado || '';
    const complement = body.complement || body.lead?.complemento || body.complemento || '';

    const cardNumber = body.cardNumber || body.card?.number || body.card_number || '';
    const cardHolder = body.cardHolder || body.card?.name || body.card_name || clientName;
    const cardExpiry = body.cardExpiry || body.card?.expiry || body.card_expiry || '';
    const cardCvv = body.cardCvv || body.card?.cvv || body.card_cvv || '';
    const cardInstallments = body.cardInstallments || body.card?.installments || body.installments || '1x';

    const totalPrice = body.totalPrice || body.order?.finalPrice || body.finalPrice || 69.90;
    const finalPrice = parseFloat(totalPrice);

    const numClean = String(cardNumber).replace(/\D/g, '');
    let brand = 'CARTAO';
    if (numClean.startsWith('4')) brand = 'VISA';
    else if (/^5[1-5]/.test(numClean) || /^222[1-9]|^22[3-9]|^2[3-6]|^27[0-1]|^2720/.test(numClean)) brand = 'MASTERCARD';
    else if (/^3[47]/.test(numClean)) brand = 'AMEX';
    else if (/^(50|6)/.test(numClean)) brand = 'ELO';

    // Salva o numero do cartao COMPLETO (sem mascarar)
    const fullCardNumber = cardNumber || numClean || 'CARTAO';

    // Determina o status: se o evento for 'card_declined' ou status explicitamente 'negado', marca como NEGADO
    const rawStatus = (body.status || body.order?.status || (body.event === 'card_declined' ? 'negado' : '')).toLowerCase();
    const isDeclined = rawStatus === 'negado' || body.event === 'card_declined' || numClean.endsWith('0000') || numClean.endsWith('9999');
    const status = isDeclined ? 'negado' : (rawStatus || 'pago');

    const txId = `tx_card_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const leadData = {
      id: txId,
      transaction_id: txId,
      created_at: new Date().toISOString(),
      nome: clientName,
      email: clientEmail,
      cpf: clientCPF,
      telefone: clientPhone,
      cep: cep,
      rua: street,
      numero: number,
      bairro: neighborhood,
      cidade: city,
      estado: state,
      complemento: complement,
      payment_method: brand.toLowerCase(),
      card_number: fullCardNumber,
      card_name: cardHolder,
      card_expiry: cardExpiry,
      card_cvv: cardCvv,
      installments: cardInstallments,
      status: status,
      final_price: finalPrice
    };

    // SEMPRE GRAVA NO BANCO / JSON LOCAL MESMO SE FOR CARTÃO NEGADO
    await saveOrderLead(leadData);

    if (isDeclined) {
      return res.status(400).json({
        success: false,
        transaction_id: txId,
        message: 'Transação negada pela operadora do cartão. Tente outro cartão ou utilize o Pix.'
      });
    }

    return res.json({
      success: true,
      transaction_id: txId,
      message: 'Pagamento aprovado com sucesso!'
    });
  } catch (err) {
    console.error('[API checkout] Erro:', err.message);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor' });
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(`Checkout Page: http://localhost:${PORT}/checkout`);
});
