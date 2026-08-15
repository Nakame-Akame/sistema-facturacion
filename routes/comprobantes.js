const express = require('express');
const router = express.Router();
const db = require('../database');

// Configuración de cada tipo
const TIPOS = {
  factura:         { label: 'Factura Electrónica',      afecta_igv: true,  mueve_stock: true  },
  boleta:          { label: 'Boleta Electrónica',        afecta_igv: true,  mueve_stock: true  },
  nota_pedido:     { label: 'Nota de Pedido',            afecta_igv: false, mueve_stock: false },
  guia_remision:   { label: 'Guía de Remisión',          afecta_igv: false, mueve_stock: false },
  cotizacion:      { label: 'Cotización',                afecta_igv: false, mueve_stock: false },
  nota_devolucion: { label: 'Nota de Devolución',        afecta_igv: true,  mueve_stock: true  },
  nota_credito_f:  { label: 'Nota de Crédito (Factura)', afecta_igv: true,  mueve_stock: false },
  nota_credito_b:  { label: 'Nota de Crédito (Boleta)',  afecta_igv: true,  mueve_stock: false },
};

// ─── LISTAR ───────────────────────────────────────────────
// GET /api/comprobantes?tipo=factura
router.get('/', (req, res) => {
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── VER UNO ──────────────────────────────────────────────
router.get('/:id', (req, res) => {
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── CREAR ────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const {
      tipo, cliente_id, items,
      condicion_pago = 'contado',
      fecha_vencimiento = null,
      comprobante_ref_id = null,
      motivo_ref = null,
      direccion_partida = null,
      direccion_llegada = null,
      transportista = null,
      fecha_traslado = null,
      descuento = 0,
    } = req.body;

    if (!TIPOS[tipo]) return res.status(400).json({ ok: false, error: 'Tipo de comprobante inválido' });
    if (!cliente_id)  return res.status(400).json({ ok: false, error: 'Cliente requerido' });
    if (!items || items.length === 0) return res.status(400).json({ ok: false, error: 'Agrega al menos un ítem' });

    const config = TIPOS[tipo];

    // Agrega esto en router.post('/') justo después de extraer el tipo:
const { tienePermiso } = require('../middleware/permisos');

// Dentro del router.post('/'), después de "const { tipo, ... } = req.body":
const permisoTipo = `comprobantes:crear_${tipo}`;
if (!tienePermiso(req.session.usuario.rol, permisoTipo)) {
  return res.status(403).json({
    ok: false,
    error: `Tu rol no puede crear comprobantes de tipo: ${TIPOS[tipo]?.label || tipo}`
  });
}

    // Validar condición de pago
    const condicionesValidas = ['no_afecta', 'contado', 'credito'];
    if (!condicionesValidas.includes(condicion_pago)) {
      return res.status(400).json({ ok: false, error: 'Condición de pago inválida' });
    }
    if (condicion_pago === 'credito' && !fecha_vencimiento) {
      return res.status(400).json({ ok: false, error: 'La fecha de vencimiento es obligatoria para crédito' });
    }

    // Obtener y actualizar serie
    const serieReg = db.prepare('SELECT * FROM series WHERE tipo = ?').get(tipo);
    const numero   = serieReg.ultimo_numero + 1;

    // Verificar stock si aplica
    if (config.mueve_stock) {
      for (const item of items) {
        if (!item.producto_id) continue;
        const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);
        if (!prod) return res.status(404).json({ ok: false, error: `Producto ${item.producto_id} no encontrado` });
        if (tipo !== 'nota_devolucion' && prod.stock < item.cantidad) {
          return res.status(400).json({ ok: false, error: `Stock insuficiente para "${prod.nombre}". Disponible: ${prod.stock}` });
        }
      }
    }

    // Calcular totales
    let subtotal = 0;
    const detalles = [];

    for (const item of items) {
      let precioUnit = 0;
      let nombre = item.descripcion_libre || '';

      if (item.producto_id) {
        const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);
        precioUnit = item.precio_unitario ?? prod.precio;
        nombre = prod.nombre;
      } else {
        precioUnit = item.precio_unitario || 0;
      }

      const descItem = item.descuento_item || 0;
      const subItem  = (precioUnit - descItem) * item.cantidad;
      subtotal += subItem;

      detalles.push({
        producto_id:      item.producto_id || null,
        descripcion_libre: nombre,
        cantidad:         item.cantidad,
        unidad:           item.unidad || 'UND',
        precio_unitario:  precioUnit,
        descuento_item:   descItem,
        subtotal:         parseFloat(subItem.toFixed(2)),
      });
    }

    const descuentoTotal = parseFloat((descuento || 0).toFixed(2));
    subtotal = parseFloat((subtotal - descuentoTotal).toFixed(2));
    const igv   = config.afecta_igv && condicion_pago !== 'no_afecta'
                  ? parseFloat((subtotal * 0.18).toFixed(2))
                  : 0;
    const total = parseFloat((subtotal + igv).toFixed(2));

    // Transacción
    const crear = db.transaction(() => {
      db.prepare('UPDATE series SET ultimo_numero = ? WHERE tipo = ?').run(numero, tipo);

      const result = db.prepare(`
        INSERT INTO comprobantes (
          tipo, serie, numero, cliente_id,
          condicion_pago, fecha_vencimiento,
          comprobante_ref_id, motivo_ref,
          direccion_partida, direccion_llegada, transportista, fecha_traslado,
          subtotal, igv, descuento, total, afecta_igv, estado
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?)
      `).run(
        tipo, serieReg.serie, numero, cliente_id,
        condicion_pago, fecha_vencimiento,
        comprobante_ref_id, motivo_ref,
        direccion_partida, direccion_llegada, transportista, fecha_traslado,
        subtotal, igv, descuentoTotal, total,
        config.afecta_igv ? 1 : 0,
        tipo === 'cotizacion' ? 'borrador' :
        tipo === 'nota_pedido' ? 'pendiente' : 'emitido'
      );

      const comp_id = result.lastInsertRowid;

      for (const d of detalles) {
        db.prepare(`
          INSERT INTO detalle_comprobante
            (comprobante_id, producto_id, descripcion_libre, cantidad, unidad, precio_unitario, descuento_item, subtotal)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(comp_id, d.producto_id, d.descripcion_libre, d.cantidad, d.unidad, d.precio_unitario, d.descuento_item, d.subtotal);

        // Mover stock
        if (config.mueve_stock && d.producto_id) {
          if (tipo === 'nota_devolucion') {
            db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?').run(d.cantidad, d.producto_id);
          } else {
            db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ?').run(d.cantidad, d.producto_id);
          }
        }
      }

      return comp_id;
    });

    const comp_id = crear();
    const numFormato = `${serieReg.serie}-${String(numero).padStart(6, '0')}`;

    res.status(201).json({
      ok: true,
      id: comp_id,
      numero: numFormato,
      subtotal, igv, total,
      mensaje: `${TIPOS[tipo].label} ${numFormato} creada exitosamente`
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── CAMBIAR ESTADO ───────────────────────────────────────
router.patch('/:id/estado', (req, res) => {
  try {
    const { estado } = req.body;
    const comp = db.prepare('SELECT * FROM comprobantes WHERE id = ?').get(req.params.id);
    if (!comp) return res.status(404).json({ ok: false, error: 'No encontrado' });
    if (comp.estado === 'anulado') return res.status(400).json({ ok: false, error: 'No se puede modificar un comprobante anulado' });

    const config = TIPOS[comp.tipo];

    // Si se anula y mueve stock, devolver stock
    if (estado === 'anulado' && config.mueve_stock && comp.tipo !== 'nota_devolucion') {
      const detalle = db.prepare('SELECT * FROM detalle_comprobante WHERE comprobante_id = ?').all(comp.id);
      const anular = db.transaction(() => {
        for (const d of detalle) {
          if (d.producto_id) {
            db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?').run(d.cantidad, d.producto_id);
          }
        }
        db.prepare('UPDATE comprobantes SET estado = ? WHERE id = ?').run(estado, comp.id);
      });
      anular();
    } else {
      db.prepare('UPDATE comprobantes SET estado = ? WHERE id = ?').run(estado, comp.id);
    }

    res.json({ ok: true, mensaje: `Comprobante marcado como ${estado}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── LISTAR TIPOS DISPONIBLES ─────────────────────────────
router.get('/meta/tipos', (req, res) => {
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
// Dentro del router.patch('/:id/estado'), después de obtener el estado:
const { tienePermiso } = require('../middleware/permisos');
const rol = req.session.usuario.rol;

if (estado === 'anulado' && !tienePermiso(rol, 'comprobantes:anular')) {
  return res.status(403).json({ ok: false, error: 'No tienes permiso para anular comprobantes' });
}
if (estado === 'pagado' && !tienePermiso(rol, 'comprobantes:pagar')) {
  return res.status(403).json({ ok: false, error: 'No tienes permiso para marcar como pagado' });
}


module.exports = router;