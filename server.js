require('dotenv').config();

const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const bcrypt  = require('bcryptjs');
const session = require('express-session');
const Stripe  = require('stripe');
const crypto  = require('crypto');

const app      = express();
const PORT     = process.env.PORT || 3001;
const stripe   = Stripe(process.env.STRIPE_SECRET_KEY);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DB_PATH  = path.join(__dirname, 'db.json');

// ── Base de datos JSON ───────────────────────────────────────────
function leerDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}
function guardarDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ── Helper: crear sesión de pago en Stripe ───────────────────────
async function crearCheckout(stripeCustomerId) {
  return stripe.checkout.sessions.create({
    customer:             stripeCustomerId,
    payment_method_types: ['card'],
    mode:                 'subscription',
    line_items: [{
      price_data: {
        currency:     'usd',
        product_data: {
          name:        'Analizador de Reseñas Pro',
          description: 'Acceso ilimitado · Claude AI · $39/mes',
        },
        recurring:   { interval: 'month' },
        unit_amount: 3900,
      },
      quantity: 1,
    }],
    success_url: `${BASE_URL}/exito?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${BASE_URL}/cancelado`,
  });
}

// ── Middlewares ──────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 días
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login.html');
  next();
}
function requireSubscription(req, res, next) {
  const db   = leerDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user || !user.subscriptionActive) return res.redirect('/api/pagar');
  next();
}

// ── Rutas protegidas (ANTES que static) ─────────────────────────
app.get('/',           requireAuth, requireSubscription, (_req, res) =>
  res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', requireAuth, requireSubscription, (_req, res) =>
  res.sendFile(path.join(__dirname, 'index.html')));

// ── Archivos estáticos ───────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── API: estado del servidor ─────────────────────────────────────
app.get('/api/status', (_req, res) =>
  res.json({ serverKey: !!process.env.ANTHROPIC_API_KEY }));

// ── Auth: Registro ───────────────────────────────────────────────
app.post('/api/auth/registro', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email y contraseña son requeridos.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });

    const db = leerDB();
    if (db.users.find(u => u.email === email))
      return res.status(400).json({ error: 'Este email ya está registrado. Inicia sesión.' });

    const passwordHash   = await bcrypt.hash(password, 10);
    const stripeCustomer = await stripe.customers.create({ email });

    const user = {
      id:                   crypto.randomUUID(),
      email,
      passwordHash,
      stripeCustomerId:     stripeCustomer.id,
      stripeSubscriptionId: null,
      subscriptionActive:   false,
      createdAt:            new Date().toISOString(),
    };
    db.users.push(user);
    guardarDB(db);

    req.session.userId = user.id;

    const checkout = await crearCheckout(stripeCustomer.id);
    res.json({ checkoutUrl: checkout.url });
  } catch (err) {
    console.error('Error en registro:', err.message);
    res.status(500).json({ error: 'Error interno. Intenta de nuevo.' });
  }
});

// ── Auth: Login ──────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const db   = leerDB();
    const user = db.users.find(u => u.email === email);

    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

    req.session.userId = user.id;

    if (!user.subscriptionActive) {
      const checkout = await crearCheckout(user.stripeCustomerId);
      return res.json({ subscriptionActive: false, checkoutUrl: checkout.url });
    }

    res.json({ subscriptionActive: true });
  } catch (err) {
    console.error('Error en login:', err.message);
    res.status(500).json({ error: 'Error interno. Intenta de nuevo.' });
  }
});

// ── Auth: Logout ─────────────────────────────────────────────────
app.get('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// ── Stripe: redirigir a pago (usuario logueado sin suscripción) ──
app.get('/api/pagar', requireAuth, async (req, res) => {
  try {
    const db   = leerDB();
    const user = db.users.find(u => u.id === req.session.userId);
    const checkout = await crearCheckout(user.stripeCustomerId);
    res.redirect(checkout.url);
  } catch (err) {
    console.error('Error creando checkout:', err.message);
    res.redirect('/cancelado');
  }
});

// ── Stripe: página de éxito ──────────────────────────────────────
app.get('/exito', requireAuth, async (req, res) => {
  const { session_id } = req.query;
  if (session_id) {
    try {
      const checkout = await stripe.checkout.sessions.retrieve(session_id);
      if (checkout.status === 'complete' || checkout.payment_status === 'paid') {
        const db   = leerDB();
        const user = db.users.find(u => u.id === req.session.userId);
        if (user) {
          user.subscriptionActive   = true;
          user.stripeSubscriptionId = checkout.subscription;
          guardarDB(db);
        }
      }
    } catch (err) {
      console.error('Error verificando pago:', err.message);
    }
  }
  res.sendFile(path.join(__dirname, 'exito.html'));
});

// ── Anthropic proxy (protegido) ──────────────────────────────────
app.post('/api/analizar', requireAuth, requireSubscription, (req, res) => {
  const { resenas, apiKey: clientKey } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY || clientKey;

  if (!resenas)
    return res.status(400).json({ error: { message: 'El campo resenas es requerido.' } });
  if (!apiKey)
    return res.status(400).json({ error: { message: 'No hay clave de API configurada.' } });

  const prompt = `Eres un experto en análisis de negocios locales.
Analiza estas reseñas de Google y devuelve:
- Puntuación general del negocio (1-10)
- Top 3 cosas que los clientes elogian
- Top 3 problemas principales que mencionan
- Plan de acción de 3 pasos para mejorar
- Sugerencia de respuesta para la reseña más negativa

Reseñas a analizar: ${resenas}`;

  const payload = JSON.stringify({
    model:      'claude-sonnet-4-6',
    max_tokens: 1024,
    stream:     true,
    messages:   [{ role: 'user', content: prompt }],
  });

  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length':    Buffer.byteLength(payload),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    if (apiRes.statusCode !== 200) {
      let errBody = '';
      apiRes.on('data', chunk => { errBody += chunk; });
      apiRes.on('end', () => {
        try   { res.status(apiRes.statusCode).json(JSON.parse(errBody)); }
        catch { res.status(apiRes.statusCode).json({ error: { message: errBody } }); }
      });
      return;
    }
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    apiRes.pipe(res);
  });

  apiReq.on('error', err => {
    if (!res.headersSent)
      res.status(502).json({ error: { message: `Error conectando con Anthropic: ${err.message}` } });
  });

  apiReq.write(payload);
  apiReq.end();
});

app.listen(PORT, () => {
  console.log(`\n✓ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`  Stripe: modo ${process.env.STRIPE_SECRET_KEY?.includes('test') ? 'PRUEBA' : 'PRODUCCIÓN'}\n`);
});
