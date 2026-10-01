const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const router = express.Router();
const db = require('../database');
const { requierePermiso } = require('../middleware/permisos');
const METODOS_PAGO = new Set(['efectivo', 'transferencia', 'tarjeta', 'otro']);

const directorio = path.resolve(__dirname, '..', 'uploads', 'compras');
fs.mkdirSync(directorio, { recursive: true });
const almacenamiento = multer.diskStorage({
  destination: directorio,
  filename: (_req, file, callback) => {
    callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  },
});
const cargarArchivo = multer({
  storage: almacenamiento,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const permitidos = ['application/pdf', 'image/jpeg', 'image/png'];
    callback(null, permitidos.includes(file.mimetype));
  },
});

function obtenerItemsCompra(body) {
  let items = body.items;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      throw Object.assign(new Error('La lista de productos de compra no es válida.'), { statusCode: 400 });
    }
  }

  if (items === undefined) {
    if (body.producto_id === undefined && body.cantidad === undefined) return [];
    items = [{
      producto_id: body.producto_id,
      cantidad: body.cantidad,
      costo_unitario: body.costo_unitario ?? body.precio_compra,
      almacen_id: body.almacen_id,
    }];
  }

  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw Object.assign(new Error('La compra debe incluir entre 1 y 100 productos.'), { statusCode: 400 });
  }

  return items.map((item, index) => {
    const productoId = Number(item?.producto_id);
    const cantidad = Number(item?.cantidad);
    const costoUnitario = Number(item?.costo_unitario ?? item?.precio_compra ?? 0);
    const almacenId = item?.almacen_id ? Number(item.almacen_id) : null;
    if (!Number.isInteger(productoId) || productoId <= 0) {
      throw Object.assign(new Error(`Producto no válido en la línea ${index + 1}.`), { statusCode: 400 });
    }
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      throw Object.assign(new Error(`La cantidad de la línea ${index + 1} debe ser un entero positivo.`), { statusCode: 400 });
    }
    if (!Number.isFinite(costoUnitario) || costoUnitario < 0) {
      throw Object.assign(new Error(`El costo de la línea ${index + 1} no es válido.`), { statusCode: 400 });
    }
    if (almacenId !== null && (!Number.isInteger(almacenId) || almacenId <= 0)) {
      throw Object.assign(new Error(`El almacén de la línea ${index + 1} no es válido.`), { statusCode: 400 });
    }
    return { producto_id: productoId, cantidad, costo_unitario: costoUnitario, almacen_id: almacenId };
  });
}

function fechaISOValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

router.get('/', requierePermiso('compras:ver'), (req, res) => {
  const { buscar, condicion_pago: condicionPago, estado, desde, hasta } = req.query;
  const filtrosTexto = [buscar, condicionPago, estado, desde, hasta].filter(valor => valor !== undefined);
  if (filtrosTexto.some(valor => typeof valor !== 'string')) {
    return res.status(400).json({ ok: false, error: 'Los filtros de compras deben ser valores de texto únicos.' });
  }
  if (Boolean(desde) !== Boolean(hasta) || (desde && (!fechaISOValida(desde) || !fechaISOValida(hasta) || desde > hasta))) {
    return res.status(400).json({ ok: false, error: 'El rango requiere fechas válidas YYYY-MM-DD y desde menor o igual a hasta.' });
  }
  if (condicionPago && !['contado', 'credito'].includes(condicionPago)) {
    return res.status(400).json({ ok: false, error: 'condicion_pago no válida.' });
  }
  if (estado && !['pendiente', 'parcial', 'pagado', 'entregado', 'anulado'].includes(estado)) {
    return res.status(400).json({ ok: false, error: 'Estado de compra no válido.' });
  }
  if (buscar && buscar.trim().length > 100) {
    return res.status(400).json({ ok: false, error: 'La búsqueda admite hasta 100 caracteres.' });
  }

  const condiciones = [];
  const parametros = [];
  if (buscar?.trim()) {
    const patron = `%${buscar.trim().toLocaleLowerCase('es')}%`;
    condiciones.push('(lower(proveedor_razon_social) LIKE ? OR lower(proveedor_documento) LIKE ? OR lower(COALESCE(serie, \'\') || \'-\' || COALESCE(numero, \'\')) LIKE ?)');
    parametros.push(patron, patron, patron);
  }
  if (condicionPago) {
    condiciones.push('condicion_pago = ?');
    parametros.push(condicionPago);
  }
  if (estado) {
    condiciones.push('estado = ?');
    parametros.push(estado);
  }
  if (desde) {
    condiciones.push("DATE(COALESCE(NULLIF(fecha_factura, ''), NULLIF(fecha_ingreso, ''), created_at)) BETWEEN DATE(?) AND DATE(?)");
    parametros.push(desde, hasta);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const documentos = db.prepare(`
    SELECT * FROM documentos_compra ${where}
    ORDER BY created_at DESC, id DESC
  `).all(...parametros);
  if (!documentos.length) return res.json({ ok: true, data: [] });

  const documentoIds = documentos.map(documento => documento.id);
  const placeholders = documentoIds.map(() => '?').join(', ');
  const detalles = db.prepare(`
    SELECT d.documento_compra_id, d.producto_id, p.nombre AS producto_nombre,
           d.cantidad, d.costo_unitario, d.almacen_id, a.nombre AS almacen_nombre,
           ROUND(d.cantidad * d.costo_unitario, 2) AS subtotal
    FROM detalle_documento_compra d
    JOIN productos p ON p.id = d.producto_id
    JOIN almacenes a ON a.id = d.almacen_id
    WHERE d.documento_compra_id IN (${placeholders})
    ORDER BY d.id ASC
  `).all(...documentoIds);

  const pagos = db.prepare(`
    SELECT * FROM pagos_documento_compra
    WHERE documento_compra_id IN (${placeholders})
    ORDER BY fecha_pago ASC, id ASC
  `).all(...documentoIds);

  const itemsPorDocumento = new Map();
  for (const detalle of detalles) {
    const { documento_compra_id: documentoId, ...item } = detalle;
    const items = itemsPorDocumento.get(documentoId) || [];
    items.push(item);
    itemsPorDocumento.set(documentoId, items);
  }

  const pagosPorDocumento = new Map();
  for (const pago of pagos) {
    const items = pagosPorDocumento.get(pago.documento_compra_id) || [];
    items.push(pago);
    pagosPorDocumento.set(pago.documento_compra_id, items);
  }

  res.json({
    ok: true,
    data: documentos.map(documento => {
      const items = itemsPorDocumento.get(documento.id) || [];
      const pagosDocumento = pagosPorDocumento.get(documento.id) || [];
      const importeEstimado = Number(items.reduce((total, item) => total + Number(item.subtotal || 0), 0).toFixed(2));
      const montoPagado = Number(pagosDocumento.reduce((total, pago) => total + Number(pago.monto || 0), 0).toFixed(2));
      return {
        ...documento,
        items,
        pagos: pagosDocumento,
        importe_estimado_pen: importeEstimado,
        monto_pagado_pen: montoPagado,
        saldo_pendiente_pen: documento.estado === 'pagado'
          ? 0
          : Math.max(0, Number((importeEstimado - montoPagado).toFixed(2))),
      };
    }),
  });
});

router.post('/', requierePermiso('compras:crear'), cargarArchivo.fields([
  { name: 'archivo_factura', maxCount: 1 },
  { name: 'archivo_guia', maxCount: 1 },
]), (req, res) => {
  try {
    const body = req.body || {};
    const factura = req.files?.archivo_factura?.[0];
    const guia = req.files?.archivo_guia?.[0];
    const tipo = String(body.tipo || 'factura').trim().toLowerCase();
    if (!['factura', 'guia'].includes(tipo)) return res.status(400).json({ ok: false, error: 'Tipo de documento inválido' });
    if (!String(body.proveedor_documento || '').trim() || !String(body.proveedor_razon_social || '').trim()) {
      return res.status(400).json({ ok: false, error: 'El proveedor y su número de documento son obligatorios' });
    }

    const itemsCompra = obtenerItemsCompra(body);
    const almacenId = body.almacen_id ? Number(body.almacen_id) : null;
    if (almacenId !== null && (!Number.isInteger(almacenId) || almacenId <= 0)) {
      return res.status(400).json({ ok: false, error: 'almacen_id no válido' });
    }

    let documentoCompra = null;
    const productosRegistrados = [];

    db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO documentos_compra
          (tipo, orden_compra, serie, numero, condicion_pago, plazo_pago, fecha_factura,
           fecha_ingreso, fecha_pago, porcentaje, estado, proveedor_documento,
          proveedor_razon_social, proveedor_direccion, moneda, tipo_cambio,
          archivo_nombre, archivo_ruta, archivo_mime,
          factura_archivo_nombre, factura_archivo_ruta, factura_archivo_mime,
          guia_archivo_nombre, guia_archivo_ruta, guia_archivo_mime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tipo,
        body.orden_compra || null,
        body.serie || null,
        body.numero || null,
        body.condicion_pago || null,
        body.plazo_pago || null,
        body.fecha_factura || null,
        body.fecha_ingreso || null,
        body.fecha_pago || null,
        body.porcentaje ? Number(body.porcentaje) : null,
        body.estado || 'pendiente',
        String(body.proveedor_documento).trim(),
        String(body.proveedor_razon_social).trim(),
        body.proveedor_direccion || null,
        body.moneda || 'PEN',
        body.tipo_cambio ? Number(body.tipo_cambio) : null,
        null,
        null,
        null,
        factura?.originalname || null,
        factura?.filename || null,
        factura?.mimetype || null,
        guia?.originalname || null,
        guia?.filename || null,
        guia?.mimetype || null
      );

      documentoCompra = {
        id: result.lastInsertRowid,
        tipo,
        proveedor_documento: String(body.proveedor_documento).trim(),
        proveedor_razon_social: String(body.proveedor_razon_social).trim(),
        orden_compra: body.orden_compra || null,
        serie: body.serie || null,
        numero: body.numero || null,
        estado: body.estado || 'pendiente',
      };

      for (const item of itemsCompra) {
        const producto = db.prepare('SELECT id, stock, precio_compra FROM productos WHERE id = ?').get(item.producto_id);
        if (!producto) {
          throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
        }

        const almacenSolicitado = item.almacen_id ?? almacenId;
        const activoAlmacenId = almacenSolicitado
          ? db.prepare('SELECT id FROM almacenes WHERE id = ? AND activo = 1').get(almacenSolicitado)?.id
          : db.prepare('SELECT id FROM almacenes WHERE activo = 1 ORDER BY id ASC LIMIT 1').get()?.id || null;

        if (almacenSolicitado && !activoAlmacenId) {
          throw Object.assign(new Error('Almacén no encontrado'), { statusCode: 404 });
        }

        let almacenUsadoId = activoAlmacenId;
        if (!activoAlmacenId) {
          const defaultWarehouse = db.prepare(
            'INSERT INTO almacenes (nombre, codigo, tipo, activo) VALUES (?, ?, ?, 1)'
          ).run('Almacén principal', 'ALM-DEFAULT', 'principal');
          almacenUsadoId = Number(defaultWarehouse.lastInsertRowid);
        }

        const stockAnterior = Number(producto.stock || 0);
        const stockPosterior = stockAnterior + item.cantidad;
        const costoValido = item.costo_unitario;

        db.prepare('UPDATE productos SET stock = ?, precio_compra = ? WHERE id = ?')
          .run(stockPosterior, costoValido, item.producto_id);

        db.prepare(`
          INSERT INTO detalle_documento_compra
            (documento_compra_id, producto_id, cantidad, costo_unitario, almacen_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(documentoCompra.id, item.producto_id, item.cantidad, costoValido, almacenUsadoId);

        db.prepare(`
          INSERT INTO kardex_movimientos (
            producto_id, almacen_id, tipo, cantidad, costo_unitario, stock_anterior, stock_posterior,
            documento_relacionado, observacion, usuario_id, fecha
          ) VALUES (?, ?, 'COMPRA', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          item.producto_id,
          almacenUsadoId,
          item.cantidad,
          costoValido,
          stockAnterior,
          stockPosterior,
          `DOC-${documentoCompra.id}`,
          `Compra ${documentoCompra.serie || documentoCompra.id}`,
          req.session?.usuario?.id || null,
        );

        productosRegistrados.push({
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          costo_unitario: costoValido,
          stock_anterior: stockAnterior,
          stock_posterior: stockPosterior,
          almacen_id: almacenUsadoId,
        });
      }
    })();

    res.status(201).json({
      ok: true,
      id: documentoCompra.id,
      tipo: documentoCompra.tipo,
      proveedor_documento: documentoCompra.proveedor_documento,
      proveedor_razon_social: documentoCompra.proveedor_razon_social,
      serie: documentoCompra.serie,
      numero: documentoCompra.numero,
      estado: documentoCompra.estado,
      ...(productosRegistrados.length === 1 ? productosRegistrados[0] : {}),
      productos_registrados: productosRegistrados,
      mensaje: 'Documento de compra guardado',
    });
  } catch (error) {
    for (const archivo of [...(req.files?.archivo_factura || []), ...(req.files?.archivo_guia || [])]) {
      if (archivo.path) fs.rmSync(archivo.path, { force: true });
    }
    const status = Number(error.statusCode) || 500;
    res.status(status).json({ ok: false, error: error.message || 'No se pudo guardar el documento de compra' });
  }
});

router.patch('/:id/pago', requierePermiso('compras:crear'), (req, res) => {
  const id = Number(req.params.id);
  const fechaPago = req.body?.fecha_pago;
  if (!Number.isInteger(id) || id <= 0 || !fechaISOValida(fechaPago)) {
    return res.status(400).json({ ok: false, error: 'Identificador o fecha de pago no válidos.' });
  }

  try {
    const actualizado = db.transaction(() => {
      const documento = db.prepare('SELECT id, condicion_pago, estado FROM documentos_compra WHERE id = ?').get(id);
      if (!documento) throw Object.assign(new Error('Documento de compra no encontrado.'), { statusCode: 404 });
      if (documento.condicion_pago !== 'credito') {
        throw Object.assign(new Error('Solo se puede registrar el pago de documentos a crédito.'), { statusCode: 409 });
      }
      if (documento.estado === 'pagado') {
        throw Object.assign(new Error('El documento ya está pagado.'), { statusCode: 409 });
      }

      const total = db.prepare(`
        SELECT ROUND(COALESCE(SUM(cantidad * costo_unitario), 0), 2) AS total
        FROM detalle_documento_compra WHERE documento_compra_id = ?
      `).get(id).total;
      const pagado = db.prepare(`
        SELECT ROUND(COALESCE(SUM(monto), 0), 2) AS total
        FROM pagos_documento_compra WHERE documento_compra_id = ?
      `).get(id).total;
      const saldo = Math.max(0, Math.round((Number(total) - Number(pagado)) * 100) / 100);
      if (saldo > 0 && documento.estado !== 'pagado') {
        db.prepare(`
          INSERT INTO pagos_documento_compra
            (documento_compra_id, monto, fecha_pago, metodo_pago, usuario_id)
          VALUES (?, ?, ?, 'otro', ?)
        `).run(id, saldo, fechaPago, req.session?.usuario?.id || null);
      }
      db.prepare(`UPDATE documentos_compra SET estado = 'pagado', fecha_pago = ? WHERE id = ?`).run(fechaPago, id);
      return db.prepare('SELECT * FROM documentos_compra WHERE id = ?').get(id);
    })();
    res.json({ ok: true, data: actualizado });
  } catch (error) {
    res.status(Number(error.statusCode) || 500).json({ ok: false, error: error.message || 'No se pudo registrar el pago.' });
  }
});

router.post('/:id/pagos', requierePermiso('compras:crear'), (req, res) => {
  const id = Number(req.params.id);
  const monto = Number(req.body?.monto);
  const fechaPago = req.body?.fecha_pago;
  const metodoPago = String(req.body?.metodo_pago || '').trim().toLowerCase();
  const referencia = String(req.body?.referencia || '').trim();
  const centavos = Math.round(monto * 100);
  if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(monto) || monto <= 0 ||
      Math.abs(monto * 100 - centavos) > 1e-7 || !fechaISOValida(fechaPago) ||
      !METODOS_PAGO.has(metodoPago) || referencia.length > 100) {
    return res.status(400).json({ ok: false, error: 'Datos del pago no válidos.' });
  }

  try {
    const data = db.transaction(() => {
      const documento = db.prepare('SELECT id, condicion_pago, estado FROM documentos_compra WHERE id = ?').get(id);
      if (!documento) throw Object.assign(new Error('Documento de compra no encontrado.'), { statusCode: 404 });
      if (documento.condicion_pago !== 'credito') {
        throw Object.assign(new Error('Solo se permiten abonos en documentos a crédito.'), { statusCode: 409 });
      }
      if (documento.estado === 'pagado') {
        throw Object.assign(new Error('El documento ya está pagado.'), { statusCode: 409 });
      }

      const total = Number(db.prepare(`
        SELECT ROUND(COALESCE(SUM(cantidad * costo_unitario), 0), 2) AS total
        FROM detalle_documento_compra WHERE documento_compra_id = ?
      `).get(id).total);
      if (total <= 0) {
        throw Object.assign(new Error('El documento no tiene líneas de recepción para calcular el saldo.'), { statusCode: 409 });
      }

      const pagado = Number(db.prepare(`
        SELECT ROUND(COALESCE(SUM(monto), 0), 2) AS total
        FROM pagos_documento_compra WHERE documento_compra_id = ?
      `).get(id).total);
      const saldoActual = Math.max(0, Math.round((total - pagado) * 100) / 100);
      if (monto > saldoActual) {
        throw Object.assign(new Error('El abono no puede superar el saldo pendiente.'), { statusCode: 400 });
      }

      db.prepare(`
        INSERT INTO pagos_documento_compra
          (documento_compra_id, monto, fecha_pago, metodo_pago, referencia, usuario_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, monto, fechaPago, metodoPago, referencia || null, req.session?.usuario?.id || null);

      const pagadoActual = Math.round((pagado + monto) * 100) / 100;
      const saldoPendiente = Math.max(0, Math.round((total - pagadoActual) * 100) / 100);
      const estado = saldoPendiente === 0 ? 'pagado' : 'parcial';
      db.prepare(`
        UPDATE documentos_compra
        SET estado = ?, fecha_pago = ?
        WHERE id = ?
      `).run(estado, saldoPendiente === 0 ? fechaPago : null, id);

      return {
        id,
        estado,
        importe_estimado_pen: total,
        monto_pagado_pen: pagadoActual,
        saldo_pendiente_pen: saldoPendiente,
      };
    })();
    res.status(201).json({ ok: true, data });
  } catch (error) {
    res.status(Number(error.statusCode) || 500).json({ ok: false, error: error.message || 'No se pudo guardar el abono.' });
  }
});

router.get('/:id/archivo', requierePermiso('compras:ver'), (req, res) => {
  const campo = req.query.tipo === 'guia' ? 'guia' : 'factura';
  const documento = db.prepare(`SELECT ${campo}_archivo_ruta AS archivo_ruta, ${campo}_archivo_nombre AS archivo_nombre, ${campo}_archivo_mime AS archivo_mime FROM documentos_compra WHERE id = ?`).get(req.params.id);
  if (!documento?.archivo_ruta) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
  const archivo = path.join(directorio, documento.archivo_ruta);
  if (!fs.existsSync(archivo)) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
  res.type(documento.archivo_mime || 'application/octet-stream');
  res.download(archivo, documento.archivo_nombre || 'documento');
});

module.exports = router;