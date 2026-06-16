const express = require('express');
const cors = require('cors');
const db = require('./database');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const clientesRouter = require('./routes/clientes');
const productosRouter = require('./routes/productos');
const facturasRouter = require('./routes/facturas');
const reportesRouter = require('./routes/reportes');

app.use('/api/clientes', clientesRouter);
app.use('/api/productos', productosRouter);
app.use('/api/facturas', facturasRouter);
app.use('/api/reportes', reportesRouter);

app.get('/api/ping', (req, res) => {
  res.json({ mensaje: 'Servidor funcionando ✓' });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});