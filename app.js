/* ================================================================
 * DASHBOARD DE GASTOS
 * ----------------------------------------------------------------
 * App de una sola página que usa un Google Apps Script desplegado
 * como Web App (variable AS = "Apps Script URL") como backend:
 * toda lectura/escritura de datos pasa por asPost()/asRead()/asWrite(),
 * que hacen POST de JSON a esa URL. No hay build step ni framework:
 * el DOM se actualiza a mano con innerHTML en las funciones r*() (render).
 *
 * Convenciones de nombres abreviados usadas en todo el archivo:
 *   aD             = "all Data" (gastos)      -> { 'YYYY-MM': [gasto, ...] } (TODOS los meses cargados)
 *   aI             = "all Ingresos"            -> { 'YYYY-MM': [ingreso, ...] } (TODOS los meses)
 *   aBu            = "all Budgets"             -> presupuesto global por mes: { 'YYYY-MM': monto }
 *   aBuCat         = presupuesto por categoría -> { 'YYYY-MM|Categoria': monto }
 *   aTC            = "all TC"                  -> compras en cuotas de tarjeta de crédito
 *   aTarjetas      = tarjetas de crédito registradas (banco, día de cierre, día de pago)
 *   aPagosTC       = pagos de tarjeta ya registrados
 *   aRecurrentes   = gastos/ingresos recurrentes (arriendo, suscripciones, sueldo, etc.)
 *   aMetas         = metas de ahorro
 *   aAportesMetas  = aportes registrados a cada meta
 *   cY / cM        = año / mes actualmente visible en el dashboard (mes = 0-indexado, como Date)
 *   AS             = URL del Apps Script en uso
 *   inMode         = 'gasto' | 'ingreso' — modo activo del formulario de "Agregar" en la pestaña Gastos
 *   Un "gasto" o "ingreso" tiene: { id, c: categoría, a: monto, d: descripción, f: fecha, mes }
 *   Una "compra TC" (aTC) tiene: { id, d: descripción, mt: monto total, n: nº cuotas,
 *                                  cm: cuota mensual, sk: mes de inicio del ciclo, tarjetaId, fechaCompra }
 * ================================================================ */

// Categorías de gasto disponibles. "Pagos TC" no aparece en el selector de "agregar gasto":
// se genera automáticamente al registrar un pago de tarjeta (ver registrarPago/marcarPagado).
const CATS = ['Vivienda / Arriendo', 'Alimentación', 'Transporte', 'Entretenimiento / Hobbies', 'Salud', 'Educación', 'Ahorro / Inversión', 'Transferencias', 'Tarjeta de Crédito', 'Pagos TC', 'Otros'];
// Un color por categoría (mismo índice que CATS), usado en el gráfico y la leyenda.
const CLR = ['#7F77DD', '#1D9E75', '#378ADD', '#D85A30', '#D4537E', '#BA7517', '#639922', '#E07B39', '#534AB7', '#2A9D8F', '#888780'];
const MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Categorías de ingreso (sueldo, transferencias de otras cuentas, reembolsos, etc.)
// y un color por categoría (mismo índice que CATS_ING), usado en la lista de transacciones.
const CATS_ING = ['Sueldo', 'Transferencia', 'Reembolso', 'Venta', 'Bono / Aguinaldo', 'Otros ingresos'];
const CLR_ING = ['#1D9E75', '#2A9D8F', '#378ADD', '#639922', '#BA7517', '#888780'];

// Categorías elegibles para presupuesto por categoría (se excluyen las "automáticas").
const CATS_PRESUP = CATS.filter(c => c !== 'Tarjeta de Crédito' && c !== 'Pagos TC');

// ---- ESTADO GLOBAL ----
let cY = new Date().getFullYear();   // año mostrado actualmente
let cM = new Date().getMonth();      // mes mostrado actualmente (0 = enero)
let aD = {};              // gastos, TODOS los meses cargados
let aI = {};              // ingresos, TODOS los meses cargados
let aBu = {};              // presupuestos globales por mes
let aBuCat = {};           // presupuestos por categoría: clave 'YYYY-MM|Categoria'
let aTC = [];              // compras en cuotas
let aTarjetas = [];        // tarjetas de crédito registradas
let aPagosTC = [];         // pagos de tarjeta registrados
let aRecurrentes = [];     // gastos/ingresos recurrentes
let aMetas = [];           // metas de ahorro
let aAportesMetas = [];    // aportes a metas de ahorro
let pie = null;            // instancia del gráfico de torta (Chart.js)
let trendChart = null;     // instancia del gráfico de tendencia histórica (Chart.js)
let AS = '';               // URL del Apps Script en uso
let editingId = null;      // id del gasto/ingreso cuyo panel de edición está abierto (o null)
let editingTipo = null;    // 'gasto' | 'ingreso' — a qué tipo pertenece editingId
let inMode = 'gasto';      // modo activo del formulario "Agregar" en la pestaña Gastos
let searchQuery = '';      // texto de búsqueda en "Transacciones del mes"
let filterCat = '';        // categoría seleccionada en el filtro de "Transacciones del mes"

// Arma la clave de mes usada como índice en aD/aI/aBu, ej: mk(2026, 7) -> "2026-07"
const mk = (y, m) => y + '-' + String(m).padStart(2, '0');
// Formatea un número como moneda chilena, ej: fmt(15000) -> "$15.000"
const fmt = n => '$' + Math.round(n).toLocaleString('es-CL');

// ============================================================
// SETUP — variables de estado del onboarding
// ============================================================

// Paso actualmente visible en el tutorial (1, 2 o 3).
let setupCurrentStep = 1;


// ============================================================
// SETUP — inicialización
// Decide si mostrar el dashboard o la pantalla de onboarding
// según si ya hay una URL de Apps Script guardada en localStorage.
// ============================================================

function checkSetup() {
  const url = localStorage.getItem('as_url');
  if (url) {
    // Ya está configurado: ir directo al dashboard
    AS = url;
    document.getElementById('setupScreen').classList.remove('visible');
    document.getElementById('app').style.display = 'block';
    document.getElementById('configUrl').value = url;
    initApp();
  } else {
    // Primera visita: mostrar pantalla de onboarding en el paso 1
    document.getElementById('setupScreen').classList.add('visible');
    document.getElementById('app').style.display = 'none';
    goStep(1);
  }
}


// ============================================================
// SETUP — navegación entre pasos
// Oculta el paso actual, actualiza los indicadores de progreso
// y muestra el paso destino.
// ============================================================

function goStep(step) {

  // Validar antes de avanzar (no aplica al retroceder). El paso 1 ya no pide
  // ningún dato (solo un enlace para copiar la plantilla), así que no hay nada
  // que validar ahí — solo el paso 3 (URL del Apps Script).
  if (step > setupCurrentStep) {
    if (setupCurrentStep === 3 && !validateUrl()) return;
  }

  // Ocultar todos los pasos
  [1, 2, 3].forEach(n => {
    const el = document.getElementById('step-' + n);
    if (el) el.style.display = 'none';
  });

  // Mostrar el paso destino
  const target = document.getElementById('step-' + step);
  if (target) target.style.display = 'block';

  // Actualizar indicadores de progreso (círculos numerados)
  [1, 2, 3].forEach(n => {
    const ind = document.getElementById('ind-' + n);
    if (!ind) return;
    ind.classList.remove('active', 'done');
    if (n < step) ind.classList.add('done');
    else if (n === step) ind.classList.add('active');
  });

  // Actualizar líneas entre indicadores
  const lines = document.querySelectorAll('.setup-progress-line');
  lines.forEach((line, i) => {
    // La línea i conecta el paso (i+1) con el (i+2)
    line.classList.toggle('done', i + 2 <= step);
  });

  setupCurrentStep = step;
}


// ============================================================
// SETUP — validaciones de inputs
// ============================================================

/**
 * Valida la URL del Apps Script ingresada en el paso 3.
 * Debe contener "script.google.com" y terminar en "/exec".
 * @returns {boolean} true si la URL es válida.
 */
function validateUrl() {
  const input = document.getElementById('setupUrl');
  const err   = document.getElementById('errUrl');
  const hint  = document.getElementById('hintUrl');
  const val   = input.value.trim();

  const isValid = val.includes('script.google.com') && val.endsWith('/exec');

  input.classList.toggle('input-ok', isValid);
  input.classList.toggle('input-err', !isValid);
  err.style.display  = isValid ? 'none' : 'block';
  hint.style.display = isValid ? 'block' : 'none';

  return isValid;
}

// Handler de "oninput": valida en tiempo real mientras el usuario escribe.
function onUrlInput()     { validateUrl(); }


// ============================================================
// SETUP — guardar configuración (botón "Comenzar →" del paso 3)
// Persiste la URL en localStorage y arranca el dashboard.
// ============================================================

function saveSetup() {
  if (!validateUrl()) return;

  const url = document.getElementById('setupUrl').value.trim();

  // Guardar la URL para futuras sesiones
  localStorage.setItem('as_url', url);

  AS = url;

  // Ocultar onboarding y mostrar el dashboard
  document.getElementById('setupScreen').classList.remove('visible');
  document.getElementById('app').style.display = 'block';
  document.getElementById('configUrl').value = url;

  initApp();
}


// ============================================================
// SETUP — funciones de configuración posterior (pestaña Config)
// ============================================================

/**
 * Guarda una nueva URL de Apps Script desde la pestaña de configuración.
 * Útil cuando el usuario necesita actualizar el deployment sin resetear todo.
 */
function saveConfigUrl() {
  const input = document.getElementById('configUrl');
  const st    = document.getElementById('configSt');
  const url   = input.value.trim();

  if (!url || !url.includes('script.google.com') || !url.endsWith('/exec')) {
    st.textContent = 'URL inválida. Debe terminar en /exec.';
    st.className = 'rst err';
    return;
  }

  localStorage.setItem('as_url', url);
  AS = url;

  st.textContent = 'URL guardada ✓';
  st.className = 'rst ok';
  setTimeout(() => { st.textContent = ''; }, 3000);

  // Recargar datos con la nueva URL
  load();
}

/**
 * Borra toda la configuración del localStorage y recarga la página,
 * volviendo al onboarding desde el paso 1.
 * Útil si el usuario quiere cambiar de Google Sheet.
 */
function resetConfig() {
  if (!confirm('¿Estás seguro? Se borrará tu configuración y volverás a la pantalla de inicio.')) return;
  localStorage.removeItem('as_url');
  location.reload();
}

// Acceso directo a la pestaña Config desde el botón ⚙️ del header.
function openSettings() { showTab('config'); }

// Inicializa el dashboard una vez que ya hay una URL de Apps Script configurada:
// aplica el tema guardado, precarga fechas de hoy en los formularios, registra el
// service worker (PWA) y carga los datos.
function initApp() {
  if (localStorage.getItem('darkMode') === '1') {
    document.body.classList.add('dark');
    document.getElementById('darkBtn').textContent = '☀️';
  }
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('inDate').value = hoy;
  document.getElementById('inTCFecha').value = hoy;
  document.getElementById('pagoFecha').value = hoy;
  document.getElementById('pagoCiclo').value = mk(new Date().getFullYear(), new Date().getMonth() + 1);
  document.getElementById('inTarjeta').addEventListener('change', updateCicloInfo);
  document.getElementById('inTCFecha').addEventListener('change', updateCicloInfo);
  registerSW();
  load();
}

// ============================================================
// PWA — registro del service worker (ver sw.js)
// ============================================================
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.log('SW no registrado:', e));
  }
}

// ============================================================
// MODO OSCURO
// ============================================================
function toggleDark() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  document.getElementById('darkBtn').textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('darkMode', isDark ? '1' : '0');
}

// ============================================================
// FORMATO DE MONTOS (inputs de texto que muestran separador de miles)
// El valor "real" (sin puntos) se guarda en el atributo data-raw del input,
// porque el value visible ya tiene el formato "15.000".
// ============================================================

// Handler de "oninput" del input de monto en el formulario de agregar gasto/ingreso.
function fmtAmt(el) {
  const raw = el.value.replace(/\./g, '').replace(/\D/g, '');
  if (raw === '') { el.value = ''; return; }
  el.value = Number(raw).toLocaleString('es-CL');
  el.dataset.raw = raw;
  updHint();
}
// Lee el monto numérico real del input #inAmt (usa data-raw si existe).
function getAmt() {
  const el = document.getElementById('inAmt');
  return parseFloat((el.dataset.raw || el.value.replace(/\./g, '')).replace(/\D/g, '')) || 0;
}
// Igual que fmtAmt() pero para el input de monto dentro del panel de edición inline.
function fmtEditAmt(el) {
  const raw = el.value.replace(/\./g, '').replace(/\D/g, '');
  if (raw === '') { el.value = ''; return; }
  el.value = Number(raw).toLocaleString('es-CL');
  el.dataset.raw = raw;
}
// Formatea genéricamente cualquier input de monto que use data-raw (recurrentes, metas, aportes).
function fmtGenAmt(el) {
  const raw = el.value.replace(/\./g, '').replace(/\D/g, '');
  if (raw === '') { el.value = ''; return; }
  el.value = Number(raw).toLocaleString('es-CL');
  el.dataset.raw = raw;
}
function getGenAmt(id) {
  const el = document.getElementById(id);
  return parseFloat((el.dataset.raw || el.value.replace(/\./g, '')).replace(/\D/g, '')) || 0;
}

// ============================================================
// PESTAÑAS Y ESTADO DE SINCRONIZACIÓN
// ============================================================

// Cambia la pestaña activa (Resumen / Gastos / Tarjetas TC / Metas / Config).
function showTab(t) {
  const tabs = ['resumen', 'gastos', 'tc', 'metas', 'config'];
  document.querySelectorAll('.tab').forEach((el, i) => el.classList.toggle('active', tabs[i] === t));
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + t).classList.add('active');
}

// Actualiza el punto de color + mensaje de la barra de sincronización.
// s: 'ok' | 'err' | 'pnd' (pendiente).
function sync(s, msg) {
  const d = document.getElementById('sdot'), m = document.getElementById('smsg');
  d.className = 'sdot' + (s === 'ok' ? '' : s === 'err' ? ' err' : ' pnd');
  m.textContent = msg;
}

// ============================================================
// COMUNICACIÓN CON EL BACKEND (Google Apps Script)
// Todas las peticiones son POST con un body JSON; el Apps Script
// responde { ok: true, data: ... } o { ok: false, error: ... }.
// ============================================================

async function asPost(payload) {
  try {
    const r = await fetch(AS, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
    return await r.json();
  } catch (e) {
    console.error('asPost', e);
    return { ok: false, error: String(e) };
  }
}
// Para operaciones de escritura: solo interesa si tuvo éxito.
async function asWrite(payload) { const j = await asPost(payload); return j.ok === true; }
// Para lecturas: `tipo` identifica qué handler del Apps Script debe responder.
async function asRead(tipo, extra = {}) { const j = await asPost({ tipo, ...extra }); return j.ok ? j.data : null; }

// Carga todos los datos desde Google Sheets (gastos e ingresos de TODOS los meses,
// presupuestos globales y por categoría, cuotas TC, tarjetas, pagos del mes actual,
// recurrentes y metas de ahorro) y vuelve a renderizar todo el dashboard. También
// procesa los gastos/ingresos recurrentes pendientes del mes real (no del mes visible).
async function load() {
  sync('pnd', 'Cargando datos desde Google Sheets...');
  const k = mk(cY, cM + 1);
  const [gastos, ingresos, presupuestos, presupuestosCat, tc, tarjetas, pagosTC, recurrentes, metas, aportes] = await Promise.all([
    asRead('read_gastos'), asRead('read_ingresos'), asRead('read_presupuestos'), asRead('read_presupuestos_cat'),
    asRead('read_tc'), asRead('read_tarjetas'), asRead('read_pagos_mes', { mes: k }),
    asRead('read_recurrentes'), asRead('read_metas'), asRead('read_aportes_metas')
  ]);
  if (Array.isArray(gastos)) {
    aD = {};
    gastos.forEach(e => { if (!aD[e.mes]) aD[e.mes] = []; aD[e.mes].push(e); });
  }
  if (Array.isArray(ingresos)) {
    aI = {};
    ingresos.forEach(e => { if (!aI[e.mes]) aI[e.mes] = []; aI[e.mes].push(e); });
  }
  if (presupuestos && !Array.isArray(presupuestos)) aBu = presupuestos;
  if (Array.isArray(presupuestosCat)) {
    aBuCat = {};
    presupuestosCat.forEach(p => { aBuCat[p.mes + '|' + p.categoria] = p.monto; });
  }
  if (Array.isArray(tc)) aTC = tc;
  if (Array.isArray(tarjetas) && tarjetas.length > 0) aTarjetas = tarjetas;
  else aTarjetas = [{ id: 'tc_bci', nombre: 'BCI', diaCierre: 20, diaPago: 7 }, { id: 'tc_falabella', nombre: 'Falabella', diaCierre: 25, diaPago: 10 }]; // valores por defecto si la hoja está vacía
  if (Array.isArray(pagosTC)) aPagosTC = pagosTC;
  if (Array.isArray(recurrentes)) aRecurrentes = recurrentes;
  if (Array.isArray(metas)) aMetas = metas;
  if (Array.isArray(aportes)) aAportesMetas = aportes;

  // Procesa recurrentes pendientes (crea automáticamente el gasto/ingreso del mes
  // real si todavía no se había generado) y agrega lo nuevo al estado local.
  const generados = await asRead('procesar_recurrentes');
  if (Array.isArray(generados) && generados.length) {
    generados.forEach(g => {
      const store = g.tipo === 'ingreso' ? aI : aD;
      if (!store[g.mes]) store[g.mes] = [];
      store[g.mes].push({ id: g.id, c: g.categoria, a: g.monto, d: g.descripcion, f: g.fecha, mes: g.mes });
    });
  }

  sync('ok', 'Conectado · Google Sheets');
  updateSelects();
  renderAll();
}

// ============================================================
// FORMULARIO "AGREGAR" — TOGGLE GASTO / INGRESO
// El mismo formulario se reutiliza para ambos tipos; setInMode()
// cambia las categorías del <select>, el texto del botón y el
// color de acento según el modo activo.
// ============================================================

function setInMode(mode) {
  inMode = mode;
  document.getElementById('modeBtnGasto').classList.toggle('active', mode === 'gasto');
  document.getElementById('modeBtnIngreso').classList.toggle('active', mode === 'ingreso');

  const catSel = document.getElementById('inCat');
  if (mode === 'ingreso') {
    catSel.innerHTML = CATS_ING.map(c => `<option>${c}</option>`).join('');
    document.getElementById('tcBox').style.display = 'none'; // TC no aplica a ingresos
    document.getElementById('dGrp').style.display = 'block';
    document.getElementById('aLbl').textContent = 'Monto (CLP)';
    document.getElementById('btnAdd').textContent = '+ Agregar ingreso';
    document.getElementById('btnAdd').classList.add('btn-ingreso');
  } else {
    catSel.innerHTML = CATS.filter(c => c !== 'Pagos TC').map(c => `<option>${c}</option>`).join('');
    document.getElementById('aLbl').textContent = 'Monto (CLP)';
    document.getElementById('btnAdd').textContent = '+ Agregar gasto';
    document.getElementById('btnAdd').classList.remove('btn-ingreso');
    toggleTC(); // por si la categoría restaurada es "Tarjeta de Crédito"
  }
}

// ============================================================
// DUPLICAR TRANSACCIÓN
// Prefila el formulario de "Agregar" con los mismos datos de un
// gasto/ingreso existente (categoría y descripción), dejando el
// monto y la fecha listos para editar antes de guardar. Útil para
// gastos repetidos (ej. mismo local, distinto monto cada vez).
// ============================================================
function dupTransaction(id, tipo) {
  const lista = tipo === 'ingreso' ? getIng() : getExp();
  const e = lista.find(x => x.id === id);
  if (!e) return;

  setInMode(tipo);
  document.getElementById('inCat').value = e.c;
  document.getElementById('inDesc').value = e.d || '';
  const amtEl = document.getElementById('inAmt');
  amtEl.value = Number(e.a).toLocaleString('es-CL');
  amtEl.dataset.raw = String(e.a);
  document.getElementById('inDate').value = new Date().toISOString().split('T')[0];
  if (tipo === 'gasto') toggleTC();

  showTab('gastos');
  document.getElementById('inAmt').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('inAmt').focus();
}

// ============================================================
// EDICIÓN INLINE DE UN GASTO O INGRESO
// Cada fila de la lista de transacciones tiene un panel oculto
// (.edit-panel) que se despliega al hacer clic en el lápiz.
// ============================================================

function openEdit(id, tipo) {
  document.querySelectorAll('.edit-panel.open').forEach(p => p.classList.remove('open'));
  if (editingId === id) { editingId = null; editingTipo = null; return; } // clic de nuevo sobre el mismo = cerrar
  editingId = id;
  editingTipo = tipo;
  const lista = tipo === 'ingreso' ? getIng() : getExp();
  const e = lista.find(e => e.id === id);
  if (!e) return;
  const panel = document.getElementById('ep_' + id);
  if (!panel) return;
  panel.querySelector('.ep-cat').value = e.c;
  panel.querySelector('.ep-desc').value = e.d || '';
  const amtEl = panel.querySelector('.ep-amt');
  amtEl.value = Number(e.a).toLocaleString('es-CL');
  amtEl.dataset.raw = String(e.a);
  panel.querySelector('.ep-fecha').value = e.f;
  panel.classList.add('open');
}
function closeEdit(id) {
  const panel = document.getElementById('ep_' + id);
  if (panel) panel.classList.remove('open');
  editingId = null;
  editingTipo = null;
}
async function saveEdit(id) {
  const tipo = editingTipo;
  const panel = document.getElementById('ep_' + id);
  const cat = panel.querySelector('.ep-cat').value;
  const desc = panel.querySelector('.ep-desc').value.trim();
  const amtEl = panel.querySelector('.ep-amt');
  const amt = parseFloat((amtEl.dataset.raw || amtEl.value.replace(/\./g, '')).replace(/\D/g, '')) || 0;
  const fecha = panel.querySelector('.ep-fecha').value;
  if (!amt || amt <= 0) { alert('Ingresa un monto válido.'); return; }
  if (!fecha) { alert('Selecciona una fecha.'); return; }
  const k = mk(cY, cM + 1), mes = fecha.substring(0, 7);
  // Actualiza el estado local de inmediato (optimista); si la fecha cambió de mes,
  // el registro seguirá viviendo bajo la clave de mes original hasta el próximo load().
  const store = tipo === 'ingreso' ? aI : aD;
  const arr = store[k];
  if (arr) {
    const idx = arr.findIndex(e => e.id === id);
    if (idx >= 0) arr[idx] = { ...arr[idx], c: cat, d: desc, a: amt, f: fecha, mes };
  }
  sync('pnd', 'Guardando cambios...');
  const op = tipo === 'ingreso' ? 'edit_ingreso' : 'edit_gasto';
  const ok = await asWrite({ tipo: op, id, fecha, categoria: cat, descripcion: desc, monto: amt, mes });
  sync(ok ? 'ok' : 'err', ok ? 'Actualizado ✓' : 'Error al guardar');
  closeEdit(id);
  renderAll();
}

// ============================================================
// TARJETAS DE CRÉDITO Y CÁLCULO DE CICLOS DE FACTURACIÓN
// ============================================================

// Dada una fecha de compra y una tarjeta, calcula en qué ciclo de
// facturación cae la compra y cuándo vence el pago de ese ciclo.
// Regla: si el día de compra es <= día de cierre, cae en el ciclo del
// mes de la compra; si no, cae en el ciclo del mes siguiente.
// El pago siempre vence el "diaPago" del mes siguiente al cierre.
function calcCiclo(fechaCompra, tarjetaId) {
  const t = aTarjetas.find(t => t.id === tarjetaId);
  if (!t || !fechaCompra) return null;
  const [y, m, d] = fechaCompra.substring(0, 10).split('-').map(Number);
  let mesCobro, anoCobro;
  if (d <= t.diaCierre) { mesCobro = m; anoCobro = y; }
  else { mesCobro = m + 1 > 12 ? 1 : m + 1; anoCobro = m + 1 > 12 ? y + 1 : y; }
  const mesPago = mesCobro + 1 > 12 ? 1 : mesCobro + 1, anoPago = mesCobro + 1 > 12 ? anoCobro + 1 : anoCobro;
  return {
    mesCierre: mk(anoCobro, mesCobro),
    fechaPago: `${anoPago}-${String(mesPago).padStart(2, '0')}-${String(t.diaPago).padStart(2, '0')}`,
    mesPagoLabel: MES[mesPago - 1] + ' ' + anoPago,
    tarjetaNombre: t.nombre
  };
}

// Muestra debajo del formulario "en qué ciclo cae esta compra y hasta cuándo hay que pagarla".
function updateCicloInfo() {
  const fecha = document.getElementById('inTCFecha').value, tarjetaId = document.getElementById('inTarjeta').value;
  const info = document.getElementById('cicloInfo');
  if (!fecha || !tarjetaId) { info.style.display = 'none'; return; }
  const ciclo = calcCiclo(fecha, tarjetaId);
  if (!ciclo) { info.style.display = 'none'; return; }
  info.style.display = 'block';
  info.textContent = `Se cobrará en ciclo ${MES[parseInt(ciclo.mesCierre.split('-')[1]) - 1]} → pagar hasta el ${ciclo.fechaPago.split('-')[2]} de ${ciclo.mesPagoLabel}`;
}

// Repuebla los <select> de tarjeta (formulario de gasto TC y formulario de pago).
function updateSelects() {
  const opts = aTarjetas.map(t => `<option value="${t.id}">${t.nombre} (cierre día ${t.diaCierre})</option>`).join('');
  document.getElementById('inTarjeta').innerHTML = opts;
  document.getElementById('pagoTarjeta').innerHTML = opts;
}

// Registra manualmente un pago de tarjeta (formulario "Registrar pago de tarjeta").
// Además del pago en sí, crea un gasto en la categoría "Pagos TC" para que
// el monto aparezca reflejado en el resumen del mes en que se pagó.
async function registrarPago() {
  const tarjetaId = document.getElementById('pagoTarjeta').value, monto = parseFloat(document.getElementById('pagoMonto').value);
  const fecha = document.getElementById('pagoFecha').value, ciclo = document.getElementById('pagoCiclo').value;
  if (!monto || monto <= 0) { alert('Ingresa un monto válido.'); return; }
  if (!fecha) { alert('Ingresa la fecha de pago.'); return; }
  if (!ciclo) { alert('Selecciona el ciclo.'); return; }
  const tarj = aTarjetas.find(t => t.id === tarjetaId);
  const btn = document.getElementById('btnPago'); btn.disabled = true;
  const st = document.getElementById('pagoSt'); st.textContent = 'Registrando...'; st.className = 'rst snd';
  const pago = { id: Date.now().toString(), tarjetaId, tarjetaNombre: tarj.nombre, mesCierre: ciclo, montoTotal: monto, fechaPago: fecha };
  const ok = await asWrite({ tipo: 'pago_tc', ...pago });
  if (ok) {
    aPagosTC.push(pago);
    const k = mk(cY, cM + 1);
    const entry = { id: 'pago_' + pago.id, c: 'Pagos TC', a: monto, d: 'Pago ' + tarj.nombre + ' ciclo ' + MES[parseInt(ciclo.split('-')[1]) - 1], f: fecha, mes: k };
    const ok2 = await asWrite({ tipo: 'gasto', id: entry.id, fecha: entry.f, categoria: entry.c, descripcion: entry.d, monto: entry.a, mes: k });
    if (ok2) { if (!aD[k]) aD[k] = []; aD[k].push(entry); }
    sync('ok', 'Pago registrado ✓'); st.textContent = 'Pago registrado ✓'; st.className = 'rst ok';
    document.getElementById('pagoMonto').value = '';
  } else {
    sync('err', 'Error al registrar'); st.textContent = 'Error al registrar'; st.className = 'rst err';
  }
  btn.disabled = false;
  setTimeout(() => { st.textContent = ''; }, 3000);
  renderAll();
}

// Botón "✓ Marcar pagado" sobre una tarjeta de "Compromisos por ciclo de facturación".
// Mismo efecto que registrarPago() pero con la fecha de hoy y sin pasar por el formulario.
async function marcarPagado(tarjetaId, tarjetaNombre, mesCierre, montoTotal) {
  if (!confirm(`¿Confirmas el pago de ${tarjetaNombre} — ciclo ${MES[parseInt(mesCierre.split('-')[1]) - 1]} por ${fmt(montoTotal)}?`)) return;
  const hoy = new Date().toISOString().split('T')[0];
  const pago = { id: Date.now().toString(), tarjetaId, tarjetaNombre, mesCierre, montoTotal, fechaPago: hoy };
  sync('pnd', 'Registrando pago...');
  const ok = await asWrite({ tipo: 'pago_tc', ...pago });
  if (ok) {
    aPagosTC.push(pago);
    const k = mk(cY, cM + 1);
    const entry = { id: 'pago_' + pago.id, c: 'Pagos TC', a: montoTotal, d: 'Pago ' + tarjetaNombre + ' ciclo ' + MES[parseInt(mesCierre.split('-')[1]) - 1], f: hoy, mes: k };
    const ok2 = await asWrite({ tipo: 'gasto', id: entry.id, fecha: entry.f, categoria: entry.c, descripcion: entry.d, monto: entry.a, mes: k });
    if (ok2) { if (!aD[k]) aD[k] = []; aD[k].push(entry); }
    sync('ok', 'Pago registrado ✓');
  } else {
    sync('err', 'Error al registrar pago');
  }
  renderAll();
}

function showAddTarjeta() { document.getElementById('addTarjetaForm').style.display = 'block'; }

async function addTarjeta() {
  const nombre = document.getElementById('newTCName').value.trim();
  const cierre = parseInt(document.getElementById('newTCCierre').value);
  const pago = parseInt(document.getElementById('newTCPago').value);
  if (!nombre || !cierre || !pago) { alert('Completa todos los campos.'); return; }
  const t = { id: 'tc_' + Date.now(), nombre, diaCierre: cierre, diaPago: pago };
  aTarjetas.push(t);
  const ok = await asWrite({ tipo: 'tarjeta_add', id: t.id, nombre: t.nombre, diaCierre: t.diaCierre, diaPago: t.diaPago });
  sync(ok ? 'ok' : 'err', ok ? 'Tarjeta guardada ✓' : 'Error');
  document.getElementById('newTCName').value = '';
  document.getElementById('newTCCierre').value = '';
  document.getElementById('newTCPago').value = '';
  document.getElementById('addTarjetaForm').style.display = 'none';
  updateSelects();
  renderAll();
}

async function delTarjeta(id) {
  if (!confirm('¿Eliminar esta tarjeta?')) return;
  aTarjetas = aTarjetas.filter(t => t.id !== id);
  const ok = await asWrite({ tipo: 'tarjeta_delete', id });
  sync(ok ? 'ok' : 'err', ok ? 'Eliminada ✓' : 'Error');
  updateSelects();
  renderAll();
}

// ============================================================
// PRESUPUESTO MENSUAL (GLOBAL)
// ============================================================

function editBudget() {
  const k = mk(cY, cM + 1);
  document.getElementById('budgetInput').value = aBu[k] || '';
  document.getElementById('bpView').style.display = 'none';
  document.getElementById('bpEdit').style.display = 'block';
  document.getElementById('bpNone').style.display = 'none';
  document.getElementById('bpCancelRow').style.display = 'block';
}
function cancelEditBudget() {
  const k = mk(cY, cM + 1);
  if (aBu[k]) { document.getElementById('bpView').style.display = 'block'; document.getElementById('bpEdit').style.display = 'none'; }
}
async function saveBudget() {
  const v = parseFloat(document.getElementById('budgetInput').value);
  const k = mk(cY, cM + 1);
  if (!v || v <= 0) delete aBu[k]; else aBu[k] = v;
  const ok = await asWrite({ tipo: 'presupuesto', mes: k, monto: aBu[k] || 0 });
  sync(ok ? 'ok' : 'err', ok ? 'Presupuesto guardado ✓' : 'Error');
  renderAll();
}

// ============================================================
// PRESUPUESTO POR CATEGORÍA
// ============================================================

// Guarda (o borra, si el monto queda en 0) el presupuesto de una categoría para el mes visible.
async function saveBudgetCat(cat) {
  const k = mk(cY, cM + 1);
  const input = document.getElementById('bc_' + CATS_PRESUP.indexOf(cat));
  const v = parseFloat(input.value) || 0;
  if (v > 0) aBuCat[k + '|' + cat] = v; else delete aBuCat[k + '|' + cat];
  const ok = await asWrite({ tipo: 'presupuesto_cat', mes: k, categoria: cat, monto: v });
  sync(ok ? 'ok' : 'err', ok ? 'Presupuesto de categoría guardado ✓' : 'Error');
  renderAll();
}

// Dibuja la lista de presupuestos por categoría con su barra de progreso.
function rBudgetCat(bycat) {
  const k = mk(cY, cM + 1);
  const div = document.getElementById('budgetCatList');
  div.innerHTML = CATS_PRESUP.map((cat, i) => {
    const budget = aBuCat[k + '|' + cat] || 0;
    const spent = bycat[cat] || 0;
    const p = budget > 0 ? Math.min(spent / budget * 100, 100) : 0;
    const color = p >= 100 ? '#e24b4a' : p >= 80 ? '#ef9f27' : '#1d9e75';
    return `<div class="bc-row">
      <div class="bc-hdr">
        <span class="bc-name">${cat}</span>
        <span class="bc-inputwrap">
          <span class="amt-prefix" style="font-size:11px">$</span>
          <input type="number" id="bc_${i}" class="bc-input" value="${budget || ''}" placeholder="Sin límite" min="0" step="1000">
          <button class="bc-save" onclick="saveBudgetCat('${cat.replace(/'/g, "\\'")}')">✓</button>
        </span>
      </div>
      ${budget > 0 ? `<div class="pbg" style="height:6px"><div class="pfill" style="width:${Math.round(p)}%;background:${color}"></div></div>
      <div class="pmeta" style="font-size:11px"><span>${fmt(spent)}</span><span>${fmt(budget)}</span></div>` : ''}
    </div>`;
  }).join('');
}

// ============================================================
// GASTOS / INGRESOS RECURRENTES
// ============================================================

function toggleRecurrenteFields() {
  const isIng = document.getElementById('recTipo').value === 'ingreso';
  const sel = document.getElementById('recCat');
  sel.innerHTML = (isIng ? CATS_ING : CATS_PRESUP).map(c => `<option>${c}</option>`).join('');
}

async function addRecurrente() {
  const tipo = document.getElementById('recTipo').value;
  const categoria = document.getElementById('recCat').value;
  const descripcion = document.getElementById('recDesc').value.trim();
  const monto = getGenAmt('recMonto');
  const diaMes = parseInt(document.getElementById('recDia').value);
  if (!monto || monto <= 0) { alert('Ingresa un monto válido.'); return; }
  if (!diaMes || diaMes < 1 || diaMes > 28) { alert('El día del mes debe estar entre 1 y 28.'); return; }
  const id = Date.now().toString();
  const ok = await asWrite({ tipo: 'recurrente_add', id, tipo: tipo, categoria, descripcion, monto, diaMes });
  if (ok) {
    aRecurrentes.push({ id, tipo, categoria, descripcion, monto, diaMes, activo: true, ultimoMesGenerado: '' });
    sync('ok', 'Recurrente guardado ✓');
    document.getElementById('recDesc').value = '';
    document.getElementById('recMonto').value = ''; delete document.getElementById('recMonto').dataset.raw;
    document.getElementById('recDia').value = '';
  } else sync('err', 'Error al guardar');
  renderAll();
}

async function toggleRecurrenteActivo(id, activo) {
  const rec = aRecurrentes.find(r => r.id === id);
  if (rec) rec.activo = activo;
  const ok = await asWrite({ tipo: 'recurrente_toggle', id, activo });
  sync(ok ? 'ok' : 'err', ok ? (activo ? 'Activado ✓' : 'Pausado ✓') : 'Error');
  renderAll();
}

async function delRecurrente(id) {
  if (!confirm('¿Eliminar este recurrente? Los movimientos ya generados no se borran.')) return;
  aRecurrentes = aRecurrentes.filter(r => r.id !== id);
  const ok = await asWrite({ tipo: 'recurrente_delete', id });
  sync(ok ? 'ok' : 'err', ok ? 'Eliminado ✓' : 'Error');
  renderAll();
}

function rRecurrentes() {
  const div = document.getElementById('recurrentesList');
  if (!aRecurrentes.length) { div.innerHTML = '<div class="empty">No hay gastos o ingresos recurrentes configurados.</div>'; return; }
  div.innerHTML = aRecurrentes.map(r => `
    <div class="tc-card" style="${r.activo ? '' : 'opacity:.5'}">
      <div class="tc-card-hdr">
        <span class="tc-card-name">${r.tipo === 'ingreso' ? '💰' : '💸'} ${r.descripcion || r.categoria}</span>
        <button class="del" onclick="delRecurrente('${r.id}')">✕</button>
      </div>
      <div class="tc-card-info">${r.categoria} · ${fmt(r.monto)} · día ${r.diaMes} de cada mes</div>
      <div style="margin-top:6px">
        <label style="font-size:11px;display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" ${r.activo ? 'checked' : ''} onchange="toggleRecurrenteActivo('${r.id}', this.checked)">
          ${r.activo ? 'Activo — se genera automáticamente cada mes' : 'Pausado'}
        </label>
      </div>
    </div>`).join('');
}

// ============================================================
// METAS DE AHORRO
// ============================================================

async function addMeta() {
  const nombre = document.getElementById('metaNombre').value.trim();
  const montoObjetivo = getGenAmt('metaMonto');
  const fechaObjetivo = document.getElementById('metaFecha').value;
  if (!nombre) { alert('Ingresa un nombre para la meta.'); return; }
  if (!montoObjetivo || montoObjetivo <= 0) { alert('Ingresa un monto objetivo válido.'); return; }
  const id = Date.now().toString();
  const ok = await asWrite({ tipo: 'meta_add', id, nombre, montoObjetivo, fechaObjetivo });
  if (ok) {
    aMetas.push({ id, nombre, montoObjetivo, fechaObjetivo });
    sync('ok', 'Meta creada ✓');
    document.getElementById('metaNombre').value = '';
    document.getElementById('metaMonto').value = ''; delete document.getElementById('metaMonto').dataset.raw;
    document.getElementById('metaFecha').value = '';
  } else sync('err', 'Error al crear la meta');
  renderAll();
}

async function delMeta(id) {
  if (!confirm('¿Eliminar esta meta y todos sus aportes?')) return;
  aMetas = aMetas.filter(m => m.id !== id);
  aAportesMetas = aAportesMetas.filter(a => a.metaId !== id);
  const ok = await asWrite({ tipo: 'meta_delete', id });
  sync(ok ? 'ok' : 'err', ok ? 'Eliminada ✓' : 'Error');
  renderAll();
}

async function addAporteMeta(metaId) {
  const input = document.getElementById('aporte_' + metaId);
  const monto = parseFloat((input.dataset.raw || input.value.replace(/\./g, '')).replace(/\D/g, '')) || 0;
  if (!monto || monto <= 0) { alert('Ingresa un monto válido.'); return; }
  const id = Date.now().toString(), fecha = new Date().toISOString().split('T')[0];
  const ok = await asWrite({ tipo: 'aporte_meta_add', id, metaId, monto, fecha });
  if (ok) {
    aAportesMetas.push({ id, metaId, monto, fecha });
    sync('ok', 'Aporte registrado ✓');
    input.value = ''; delete input.dataset.raw;
  } else sync('err', 'Error al registrar aporte');
  renderAll();
}

function rMetas() {
  const div = document.getElementById('metasList');
  if (!aMetas.length) { div.innerHTML = '<div class="empty">No hay metas de ahorro. Crea una arriba.</div>'; return; }
  div.innerHTML = aMetas.map(m => {
    const aportado = aAportesMetas.filter(a => a.metaId === m.id).reduce((s, a) => s + a.monto, 0);
    const p = Math.min(Math.round(aportado / m.montoObjetivo * 100), 100);
    const done = aportado >= m.montoObjetivo;
    return `<div class="tc-card">
      <div class="tc-card-hdr">
        <span class="tc-card-name">🎯 ${m.nombre}</span>
        <button class="del" onclick="delMeta('${m.id}')">✕</button>
      </div>
      ${m.fechaObjetivo ? `<div class="tc-card-info">Meta: ${m.fechaObjetivo}</div>` : ''}
      <div class="pbg" style="margin-top:6px"><div class="pfill" style="width:${p}%;background:${done ? '#1d9e75' : '#534ab7'}"></div></div>
      <div class="pmeta"><span>${fmt(aportado)} de ${fmt(m.montoObjetivo)}</span><span>${p}%${done ? ' ✓' : ''}</span></div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <div class="amt-wrap" style="flex:1">
          <span class="amt-prefix">$</span>
          <input type="text" id="aporte_${m.id}" placeholder="Aportar monto" oninput="fmtGenAmt(this)" inputmode="numeric">
        </div>
        <button class="btn" style="width:auto;margin-top:0;padding:9px 14px" onclick="addAporteMeta('${m.id}')">+ Aportar</button>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// RESUMEN ANUAL
// ============================================================
function rAnual() {
  const div = document.getElementById('anualResumen');
  if (!div) return;
  const mesesDelAno = Object.keys(aD).filter(k => k.startsWith(cY + '-'));
  if (!mesesDelAno.length) { div.innerHTML = `<div class="empty">Sin datos de ${cY} todavía.</div>`; return; }

  let totalGastado = 0, totalIngresos = 0;
  const porMes = {};
  mesesDelAno.forEach(k => {
    const g = (aD[k] || []).reduce((s, e) => s + e.a, 0);
    const i = (aI[k] || []).reduce((s, e) => s + e.a, 0);
    porMes[k] = g;
    totalGastado += g;
    totalIngresos += i;
  });
  const entries = Object.entries(porMes);
  const max = entries.reduce((a, b) => b[1] > a[1] ? b : a, entries[0]);
  const min = entries.reduce((a, b) => b[1] < a[1] ? b : a, entries[0]);
  const promedio = totalGastado / entries.length;

  div.innerHTML = `
    <div class="mets" style="grid-template-columns:repeat(2,1fr)">
      <div class="met"><div class="ml">Total gastado ${cY}</div><div class="mv">${fmt(totalGastado)}</div></div>
      <div class="met"><div class="ml">Total ingresos ${cY}</div><div class="mv" style="color:#1d9e75">${fmt(totalIngresos)}</div></div>
      <div class="met"><div class="ml">Promedio mensual</div><div class="mv">${fmt(promedio)}</div></div>
      <div class="met"><div class="ml">Balance del año</div><div class="mv" style="color:${totalIngresos - totalGastado >= 0 ? '#1d9e75' : '#a32d2d'}">${fmt(totalIngresos - totalGastado)}</div></div>
      <div class="met"><div class="ml">Mes de mayor gasto</div><div class="mv" style="font-size:14px">${MES[parseInt(max[0].split('-')[1]) - 1]}</div><div class="ms">${fmt(max[1])}</div></div>
      <div class="met"><div class="ml">Mes de menor gasto</div><div class="mv" style="font-size:14px">${MES[parseInt(min[0].split('-')[1]) - 1]}</div><div class="ms">${fmt(min[1])}</div></div>
    </div>`;
}

// ============================================================
// TENDENCIA HISTÓRICA (gráfico de línea, últimos meses cargados)
// ============================================================
function rTrend() {
  const cv = document.getElementById('trendChart');
  if (!cv) return;
  const meses = [...new Set([...Object.keys(aD), ...Object.keys(aI)])].sort().slice(-12);
  if (trendChart) { trendChart.destroy(); trendChart = null; }
  if (!meses.length) return;
  const gastosPorMes = meses.map(k => (aD[k] || []).reduce((s, e) => s + e.a, 0));
  const ingresosPorMes = meses.map(k => (aI[k] || []).reduce((s, e) => s + e.a, 0));
  const labels = meses.map(k => MES_CORTO[parseInt(k.split('-')[1]) - 1] + ' ' + k.split('-')[0].substring(2));

  trendChart = new Chart(cv, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Gastos', data: gastosPorMes, borderColor: '#e24b4a', backgroundColor: 'rgba(226,75,74,.08)', tension: .3, fill: true },
        { label: 'Ingresos', data: ingresosPorMes, borderColor: '#1d9e75', backgroundColor: 'rgba(29,158,117,.08)', tension: .3, fill: true }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: { y: { ticks: { callback: v => fmt(v) } } }
    }
  });
}

// ============================================================
// EXPORTAR DATOS (Excel y PDF/Impresión)
// ============================================================

// Descarga un .xlsx con todos los gastos e ingresos guardados (todos los meses cargados).
function exportExcel() {
  const gastosRows = [['Fecha', 'Categoría', 'Descripción', 'Monto', 'Mes']];
  Object.values(aD).flat().sort((a, b) => a.f.localeCompare(b.f)).forEach(e => gastosRows.push([e.f, e.c, e.d || '', e.a, e.mes]));
  const ingresosRows = [['Fecha', 'Categoría', 'Descripción', 'Monto', 'Mes']];
  Object.values(aI).flat().sort((a, b) => a.f.localeCompare(b.f)).forEach(e => ingresosRows.push([e.f, e.c, e.d || '', e.a, e.mes]));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gastosRows), 'Gastos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ingresosRows), 'Ingresos');
  XLSX.writeFile(wb, `dashboard-gastos-${mk(cY, cM + 1)}.xlsx`);
}

// Arma un resumen imprimible del mes visible y abre el diálogo de impresión
// del navegador (el usuario elige "Guardar como PDF" ahí).
function exportPDF() {
  const exp = getExp(), ing = getIng(), budget = aBu[mk(cY, cM + 1)] || 0;
  const expT = exp.reduce((s, e) => s + e.a, 0), ingT = ing.reduce((s, e) => s + e.a, 0);
  const bycat = {}; CATS.forEach(c => { bycat[c] = 0; });
  exp.forEach(e => { bycat[e.c] = (bycat[e.c] || 0) + e.a; });

  const filas = Object.entries(bycat).filter(([, v]) => v > 0)
    .map(([c, v]) => `<tr><td>${c}</td><td style="text-align:right">${fmt(v)}</td></tr>`).join('');

  const area = document.getElementById('printArea');
  area.innerHTML = `
    <h1>Dashboard de Gastos — ${MES[cM]} ${cY}</h1>
    <p><strong>Total gastado:</strong> ${fmt(expT)} &nbsp; <strong>Ingresos:</strong> ${fmt(ingT)} &nbsp; <strong>Balance:</strong> ${fmt(ingT - expT)}</p>
    ${budget ? `<p><strong>Presupuesto:</strong> ${fmt(budget)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Categoría</th><th style="text-align:right">Monto</th></tr></thead><tbody>${filas}</tbody></table>
  `;
  window.print();
}

// ============================================================
// FORMULARIO "AGREGAR GASTO / INGRESO"
// ============================================================

// Muestra/oculta los campos específicos de tarjeta de crédito según la categoría elegida.
// Solo aplica en modo "gasto" (en modo "ingreso" el box de TC siempre está oculto, ver setInMode).
function toggleTC() {
  if (inMode !== 'gasto') return;
  const isTC = document.getElementById('inCat').value === 'Tarjeta de Crédito';
  document.getElementById('tcBox').style.display = isTC ? 'block' : 'none';
  document.getElementById('aLbl').textContent = isTC ? 'Monto total (CLP)' : 'Monto (CLP)';
  document.getElementById('dGrp').style.display = isTC ? 'none' : 'block'; // el campo "Fecha" normal no aplica para TC (se usa "Fecha de compra")
  updHint();
}

// Actualiza el texto de ayuda "Cuota: $X × N meses" mientras se escribe el monto/cuotas.
function updHint() {
  const a = getAmt(), c = parseInt(document.getElementById('inCuotas').value) || 0;
  document.getElementById('cHint').textContent = (a > 0 && c > 0) ? 'Cuota: ' + fmt(a / c) + ' × ' + c + ' meses' : '';
  updateCicloInfo();
}

// ============================================================
// HELPERS DE CÁLCULO PARA COMPRAS EN CUOTAS (aTC)
// ============================================================

// Cuota mensual de una compra TC que corresponde al mes actualmente visible (cY/cM),
// o 0 si ese mes está fuera del rango de cuotas de la compra.
const tcCM = tc => {
  const [sy, sm] = tc.sk.split('-').map(Number);
  const ma = mk(cY, cM + 1), mi = mk(sy, sm);
  let ey = sy, em = sm + tc.n - 1;
  while (em > 12) { em -= 12; ey++; }
  return (ma >= mi && ma <= mk(ey, em)) ? tc.cm : 0;
};
// Número de cuotas ya transcurridas desde el inicio del ciclo hasta el mes actualmente visible.
const tcPag = tc => {
  const [sy, sm] = tc.sk.split('-').map(Number);
  return Math.max(0, (cY - sy) * 12 + (cM + 1 - sm));
};
// Gastos (no-TC) del mes actualmente visible.
const getExp = () => aD[mk(cY, cM + 1)] || [];
// Ingresos del mes actualmente visible.
const getIng = () => aI[mk(cY, cM + 1)] || [];
// Pagos de tarjeta realizados dentro del mes actualmente visible (por fecha de pago).
const getPagosTC = () => aPagosTC.filter(p => p.fechaPago && p.fechaPago.substring(0, 7) === mk(cY, cM + 1));
// Opciones de categoría para el <select> de edición inline (excluye las categorías "automáticas").
function catOpts(selected = '') {
  return CATS.filter(c => c !== 'Tarjeta de Crédito' && c !== 'Pagos TC').map(c => `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`).join('');
}
// Opciones de categoría de ingreso para el <select> de edición inline.
function catOptsIng(selected = '') {
  return CATS_ING.map(c => `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`).join('');
}

// ============================================================
// BUSCADOR / FILTRO DE TRANSACCIONES
// ============================================================
function onSearchInput(v) { searchQuery = v.trim().toLowerCase(); renderAll(); }
function onFilterCatChange(v) { filterCat = v; renderAll(); }

function buildFilterCatOptions() {
  const sel = document.getElementById('filterCatSelect');
  if (!sel || sel.dataset.built) return;
  const todas = [...new Set([...CATS, ...CATS_ING])];
  sel.innerHTML = '<option value="">Todas las categorías</option>' + todas.map(c => `<option value="${c}">${c}</option>`).join('');
  sel.dataset.built = '1';
}

// ============================================================
// RENDERIZADO
// Cada función r*() actualiza una sección del DOM a partir del
// estado global. renderAll() las orquesta a todas y es el único
// punto de entrada que se debe llamar después de cualquier cambio
// de datos o de mes.
// ============================================================

// Banner de alerta según % de presupuesto usado (>=100 peligro, >=80 aviso, >=50 aviso suave, si no ok).
function rAlert(total, budget) {
  const a = document.getElementById('alertArea');
  if (!budget || budget <= 0) { a.innerHTML = ''; return; }
  const p = total / budget * 100;
  if (p >= 100) a.innerHTML = `<div class="alert ad">&#9888; <span><strong>Presupuesto superado.</strong> ${fmt(total)} de ${fmt(budget)}. Exceso: ${fmt(total - budget)}.</span></div>`;
  else if (p >= 80) a.innerHTML = `<div class="alert aw">&#9888; <span><strong>Atención:</strong> ${Math.round(p)}% usado. Disponible: ${fmt(budget - total)}.</span></div>`;
  else if (p >= 50) a.innerHTML = `<div class="alert aw">&#9432; <span>Vas en el ${Math.round(p)}% del presupuesto. Disponible: ${fmt(budget - total)}.</span></div>`;
  else a.innerHTML = `<div class="alert ao">&#10003; <span>Vas bien. ${Math.round(p)}% del presupuesto usado.</span></div>`;
}

// Tarjeta "Presupuesto mensual": barra de progreso + texto de gastado/disponible,
// o el formulario para definirlo si todavía no existe uno para el mes visible.
function rBudget(total, budget) {
  const bpView = document.getElementById('bpView'), bpEdit = document.getElementById('bpEdit'), bpNone = document.getElementById('bpNone'), bpCancelRow = document.getElementById('bpCancelRow');
  if (!budget || budget <= 0) {
    bpView.style.display = 'none'; bpEdit.style.display = 'block'; bpNone.style.display = 'block'; bpCancelRow.style.display = 'none';
    document.getElementById('budgetInput').value = '';
    return;
  }
  bpView.style.display = 'block'; bpEdit.style.display = 'none';
  document.getElementById('bpValLabel').textContent = fmt(budget);
  const p = Math.min(total / budget * 100, 100);
  const f = document.getElementById('bpFill');
  f.style.width = Math.round(p) + '%';
  f.style.background = p >= 100 ? '#e24b4a' : p >= 80 ? '#ef9f27' : '#1d9e75';
  document.getElementById('bpSpent').textContent = 'Gastado: ' + fmt(total);
  const rem = budget - total;
  const re = document.getElementById('bpRemain');
  re.textContent = rem >= 0 ? 'Disponible: ' + fmt(rem) : 'Exceso: ' + fmt(Math.abs(rem));
  re.style.color = rem >= 0 ? 'var(--text2)' : '#a32d2d';
}

// Lista de tarjetas registradas ("Mis tarjetas").
function rTarjetas() {
  const div = document.getElementById('tarjetasList');
  div.innerHTML = aTarjetas.length
    ? aTarjetas.map(t => `<div class="tc-card"><div class="tc-card-hdr"><span class="tc-card-name">💳 ${t.nombre}</span><button class="del" onclick="delTarjeta('${t.id}')">✕</button></div><div class="tc-card-info">Cierre: día ${t.diaCierre} · Pago hasta: día ${t.diaPago} del mes siguiente</div></div>`).join('')
    : '<div class="empty">No hay tarjetas.</div>';
}

// "Compromisos por ciclo de facturación": agrupa las compras en cuotas (aTC) por
// tarjeta + ciclo de cierre, calcula el total a pagar de cada ciclo y muestra
// si ya se pagó (aPagosTC), si está por vencer (<=7 días) o vencido.
function rCompromisosTC() {
  const div = document.getElementById('compromisosTCView');
  if (!aTC.length) { div.innerHTML = '<div class="empty">No hay compromisos TC.</div>'; return; }
  const hoy = new Date(), grupos = {};
  aTC.forEach(tc => {
    if (!tc.fechaCompra || !tc.tarjetaId) return;
    const ciclo = calcCiclo(tc.fechaCompra, tc.tarjetaId);
    if (!ciclo) return;
    const key = tc.tarjetaId + '_' + ciclo.mesCierre;
    if (!grupos[key]) grupos[key] = { tarjeta: ciclo.tarjetaNombre, tarjetaId: tc.tarjetaId, mesCierre: ciclo.mesCierre, fechaPago: ciclo.fechaPago, mesPagoLabel: ciclo.mesPagoLabel, compras: [], total: 0 };
    grupos[key].compras.push(tc);
    grupos[key].total += tc.cm;
  });
  if (!Object.keys(grupos).length) { div.innerHTML = '<div class="empty">Sin compromisos con fecha registrada.</div>'; return; }
  div.innerHTML = Object.values(grupos).sort((a, b) => a.fechaPago.localeCompare(b.fechaPago)).map(g => {
    const fPago = new Date(g.fechaPago), dias = Math.ceil((fPago - hoy) / (1000 * 60 * 60 * 24));
    const urgente = dias <= 7 && dias >= 0, vencido = dias < 0;
    const pagoMsg = vencido ? '⚠️ Vencido' : `Pagar antes del ${g.fechaPago.split('-')[2]} de ${g.mesPagoLabel}` + (urgente ? ` (${dias} días)` : '');
    const mesLabel = MES[parseInt(g.mesCierre.split('-')[1]) - 1] + ' ' + g.mesCierre.split('-')[0];
    const yaPageado = aPagosTC.some(p => p.tarjetaId === g.tarjetaId && p.mesCierre === g.mesCierre);
    return `<div class="tc-card" style="${yaPageado ? 'opacity:.55' : ''}">
      <div class="tc-card-hdr"><span class="tc-card-name">💳 ${g.tarjeta}</span>
        <span style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;color:var(--text3)">Ciclo ${mesLabel}</span>
          ${yaPageado ? `<span style="font-size:11px;padding:2px 8px;border-radius:5px;background:#eaf3de;color:#3b6d11">✓ Pagado</span>` : `<button onclick="marcarPagado('${g.tarjetaId}','${g.tarjeta}','${g.mesCierre}',${g.total})" style="font-size:11px;padding:3px 10px;border:1px solid #1d9e75;border-radius:6px;background:var(--btn-bg);color:#1d9e75;cursor:pointer">✓ Marcar pagado</button>`}
        </span>
      </div>
      <div class="tc-card-total">Total a pagar: ${fmt(g.total)}/mes</div>
      ${!yaPageado ? `<div class="tc-card-pago ${urgente || vencido ? 'urgent' : ''}">${pagoMsg}</div>` : ''}
      <div style="margin-top:8px">${g.compras.map(c => `<div class="tc-compra-item"><span>${c.d || 'Sin descripción'}</span><span style="color:#534ab7">${fmt(c.cm)}/mes · ${c.n} cuota${c.n !== 1 ? 's' : ''}</span></div>`).join('')}</div>
    </div>`;
  }).join('');
}

// "Historial de pagos realizados": lista simple de aPagosTC, más recientes primero.
function rHistorialPagos() {
  const div = document.getElementById('historialPagos');
  if (!aPagosTC.length) { div.innerHTML = '<div class="empty">No hay pagos registrados.</div>'; return; }
  div.innerHTML = [...aPagosTC].sort((a, b) => b.fechaPago.localeCompare(a.fechaPago)).map(p => {
    const mesLabel = MES[parseInt(p.mesCierre.split('-')[1]) - 1] + ' ' + p.mesCierre.split('-')[0];
    return `<div class="ei"><div class="dot" style="background:#1d9e75"></div><div class="einfo"><div class="edesc">💳 ${p.tarjetaNombre} — Ciclo ${mesLabel}</div><div class="ecat">Pagado el ${p.fechaPago}</div></div><div class="eamt" style="color:#1d9e75">${fmt(p.montoTotal)}</div></div>`;
  }).join('');
}

// "Historial de cuotas activas": una fila por compra en cuotas (aTC) con su
// progreso de pago (cuotas transcurridas / total) y próxima fecha de vencimiento.
function rTC() {
  const div = document.getElementById('tcList');
  if (!aTC.length) { div.innerHTML = '<div class="empty">No hay compras en cuotas.</div>'; return; }
  div.innerHTML = aTC.map((tc, i) => {
    const pag = tcPag(tc), rest = tc.n - pag, p = Math.min(Math.round(pag / tc.n * 100), 100), done = rest <= 0, cm = tcCM(tc);
    const tarj = aTarjetas.find(t => t.id === tc.tarjetaId);
    const ciclo = tc.fechaCompra && tc.tarjetaId ? calcCiclo(tc.fechaCompra, tc.tarjetaId) : null;
    return `<div class="tci">
      <div class="tcih"><span class="tcin">${tc.d || 'Sin descripción'}</span><span class="badge${done ? ' done' : ''}">${done ? 'Pagado' : 'Cuota ' + Math.min(pag + 1, tc.n) + '/' + tc.n}</span></div>
      ${tarj ? `<div style="font-size:11px;color:var(--text3);margin-bottom:3px">💳 ${tarj.nombre} · Compra: ${tc.fechaCompra ? tc.fechaCompra.substring(0, 10) : '—'}</div>` : ''}
      ${ciclo ? `<div style="font-size:11px;color:#534ab7;margin-bottom:3px">Pago hasta: ${ciclo.fechaPago.split('-')[2]} de ${ciclo.mesPagoLabel}</div>` : ''}
      <div class="tcpb"><div class="tcpf" style="width:${p}%"></div></div>
      <div class="tcmeta"><span>${fmt(tc.cm)}/mes · Total: ${fmt(tc.mt)}</span><span>${done ? 'Completado' : rest + ' cuota' + (rest !== 1 ? 's' : '') + ' restante' + (rest !== 1 ? 's' : '')}</span></div>
      ${cm > 0 ? `<div style="margin-top:3px;font-size:11px;color:#534ab7">Cuota este mes: ${fmt(cm)}</div>` : ''}
      <div style="text-align:right;margin-top:3px"><button class="del" onclick="delTC(${i})">&#10005;</button></div>
    </div>`;
  }).join('');
}

// Punto de entrada principal de renderizado: recalcula las métricas del mes
// visible (cY/cM) y actualiza cada sección del dashboard.
function renderAll() {
  const exp = getExp(), ing = getIng(), k = mk(cY, cM + 1), budget = aBu[k] || 0;
  document.getElementById('mLbl').textContent = MES[cM] + ' ' + cY;

  // --- Métricas (tarjetas superiores) ---
  const expT = exp.reduce((s, e) => s + e.a, 0), total = expT, cnt = exp.length;
  const ingT = ing.reduce((s, e) => s + e.a, 0);
  const pagosT = getPagosTC().reduce((s, p) => s + p.montoTotal, 0);
  document.getElementById('mTotal').textContent = fmt(total);
  document.getElementById('mCount').textContent = cnt + ' transacciones';
  document.getElementById('mGastos').textContent = fmt(expT - pagosT); // gastos "directos", sin contar pagos de TC
  document.getElementById('mPagosTC').textContent = fmt(pagosT);
  document.getElementById('mIngresos').textContent = fmt(ingT);
  const balance = ingT - total;
  const balEl = document.getElementById('mBalance');
  balEl.textContent = (balance >= 0 ? '+' : '-') + fmt(Math.abs(balance)).substring(1);
  balEl.style.color = balance >= 0 ? '#1d9e75' : '#a32d2d';

  const bycat = {}; CATS.forEach(c => { bycat[c] = 0; });
  exp.forEach(e => { bycat[e.c] = (bycat[e.c] || 0) + e.a; });
  const top = Object.entries(bycat).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 0) {
    document.getElementById('mTop').textContent = top[0].split('/')[0].trim();
    document.getElementById('mTopAmt').textContent = fmt(top[1]);
  } else {
    document.getElementById('mTop').textContent = '—';
    document.getElementById('mTopAmt').textContent = '—';
  }

  rAlert(total, budget);
  rBudget(total, budget);
  rBudgetCat(bycat);
  rTrend();
  rAnual();
  rRecurrentes();
  rMetas();
  buildFilterCatOptions();

  // --- Gráfico de torta + leyenda + barras de distribución (solo categorías con gasto > 0) ---
  const uc = CATS.filter(c => bycat[c] > 0), ucl = uc.map(c => CLR[CATS.indexOf(c)]), ucv = uc.map(c => bycat[c]);
  document.getElementById('lgd').innerHTML = uc.map((c, i) => `<span><i style="background:${ucl[i]}"></i>${c.split('/')[0].trim()} ${total ? Math.round(bycat[c] / total * 100) + '%' : ''}</span>`).join('');
  const cv = document.getElementById('pie');
  if (pie) { pie.destroy(); pie = null; } // Chart.js exige destruir la instancia anterior antes de redibujar
  if (uc.length) {
    pie = new Chart(cv, {
      type: 'doughnut',
      data: { labels: uc, datasets: [{ data: ucv, backgroundColor: ucl, borderWidth: 0, hoverOffset: 5 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) + ' (' + Math.round(ctx.raw / total * 100) + '%)' } } } }
    });
  }
  const bd = document.getElementById('bars');
  if (!uc.length) {
    bd.innerHTML = '<div class="empty">Sin datos.</div>';
  } else {
    const mx = Math.max(...ucv);
    bd.innerHTML = uc.map((c, i) => `<div class="brow"><span>${c}</span><span style="font-weight:500">${fmt(bycat[c])}</span></div><div class="bbg"><div class="bfill" style="width:${Math.round(bycat[c] / mx * 100)}%;background:${ucl[i]}"></div></div>`).join('');
  }

  // --- Lista de transacciones del mes: mezcla gastos + ingresos + cuotas TC que
  //     corresponden a este mes, ordenadas por fecha descendente, aplicando
  //     el buscador de texto y el filtro de categoría si están activos ---
  const matchesFilter = (cat, desc) => {
    if (filterCat && cat !== filterCat) return false;
    if (searchQuery && !(cat.toLowerCase().includes(searchQuery) || (desc || '').toLowerCase().includes(searchQuery))) return false;
    return true;
  };
  const expF = exp.filter(e => matchesFilter(e.c, e.d));
  const ingF = ing.filter(e => matchesFilter(e.c, e.d));
  const tcMes = aTC.filter(tc => tcCM(tc) > 0 && matchesFilter('Tarjeta de Crédito', tc.d));
  const ld = document.getElementById('expList');
  if (!expF.length && !ingF.length && !tcMes.length) {
    ld.innerHTML = `<div class="empty">${searchQuery || filterCat ? 'Sin resultados para ese filtro.' : 'No hay movimientos este mes.'}</div>`;
  } else {
    const expItems = expF.map(e => ({
      fecha: e.f, html: `<div>
      <div class="ei">
        <div class="dot" style="background:${CLR[CATS.indexOf(e.c)] || '#888'}"></div>
        <div class="einfo"><div class="edesc">${e.d || e.c}</div><div class="ecat">${e.c} · ${e.f}</div></div>
        <div class="eamt">-${fmt(e.a).substring(1)}</div>
        <div class="ebtns">
          <button class="edit-btn" onclick="dupTransaction('${e.id}','gasto')" title="Duplicar">⎘</button>
          <button class="edit-btn" onclick="openEdit('${e.id}','gasto')" title="Editar">✏️</button>
          <button class="del" onclick="delExp('${e.id}')" title="Eliminar">✕</button>
        </div>
      </div>
      <div class="edit-panel" id="ep_${e.id}">
        <div class="edit-grid">
          <div class="fg"><label>Categoría</label><select class="ep-cat">${catOpts(e.c)}</select></div>
          <div class="fg"><label>Fecha</label><input type="date" class="ep-fecha" value="${e.f}"></div>
          <div class="fg"><label>Descripción</label><input type="text" class="ep-desc" value="${(e.d || '').replace(/"/g, '&quot;')}"></div>
          <div class="fg"><label>Monto</label><div class="amt-wrap"><span class="amt-prefix">$</span><input type="text" class="ep-amt" value="${Number(e.a).toLocaleString('es-CL')}" oninput="fmtEditAmt(this)" inputmode="numeric"></div></div>
        </div>
        <div class="edit-actions">
          <button class="btn-save-edit" onclick="saveEdit('${e.id}')">Guardar</button>
          <button class="btn-cancel-edit" onclick="closeEdit('${e.id}')">Cancelar</button>
        </div>
      </div>
    </div>`
    }));
    const ingItems = ingF.map(e => ({
      fecha: e.f, html: `<div>
      <div class="ei">
        <div class="dot" style="background:${CLR_ING[CATS_ING.indexOf(e.c)] || '#1d9e75'}"></div>
        <div class="einfo"><div class="edesc">💰 ${e.d || e.c}</div><div class="ecat">${e.c} · ${e.f}</div></div>
        <div class="eamt" style="color:#1d9e75">+${fmt(e.a).substring(1)}</div>
        <div class="ebtns">
          <button class="edit-btn" onclick="dupTransaction('${e.id}','ingreso')" title="Duplicar">⎘</button>
          <button class="edit-btn" onclick="openEdit('${e.id}','ingreso')" title="Editar">✏️</button>
          <button class="del" onclick="delIng('${e.id}')" title="Eliminar">✕</button>
        </div>
      </div>
      <div class="edit-panel" id="ep_${e.id}">
        <div class="edit-grid">
          <div class="fg"><label>Categoría</label><select class="ep-cat">${catOptsIng(e.c)}</select></div>
          <div class="fg"><label>Fecha</label><input type="date" class="ep-fecha" value="${e.f}"></div>
          <div class="fg"><label>Descripción</label><input type="text" class="ep-desc" value="${(e.d || '').replace(/"/g, '&quot;')}"></div>
          <div class="fg"><label>Monto</label><div class="amt-wrap"><span class="amt-prefix">$</span><input type="text" class="ep-amt" value="${Number(e.a).toLocaleString('es-CL')}" oninput="fmtEditAmt(this)" inputmode="numeric"></div></div>
        </div>
        <div class="edit-actions">
          <button class="btn-save-edit" onclick="saveEdit('${e.id}')">Guardar</button>
          <button class="btn-cancel-edit" onclick="closeEdit('${e.id}')">Cancelar</button>
        </div>
      </div>
    </div>`
    }));
    const tcItems = tcMes.map(tc => {
      const tarj = aTarjetas.find(t => t.id === tc.tarjetaId);
      return {
        fecha: tc.fechaCompra ? tc.fechaCompra.substring(0, 10) : '',
        html: `<div class="ei"><div class="dot" style="background:#534AB7"></div><div class="einfo"><div class="edesc">💳 ${tarj ? tarj.nombre : 'TC'} — ${tc.d || 'Sin descripción'}</div><div class="ecat">${fmt(tc.cm)}/mes · ${fmt(tc.mt)} en ${tc.n} cuota${tc.n !== 1 ? 's' : ''} · ${tc.fechaCompra ? tc.fechaCompra.substring(0, 10) : '—'}</div></div><div class="eamt" style="color:#534AB7">-${fmt(tc.cm).substring(1)}</div><button class="del" onclick="delTC(${aTC.indexOf(tc)})">✕</button></div>`
      };
    });
    const all = [...expItems, ...ingItems, ...tcItems].sort((a, b) => b.fecha.localeCompare(a.fecha));
    ld.innerHTML = all.map(i => i.html).join('');
  }

  rTC();
  rTarjetas();
  rCompromisosTC();
  rHistorialPagos();
}

// ============================================================
// ACCIONES: AGREGAR / ELIMINAR GASTOS, INGRESOS Y COMPRAS EN CUOTAS
// ============================================================

// Botón "+ Agregar gasto" / "+ Agregar ingreso" (el mismo botón, según inMode).
// En modo "gasto", si la categoría es "Tarjeta de Crédito" crea una compra en
// cuotas (aTC); en cualquier otro caso (o en modo "ingreso"), crea un registro
// normal en aD o aI según corresponda.
async function addExp() {
  if (inMode === 'ingreso') { await addIngreso(); return; }

  const cat = document.getElementById('inCat').value, amt = getAmt(), desc = document.getElementById('inDesc').value.trim();
  if (!amt || amt <= 0) { alert('Ingresa un monto válido.'); return; }
  const btn = document.getElementById('btnAdd'); btn.disabled = true; btn.textContent = 'Guardando...';

  if (cat === 'Tarjeta de Crédito') {
    const n = parseInt(document.getElementById('inCuotas').value), tarjetaId = document.getElementById('inTarjeta').value, fechaCompra = document.getElementById('inTCFecha').value;
    if (!n || n < 1) { alert('Ingresa cuotas.'); btn.disabled = false; btn.textContent = '+ Agregar gasto'; return; }
    if (!fechaCompra) { alert('Ingresa fecha de compra.'); btn.disabled = false; btn.textContent = '+ Agregar gasto'; return; }
    const ciclo = calcCiclo(fechaCompra, tarjetaId), sk = ciclo ? ciclo.mesCierre : mk(cY, cM + 1);
    const tc = { id: Date.now().toString(), d: desc, mt: amt, n, cm: Math.round(amt / n), sk, tarjetaId, fechaCompra };
    const ok = await asWrite({ tipo: 'tc', id: tc.id, descripcion: tc.d, montoTotal: tc.mt, cuotas: tc.n, cuotaMensual: tc.cm, mesInicio: tc.sk, tarjetaId: tc.tarjetaId, fechaCompra: tc.fechaCompra });
    if (ok) { aTC.push(tc); sync('ok', 'Compra TC guardada ✓'); } else sync('err', 'Error al guardar TC');
    document.getElementById('inAmt').value = ''; delete document.getElementById('inAmt').dataset.raw;
    document.getElementById('inDesc').value = '';
    document.getElementById('inCuotas').value = '';
    document.getElementById('cHint').textContent = '';
    document.getElementById('cicloInfo').style.display = 'none';
  } else {
    const f = document.getElementById('inDate').value;
    if (!f) { alert('Selecciona fecha.'); btn.disabled = false; btn.textContent = '+ Agregar gasto'; return; }
    const k = mk(cY, cM + 1), entry = { id: Date.now().toString(), c: cat, a: amt, d: desc, f, mes: k };
    const ok = await asWrite({ tipo: 'gasto', id: entry.id, fecha: entry.f, categoria: entry.c, descripcion: entry.d, monto: entry.a, mes: k });
    if (ok) { if (!aD[k]) aD[k] = []; aD[k].push(entry); sync('ok', 'Gasto guardado ✓'); } else sync('err', 'Error al guardar');
    document.getElementById('inAmt').value = ''; delete document.getElementById('inAmt').dataset.raw;
    document.getElementById('inDesc').value = '';
  }

  btn.disabled = false; btn.textContent = '+ Agregar gasto';
  renderAll();
}

// Crea un ingreso (sueldo, transferencia, reembolso, etc.) en el mes actualmente visible.
async function addIngreso() {
  const cat = document.getElementById('inCat').value, amt = getAmt(), desc = document.getElementById('inDesc').value.trim();
  const f = document.getElementById('inDate').value;
  if (!amt || amt <= 0) { alert('Ingresa un monto válido.'); return; }
  if (!f) { alert('Selecciona fecha.'); return; }
  const btn = document.getElementById('btnAdd'); btn.disabled = true; btn.textContent = 'Guardando...';

  const k = mk(cY, cM + 1), entry = { id: Date.now().toString(), c: cat, a: amt, d: desc, f, mes: k };
  const ok = await asWrite({ tipo: 'ingreso', id: entry.id, fecha: entry.f, categoria: entry.c, descripcion: entry.d, monto: entry.a, mes: k });
  if (ok) { if (!aI[k]) aI[k] = []; aI[k].push(entry); sync('ok', 'Ingreso guardado ✓'); } else sync('err', 'Error al guardar');
  document.getElementById('inAmt').value = ''; delete document.getElementById('inAmt').dataset.raw;
  document.getElementById('inDesc').value = '';

  btn.disabled = false; btn.textContent = '+ Agregar ingreso';
  renderAll();
}

async function delExp(id) {
  const k = mk(cY, cM + 1);
  if (aD[k]) aD[k] = aD[k].filter(e => e.id !== id);
  const ok = await asWrite({ tipo: 'delete_gasto', id });
  sync(ok ? 'ok' : 'err', ok ? 'Eliminado ✓' : 'Error');
  renderAll();
}

async function delIng(id) {
  const k = mk(cY, cM + 1);
  if (aI[k]) aI[k] = aI[k].filter(e => e.id !== id);
  const ok = await asWrite({ tipo: 'delete_ingreso', id });
  sync(ok ? 'ok' : 'err', ok ? 'Eliminado ✓' : 'Error');
  renderAll();
}

async function delTC(i) {
  const tc = aTC[i];
  aTC.splice(i, 1);
  const ok = await asWrite({ tipo: 'delete_tc', id: tc.id });
  sync(ok ? 'ok' : 'err', ok ? 'Eliminado ✓' : 'Error');
  renderAll();
}

// ============================================================
// NAVEGACIÓN DE MES (flechas ← →)
// ============================================================
function chM(d) {
  cM += d;
  if (cM < 0) { cM = 11; cY--; }
  if (cM > 11) { cM = 0; cY++; }
  renderAll();
}

// ============================================================
// REPORTE MENSUAL POR CORREO
// Arma un resumen del mes visible y le pide al Apps Script que lo envíe
// por Gmail (el backend genera y envía el correo; el frontend solo junta los datos).
// ============================================================
async function sendReport() {
  const btn = document.getElementById('btnRep'); btn.disabled = true;
  const st = document.getElementById('repSt'); st.textContent = 'Enviando...'; st.className = 'rst snd';
  const exp = getExp(), ing = getIng(), k = mk(cY, cM + 1), budget = aBu[k] || 0;
  const expT = exp.reduce((s, e) => s + e.a, 0), ingT = ing.reduce((s, e) => s + e.a, 0);
  const bycat = {}; CATS.forEach(c => { bycat[c] = 0; });
  exp.forEach(e => { bycat[e.c] = (bycat[e.c] || 0) + e.a; });
  const ok = await asWrite({
    tipo: 'reporte',
    mes: MES[cM] + ' ' + cY,
    totalGastado: expT,
    totalIngresos: ingT,
    presupuesto: budget,
    porcentajePresupuesto: budget > 0 ? Math.round(expT / budget * 100) : null,
    cantidadTransacciones: exp.length,
    promedioPorGasto: exp.length ? Math.round(expT / exp.length) : 0,
    porCategoria: Object.entries(bycat).filter(([, v]) => v > 0).map(([cat, monto]) => ({ cat, monto, pct: expT > 0 ? Math.round(monto / expT * 100) : 0 })),
    compromisosTCActivos: aTC.filter(tc => {
      // solo compras cuya última cuota todavía no venció respecto al mes visible
      const [sy, sm] = tc.sk.split('-').map(Number);
      let ey = sy, em = sm + tc.n - 1;
      while (em > 12) { em -= 12; ey++; }
      return mk(ey, em) >= mk(cY, cM + 1);
    }).map(tc => ({ desc: tc.d, montoTotal: tc.mt, cuotaMensual: tc.cm, cuotas: tc.n, pagadas: tcPag(tc) })),
    transacciones: exp.map(e => ({ desc: e.d || e.c, cat: e.c, monto: e.a, fecha: e.f }))
  });
  st.textContent = ok ? 'Reporte enviado ✓' : 'Error al enviar.';
  st.className = 'rst ' + (ok ? 'ok' : 'err');
  if (ok) setTimeout(() => { st.textContent = ''; }, 4000);
  btn.disabled = false;
}

// Iniciar
checkSetup();