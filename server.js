require('dotenv').config();

const express = require('express');
const https   = require('https');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Informa al frontend si el servidor ya tiene una API key configurada
app.get('/api/status', (_req, res) => {
  res.json({ serverKey: !!process.env.ANTHROPIC_API_KEY });
});

app.post('/api/analizar', (req, res) => {
  const { resenas, apiKey: clientKey } = req.body;

  // Preferir la clave del servidor; si no hay, usar la del cliente
  const apiKey = process.env.ANTHROPIC_API_KEY || clientKey;

  if (!resenas) {
    return res.status(400).json({ error: { message: 'El campo resenas es requerido.' } });
  }
  if (!apiKey) {
    return res.status(400).json({ error: { message: 'No hay clave de API configurada. Agrégala en la sección de Configuración.' } });
  }

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
    messages:   [{ role: 'user', content: prompt }]
  });

  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length':    Buffer.byteLength(payload)
    }
  };

  const apiReq = https.request(options, (apiRes) => {
    if (apiRes.statusCode !== 200) {
      let errBody = '';
      apiRes.on('data', chunk => { errBody += chunk; });
      apiRes.on('end', () => {
        try {
          res.status(apiRes.statusCode).json(JSON.parse(errBody));
        } catch {
          res.status(apiRes.statusCode).json({ error: { message: errBody } });
        }
      });
      return;
    }

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    apiRes.pipe(res);
  });

  apiReq.on('error', (err) => {
    console.error('Error conectando con Anthropic:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: { message: `No se pudo conectar con Anthropic: ${err.message}` } });
    }
  });

  apiReq.write(payload);
  apiReq.end();
});

app.listen(PORT, () => {
  const modo = process.env.ANTHROPIC_API_KEY ? 'clave del servidor' : 'clave del cliente';
  console.log(`\n✓ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`  Modo de autenticación: ${modo}\n`);
});
