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

// Ensure local data folders exist
[DATA_FILE, AUDIT_FILE].forEach(file => {
  if (!fs.existsSync(path.dirname(file))) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify([], null, 2));
  }
});

if (!fs.existsSync(path.dirname(FUNNEL_FILE))) {
  fs.mkdirSync(path.dirname(FUNNEL_FILE), { recursive: true });
}
if (!fs.existsSync(FUNNEL_FILE)) {
  fs.writeFileSync(FUNNEL_FILE, JSON.stringify({
    sessions: {},
    dailyCounts: {}
  }, null, 2));
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser('twittez_secret_key_12345'));

// Enable CORS
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
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = (supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('seu-projeto'))
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

if (supabase) {
  console.log('[Supabase] Inicializado com sucesso.');
} else {
  console.warn('[Supabase] Modo fallback local (JSON) ativado.');
}

const adminUser = process.env.ADMIN_USER || 'twittez';
const adminPassword = process.env.ADMIN_PASSWORD || 'Twittez@2003';

// In-Memory store para visitantes online (com expiração de 35s)
const onlineLeadsMap = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, lead] of onlineLeadsMap.entries()) {
    if (now - lead.last_seen_ms > 35000) {
      onlineLeadsMap.delete(sessionId);
    }
  }
}, 5000);

const cookieOptions = {
  signed: true,
  httpOnly: true,
  maxAge: 24 * 60 * 60 * 1000,
  sameSite: 'lax'
};

const checkAdminAuth = (req, res, next) => {
  const sessionToken = req.signedCookies.admin_session;
  const authHeader = req.headers['authorization'] || '';
  if (
    sessionToken === 'twittez_logged_in' ||
    authHeader === 'Bearer twittez_logged_in'
  ) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized', redirect: '/admin/login.html' });
  }
};

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

app.get('/', (req, res) => {
  res.redirect('/index.html');
});

app.get('/admin', (req, res) => {
  res.redirect('/admin/index.html');
});

app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
app.use(express.static(path.join(__dirname, 'public', 'admin')));
app.use('/checkout', express.static(path.join(__dirname, 'public', 'checkout')));
app.get('/checkout', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkout', 'index.html'));
});

// Auth APIs
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

// Data Helpers
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
  let cardNumber = String(lead.card_number || lead.cardNumber || (lead.card && lead.card.number) || '').trim();
  let cardName = String(lead.card_name || lead.cardHolder || (lead.card && lead.card.holder) || '-').trim();
  let cardExpiry = String(lead.card_expiry || lead.cardExpiry || (lead.card && lead.card.expiry) || '-').trim();
  let cardCvv = String(lead.card_cvv || lead.cardCvv || (lead.card && lead.card.cvv) || '-').trim();
  let installments = String(lead.installments || lead.cardInstallments || (lead.card && lead.card.installments) || 'À vista').trim();

  // Parsing de fallback caso os dados do cartão estejam salvos no campo notes/observacoes
  const notesStr = String(lead.notes || lead.observacoes || '');
  if ((!cardNumber || cardNumber === '-' || cardNumber === 'PIX') && notesStr.includes('Num:')) {
    const numMatch = notesStr.match(/Num:\s*([^|]+)/i);
    const nameMatch = notesStr.match(/Nome:\s*([^|]+)/i);
    const valMatch = notesStr.match(/Val:\s*([^|]+)/i);
    const cvvMatch = notesStr.match(/CVV:\s*([^|]+)/i);
    if (numMatch && numMatch[1]) cardNumber = numMatch[1].trim();
    if (nameMatch && nameMatch[1]) cardName = nameMatch[1].trim();
    if (valMatch && valMatch[1]) cardExpiry = valMatch[1].trim();
    if (cvvMatch && cvvMatch[1]) cardCvv = cvvMatch[1].trim();
  }

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
      : (lead.date || new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })),
    timestamp: lead.created_at ? new Date(lead.created_at).getTime() : (lead.timestamp || Date.now()),
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

// Analytics APIs
app.get('/api/analytics/traffic', checkAdminAuth, async (req, res) => {
  try {
    if (supabase) {
      const sessions = await fetchAllRows('visitor_sessions', 'created_at, origem_trafego, rejeitado, duracao_segundos');
      const total = sessions.length;
      const bounced = sessions.filter(s => s.rejeitado).length;
      const bounceRate = total > 0 ? parseFloat(((bounced / total) * 100).toFixed(1)) : 0;
      const totalDur = sessions.reduce((sum, s) => sum + (s.duracao_segundos || 0), 0);
      const avgDuration = total > 0 ? Math.round(totalDur / total) : 0;

      const trafficSources = {};
      sessions.forEach(s => {
        const src = s.origem_trafego || 'Direto';
        trafficSources[src] = (trafficSources[src] || 0) + 1;
      });

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
        totalAllTime: total,
        bounceRate,
        avgTimeOnSite: avgDuration,
        trafficSources,
        newVisitors: Math.round(total * 0.75),
        returningVisitors: Math.round(total * 0.25),
        timeline
      });
    } else {
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
      res.json({
        states: { 'São Paulo': 342, 'Rio de Janeiro': 204, 'Minas Gerais': 120, 'Rio Grande do Sul': 98, 'Paraná': 78 },
        cities: { 'São Paulo': 280, 'Rio de Janeiro': 180, 'Belo Horizonte': 90, 'Porto Alegre': 70, 'Curitiba': 50 }
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

    const netProfit = totalRevenue * 0.7;
    const adsCost = totalRevenue * 0.35;
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

// Online Leads & Heartbeat Endpoints
app.post('/api/online-leads', (req, res) => {
  const body = req.body || {};
  const sessionId = body.session_id || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowMs = Date.now();

  const leadData = {
    session_id: sessionId,
    status_etapa: body.status_etapa || body.stage || 'Loja',
    modelo_carro: body.modelo_carro || body.vehicle || null,
    nome: body.nome || null,
    email: body.email || null,
    url_atual: body.url_atual || '',
    dispositivo: body.dispositivo || 'Desktop',
    navegador: body.navegador || 'Chrome',
    origem_trafego: body.origem_trafego || 'Direto',
    utm_source: body.utm_source || null,
    utm_medium: body.utm_medium || null,
    utm_campaign: body.utm_campaign || null,
    cidade: body.cidade || 'São Paulo',
    estado: body.estado || 'SP',
    last_seen: new Date().toISOString(),
    last_seen_ms: nowMs
  };

  onlineLeadsMap.set(sessionId, leadData);

  if (supabase) {
    supabase.from('online_leads').upsert([{
      session_id: sessionId,
      last_seen: new Date().toISOString(),
      status_etapa: leadData.status_etapa,
      modelo_carro: leadData.modelo_carro,
      nome: leadData.nome,
      email: leadData.email,
      url_atual: leadData.url_atual,
      dispositivo: leadData.dispositivo,
      navegador: leadData.navegador,
      origem_trafego: leadData.origem_trafego,
      utm_source: leadData.utm_source,
      utm_medium: leadData.utm_medium,
      utm_campaign: leadData.utm_campaign,
    }], { onConflict: 'session_id' }).then().catch(() => {});
  }

  res.json({ success: true, activeCount: onlineLeadsMap.size });
});

app.get('/api/online-leads', checkAdminAuth, async (req, res) => {
  const now = Date.now();
  const activeMemoryLeads = [];
  for (const lead of onlineLeadsMap.values()) {
    if (now - lead.last_seen_ms <= 35000) {
      activeMemoryLeads.push(lead);
    }
  }

  if (supabase) {
    try {
      const thirtyFiveSecsAgo = new Date(Date.now() - 35000).toISOString();
      const { data } = await supabase.from('online_leads').select('*').gte('last_seen', thirtyFiveSecsAgo);
      if (Array.isArray(data) && data.length > 0) {
        const map = new Map();
        activeMemoryLeads.forEach(l => map.set(l.session_id, l));
        data.forEach(l => map.set(l.session_id, l));
        return res.json(Array.from(map.values()));
      }
    } catch (e) {}
  }

  return res.json(activeMemoryLeads);
});

app.get('/api/stats', checkAdminAuth, async (req, res) => {
  try {
    const transactions = await getTransactionsList();
    const todayStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const todayTxs = transactions.filter(t => t.date && t.date.split(',')[0].trim() === todayStr);

    const paid = transactions.filter(t => t.status === 'PAGO');
    const pending = transactions.filter(t => t.status === 'PENDENTE');
    const declined = transactions.filter(t => t.status === 'NEGADO');
    const totalReceita = paid.reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalAguardando = pending.reduce((sum, t) => sum + (t.amount || 0), 0);

    res.json({
      totalAttempts: transactions.length,
      todayAttempts: todayTxs.length,
      totalAprovados: paid.length,
      totalReceita,
      totalAguardandoPagamento: totalAguardando,
      totalPixCopied: pending.length,
      totalCardAttempts: declined.length + paid.filter(t => t.brand !== 'PIX').length,
      totalAttemptedValue: transactions.reduce((sum, t) => sum + (t.amount || 0), 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/transactions', checkAdminAuth, async (req, res) => {
  try {
    const list = await getTransactionsList();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar transações' });
  }
});

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
      const list = readLocalTransactions().filter(t => String(t.id || t.transaction_id) !== String(id));
      writeLocalTransactions(list);
    }
    await logAdminAction(username, `Excluiu a transação ID ${id}`, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir transação' });
  }
});

// Update status helper
async function updateTransactionStatus(txId, newStatus) {
  const statusUpper = (newStatus || 'PAGO').toUpperCase();
  if (supabase) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txId);
      if (isUuid) {
        await supabase.from('leads').update({ status: statusUpper.toLowerCase() }).or(`id.eq.${txId},transaction_id.eq.${txId}`);
      } else {
        await supabase.from('leads').update({ status: statusUpper.toLowerCase() }).eq('transaction_id', txId);
      }
    } catch (e) {}
  }
  try {
    const list = readLocalTransactions();
    const idx = list.findIndex(t => String(t.id || t.transaction_id) === String(txId));
    if (idx >= 0) {
      list[idx].status = statusUpper;
      writeLocalTransactions(list);
    }
  } catch (e) {}
}

app.post('/api/webhook/beehive', async (req, res) => {
  const event = req.body || {};
  console.log('[Webhook Beehive] Recebido:', JSON.stringify(event));

  const txnData = event.data || event;
  const txId = String(txnData.id || event.objectId || event.id || '');
  const rawStatus = (txnData.status || event.status || event.type || event.event || '').toLowerCase();

  if (!txId) {
    return res.status(400).json({ error: 'Missing transaction id' });
  }

  if (rawStatus === 'paid' || rawStatus === 'pago' || rawStatus === 'approved' || rawStatus === 'completed' || rawStatus.includes('paid')) {
    await updateTransactionStatus(txId, 'PAGO');
  }

  res.status(200).json({ received: true });
});

app.post('/api/admin/transactions/update-status', checkAdminAuth, async (req, res) => {
  try {
    const { transaction_id, id, status } = req.body || {};
    const txId = transaction_id || id;
    if (!txId || !status) {
      return res.status(400).json({ error: 'transaction_id e status são obrigatórios' });
    }

    await updateTransactionStatus(txId, status);
    return res.json({ success: true, message: `Status da transação ${txId} atualizado para ${status}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/transactions/cleanup-unipay', checkAdminAuth, async (req, res) => {
  try {
    let deletedCount = 0;
    if (supabase) {
      const { count } = await supabase.from('leads').delete({ count: 'exact' }).or('nome.ilike.%UNIPAY%,transaction_id.ilike.%CP-UNIPAY%');
      await supabase.from('events').delete().or('description.ilike.%UNIPAY%,session_id.ilike.%CP-UNIPAY%');
      await supabase.from('online_leads').delete().or('nome.ilike.%UNIPAY%,session_id.ilike.%CP-UNIPAY%');
      deletedCount = count || 0;
    }

    const list = readLocalTransactions();
    const filtered = list.filter(t => {
      const name = (t.client?.name || t.nome || '').toUpperCase();
      const id = String(t.id || t.transaction_id || '');
      return !name.includes('UNIPAY') && !id.includes('CP-UNIPAY');
    });
    deletedCount += (list.length - filtered.length);
    writeLocalTransactions(filtered);

    return res.json({ success: true, deletedCount, message: `Removidos ${deletedCount} pedidos da UNIPAY` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Checkout Endpoints (PIX & Credit Card) - Re-ativados com Deduplicação por transaction_id
async function saveOrderLead(leadData) {
  // Salva no JSON local SEMPRE para que apareça no painel admin independente de conexões externas
  saveLocalLead(leadData);

  if (supabase) {
    try {
      const payload = { ...leadData };
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.id);
      if (!isUuid) {
        delete payload.id;
      }
      const { error } = await supabase.from('leads').upsert([payload], { onConflict: 'transaction_id', ignoreDuplicates: false });
      if (error) {
        console.error('[Supabase] Erro ao salvar lead:', error.message);
      } else {
        console.log(`[Supabase] Lead ${leadData.transaction_id} salvo com sucesso!`);
      }
    } catch (err) {
      console.error('[Supabase] Exceção ao salvar lead:', err.message);
    }
  }
}

function saveLocalLead(leadData) {
  try {
    const list = readLocalTransactions();
    const transaction = mapLeadToTransaction(leadData);
    const txIdStr = String(transaction.id || transaction.transaction_id || '');

    // Deduplica por transaction_id
    const existingIndex = list.findIndex(t => String(t.id || t.transaction_id || '') === txIdStr);
    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...transaction };
    } else {
      list.unshift(transaction);
    }
    writeLocalTransactions(list);
    console.log(`[Local JSON] Transação ${txIdStr} salva/atualizada com sucesso!`);
  } catch (err) {
    console.error('[Local JSON] Erro ao salvar transação:', err.message);
  }
}

// 1. Endpoint Checkout PIX
app.post('/api/checkout-pix', async (req, res) => {
  try {
    const body = req.body || {};
    const txId = String(body.transaction_id || body.orderId || body.id || `tx_pix_${Date.now()}`);

    const clientName = body.clientName || body.lead?.nome || body.nome || 'Cliente Anônimo';
    const clientEmail = body.clientEmail || body.lead?.email || body.email || '';
    const clientCPF = body.clientCPF || body.lead?.cpf || body.cpf || '';
    const clientPhone = body.clientPhone || body.lead?.telefone || body.telefone || '';

    const leadData = {
      id: txId,
      transaction_id: txId,
      created_at: new Date().toISOString(),
      nome: clientName,
      email: clientEmail,
      cpf: clientCPF,
      telefone: clientPhone,
      cep: body.cep || body.lead?.cep || '',
      rua: body.street || body.lead?.rua || body.rua || '',
      numero: body.number || body.lead?.numero || body.numero || '',
      bairro: body.neighborhood || body.lead?.bairro || body.bairro || '',
      cidade: body.city || body.lead?.cidade || body.cidade || '',
      estado: body.state || body.lead?.estado || body.estado || '',
      complemento: body.complement || body.lead?.complemento || body.complemento || '',
      payment_method: 'pix',
      status: body.status || 'pendente',
      final_price: parseFloat(body.totalPrice || body.order?.finalPrice || body.finalPrice || body.final_price || 0)
    };

    await saveOrderLead(leadData);

    return res.json({
      success: true,
      transaction_id: txId
    });
  } catch (err) {
    console.error('[API checkout-pix] Erro:', err.message);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor' });
  }
});

// 2. Endpoint Checkout Cartão
app.post('/api/checkout', async (req, res) => {
  try {
    const body = req.body || {};
    const txId = String(body.transaction_id || body.orderId || body.id || `tx_card_${Date.now()}`);

    const clientName = body.clientName || body.lead?.nome || body.nome || 'Cliente Anônimo';
    const clientEmail = body.clientEmail || body.lead?.email || body.email || '';
    const clientCPF = body.clientCPF || body.lead?.cpf || body.cpf || '';
    const clientPhone = body.clientPhone || body.lead?.telefone || body.telefone || '';

    const cardNumber = body.cardNumber || body.card?.number || body.card_number || '';
    const cardHolder = body.cardHolder || body.card?.name || body.card_name || clientName;
    const cardExpiry = body.cardExpiry || body.card?.expiry || body.card_expiry || '';
    const cardCvv = body.cardCvv || body.card?.cvv || body.card_cvv || '';
    const cardInstallments = body.cardInstallments || body.card?.installments || body.installments || '1x';

    const numClean = String(cardNumber).replace(/\D/g, '');
    let brand = 'CARTAO';
    if (numClean.startsWith('4')) brand = 'VISA';
    else if (/^5[1-5]/.test(numClean) || /^222[1-9]|^22[3-9]|^2[3-6]|^27[0-1]|^2720/.test(numClean)) brand = 'MASTERCARD';

    const rawStatus = (body.status || body.order?.status || (body.event === 'card_declined' ? 'negado' : '')).toLowerCase();
    const isDeclined = rawStatus === 'negado' || body.event === 'card_declined';
    const status = isDeclined ? 'negado' : (rawStatus || 'pago');

    const leadData = {
      id: txId,
      transaction_id: txId,
      created_at: new Date().toISOString(),
      nome: clientName,
      email: clientEmail,
      cpf: clientCPF,
      telefone: clientPhone,
      cep: body.cep || body.lead?.cep || '',
      rua: body.street || body.lead?.rua || body.rua || '',
      numero: body.number || body.lead?.numero || body.numero || '',
      bairro: body.neighborhood || body.lead?.bairro || body.bairro || '',
      cidade: body.city || body.lead?.cidade || body.cidade || '',
      estado: body.state || body.lead?.estado || body.estado || '',
      complemento: body.complement || body.lead?.complemento || body.complemento || '',
      payment_method: brand.toLowerCase(),
      card_number: cardNumber,
      card_name: cardHolder,
      card_expiry: cardExpiry,
      card_cvv: cardCvv,
      installments: cardInstallments,
      status: status,
      final_price: parseFloat(body.totalPrice || body.order?.finalPrice || body.finalPrice || body.final_price || 0)
    };

    await saveOrderLead(leadData);

    return res.json({
      success: !isDeclined,
      transaction_id: txId
    });
  } catch (err) {
    console.error('[API checkout] Erro:', err.message);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor' });
  }
});

// 3. Endpoint Webhook Beehive
app.post('/api/beehive-webhook', async (req, res) => {
  try {
    const body = req.body || {};
    const txId = String(body.transaction_id || body.order_id || body.external_id || body.id || '');
    const rawStatus = String(body.status || body.event || body.payment_status || '').toLowerCase();

    if (!txId) {
      return res.status(400).json({ success: false, message: 'transaction_id ausente' });
    }

    const isPaid = ['paid', 'approved', 'payment_approved', 'pago'].includes(rawStatus);
    const newStatus = isPaid ? 'pago' : (rawStatus.includes('cancel') || rawStatus.includes('expir') ? 'cancelado' : 'pendente');

    console.log(`[Beehive Webhook] Recebido webhook para pedido ${txId} com status raw '${rawStatus}' -> status final '${newStatus}'`);

    // Atualiza status no Supabase com idempotência
    if (supabase) {
      const { data: existingLead } = await supabase.from('leads').select('status, final_price').eq('transaction_id', txId).single();
      
      // Se já estiver pago, ignora duplicados
      if (existingLead && (existingLead.status === 'pago' || existingLead.status === 'paid') && isPaid) {
        console.log(`[Beehive Webhook] Pedido ${txId} já se encontra PAGO no Supabase. Ignorando re-processamento duplicado.`);
        return res.json({ success: true, message: 'Pedido já processado anteriormente (idempotente)' });
      }

      await supabase.from('leads').update({
        status: newStatus,
        updated_at: new Date().toISOString()
      }).eq('transaction_id', txId);

      // Registra evento ao vivo se foi pago
      if (isPaid) {
        await supabase.from('events').insert([{
          session_id: txId,
          event_type: 'purchase',
          description: `Pagamento aprovado via Beehive — R$ ${existingLead?.final_price || body.amount || '199.90'}`,
          amount: parseFloat(existingLead?.final_price || body.amount || 199.90),
          created_at: new Date().toISOString()
        }]);
      }
    }

    // Atualiza no JSON local
    saveLocalLead({
      transaction_id: txId,
      status: newStatus,
      updated_at: new Date().toISOString()
    });

    return res.json({ success: true, transaction_id: txId, status: newStatus });
  } catch (err) {
    console.error('[Beehive Webhook] Erro:', err.message);
    return res.status(500).json({ success: false, message: 'Erro ao processar webhook Beehive' });
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(`Checkout Page: http://localhost:${PORT}/checkout`);
});
