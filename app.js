/* ================================================================
 * SECCIÓN: SETUP (onboarding multi-paso)
 * ----------------------------------------------------------------
 * Reemplaza el bloque "SETUP" existente en app.js por este.
 *
 * Cambios respecto a la versión anterior:
 *   - El setup ahora tiene 3 pasos navegables (goStep).
 *   - El Sheet ID se valida y guarda en el paso 1 (setupSheetId).
 *   - El paso 2 muestra un enlace dinámico a la hoja del usuario
 *     y un preview del SHEET_ID ya insertado en el código de ejemplo.
 *   - La URL del Apps Script se valida en el paso 3 (setupUrl).
 *   - Los indicadores de progreso (numeritos) se actualizan en cada paso.
 *   - Los inputs muestran feedback visual (borde verde/rojo + hint/error).
 * ================================================================ */

// ============================================================
// SETUP — variables de estado del onboarding
// ============================================================

// Paso actualmente visible en el tutorial (1, 2 o 3).
let setupCurrentStep = 1;

// Sheet ID ingresado en el paso 1 (se usa para generar el enlace en paso 2).
let setupSheetId = '';


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

  // Validar antes de avanzar (no aplica al retroceder)
  if (step > setupCurrentStep) {
    if (setupCurrentStep === 1 && !validateSheetId()) return;
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

  // Si vamos al paso 2, actualizar el preview del Sheet ID y el enlace
  if (step === 2) updateStep2Preview();

  setupCurrentStep = step;
}


// ============================================================
// SETUP — validaciones de inputs
// ============================================================

/**
 * Valida el Sheet ID ingresado en el paso 1.
 * Un Sheet ID válido tiene entre 20 y 60 caracteres alfanuméricos
 * (con guiones y guiones bajos), tal como los genera Google Sheets.
 * @returns {boolean} true si el ID es válido.
 */
function validateSheetId() {
  const input = document.getElementById('setupSheetId');
  const err   = document.getElementById('errSheetId');
  const hint  = document.getElementById('hintSheetId');
  const val   = input.value.trim();

  // Patrón: 20-60 chars alfanuméricos, guiones o guiones bajos
  const isValid = /^[a-zA-Z0-9_-]{20,60}$/.test(val);

  input.classList.toggle('input-ok', isValid);
  input.classList.toggle('input-err', !isValid);
  err.style.display  = isValid ? 'none' : 'block';
  hint.style.display = isValid ? 'block' : 'none';

  if (isValid) setupSheetId = val;
  return isValid;
}

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

// Handlers de "oninput": validan en tiempo real mientras el usuario escribe.
function onSheetIdInput() { validateSheetId(); }
function onUrlInput()     { validateUrl(); }


// ============================================================
// SETUP — paso 2: preview dinámico
// Actualiza el enlace a la hoja y el preview del SHEET_ID en
// el ejemplo de código, usando el ID guardado en el paso 1.
// ============================================================

function updateStep2Preview() {
  const idToShow = setupSheetId || localStorage.getItem('sheet_id') || 'TU_ID_AQUÍ';

  // Preview del ID dentro del ejemplo de código del paso 2
  const preview = document.getElementById('sheetIdPreview');
  if (preview) preview.textContent = idToShow;

  // Enlace directo a la hoja del usuario
  const linkWrap = document.getElementById('sheetLinkWrap');
  const link     = document.getElementById('sheetLink');
  if (linkWrap && link && setupSheetId) {
    link.href = `https://docs.google.com/spreadsheets/d/${setupSheetId}/edit`;
    linkWrap.style.display = 'block';
  } else if (linkWrap) {
    linkWrap.style.display = 'none';
  }
}


// ============================================================
// SETUP — guardar configuración (botón "Comenzar →" del paso 3)
// Persiste la URL en localStorage y arranca el dashboard.
// ============================================================

function saveSetup() {
  if (!validateUrl()) return;

  const url = document.getElementById('setupUrl').value.trim();

  // Guardar ambos valores en localStorage para futuras sesiones
  localStorage.setItem('as_url', url);
  if (setupSheetId) localStorage.setItem('sheet_id', setupSheetId);

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
  localStorage.removeItem('sheet_id');
  location.reload();
}

// Acceso directo a la pestaña Config desde el botón ⚙️ del header.
function openSettings() { showTab('config'); }