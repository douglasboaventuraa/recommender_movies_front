const resolveApiBase = () => {
  const queryApi = new URLSearchParams(window.location.search).get('api');
  const globalApi = window.__API_BASE__;
  const storedApi = window.localStorage.getItem('RECOMMENDER_API_BASE');
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const fallback = isLocalHost
    ? 'http://localhost:8080'
    : 'https://recommender-movies-back.onrender.com';

  const raw = queryApi || globalApi || storedApi || fallback;
  const normalized = String(raw).trim().replace(/\/$/, '');

  // Persist only explicit runtime overrides to simplify repeated demo access.
  if (queryApi) window.localStorage.setItem('RECOMMENDER_API_BASE', normalized);

  return normalized;
};

const API_BASE = resolveApiBase();

const state = {
  runs: [],
  users: [],
  movies: [],
  movieDetailsById: {},
  suggestions: [],
  interactions: [],
  selectedUser: null,
  suggestionMeta: null,
  epochChart: null,
  runsChart: null
};

const refs = {
  apiStatus: document.getElementById('apiStatus'),
  trainForm: document.getElementById('trainForm'),
  trainBtn: document.getElementById('trainBtn'),
  feedback: document.getElementById('feedback'),
  runsBody: document.getElementById('runsBody'),
  kpiRunId: document.getElementById('kpiRunId'),
  kpiModel: document.getElementById('kpiModel'),
  kpiValAcc: document.getElementById('kpiValAcc'),
  kpiValLoss: document.getElementById('kpiValLoss'),
  kpiSamples: document.getElementById('kpiSamples'),
  kpiPositive: document.getElementById('kpiPositive'),
  modelName: document.getElementById('modelName'),
  epochs: document.getElementById('epochs'),
  batchSize: document.getElementById('batchSize'),
  learningRate: document.getElementById('learningRate'),
  validationSplit: document.getElementById('validationSplit'),
  userSelect: document.getElementById('userSelect'),
  recommendationLimit: document.getElementById('recommendationLimit'),
  loadSuggestionsBtn: document.getElementById('loadSuggestionsBtn'),
  refreshSuggestionsBtn: document.getElementById('refreshSuggestionsBtn'),
  moviesList: document.getElementById('moviesList'),
  interactionsList: document.getElementById('interactionsList'),
  suggestionsList: document.getElementById('suggestionsList'),
  suggestionMeta: document.getElementById('suggestionMeta'),
  addMovieSelect: document.getElementById('addMovieSelect'),
  addMovieEvent: document.getElementById('addMovieEvent'),
  addMovieBtn: document.getElementById('addMovieBtn')
};

function setFeedback(message, isError = false) {
  refs.feedback.textContent = message;
  refs.feedback.style.color = isError ? '#ff5f68' : '#c7c7c7';
}

function setApiStatus(ok) {
  refs.apiStatus.className = `pill ${ok ? 'ok' : 'err'}`;
  refs.apiStatus.textContent = ok ? 'API: online' : 'API: offline';
}

function fmtNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

function fmtDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR');
}

function calcAgeFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const now = new Date();
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;

  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  const dayDiff = now.getUTCDate() - birth.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age;
}

function getPosterUrl(seed) {
  const normalized = String(seed || 'movie').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'movie';
  return `https://picsum.photos/seed/${normalized}/96/140`;
}

function getLatestRun() {
  return state.runs.find((run) => run.status === 'completed') || state.runs[0] || null;
}

async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    setApiStatus(res.ok);
  } catch (_) {
    setApiStatus(false);
  }
}

async function fetchRuns() {
  const res = await fetch(`${API_BASE}/api/train/runs?limit=12`);
  if (!res.ok) throw new Error('Falha ao buscar runs');
  const json = await res.json();
  state.runs = Array.isArray(json.data) ? json.data : [];
}

async function fetchUsers() {
  const res = await fetch(`${API_BASE}/api/users?limit=100`);
  if (!res.ok) throw new Error('Falha ao buscar usuarios');
  const json = await res.json();
  state.users = Array.isArray(json.data) ? json.data : [];
}

async function fetchMovies() {
  const res = await fetch(`${API_BASE}/api/movies?limit=30`);
  if (!res.ok) throw new Error('Falha ao buscar filmes');
  const json = await res.json();
  state.movies = Array.isArray(json.data) ? json.data : [];
}

async function fetchUserInteractions(userId) {
  const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(userId)}/interactions?limit=20`);
  if (!res.ok) throw new Error('Falha ao buscar interacoes');
  const json = await res.json();
  state.interactions = Array.isArray(json.data) ? json.data : [];

  const movieIds = Array.from(new Set(state.interactions.map((item) => item.movie_id).filter(Boolean)));
  await Promise.all(movieIds.map(async (movieId) => {
    const key = String(movieId);
    if (state.movieDetailsById[key]) return;

    try {
      const movieRes = await fetch(`${API_BASE}/api/movies/${encodeURIComponent(movieId)}`);
      if (!movieRes.ok) return;
      const movie = await movieRes.json();
      state.movieDetailsById[key] = movie;
    } catch (_) {
      // Ignore detail fetch errors and keep interaction fallback rendering.
    }
  }));
}

async function fetchSuggestions(userId, limit) {
  const res = await fetch(`${API_BASE}/api/recommendations/${encodeURIComponent(userId)}?limit=${limit}`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.details || 'Falha ao buscar sugestoes');
  }

  const json = await res.json();
  state.suggestions = Array.isArray(json.recommendations) ? json.recommendations : [];
  state.suggestionMeta = {
    strategy: json.strategy,
    modelName: json.model?.model_name,
    modelVersion: json.model?.model_version,
    count: json.count
  };
}

async function refreshSuggestionBatch(userId, limit) {
  const res = await fetch(`${API_BASE}/api/recommendations/refresh/${encodeURIComponent(userId)}?limit=${limit}`, {
    method: 'POST'
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.details || 'Falha ao gerar snapshot');
  }

  return res.json();
}

async function addMovieToUser(userId, movieId, eventType) {
  const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(userId)}/movies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ movieId, eventType })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.details || error.error || 'Falha ao adicionar filme');
  }
  return res.json();
}

async function removeMovieFromUser(userId, movieId) {
  const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(userId)}/movies/${encodeURIComponent(movieId)}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.details || error.error || 'Falha ao remover filme');
  }
  return res.json();
}

async function runTraining(payload) {
  const res = await fetch(`${API_BASE}/api/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.details || 'Falha no treinamento');
  }

  return res.json();
}

function renderRunsTable() {
  if (!state.runs.length) {
    refs.runsBody.innerHTML = '<tr><td colspan="8">Sem runs ainda.</td></tr>';
    return;
  }

  refs.runsBody.innerHTML = state.runs.map((run) => {
    const m = run.metrics || {};
    const status = (run.status || 'unknown').toLowerCase();
    return `
      <tr>
        <td>${run.id ?? '-'}</td>
        <td>${run.model_name || run.run_name || '-'}</td>
        <td><span class="status ${status}">${run.status || '-'}</span></td>
        <td>${fmtNumber(m.accuracy)}</td>
        <td>${fmtNumber(m.valAccuracy)}</td>
        <td>${fmtNumber(m.valLoss)}</td>
        <td>${m.sampleCount ?? '-'}</td>
        <td>${fmtDate(run.ended_at)}</td>
      </tr>
    `;
  }).join('');
}

function renderKpis() {
  const run = getLatestRun();
  if (!run) {
    refs.kpiRunId.textContent = '-';
    refs.kpiModel.textContent = '-';
    refs.kpiValAcc.textContent = '-';
    refs.kpiValLoss.textContent = '-';
    refs.kpiSamples.textContent = '-';
    refs.kpiPositive.textContent = '-';
    return;
  }

  const m = run.metrics || {};
  refs.kpiRunId.textContent = run.id ?? '-';
  refs.kpiModel.textContent = `${run.model_name || '-'} ${run.model_version || ''}`.trim();
  refs.kpiValAcc.textContent = fmtNumber(m.valAccuracy);
  refs.kpiValLoss.textContent = fmtNumber(m.valLoss);
  refs.kpiSamples.textContent = m.sampleCount ?? '-';
  refs.kpiPositive.textContent = m.positiveRate !== undefined ? `${fmtNumber(m.positiveRate, 3)} (${m.positiveCount ?? '-'})` : '-';
}

function renderUsersSelect() {
  if (!state.users.length) {
    refs.userSelect.innerHTML = '<option value="">Sem usuarios</option>';
    state.selectedUser = null;
    return;
  }

  const currentValue = state.selectedUser || state.users[0].id;
  refs.userSelect.innerHTML = state.users.map((user) => {
    const selected = String(user.id) === String(currentValue) ? 'selected' : '';
    const age = calcAgeFromBirthDate(user.birth_date);
    const ageSuffix = Number.isInteger(age) ? ` (idade: ${age})` : '';
    return `<option value="${user.id}" ${selected}>${user.full_name}${ageSuffix}</option>`;
  }).join('');
  state.selectedUser = refs.userSelect.value;
}

function renderMoviesList() {
  if (!state.movies.length) {
    refs.moviesList.innerHTML = '<li>Sem filmes disponiveis.</li>';
    refs.addMovieSelect.innerHTML = '<option value="">Sem filmes</option>';
    return;
  }

  refs.moviesList.innerHTML = state.movies.slice(0, 20).map((movie) => `
    <li class="media-item">
      <img class="poster" src="${getPosterUrl(movie.external_id || movie.title || movie.id)}" alt="Poster ilustrativo de ${movie.title}" loading="lazy">
      <div class="media-content">
        <div class="item-main"><strong>${movie.title}</strong></div>
        <div class="item-sub">${movie.genres || 'Sem genero'} | Popularidade: ${fmtNumber(movie.popularity_score, 2)}</div>
      </div>
    </li>
  `).join('');

  refs.addMovieSelect.innerHTML = state.movies.map((movie) => {
    const alreadyWatched = state.interactions.some((i) => String(i.movie_id) === String(movie.id));
    return `<option value="${movie.id}" ${alreadyWatched ? 'disabled' : ''}>${movie.title}${alreadyWatched ? ' (ja assistido)' : ''}</option>`;
  }).join('');
}

function renderInteractionsList() {
  if (!state.interactions.length) {
    refs.interactionsList.innerHTML = '<li>Sem interacoes recentes para este usuario.</li>';
    return;
  }

  refs.interactionsList.innerHTML = state.interactions.map((item) => `
    <li class="interaction-item" data-movie-id="${item.movie_id}" style="cursor:pointer;">
      <div class="item-main"><strong>${item.movie_title}</strong> <span class="remove-hint" style="font-size:0.75rem;color:#ff5f68;margin-left:8px;">&#x2715; remover</span></div>
      <div class="item-sub">${(state.movieDetailsById[String(item.movie_id)]?.genres) || 'Sem genero'} | Popularidade: ${fmtNumber(state.movieDetailsById[String(item.movie_id)]?.popularity_score, 2)} | Peso: ${fmtNumber(item.event_weight, 2)} | ${fmtDate(item.occurred_at)}</div>
    </li>
  `).join('');

  refs.interactionsList.querySelectorAll('.interaction-item').forEach((li) => {
    li.addEventListener('click', async () => {
      const movieId = li.dataset.movieId;
      const userId = state.selectedUser;
      if (!userId || !movieId) return;
      try {
        setFeedback('Removendo interacao...');
        await removeMovieFromUser(userId, movieId);
        await fetchUserInteractions(userId);
        renderInteractionsList();
        renderMoviesList();
        setFeedback('Interacao removida com sucesso.');
      } catch (err) {
        setFeedback(err.message, true);
      }
    });
  });
}

function renderSuggestionsList() {
  const suggestionAudienceAges = state.suggestions
    .map((item) => Number(item.audience_avg_age))
    .filter((age) => Number.isFinite(age) && age > 0);
  const avgSuggestionAudienceAge = suggestionAudienceAges.length
    ? suggestionAudienceAges.reduce((acc, age) => acc + age, 0) / suggestionAudienceAges.length
    : null;

  if (!state.suggestions.length) {
    refs.suggestionsList.innerHTML = '<li>Sem sugestoes ainda. Clique em "Ver Sugestoes".</li>';
  } else {
    refs.suggestionsList.innerHTML = state.suggestions.map((item, idx) => `
      <li class="media-item">
        <img class="poster" src="${getPosterUrl(item.external_id || item.title || idx)}" alt="Poster ilustrativo de ${item.title}" loading="lazy">
        <div class="media-content">
          <div class="item-main"><strong>${idx + 1}. ${item.title}</strong><span>Score: ${fmtNumber(item.score, 4)}</span></div>
          <div class="item-sub">${item.genres || 'Sem genero'} | Popularidade: ${fmtNumber(item.popularity_score, 2)} | Media de idade de quem assistiu: ${Number.isFinite(Number(item.audience_avg_age)) && Number(item.audience_avg_age) > 0 ? `${fmtNumber(item.audience_avg_age, 1)} anos` : 'Ninguem assistiu'}</div>
        </div>
      </li>
    `).join('');
  }

  const meta = state.suggestionMeta;
  refs.suggestionMeta.textContent = meta
    ? `Estrategia: ${meta.strategy || '-'} | Modelo: ${meta.modelName || 'baseline'} ${meta.modelVersion || ''} | Itens: ${meta.count ?? state.suggestions.length} | Media das idades do publico: ${avgSuggestionAudienceAge !== null ? `${fmtNumber(avgSuggestionAudienceAge, 1)} anos` : 'Ninguem assistiu'}`
    : 'Sem consulta ainda.';
}

function buildEpochChart() {
  const canvas = document.getElementById('epochChart');
  const run = getLatestRun();
  const epochHistory = run?.metrics?.epochHistory;

  if (state.epochChart) state.epochChart.destroy();

  if (!Array.isArray(epochHistory) || !epochHistory.length) {
    state.epochChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: ['Sem historico'],
        datasets: [{ label: 'Loss', data: [run?.metrics?.loss || 0], borderColor: '#e50914', backgroundColor: 'rgba(229,9,20,0.18)' }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true },
          title: { display: true, text: 'Rode um novo treino para ver curva por epoca' }
        }
      }
    });
    return;
  }

  state.epochChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: epochHistory.map((p) => p.epoch),
      datasets: [
        { label: 'Loss', data: epochHistory.map((p) => p.loss), borderColor: '#e50914', backgroundColor: 'rgba(229,9,20,0.14)', tension: 0.3 },
        { label: 'Val Loss', data: epochHistory.map((p) => p.valLoss), borderColor: '#ff7b84', backgroundColor: 'rgba(255,123,132,0.14)', tension: 0.3 },
        { label: 'Accuracy', data: epochHistory.map((p) => p.accuracy), borderColor: '#ff3b47', borderDash: [6, 4], tension: 0.3 },
        { label: 'Val Accuracy', data: epochHistory.map((p) => p.valAccuracy), borderColor: '#ffadb3', borderDash: [6, 4], tension: 0.3 }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true } }
    }
  });
}

function buildRunsChart() {
  const canvas = document.getElementById('runsChart');
  const completed = state.runs.filter((r) => r.status === 'completed').slice().reverse();

  if (state.runsChart) state.runsChart.destroy();

  state.runsChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: completed.map((r) => `Run ${r.id}`),
      datasets: [{
        label: 'Val Accuracy',
        data: completed.map((r) => Number(r.metrics?.valAccuracy || 0)),
        backgroundColor: 'rgba(229,9,20,0.75)',
        borderColor: '#ff4d57',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true, suggestedMax: 1 }
      }
    }
  });
}

function renderAll() {
  renderRunsTable();
  renderKpis();
  buildEpochChart();
  buildRunsChart();
  renderUsersSelect();
  renderMoviesList();
  renderInteractionsList();
  renderSuggestionsList();
}

async function refreshDashboard() {
  await checkHealth();
  await Promise.all([fetchRuns(), fetchUsers(), fetchMovies()]);
  if (!state.selectedUser && state.users.length) {
    state.selectedUser = String(state.users[0].id);
  }

  if (state.selectedUser) {
    await fetchUserInteractions(state.selectedUser);
  }

  renderAll();
}

function startHealthPolling() {
  checkHealth();
  setInterval(() => {
    checkHealth();
  }, 10000);
}

async function loadSuggestionsFlow() {
  const userId = refs.userSelect.value;
  const limit = Number(refs.recommendationLimit.value || 10);
  if (!userId) {
    setFeedback('Selecione um usuario antes de consultar sugestoes.', true);
    return;
  }

  state.selectedUser = userId;
  setFeedback('Consultando sugestoes para o usuario selecionado...');
  await Promise.all([fetchUserInteractions(userId), fetchSuggestions(userId, limit)]);
  renderInteractionsList();
  renderSuggestionsList();
  setFeedback('Sugestoes carregadas com sucesso.');
}

async function refreshSuggestionsFlow() {
  const userId = refs.userSelect.value;
  const limit = Number(refs.recommendationLimit.value || 10);
  if (!userId) {
    setFeedback('Selecione um usuario antes de gerar snapshot.', true);
    return;
  }

  state.selectedUser = userId;
  setFeedback('Atualizando snapshot de recomendacoes...');
  await refreshSuggestionBatch(userId, limit);
  await Promise.all([fetchUserInteractions(userId), fetchSuggestions(userId, limit)]);
  renderInteractionsList();
  renderSuggestionsList();
  setFeedback('Snapshot atualizado e sugestoes recarregadas.');
}

refs.userSelect.addEventListener('change', async () => {
  const userId = refs.userSelect.value;
  if (!userId) return;

  try {
    state.selectedUser = userId;
    setFeedback('Carregando interacoes do usuario selecionado...');
    await fetchUserInteractions(userId);
    renderInteractionsList();
    setFeedback('Usuario atualizado para consulta.');
  } catch (error) {
    setFeedback(error.message, true);
  }
});

refs.loadSuggestionsBtn.addEventListener('click', async () => {
  try {
    refs.loadSuggestionsBtn.disabled = true;
    await loadSuggestionsFlow();
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    refs.loadSuggestionsBtn.disabled = false;
  }
});

refs.refreshSuggestionsBtn.addEventListener('click', async () => {
  try {
    refs.refreshSuggestionsBtn.disabled = true;
    await refreshSuggestionsFlow();
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    refs.refreshSuggestionsBtn.disabled = false;
  }
});

refs.trainForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    modelName: refs.modelName.value.trim(),
    epochs: Number(refs.epochs.value),
    batchSize: Number(refs.batchSize.value),
    learningRate: Number(refs.learningRate.value),
    validationSplit: Number(refs.validationSplit.value)
  };

  refs.trainBtn.disabled = true;
  setFeedback('Treinando modelo... isso pode levar alguns segundos.');

  try {
    const result = await runTraining(payload);
    const runId = result?.run?.id;
    setFeedback(`Treinamento concluido com sucesso. Run ${runId}.`);
    await refreshDashboard();
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    refs.trainBtn.disabled = false;
  }
});

refs.addMovieBtn.addEventListener('click', async () => {
  const userId = state.selectedUser;
  const movieId = refs.addMovieSelect.value;
  const eventType = refs.addMovieEvent.value;
  if (!userId) {
    setFeedback('Selecione um usuario antes de adicionar um filme.', true);
    return;
  }
  if (!movieId) {
    setFeedback('Selecione um filme para adicionar.', true);
    return;
  }
  try {
    refs.addMovieBtn.disabled = true;
    setFeedback('Adicionando filme ao usuario...');
    await addMovieToUser(userId, movieId, eventType);
    await fetchUserInteractions(userId);
    renderInteractionsList();
    renderMoviesList();
    setFeedback('Filme adicionado com sucesso.');
  } catch (err) {
    setFeedback(err.message, true);
  } finally {
    refs.addMovieBtn.disabled = false;
  }
});

refreshDashboard().catch((error) => {
  setFeedback(`Falha inicial: ${error.message}`, true);
});

startHealthPolling();
