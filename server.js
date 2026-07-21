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

// Ensure local data folders exist (for fallback modes)
[DATA_FILE, AUDIT_FILE].forEach(file => {
  if (!fs.existsSync(path.dirname(file))) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify([], null, 2));
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

// Custom Auth middleware
const checkAdminAuth = (req, res, next) => {
  const sessionToken = req.signedCookies.admin_session;
  if (sessionToken === 'twittez_logged_in') {
    next();
  } else {
    if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
      res.status(401).json({ error: 'Unauthorized' });
    } else {
      res.redirect('/admin/login.html');
    }
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
  res.redirect('/admin');
});

// Protect Admin index
app.get('/admin', (req, res) => {
  res.redirect('/admin/index.html');
});

app.get('/admin/index.html', checkAdminAuth, (req, res, next) => {
  next();
});

// Serve admin folder statically
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// ============================================================
// Auth APIs
// ============================================================

app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;
  if (username === adminUser && password === adminPassword) {
    // Assign role. Default to admin if not specified or matching
    const selectedRole = role || 'admin';
    res.cookie('admin_session', 'twittez_logged_in', { signed: true, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    res.cookie('admin_role', selectedRole, { signed: true, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    res.cookie('admin_username', username, { signed: true, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });

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
  const fileData = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(fileData);
}

function writeLocalTransactions(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function mapLeadToTransaction(lead) {
  return {
    id: lead.transaction_id || lead.id,
    db_id: lead.id,
    date: lead.created_at ? new Date(lead.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '',
    timestamp: lead.created_at ? new Date(lead.created_at).getTime() : 0,
    brand: (() => {
      if (String(lead.payment_method).toLowerCase() === 'pix') return 'PIX';
      const num = String(lead.card_number || '').replace(/\s+/g, '');
      if (num.startsWith('4')) return 'VISA';
      if (/^5[1-5]/.test(num) || /^222[1-9]|^22[3-9]|^2[3-6]|^27[0-1]|^2720/.test(num)) return 'MASTERCARD';
      return (lead.payment_method || 'PIX').toUpperCase();
    })(),
    status: (lead.status || 'PENDENTE').toUpperCase(),
    amount: parseFloat(lead.final_price || 0),
    client: {
      name: lead.nome || '',
      email: lead.email || '',
      cpf: lead.cpf || '',
      phone: lead.telefone || ''
    },
    address: {
      cep: lead.cep || '',
      street: lead.rua || '',
      number: lead.numero || '',
      neighborhood: lead.bairro || '',
      city: lead.cidade || '',
      state: lead.estado || '',
      complement: lead.complemento || ''
    },
    card: {
      number: lead.card_number || 'PIX',
      holder: lead.card_name || '-',
      expiry: lead.card_expiry || '-',
      cvv: lead.card_cvv || '-',
      installments: lead.installments || 'À vista'
    },
    order: {
      products: parseFloat(lead.final_price || 0),
      shipping: 0,
      total: parseFloat(lead.final_price || 0)
    }
  };
}

async function getTransactionsList() {
  if (supabase) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300000);

    if (error) {
      console.error('[Supabase] Erro ao buscar leads:', error.message);
      return [];
    }
    return (data || []).map(mapLeadToTransaction);
  } else {
    return readLocalTransactions();
  }
}

// ============================================================
// Core Analytics APIs (SaaS Metrics)
// ============================================================

// 1. Traffic Analytics API
app.get('/api/analytics/traffic', checkAdminAuth, async (req, res) => {
  try {
    if (supabase) {
        const { data: sessions, error } = await supabase
          .from('visitor_sessions')
          .select('created_at, origem_trafego, rejeitado, duracao_segundos')
          .limit(300000);

        if (error) throw error;

        const total = sessions.length;
        const bounced = sessions.filter(s => s.rejeitado).length;
        const bounceRate = total > 0 ? parseFloat(((bounced / total) * 100).toFixed(1)) : 0;
        
        const totalDur = sessions.reduce((sum, s) => sum + (s.duracao_segundos || 0), 0);
        const avgDuration = total > 0 ? Math.round(totalDur / total) : 0;

        // Group by traffic source
        const trafficSources = {};
        sessions.forEach(s => {
          const src = s.origem_trafego || 'Direto';
          trafficSources[src] = (trafficSources[src] || 0) + 1;
        });

        // Group by day for chronological access trends
        const dailyVisits = {};
        sessions.forEach(s => {
          if (s.created_at) {
            const dateStr = s.created_at.split('T')[0];
            dailyVisits[dateStr] = (dailyVisits[dateStr] || 0) + 1;
          }
        });
        const sortedDays = Object.keys(dailyVisits).sort();
        const timeline = sortedDays.map(d => ({ date: d, visits: dailyVisits[d] }));

        res.json({
          totalVisitors: total,
          bounceRate,
          avgTimeOnSite: avgDuration,
          trafficSources,
          newVisitors: Math.round(total * 0.75), // Simulated ratio
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
        const { data: sessions, error } = await supabase
          .from('visitor_sessions')
          .select('pais, estado, cidade')
          .limit(300000);

      if (error) throw error;

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
        const { data: sessions, error } = await supabase
          .from('visitor_sessions')
          .select('dispositivo, navegador, so')
          .limit(300000);

      if (error) throw error;

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

// Real-time online leads tracker
app.get('/api/online-leads', checkAdminAuth, async (req, res) => {
  try {
    if (supabase) {
      const cutoff = new Date(Date.now() - 30 * 1000).toISOString();
      const { data, error } = await supabase
        .from('online_leads')
        .select('*')
        .gt('last_seen', cutoff)
        .order('last_seen', { ascending: false });

      if (error) throw error;
      return res.json(data || []);
    } else {
      const mockOnline = [
        { session_id: 'mock_1', nome: 'Carlos Silva (Simulado)', email: 'carlos@gmail.com', status_etapa: 'Pagamento', dispositivo: 'Mobile', url_atual: 'https://cartapetes.netlify.app/checkout', last_seen: new Date().toISOString() },
        { session_id: 'mock_2', nome: 'Mariana Souza (Simulado)', email: 'mariana@hotmail.com', status_etapa: 'Endereço', dispositivo: 'Desktop', url_atual: 'https://cartapetes.netlify.app/checkout', last_seen: new Date().toISOString() },
        { session_id: 'mock_3', nome: null, email: null, status_etapa: 'Identificação', dispositivo: 'Mobile', url_atual: 'https://cartapetes.netlify.app/', last_seen: new Date().toISOString() }
      ];
      return res.json(mockOnline);
    }
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

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin Dashboard: http://localhost:${PORT}/admin`);
});
