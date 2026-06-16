const express = require('express');
const cors    = require('cors');
const session = require('express-session');
const db      = require('./database');

const app = express();

app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(session({
  secret: 'facturapro-secreto-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 horas
}));

// Middleware de autenticación
function requiereLogin(req, res, next) {
  if (!req.session.usuario)
    return res.status(401).json({ ok: false, error: 'Debes iniciar sesión' });
  next();
}

// Rutas públicas
app.use('/api/auth', require('./routes/auth'));

// Rutas protegidas
app.use('/api/clientes',     requiereLogin, require('./routes/clientes'));
app.use('/api/productos',    requiereLogin, require('./routes/productos'));
app.use('/api/comprobantes', requiereLogin, require('./routes/comprobantes'));
app.use('/api/reportes',     requiereLogin, require('./routes/reportes'));
app.use('/api/pdf',          requiereLogin, require('./routes/pdf'));

app.use(express.static('public'));

app.listen(3000, () => console.log('✓ Servidor en http://localhost:3000'));