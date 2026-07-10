# 💰 Dashboard de Gastos Personales

Dashboard web para registrar y visualizar gastos mensuales, sincronizado en tiempo real con Google Sheets y accesible desde cualquier dispositivo.

---

## ✨ Características

- **Registro de gastos** por categoría, descripción, monto y fecha
- **Sincronización en tiempo real** con Google Sheets via Google Apps Script
- **Presupuesto mensual** con barra de progreso y alertas automáticas
- **Gestión de Tarjeta de Crédito** con cálculo automático de ciclos de facturación
- **Seguimiento de cuotas** con fecha de pago por tarjeta
- **Registro de pagos TC** con historial completo
- **Edición inline** de gastos existentes
- **Reporte mensual por Gmail** generado automáticamente
- **Modo oscuro** con preferencia guardada
- **Formato de montos** en CLP con separador de miles
- **Transacciones ordenadas** por fecha descendente
- Navegación por mes para revisar historial

---

## 🗂️ Categorías disponibles

- Vivienda / Arriendo
- Alimentación
- Transporte
- Entretenimiento / Hobbies
- Salud
- Educación
- Ahorro / Inversión
- Transferencias
- Tarjeta de Crédito
- Pagos TC
- Otros

---

## 🏗️ Arquitectura

```
index.html (GitHub Pages)
    │
    └── POST/GET ──► Google Apps Script (Web App)
                            │
                            ├── Google Sheets (base de datos)
                            │     ├── Gastos
                            │     ├── Presupuestos
                            │     ├── CompromisosTC
                            │     ├── Tarjetas
                            │     └── PagosTC
                            │
                            └── Gmail (reportes mensuales)
```

---

## 📋 Estructura del Google Sheet

| Hoja | Columnas |
|------|----------|
| `Gastos` | ID, Fecha, Categoría, Descripcion, Monto, Mes |
| `Presupuestos` | Mes, Monto |
| `CompromisosTC` | ID, Descripcion, MontoTotal, Cuotas, CuotaMensual, MesInicio, TarjetaId, FechaCompra |
| `Tarjetas` | id, nombre, diaCierre, diaPago |
| `PagosTC` | id, tarjetaId, tarjetaNombre, mesCierre, montoTotal, fechaPago |

---

## 🚀 Configuración

### 1. Google Sheets

1. Crea una nueva hoja de cálculo en [Google Sheets](https://sheets.new)
2. Nómbrala **"Dashboard Gastos Personales"**
3. Crea las 5 pestañas con los nombres exactos indicados arriba
4. Agrega los encabezados correspondientes en cada pestaña
5. Copia el **ID de la hoja** desde la URL:
   ```
   https://docs.google.com/spreadsheets/d/[SHEET_ID]/edit
   ```

### 2. Google Apps Script

1. En tu Google Sheet ve a **Extensiones → Apps Script**
2. Reemplaza todo el código con el contenido de `apps_script.gs`
3. Actualiza la constante `SHEET_ID` con el ID de tu hoja
4. Actualiza `EMAIL_DESTINO` con tu correo Gmail
5. Ve a **Implementar → Nueva implementación**
   - Tipo: **Aplicación web**
   - Ejecutar como: **Yo**
   - Acceso: **Cualquier persona**
6. Copia la **URL del deployment** generada

### 3. Dashboard HTML

1. Abre `index.html`
2. Actualiza la constante `AS` con la URL de tu Apps Script:
   ```javascript
   const AS = 'https://script.google.com/macros/s/TU_URL/exec';
   ```
3. Sube el archivo a GitHub Pages

---

## 🌐 Publicación en GitHub Pages

1. Crea un repositorio público en [GitHub](https://github.com)
2. Sube `index.html` al repositorio
3. Ve a **Settings → Pages**
4. Source: **Deploy from a branch** → `main` → `/ (root)`
5. Tu dashboard estará disponible en:
   ```
   https://tuusuario.github.io/nombre-repo/
   ```

---

## 💳 Uso — Tarjeta de Crédito

El dashboard calcula automáticamente el ciclo de facturación de cada compra según la **fecha de cierre** de tu tarjeta:

- Si compraste **antes del cierre** → se cobra en el ciclo actual
- Si compraste **después del cierre** → se cobra en el ciclo siguiente

### Tarjetas precargadas
| Tarjeta | Día de cierre | Día de pago |
|---------|--------------|-------------|
| BCI | 20 | 7 del mes siguiente |
| Falabella | 25 | 10 del mes siguiente |

Puedes agregar más tarjetas desde la pestaña **Tarjetas TC**.

---

## 📧 Reporte mensual

El botón **"Enviar reporte"** genera y envía un email HTML a tu Gmail con:
- Total gastado y comparación con presupuesto
- Desglose por categoría
- Compromisos TC activos
- Listado de transacciones del mes

---

## 🛠️ Tecnologías

- **Frontend:** HTML, CSS, JavaScript (vanilla)
- **Gráficos:** Chart.js 4.4.1
- **Backend:** Google Apps Script
- **Base de datos:** Google Sheets
- **Hosting:** GitHub Pages
- **Email:** Gmail API (via Apps Script)

---

## 📁 Archivos del proyecto

```
dashboard-gastos/
├── index.html          # Dashboard principal
├── apps_script.gs      # Código de Google Apps Script
└── README.md           # Este archivo
```

---

## ⚠️ Notas importantes

- Los datos se guardan directamente en Google Sheets — no se pierden al regenerar el dashboard
- El Apps Script debe republicarse como **nueva versión** cada vez que se modifique el código
- El modo oscuro se recuerda entre sesiones usando `localStorage`
- Los montos se ingresan en **CLP** con formato de miles automático

---

*Desarrollado con asistencia de Claude (Anthropic)*