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
 *   aD         = "all Data"      -> gastos, agrupados por mes: { 'YYYY-MM': [gasto, ...] }
 *   aBu        = "all Budgets"   -> presupuestos por mes: { 'YYYY-MM': monto }
 *   aTC        = "all TC"        -> compras en cuotas de tarjeta de crédito
 *   aTarjetas  = tarjetas de crédito registradas (banco, día de cierre, día de pago)
 *   aPagosTC   = pagos de tarjeta ya registrados
 *   cY / cM    = año / mes actualmente visible en el dashboard (mes = 0-indexado, como Date)
 *   AS         = URL del Apps Script (Apps Script)
 *   Un "gasto" (expense) tiene: { id, c: categoría, a: monto, d: descripción, f: fecha, mes }
 *   Una "compra TC" (aTC) tiene: { id, d: descripción, mt: monto total, n: nº cuotas,
 *                                  cm: cuota mensual, sk: mes de inicio del ciclo, tarjetaId, fechaCompra }
 * ================================================================ */

// Categorías de gasto disponibles. "Pagos TC" no aparece en el selector de "agregar gasto":
// se genera automáticamente al registrar un pago de tarjeta (ver registrarPago/marcarPagado).
const CATS = ['Vivienda / Arriendo', 'Alimentación', 'Transporte', 'Entretenimiento / Hobbies', 'Salud', 'Educación', 'Ahorro / Inversión', 'Transferencias', 'Tarjeta de Crédito', 'Pagos TC', 'Otros'];
// Un color por categoría (mismo índice que CATS), usado en el gráfico y la leyenda.
const CLR = ['#7F77DD', '#1D9E75', '#378ADD', '#D85A30', '#D4537E', '#BA7517', '#639922', '#E07B39', '#534AB7', '#2A9D8F', '#888780'];
const MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// ---- ESTADO GLOBAL ----
let cY = new Date().getFullYear();   // año mostrado actualmente
let cM = new Date().getMonth();      // mes mostrado actualmente (0 = enero)
let aD = {};          // gastos por mes
let aBu = {};         // presupuestos por mes
let aTC = [];         // compras en cuotas
let aTarjetas = [];   // tarjetas de crédito registradas
let aPagosTC = [];    // pagos de tarjeta registrados
let pie = null;       // instancia del gráfico Chart.js (se destruye/recrea en cada render)
let AS = '';          // URL del Apps Script en uso
let editingId = null; // id del gasto cuyo panel de edición está abierto (o null)

// Arma la clave de mes usada como índice en aD/aBu, ej: mk(2026, 7) -> "2026-07"
const mk = (y, m) => y + '-' + String(m).padStart(2, '0');
// Formatea un número como moneda chilena, ej: fmt(15000) -> "$15.000"
const fmt = n => '$' + Math.round(n).toLocaleString('es-CL');

// ============================================================
// SETUP (onboarding: configurar la URL del Apps Script)
// ============================================================

// Se ejecuta al cargar la página: decide si mostrar el dashboard
// o la pantalla de configuración inicial, según si ya hay una URL guardada.
function checkSetup() {
  const url = localStorage.getItem('as_url');
  if (url) {
    AS = url;
    document.getElementById('setupScreen').classList.remove('visible');
    document.getElementById('app').style.display = 'block';
    document.getElementById('configUrl').value = url;
    initApp();
  } else {
    document.getElementById('setupScreen').classList.add('visible');
    document.getElementById('app').style.display = 'none';
  }
}

// Botón "Comenzar →" de la pantalla de onboarding.
function saveSetup() {
  const url = document.getElementById('setupUrl').value.trim();
  const err = document.getElementById('setupErr');
  if (!url || !url.includes('script.google.com')) { err.style.display = 'block'; return; }
  err.style.display = 'none';
  localStorage.setItem('as_url', url);
  AS = url;
  document.getElementById('setupScreen').classList.remove('visible');
  document.getElementById('app').style.display = 'block';
  document.getElementById('configUrl').value = url;
  initApp();
}

// Botón "Guardar URL" en la pestaña Config (para cambiar la URL luego del setup inicial).
function saveConfigUrl() {
  const url = document.getElementById('configUrl').value.trim();
  const st = document.getElementById('configSt');
  if (!url || !url.includes('script.google.com')) { st.textContent = 'URL inválida.'; st.className = 'rst err'; return; }
  localStorage.setItem('as_url', url);
  AS = url;
  st.textContent = 'URL guardada ✓'; st.className = 'rst ok';
  setTimeout(() => { st.textContent = ''; }, 3000);
  load();
}

// "Zona de peligro": borra la URL guardada y recarga, volviendo al onboarding.
function resetConfig() {
  if (!confirm('¿Estás seguro? Se borrará tu configuración y volverás a la pantalla de inicio.')) return;
  localStorage.removeItem('as_url');
  location.reload();
}

function openSettings() { showTab('config'); }

// Inicializa el dashboard una vez que ya hay una URL de Apps Script configurada:
// aplica el tema guardado, precarga fechas de hoy en los formularios y carga los datos.
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
  load();
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

// Handler de "oninput" del input de monto en el formulario de agregar gasto.
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

// ============================================================
// PESTAÑAS Y ESTADO DE SINCRONIZACIÓN
// ============================================================

// Cambia la pestaña activa (Resumen / Gastos / Tarjetas TC / Config).
function showTab(t) {
  const tabs = ['resumen', 'gastos', 'tc', 'config'];
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

// Carga todos los datos desde Google Sheets (gastos, presupuestos, cuotas TC,
// tarjetas y pagos del mes actual) y vuelve a renderizar todo el dashboard.
async function load() {
  sync('pnd', 'Cargando datos desde Google Sheets...');
  const k = mk(cY, cM + 1);
  const [gastos, presupuestos, tc, tarjetas, pagosTC] = await Promise.all([
    asRead('read_gastos'), asRead('read_presupuestos'), asRead('read_tc'),
    asRead('read_tarjetas'), asRead('read_pagos_mes', { mes: k })
  ]);
  if (Array.isArray(gastos)) {
    aD = {};
    gastos.forEach(e => { if (!aD[e.mes]) aD[e.mes] = []; aD[e.mes].push(e); });
  }
  if (presupuestos && !Array.isArray(presupuestos)) aBu = presupuestos;
  if (Array.isArray(tc)) aTC = tc;
  if (Array.isArray(tarjetas) && tarjetas.length > 0) aTarjetas = tarjetas;
  else aTarjetas = [{ id: 'tc_bci', nombre: 'BCI', diaCierre: 20, diaPago: 7 }, { id: 'tc_falabella', nombre: 'Falabella', diaCierre: 25, diaPago: 10 }]; // valores por defecto si la hoja está vacía
  if (Array.isArray(pagosTC)) aPagosTC = pagosTC;
  sync('ok', 'Conectado · Google Sheets');
  updateSelects();
  renderAll();
}

// ============================================================
// EDICIÓN INLINE DE UN GASTO
// Cada fila de la lista de transacciones tiene un panel oculto
// (.edit-panel) que se despliega al hacer clic en el lápiz.
// ============================================================

function openEdit(id) {
  document.querySelectorAll('.edit-panel.open').forEach(p => p.classList.remove('open'));
  if (editingId === id) { editingId = null; return; } // clic de nuevo sobre el mismo = cerrar
  editingId = id;
  const e = getExp().find(e => e.id === id);
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
}
async function saveEdit(id) {
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
  const exp = aD[k];
  if (exp) {
    const idx = exp.findIndex(e => e.id === id);
    if (idx >= 0) exp[idx] = { ...exp[idx], c: cat, d: desc, a: amt, f: fecha, mes };
  }
  sync('pnd', 'Guardando cambios...');
  const ok = await asWrite({ tipo: 'edit_gasto', id, fecha, categoria: cat, descripcion: desc, monto: amt, mes });
  sync(ok ? 'ok' : 'err', ok ? 'Gasto actualizado ✓' : 'Error al guardar');
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
// PRESUPUESTO MENSUAL
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
// FORMULARIO "AGREGAR GASTO"
// ============================================================

// Muestra/oculta los campos específicos de tarjeta de crédito según la categoría elegida.
function toggleTC() {
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
// Pagos de tarjeta realizados dentro del mes actualmente visible (por fecha de pago).
const getPagosTC = () => aPagosTC.filter(p => p.fechaPago && p.fechaPago.substring(0, 7) === mk(cY, cM + 1));
// Opciones de categoría para el <select> de edición inline (excluye las categorías "automáticas").
function catOpts(selected = '') {
  return CATS.filter(c => c !== 'Tarjeta de Crédito' && c !== 'Pagos TC').map(c => `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`).join('');
}

// ============================================================
// RENDERIZADO
// Cada función r*() actualiza una sección del DOM a partir del
// estado global (aD, aBu, aTC, aTarjetas, aPagosTC). renderAll()
// las orquesta a todas y es el único punto de entrada que se
// debe llamar después de cualquier cambio de datos o de mes.
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
  const exp = getExp(), k = mk(cY, cM + 1), budget = aBu[k] || 0;
  document.getElementById('mLbl').textContent = MES[cM] + ' ' + cY;

  // --- Métricas (tarjetas superiores) ---
  const expT = exp.reduce((s, e) => s + e.a, 0), total = expT, cnt = exp.length;
  const pagosT = getPagosTC().reduce((s, p) => s + p.montoTotal, 0);
  document.getElementById('mTotal').textContent = fmt(total);
  document.getElementById('mCount').textContent = cnt + ' transacciones';
  document.getElementById('mGastos').textContent = fmt(expT - pagosT); // gastos "directos", sin contar pagos de TC
  document.getElementById('mPagosTC').textContent = fmt(pagosT);

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

  // --- Lista de transacciones del mes: mezcla gastos normales + cuotas TC que
  //     corresponden a este mes, ordenadas por fecha descendente ---
  const tcMes = aTC.filter(tc => tcCM(tc) > 0);
  const ld = document.getElementById('expList');
  if (!exp.length && !tcMes.length) {
    ld.innerHTML = '<div class="empty">No hay gastos este mes.</div>';
  } else {
    const expItems = exp.map(e => ({
      fecha: e.f, html: `<div>
      <div class="ei">
        <div class="dot" style="background:${CLR[CATS.indexOf(e.c)] || '#888'}"></div>
        <div class="einfo"><div class="edesc">${e.d || e.c}</div><div class="ecat">${e.c} · ${e.f}</div></div>
        <div class="eamt">${fmt(e.a)}</div>
        <div class="ebtns">
          <button class="edit-btn" onclick="openEdit('${e.id}')" title="Editar">✏️</button>
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
    const tcItems = tcMes.map(tc => {
      const tarj = aTarjetas.find(t => t.id === tc.tarjetaId);
      return {
        fecha: tc.fechaCompra ? tc.fechaCompra.substring(0, 10) : '',
        html: `<div class="ei"><div class="dot" style="background:#534AB7"></div><div class="einfo"><div class="edesc">💳 ${tarj ? tarj.nombre : 'TC'} — ${tc.d || 'Sin descripción'}</div><div class="ecat">${fmt(tc.cm)}/mes · ${fmt(tc.mt)} en ${tc.n} cuota${tc.n !== 1 ? 's' : ''} · ${tc.fechaCompra ? tc.fechaCompra.substring(0, 10) : '—'}</div></div><div class="eamt" style="color:#534AB7">${fmt(tc.cm)}</div><button class="del" onclick="delTC(${aTC.indexOf(tc)})">✕</button></div>`
      };
    });
    const all = [...expItems, ...tcItems].sort((a, b) => b.fecha.localeCompare(a.fecha));
    ld.innerHTML = all.map(i => i.html).join('');
  }

  rTC();
  rTarjetas();
  rCompromisosTC();
  rHistorialPagos();
}

// ============================================================
// ACCIONES: AGREGAR / ELIMINAR GASTOS Y COMPRAS EN CUOTAS
// ============================================================

// Botón "+ Agregar gasto". Si la categoría es "Tarjeta de Crédito" crea una
// compra en cuotas (aTC); en cualquier otro caso, crea un gasto normal (aD).
async function addExp() {
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

async function delExp(id) {
  const k = mk(cY, cM + 1);
  if (aD[k]) aD[k] = aD[k].filter(e => e.id !== id);
  const ok = await asWrite({ tipo: 'delete_gasto', id });
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
  const exp = getExp(), k = mk(cY, cM + 1), budget = aBu[k] || 0, expT = exp.reduce((s, e) => s + e.a, 0);
  const bycat = {}; CATS.forEach(c => { bycat[c] = 0; });
  exp.forEach(e => { bycat[e.c] = (bycat[e.c] || 0) + e.a; });
  const ok = await asWrite({
    tipo: 'reporte',
    mes: MES[cM] + ' ' + cY,
    totalGastado: expT,
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
