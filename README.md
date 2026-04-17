# Analizador de Reseñas de Google con IA

Analiza reseñas de Google usando Claude (Anthropic) y devuelve un informe estructurado con puntos fuertes, problemas y un plan de acción.

## Tecnologías

- **Frontend**: HTML + CSS + JavaScript (vanilla)
- **Backend**: Node.js + Express (proxy hacia la API de Anthropic)
- **IA**: Claude Sonnet (claude-sonnet-4-6) con streaming SSE

---

## Desarrollo local

### 1. Requisitos

- Node.js 18 o superior
- Una clave de API de Anthropic → https://console.anthropic.com/

### 2. Instalación

```bash
git clone https://github.com/TU_USUARIO/analizador-resenas.git
cd analizador-resenas
npm install
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Abre `.env` y reemplaza el valor de `ANTHROPIC_API_KEY` con tu clave real.

### 4. Iniciar el servidor

```bash
node server.js
```

Abre http://localhost:3001 en tu navegador.

> **Modos de clave:**
> - Si `ANTHROPIC_API_KEY` está definida en `.env`, el servidor la usa directamente y el campo de clave en la UI se oculta.
> - Si no está definida, la app te pide la clave desde el navegador y la guarda en localStorage.

---

## Despliegue en Render.com (gratis)

### Paso 1 — Subir a GitHub

```bash
git init
git add .
git commit -m "feat: analizador de reseñas con Claude"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/analizador-resenas.git
git push -u origin main
```

### Paso 2 — Crear el servicio en Render

1. Ve a https://render.com y crea una cuenta (o inicia sesión)
2. Haz clic en **New → Web Service**
3. Conecta tu cuenta de GitHub y selecciona el repositorio `analizador-resenas`
4. Render detectará automáticamente el `render.yaml`; confirma la configuración:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. En la sección **Environment Variables**, agrega:
   - `ANTHROPIC_API_KEY` → tu clave de Anthropic
6. Haz clic en **Create Web Service**

Render desplegará la app y te dará una URL pública tipo:
`https://analizador-resenas.onrender.com`

### Notas del plan gratuito de Render

- El servicio se **suspende tras 15 min de inactividad**; la primera petición tarda ~30 s en "despertar".
- 750 horas de cómputo gratuitas al mes.
- Si necesitas que esté siempre activo, considera el plan Starter ($7/mes).

---

## Estructura del proyecto

```
analizador-resenas/
├── index.html       # Frontend (UI completa)
├── server.js        # Backend Express (proxy hacia Anthropic)
├── package.json
├── render.yaml      # Configuración de despliegue en Render
├── .env             # Variables locales (NO subir a git)
├── .env.example     # Plantilla de variables (sí subir a git)
└── .gitignore
```
