const express = require('express');
const router = express.Router();
const db = require('../database');

// GET - Listar todas las facturas
router.get('/', (req, res) => {
  try {
    const facturas = db.prepare(`
      SELECT f.*, c.nombre as cliente_nombre, c.documento as cliente_documento
      FROM facturas f
      JOIN clientes c ON f.cliente_id = c.id
      ORDER BY f.fecha DESC
    `).all();
    res.json({ ok: true, data: facturas });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Obtener una factura completa con su detalle
router.get('/:id', (req, res) => {
  try {
    const factura = db.prepare(`
      SELECT f.*, c.nombre as cliente_nombre, c.documento as cliente_documento,
             c.direccion as cliente_direccion, c.email as cliente_email
      FROM facturas f
      JOIN clientes c ON f.cliente_id = c.id
      WHERE f.id = ?
    `).get(req.params.id);

    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });

    const detalle = db.prepare(`
      SELECT df.*, p.nombre as producto_nombre
      FROM detalle_factura df
      JOIN productos p ON df.producto_id = p.id
      WHERE df.factura_id = ?
    `).all(req.params.id);

    res.json({ ok: true, data: { ...factura, detalle } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Crear nueva factura
router.post('/', (req, res) => {
  try {
    const { cliente_id, items } = req.body;
    // items = [{ producto_id, cantidad }]

    if (!cliente_id) return res.status(400).json({ ok: false, error: 'El cliente es obligatorio' });
    if (!items || items.length === 0) return res.status(400).json({ ok: false, error: 'Debe agregar al menos un producto' });

    // Verificar que el cliente existe
    const cliente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(cliente_id);
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });

    // Verificar stock de todos los productos antes de crear la factura
    for (const item of items) {
      const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);
      if (!producto) return res.status(404).json({ ok: false, error: `Producto ${item.producto_id} no encontrado` });
      if (producto.stock < item.cantidad) {
        return res.status(400).json({ ok: false, error: `Stock insuficiente para "${producto.nombre}". Disponible: ${producto.stock}` });
      }
    }

    // Obtener el último número de factura para autoincrementar
    const ultima = db.prepare('SELECT MAX(numero) as ultimo FROM facturas').get();
    const numero = (ultima.ultimo || 0) + 1;

    // Calcular totales
    let subtotal = 0;
    const detalles = [];

    for (const item of items) {
      const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);
      const subtotalItem = producto.precio * item.cantidad;
      subtotal += subtotalItem;
      detalles.push({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio_unitario: producto.precio,
        subtotal: subtotalItem
      });
    }

    const IGV = 0.18;
    const igv = parseFloat((subtotal * IGV).toFixed(2));
    const total = parseFloat((subtotal + igv).toFixed(2));
    subtotal = parseFloat(subtotal.toFixed(2));

    // Usar transacción para que todo se guarde junto o nada
    const crearFactura = db.transaction(() => {
      // Insertar factura
      const result = db.prepare(`
        INSERT INTO facturas (cliente_id, serie, numero, subtotal, igv, total, estado)
        VALUES (?, 'F001', ?, ?, ?, ?, 'emitida')
      `).run(cliente_id, numero, subtotal, igv, total);

      const factura_id = result.lastInsertRowid;

      // Insertar cada línea de detalle y descontar stock
      for (const d of detalles) {
        db.prepare(`
          INSERT INTO detalle_factura (factura_id, producto_id, cantidad, precio_unitario, subtotal)
          VALUES (?, ?, ?, ?, ?)
        `).run(factura_id, d.producto_id, d.cantidad, d.precio_unitario, d.subtotal);

        // Descontar stock automáticamente
        db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ?').run(d.cantidad, d.producto_id);
      }

      return factura_id;
    });

    const factura_id = crearFactura();
    res.status(201).json({
      ok: true,
      id: factura_id,
      numero: `F001-${String(numero).padStart(6, '0')}`,
      subtotal,
      igv,
      total,
      mensaje: 'Factura creada exitosamente'
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH - Cambiar estado de factura (emitida, anulada, pagada)
router.patch('/:id/estado', (req, res) => {
  try {
    const { estado } = req.body;
    const estadosValidos = ['emitida', 'pagada', 'anulada'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ ok: false, error: 'Estado inválido. Use: emitida, pagada o anulada' });
    }

    const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
    if (factura.estado === 'anulada') return res.status(400).json({ ok: false, error: 'No se puede modificar una factura anulada' });

    // Si se anula, devolver stock
    if (estado === 'anulada') {
      const detalle = db.prepare('SELECT * FROM detalle_factura WHERE factura_id = ?').all(req.params.id);
      const anular = db.transaction(() => {
        for (const d of detalle) {
          db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?').run(d.cantidad, d.producto_id);
        }
        db.prepare('UPDATE facturas SET estado = ? WHERE id = ?').run(estado, req.params.id);
      });
      anular();
    } else {
      db.prepare('UPDATE facturas SET estado = ? WHERE id = ?').run(estado, req.params.id);
    }

    res.json({ ok: true, mensaje: `Factura marcada como ${estado}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Facturas por rango de fechas
router.get('/filtro/fecha', (req, res) => {
  try {
    const { desde, hasta } = req.query;
    // Uso: /api/facturas/filtro/fecha?desde=2024-01-01&hasta=2024-12-31
    const facturas = db.prepare(`
      SELECT f.*, c.nombre as cliente_nombre
      FROM facturas f
      JOIN clientes c ON f.cliente_id = c.id
      WHERE DATE(f.fecha) BETWEEN ? AND ?
      ORDER BY f.fecha DESC
    `).all(desde, hasta);
    res.json({ ok: true, data: facturas, total: facturas.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Facturas de un cliente específico
router.get('/filtro/cliente/:cliente_id', (req, res) => {
  try {
    const facturas = db.prepare(`
      SELECT f.*, c.nombre as cliente_nombre
      FROM facturas f
      JOIN clientes c ON f.cliente_id = c.id
      WHERE f.cliente_id = ?
      ORDER BY f.fecha DESC
    `).all(req.params.cliente_id);
    res.json({ ok: true, data: facturas, total: facturas.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;