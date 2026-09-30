const express = require('express');
const router = express.Router();
const db = require('../database');
const { tienePermiso, requierePermiso } = require('../middleware/permisos');
const {
  ErrorValidacion,
  TIPOS,
  crearComprobante,
  cambiarEstadoComprobante,
} = require('../services/comprobantes');

// ─── LISTAR ───────────────────────────────────────────────
// GET /api/comprobantes?tipo=factura
router.get('/', requierePermiso('comprobantes:ver'), (req, res) => {
  try {
    const { tipo } = req.query;
    let query = `
      SELECT c.*, cl.nombre as cliente_nombre, cl.documento as cliente_documento,
             s.serie as serie_actual
      FROM comprobantes c
      JOIN clientes cl ON c.cliente_id = cl.id
      JOIN series s ON s.tipo = c.tipo
    `;
    const params = [];
    if (tipo) { query += ' WHERE c.tipo = ?'; params.push(tipo); }
    query += ' ORDER BY c.fecha DESC';
    const data = db.prepare(query).all(...params);
    res.json({ ok: true, data });
  } catch (err) {
    console.error('Error al listar comprobantes:', err);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// ─── LISTAR TIPOS DISPONIBLES ─────────────────────────────
router.get('/meta/tipos', requierePermiso('comprobantes:ver'), (req, res) => {
  const series = db.prepare('SELECT * FROM series').all();
  const data = series.map(s => ({
    tipo: s.tipo,
    serie: s.serie,
    ultimo_numero: s.ultimo_numero,
    label: TIPOS[s.tipo]?.label || s.tipo,
    afecta_igv: TIPOS[s.tipo]?.afecta_igv,
    mueve_stock: TIPOS[s.tipo]?.mueve_stock,
  }));
  res.json({ ok: true, data });
});

// ─── VER UNO ──────────────────────────────────────────────
router.get('/:id', requierePermiso('comprobantes:ver'), (req, res) => {
  try {
    const comp = db.prepare(`
      SELECT c.*, cl.nombre as cliente_nombre, cl.documento as cliente_documento,
             cl.tipo_documento, cl.direccion as cliente_direccion,
             cl.email as cliente_email, cl.telefono as cliente_telefono,
             cr.serie as ref_serie, cr.numero as ref_numero, cr.tipo as ref_tipo
      FROM comprobantes c
      JOIN clientes cl ON c.cliente_id = cl.id
      LEFT JOIN comprobantes cr ON c.comprobante_ref_id = cr.id
      WHERE c.id = ?
    `).get(req.params.id);
    if (!comp) return res.status(404).json({ ok: false, error: 'Comprobante no encontrado' });

    const detalle = db.prepare(`
      SELECT d.*, p.nombre as producto_nombre
      FROM detalle_comprobante d
      LEFT JOIN productos p ON d.producto_id = p.id
      WHERE d.comprobante_id = ?
    `).all(req.params.id);

    res.json({ ok: true, data: { ...comp, detalle } });
  } catch (err) {
    console.error('Error al consultar comprobante:', err);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// ─── CREAR ────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const tipo = req.body?.tipo;
    if (!TIPOS[tipo]) return res.status(400).json({ ok: false, error: 'Tipo de comprobante inválido' });
    const permisoTipo = tipo === 'nota_devolucion'
      ? 'comprobantes:devolver'
      : `comprobantes:crear_${tipo}`;
    if (!tienePermiso(req.session.usuario.rol, permisoTipo)) {
      return res.status(403).json({
        ok: false,
        error: `Tu rol no puede crear comprobantes de tipo: ${TIPOS[tipo].label}`
      });
    }

    const comprobante = crearComprobante(db, req.body);
    res.status(201).json({
      ok: true,
      ...comprobante,
      mensaje: `${TIPOS[tipo].label} ${comprobante.numero} creada exitosamente`
    });

  } catch (err) {
    const status = err instanceof ErrorValidacion ? err.status : 500;
    if (status === 500) console.error('Error al crear comprobante:', err);
    res.status(status).json({
      ok: false,
      error: status === 500 ? 'Error interno del servidor' : err.message,
    });
  }
});

// ─── CAMBIAR ESTADO ───────────────────────────────────────
router.patch('/:id/estado', (req, res, next) => {
  const { estado } = req.body;
  const permiso = estado === 'anulado'
    ? 'comprobantes:anular'
    : estado === 'pagado'
      ? 'comprobantes:pagar'
      : 'comprobantes:estado';
  return requierePermiso(permiso)(req, res, next);
}, (req, res) => {
  try {
    const cambio = cambiarEstadoComprobante(db, req.params.id, req.body?.estado);
    res.json({ ok: true, mensaje: `Comprobante marcado como ${cambio.estado}` });
  } catch (err) {
    const status = err instanceof ErrorValidacion ? err.status : 500;
    res.status(status).json({
      ok: false,
      error: status === 500 ? 'Error interno del servidor' : err.message,
    });
  }
});

module.exports = router;