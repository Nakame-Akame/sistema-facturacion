const express = require('express');
const router = express.Router();
const db = require('../database');
const XLSX = require('xlsx');
const { requierePermiso } = require('../middleware/permisos');

router.use(requierePermiso('reportes:ver'));

// Tipos que representan una VENTA real (afectan ingresos)
const TIPOS_VENTA = ['factura', 'boleta'];
// Tipos que restan ingresos (notas de crédito y devoluciones)
const TIPOS_REVERSA = ['nota_credito_f', 'nota_credito_b', 'nota_devolucion'];

const enListaVenta = `('${TIPOS_VENTA.join("','")}')`;

function fechaISOValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

// GET - Resumen general del negocio
router.get('/resumen', (req, res) => {
  try {
    const totalClientes = db.prepare('SELECT COUNT(*) as total FROM clientes').get();
    const totalProductos = db.prepare('SELECT COUNT(*) as total FROM productos').get();
    const totalComprobantes = db.prepare(`
      SELECT COUNT(*) as total FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
    `).get();

    const ventasHoy = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
        AND DATE(fecha) = DATE('now')
    `).get();

    const ventasMes = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
        AND strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now')
    `).get();

    const ventasTotales = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
    `).get();

    const stockBajo = db.prepare('SELECT COUNT(*) as total FROM productos WHERE stock <= 5').get();

    const porCobrar = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado = 'emitido'
        AND condicion_pago = 'credito'
    `).get();

    res.json({
      ok: true,
      data: {
        clientes: totalClientes.total,
        productos: totalProductos.total,
        facturas: totalComprobantes.total,
        ventas_hoy: parseFloat(ventasHoy.total.toFixed(2)),
        ventas_mes: parseFloat(ventasMes.total.toFixed(2)),
        ventas_totales: parseFloat(ventasTotales.total.toFixed(2)),
        productos_stock_bajo: stockBajo.total,
        por_cobrar_credito: parseFloat(porCobrar.total.toFixed(2)),
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Alertas de stock bajo para operación y reposición
router.get('/alertas-stock', (req, res) => {
  try {
    const alertas = db.prepare(`
      SELECT
        id,
        nombre,
        categoria,
        stock,
        COALESCE(stock_minimo, 0) AS stock_minimo,
        CASE
          WHEN stock_minimo IS NULL OR stock_minimo <= 0 THEN 5
          ELSE stock_minimo
        END AS umbral,
        precio_compra
      FROM productos
      WHERE stock <= CASE
        WHEN stock_minimo IS NULL OR stock_minimo <= 0 THEN 5
        ELSE stock_minimo
      END
      ORDER BY stock ASC, nombre ASC
    `).all();

    const resumen = {
      total_alertas: alertas.length,
      umbral_predeterminado: 5,
      valor_total_critico: alertas.reduce((total, item) => total + Number(item.precio_compra || 0) * Number(item.stock || 0), 0),
    };

    res.json({ ok: true, data: alertas, resumen });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Ventas por día (últimos 30 días)
router.get('/ventas-por-dia', (req, res) => {
  try {
    const ventas = db.prepare(`
      SELECT
        DATE(fecha) as dia,
        COUNT(*) as cantidad_facturas,
        ROUND(SUM(subtotal), 2) as subtotal,
        ROUND(SUM(igv), 2) as igv,
        ROUND(SUM(total), 2) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
        AND fecha >= DATE('now', '-30 days')
      GROUP BY DATE(fecha)
      ORDER BY dia DESC
    `).all();
    res.json({ ok: true, data: ventas });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Ventas por mes (último año)
router.get('/ventas-por-mes', (req, res) => {
  try {
    const ventas = db.prepare(`
      SELECT
        strftime('%Y-%m', fecha) as mes,
        COUNT(*) as cantidad_facturas,
        ROUND(SUM(subtotal), 2) as subtotal,
        ROUND(SUM(igv), 2) as igv,
        ROUND(SUM(total), 2) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
        AND fecha >= DATE('now', '-12 months')
      GROUP BY strftime('%Y-%m', fecha)
      ORDER BY mes DESC
    `).all();
    res.json({ ok: true, data: ventas });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Productos más vendidos
router.get('/productos-mas-vendidos', (req, res) => {
  try {
    const productos = db.prepare(`
      SELECT
        p.id,
        p.nombre,
        p.categoria,
        p.precio,
        SUM(d.cantidad) as unidades_vendidas,
        ROUND(SUM(d.subtotal), 2) as ingresos_generados
      FROM detalle_comprobante d
      JOIN productos p ON d.producto_id = p.id
      JOIN comprobantes c ON d.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta} AND c.estado != 'anulado'
      GROUP BY p.id
      ORDER BY unidades_vendidas DESC
      LIMIT 10
    `).all();
    res.json({ ok: true, data: productos });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Clientes que más compran
router.get('/mejores-clientes', (req, res) => {
  try {
    const clientes = db.prepare(`
      SELECT
        cl.id,
        cl.nombre,
        cl.documento,
        cl.email,
        COUNT(c.id) as total_facturas,
        ROUND(SUM(c.total), 2) as total_compras
      FROM clientes cl
      JOIN comprobantes c ON c.cliente_id = cl.id
      WHERE c.tipo IN ${enListaVenta} AND c.estado != 'anulado'
      GROUP BY cl.id
      ORDER BY total_compras DESC
      LIMIT 10
    `).all();
    res.json({ ok: true, data: clientes });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Ventas por categoría de producto
router.get('/ventas-por-categoria', (req, res) => {
  try {
    const categorias = db.prepare(`
      SELECT
        p.categoria,
        COUNT(DISTINCT c.id) as facturas,
        SUM(d.cantidad) as unidades_vendidas,
        ROUND(SUM(d.subtotal), 2) as ingresos
      FROM detalle_comprobante d
      JOIN productos p ON d.producto_id = p.id
      JOIN comprobantes c ON d.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta} AND c.estado != 'anulado' AND p.categoria IS NOT NULL
      GROUP BY p.categoria
      ORDER BY ingresos DESC
    `).all();
    res.json({ ok: true, data: categorias });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Comprobantes por estado (todos los tipos)
router.get('/facturas-por-estado', (req, res) => {
  try {
    const estados = db.prepare(`
      SELECT
        estado,
        COUNT(*) as cantidad,
        ROUND(SUM(total), 2) as monto_total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta}
      GROUP BY estado
    `).all();
    res.json({ ok: true, data: estados });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Reporte de IGV del mes actual
router.get('/igv-mes', (req, res) => {
  try {
    const igv = db.prepare(`
      SELECT
        strftime('%Y-%m', fecha) as mes,
        COUNT(*) as facturas,
        ROUND(SUM(subtotal), 2) as base_imponible,
        ROUND(SUM(igv), 2) as igv_total,
        ROUND(SUM(total), 2) as total_con_igv
      FROM comprobantes
      WHERE tipo IN ${enListaVenta}
        AND strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now')
        AND estado != 'anulado'
      GROUP BY mes
    `).get();
    res.json({ ok: true, data: igv || { mes: null, facturas: 0, base_imponible: 0, igv_total: 0, total_con_igv: 0 } });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Comprobantes por tipo (conteo general, todos los 8 tipos)
router.get('/comprobantes-por-tipo', (req, res) => {
  try {
    const data = db.prepare(`
      SELECT tipo, COUNT(*) as cantidad, ROUND(SUM(total), 2) as monto_total
      FROM comprobantes
      WHERE estado != 'anulado'
      GROUP BY tipo
    `).all();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Créditos pendientes / próximos a vencer
router.get('/creditos-pendientes', (req, res) => {
  try {
    const data = db.prepare(`
      SELECT c.id, c.tipo, c.serie, c.numero, c.total, c.fecha_vencimiento,
             cl.nombre as cliente_nombre,
             COALESCE(p.monto_cobrado, 0) AS monto_cobrado,
             ROUND(MAX(0, c.total - COALESCE(p.monto_cobrado, 0)), 2) AS saldo_pendiente,
             CASE WHEN DATE(c.fecha_vencimiento) < DATE('now') THEN 1 ELSE 0 END as vencido
      FROM comprobantes c
      JOIN clientes cl ON c.cliente_id = cl.id
      LEFT JOIN (
        SELECT comprobante_id, ROUND(SUM(monto), 2) AS monto_cobrado
        FROM pagos_comprobante GROUP BY comprobante_id
      ) p ON p.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta}
        AND c.condicion_pago = 'credito'
        AND c.estado IN ('emitido', 'parcial')
      ORDER BY c.fecha_vencimiento ASC
    `).all();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/cuentas-por-cobrar', (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!fechaISOValida(desde) || !fechaISOValida(hasta) || desde > hasta) {
      return res.status(400).json({ ok: false, error: 'Envía un rango válido con fechas YYYY-MM-DD, desde menor o igual a hasta.' });
    }

    const base = `
      WITH pagos AS (
        SELECT comprobante_id, ROUND(SUM(monto), 2) AS monto_cobrado
        FROM pagos_comprobante
        GROUP BY comprobante_id
      ),
      cuentas AS (
        SELECT c.id AS comprobante_id, c.tipo, c.serie, c.numero, c.fecha,
               c.fecha_vencimiento, c.estado, c.total,
               cl.id AS cliente_id, cl.nombre AS cliente_nombre, cl.documento AS cliente_documento,
               COALESCE(p.monto_cobrado, 0) AS monto_cobrado,
               ROUND(MAX(0, c.total - COALESCE(p.monto_cobrado, 0)), 2) AS saldo_pendiente,
               CASE WHEN DATE(c.fecha_vencimiento) < DATE('now') THEN 1 ELSE 0 END AS vencido,
               CASE WHEN DATE(c.fecha_vencimiento) < DATE('now')
                 THEN MAX(0, CAST(julianday(DATE('now')) - julianday(DATE(c.fecha_vencimiento)) AS INTEGER))
                 ELSE 0 END AS dias_vencido
        FROM comprobantes c
        JOIN clientes cl ON cl.id = c.cliente_id
        LEFT JOIN pagos p ON p.comprobante_id = c.id
        WHERE c.tipo IN ${enListaVenta}
          AND c.condicion_pago = 'credito'
          AND c.estado IN ('emitido', 'parcial')
          AND DATE(c.fecha) BETWEEN ? AND ?
      )
    `;
    const parametros = [desde, hasta];
    const resumen = db.prepare(`${base}
      SELECT COUNT(*) AS cantidad_documentos,
             ROUND(COALESCE(SUM(total), 0), 2) AS monto_facturado,
             ROUND(COALESCE(SUM(monto_cobrado), 0), 2) AS monto_cobrado,
             ROUND(COALESCE(SUM(saldo_pendiente), 0), 2) AS saldo_pendiente,
             ROUND(COALESCE(SUM(CASE WHEN vencido = 1 THEN saldo_pendiente ELSE 0 END), 0), 2) AS monto_vencido,
             SUM(vencido) AS documentos_vencidos
      FROM cuentas
    `).get(...parametros);

    const data = db.prepare(`${base}
      SELECT * FROM cuentas
      ORDER BY vencido DESC, fecha_vencimiento ASC, comprobante_id ASC
    `).all(...parametros);

    const porCliente = db.prepare(`${base}
      SELECT cliente_id, cliente_nombre, cliente_documento,
             COUNT(*) AS documentos,
             ROUND(SUM(monto_cobrado), 2) AS monto_cobrado,
             ROUND(SUM(saldo_pendiente), 2) AS saldo_pendiente,
             ROUND(SUM(CASE WHEN vencido = 1 THEN saldo_pendiente ELSE 0 END), 2) AS monto_vencido
      FROM cuentas
      GROUP BY cliente_id, cliente_nombre, cliente_documento
      ORDER BY saldo_pendiente DESC, cliente_nombre COLLATE NOCASE ASC
    `).all(...parametros);

    res.json({ ok: true, periodo: { desde, hasta }, resumen, data, por_cliente: porCliente });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/cuentas-por-cobrar/exportar', (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!fechaISOValida(desde) || !fechaISOValida(hasta) || desde > hasta) {
      return res.status(400).json({ ok: false, error: 'Envía un rango válido con fechas YYYY-MM-DD, desde menor o igual a hasta.' });
    }

    const base = `
      WITH pagos AS (
        SELECT comprobante_id, ROUND(SUM(monto), 2) AS monto_cobrado
        FROM pagos_comprobante
        GROUP BY comprobante_id
      )
    `;
    const parametros = [desde, hasta];
    const cuentas = db.prepare(`${base}
      SELECT c.id AS comprobante_id, c.tipo, c.serie, c.numero, DATE(c.fecha) AS fecha,
             DATE(c.fecha_vencimiento) AS fecha_vencimiento, cl.nombre AS cliente_nombre,
             cl.documento AS cliente_documento, c.total,
             COALESCE(p.monto_cobrado, 0) AS monto_cobrado,
             ROUND(MAX(0, c.total - COALESCE(p.monto_cobrado, 0)), 2) AS saldo_pendiente,
             CASE WHEN DATE(c.fecha_vencimiento) < DATE('now') THEN 1 ELSE 0 END AS vencido,
             CASE WHEN DATE(c.fecha_vencimiento) < DATE('now')
               THEN MAX(0, CAST(julianday(DATE('now')) - julianday(DATE(c.fecha_vencimiento)) AS INTEGER))
               ELSE 0 END AS dias_vencido
      FROM comprobantes c
      JOIN clientes cl ON cl.id = c.cliente_id
      LEFT JOIN pagos p ON p.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta}
        AND c.condicion_pago = 'credito'
        AND c.estado IN ('emitido', 'parcial')
        AND DATE(c.fecha) BETWEEN ? AND ?
      ORDER BY vencido DESC, c.fecha_vencimiento ASC, c.id ASC
    `).all(...parametros);

    const porCliente = db.prepare(`${base}
      SELECT cl.id AS cliente_id, cl.nombre AS cliente_nombre, cl.documento AS cliente_documento,
             COUNT(*) AS comprobantes,
             ROUND(SUM(c.total), 2) AS monto_facturado,
             ROUND(SUM(COALESCE(p.monto_cobrado, 0)), 2) AS monto_cobrado,
             ROUND(SUM(MAX(0, c.total - COALESCE(p.monto_cobrado, 0))), 2) AS saldo_pendiente
      FROM comprobantes c
      JOIN clientes cl ON cl.id = c.cliente_id
      LEFT JOIN pagos p ON p.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta}
        AND c.condicion_pago = 'credito'
        AND c.estado IN ('emitido', 'parcial')
        AND DATE(c.fecha) BETWEEN ? AND ?
      GROUP BY cl.id, cl.nombre, cl.documento
      ORDER BY saldo_pendiente DESC, cl.nombre COLLATE NOCASE ASC
    `).all(...parametros);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cuentas), 'Cuentas por cobrar');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(porCliente), 'Resumen por cliente');
    const contenido = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cuentas_por_cobrar_${desde}_${hasta}.xlsx"`);
    res.send(contenido);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo generar el Excel de cuentas por cobrar.' });
  }
});

// GET - Recepciones de compra agrupadas por proveedor y producto
router.get('/compras', (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!fechaISOValida(desde) || !fechaISOValida(hasta) || desde > hasta) {
      return res.status(400).json({ ok: false, error: 'Envía un rango válido con fechas YYYY-MM-DD, desde menor o igual a hasta.' });
    }

    const condicionFecha = `DATE(COALESCE(dc.fecha_ingreso, dc.fecha_factura, dc.created_at)) BETWEEN ? AND ?`;
    const parametrosFecha = [desde, hasta];
    const resumen = db.prepare(`
      SELECT COUNT(DISTINCT dc.id) AS total_documentos,
             COUNT(d.id) AS total_lineas,
             COALESCE(SUM(d.cantidad), 0) AS unidades_recibidas
      FROM documentos_compra dc
      JOIN detalle_documento_compra d ON d.documento_compra_id = dc.id
      WHERE ${condicionFecha}
    `).get(...parametrosFecha);

    const porProveedor = db.prepare(`
      SELECT dc.proveedor_documento, dc.proveedor_razon_social,
             COUNT(DISTINCT dc.id) AS documentos,
             COUNT(d.id) AS lineas,
             SUM(d.cantidad) AS unidades_recibidas
      FROM documentos_compra dc
      JOIN detalle_documento_compra d ON d.documento_compra_id = dc.id
      WHERE ${condicionFecha}
      GROUP BY dc.proveedor_documento, dc.proveedor_razon_social
      ORDER BY unidades_recibidas DESC, dc.proveedor_razon_social COLLATE NOCASE ASC
    `).all(...parametrosFecha);

    const porProducto = db.prepare(`
      SELECT p.id AS producto_id, p.nombre AS producto_nombre,
             COUNT(DISTINCT dc.id) AS documentos,
             COUNT(d.id) AS lineas,
             SUM(d.cantidad) AS unidades_recibidas
      FROM documentos_compra dc
      JOIN detalle_documento_compra d ON d.documento_compra_id = dc.id
      JOIN productos p ON p.id = d.producto_id
      WHERE ${condicionFecha}
      GROUP BY p.id, p.nombre
      ORDER BY unidades_recibidas DESC, p.nombre COLLATE NOCASE ASC
    `).all(...parametrosFecha);

    res.json({
      ok: true,
      periodo: { desde, hasta },
      resumen,
      por_proveedor: porProveedor,
      por_producto: porProducto,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/compras/exportar', (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!fechaISOValida(desde) || !fechaISOValida(hasta) || desde > hasta) {
      return res.status(400).json({ ok: false, error: 'Envía un rango válido con fechas YYYY-MM-DD, desde menor o igual a hasta.' });
    }

    const recepciones = db.prepare(`
      SELECT dc.id AS documento_id,
             DATE(COALESCE(NULLIF(dc.fecha_ingreso, ''), NULLIF(dc.fecha_factura, ''), dc.created_at)) AS fecha,
             dc.tipo, dc.serie, dc.numero, dc.proveedor_documento, dc.proveedor_razon_social,
             dc.moneda, dc.tipo_cambio,
             p.id AS producto_id, p.nombre AS producto_nombre,
             d.cantidad, d.costo_unitario,
             ROUND(d.cantidad * d.costo_unitario, 2) AS subtotal_pen,
             a.nombre AS almacen_nombre
      FROM documentos_compra dc
      JOIN detalle_documento_compra d ON d.documento_compra_id = dc.id
      JOIN productos p ON p.id = d.producto_id
      JOIN almacenes a ON a.id = d.almacen_id
      WHERE DATE(COALESCE(NULLIF(dc.fecha_ingreso, ''), NULLIF(dc.fecha_factura, ''), dc.created_at)) BETWEEN ? AND ?
      ORDER BY fecha ASC, dc.id ASC, d.id ASC
    `).all(desde, hasta);

    const cuentasPorPagar = db.prepare(`
      WITH totales_linea AS (
        SELECT documento_compra_id,
               ROUND(SUM(cantidad * costo_unitario), 2) AS importe_estimado_pen
        FROM detalle_documento_compra
        GROUP BY documento_compra_id
      ),
      totales_pago AS (
        SELECT documento_compra_id, ROUND(SUM(monto), 2) AS monto_pagado_pen
        FROM pagos_documento_compra
        GROUP BY documento_compra_id
      )
      SELECT dc.id AS documento_id,
             DATE(COALESCE(NULLIF(dc.fecha_factura, ''), NULLIF(dc.fecha_ingreso, ''), dc.created_at)) AS fecha,
             dc.proveedor_documento, dc.proveedor_razon_social,
             dc.serie, dc.numero, dc.estado,
             COALESCE(tl.importe_estimado_pen, 0) AS importe_estimado_pen,
             COALESCE(tp.monto_pagado_pen, 0) AS monto_pagado_pen,
             ROUND(MAX(0, COALESCE(tl.importe_estimado_pen, 0) - COALESCE(tp.monto_pagado_pen, 0)), 2) AS saldo_pendiente_pen
      FROM documentos_compra dc
      LEFT JOIN totales_linea tl ON tl.documento_compra_id = dc.id
      LEFT JOIN totales_pago tp ON tp.documento_compra_id = dc.id
      WHERE dc.condicion_pago = 'credito'
        AND dc.estado NOT IN ('pagado', 'anulado')
        AND DATE(COALESCE(NULLIF(dc.fecha_factura, ''), NULLIF(dc.fecha_ingreso, ''), dc.created_at)) BETWEEN ? AND ?
      ORDER BY fecha ASC, dc.id ASC
    `).all(desde, hasta);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(recepciones), 'Recepciones');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cuentasPorPagar), 'Cuentas por pagar');
    const contenido = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="compras_${desde}_${hasta}.xlsx"`);
    res.send(contenido);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo generar el Excel de compras.' });
  }
});

// GET - Cuentas por pagar estimadas de compras a crédito no pagadas
router.get('/cuentas-por-pagar', (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!fechaISOValida(desde) || !fechaISOValida(hasta) || desde > hasta) {
      return res.status(400).json({ ok: false, error: 'Envía un rango válido con fechas YYYY-MM-DD, desde menor o igual a hasta.' });
    }

    const parametros = [desde, hasta];
    const baseSaldos = `
      WITH totales_linea AS (
        SELECT documento_compra_id, COUNT(*) AS lineas,
               ROUND(SUM(cantidad * costo_unitario), 2) AS importe_estimado_pen
        FROM detalle_documento_compra
        GROUP BY documento_compra_id
      ),
      totales_pago AS (
        SELECT documento_compra_id, ROUND(SUM(monto), 2) AS monto_pagado_pen
        FROM pagos_documento_compra
        GROUP BY documento_compra_id
      ),
      saldos AS (
        SELECT dc.id, dc.tipo, dc.serie, dc.numero, dc.estado, dc.fecha_factura,
               dc.fecha_ingreso, dc.created_at, dc.proveedor_documento,
               dc.proveedor_razon_social,
               COALESCE(tl.lineas, 0) AS lineas,
               COALESCE(tl.importe_estimado_pen, 0) AS importe_estimado_pen,
               COALESCE(tp.monto_pagado_pen, 0) AS monto_pagado_pen,
               ROUND(MAX(0, COALESCE(tl.importe_estimado_pen, 0) - COALESCE(tp.monto_pagado_pen, 0)), 2) AS saldo_pendiente_pen
        FROM documentos_compra dc
        LEFT JOIN totales_linea tl ON tl.documento_compra_id = dc.id
        LEFT JOIN totales_pago tp ON tp.documento_compra_id = dc.id
        WHERE dc.condicion_pago = 'credito'
          AND dc.estado NOT IN ('pagado', 'anulado')
          AND DATE(COALESCE(dc.fecha_factura, dc.fecha_ingreso, dc.created_at)) BETWEEN ? AND ?
      )
    `;
    const resumen = db.prepare(`${baseSaldos}
      SELECT COUNT(*) AS total_documentos,
             COALESCE(SUM(lineas), 0) AS total_lineas,
             ROUND(COALESCE(SUM(importe_estimado_pen), 0), 2) AS importe_estimado_pen,
             ROUND(COALESCE(SUM(monto_pagado_pen), 0), 2) AS monto_pagado_pen,
             ROUND(COALESCE(SUM(saldo_pendiente_pen), 0), 2) AS saldo_estimado_pen
      FROM saldos
    `).get(...parametros);

    const porProveedor = db.prepare(`${baseSaldos}
      SELECT proveedor_documento, proveedor_razon_social,
             COUNT(*) AS documentos,
             SUM(lineas) AS lineas,
             ROUND(SUM(importe_estimado_pen), 2) AS importe_estimado_pen,
             ROUND(SUM(monto_pagado_pen), 2) AS monto_pagado_pen,
             ROUND(SUM(saldo_pendiente_pen), 2) AS saldo_estimado_pen
      FROM saldos
      GROUP BY proveedor_documento, proveedor_razon_social
      ORDER BY saldo_estimado_pen DESC, proveedor_razon_social COLLATE NOCASE ASC
    `).all(...parametros);

    const documentos = db.prepare(`${baseSaldos}
      SELECT * FROM saldos
      ORDER BY COALESCE(fecha_factura, fecha_ingreso, created_at) ASC, id ASC
    `).all(...parametros);

    res.json({
      ok: true,
      periodo: { desde, hasta },
      resumen,
      por_proveedor: porProveedor,
      documentos,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Reporte personalizado por rango de fechas
router.get('/rango', (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, error: 'Debes enviar los parámetros desde y hasta' });
    }

    const resumen = db.prepare(`
      SELECT
        COUNT(*) as total_facturas,
        ROUND(SUM(subtotal), 2) as subtotal,
        ROUND(SUM(igv), 2) as igv,
        ROUND(SUM(total), 2) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND DATE(fecha) BETWEEN ? AND ? AND estado != 'anulado'
    `).get(desde, hasta);

    const porDia = db.prepare(`
      SELECT
        DATE(fecha) as dia,
        COUNT(*) as facturas,
        ROUND(SUM(total), 2) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND DATE(fecha) BETWEEN ? AND ? AND estado != 'anulado'
      GROUP BY DATE(fecha)
      ORDER BY dia ASC
    `).all(desde, hasta);

    const productosTop = db.prepare(`
      SELECT
        p.nombre,
        SUM(d.cantidad) as unidades,
        ROUND(SUM(d.subtotal), 2) as ingresos
      FROM detalle_comprobante d
      JOIN productos p ON d.producto_id = p.id
      JOIN comprobantes c ON d.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta} AND DATE(c.fecha) BETWEEN ? AND ? AND c.estado != 'anulado'
      GROUP BY p.id
      ORDER BY ingresos DESC
      LIMIT 5
    `).all(desde, hasta);

    res.json({
      ok: true,
      periodo: { desde, hasta },
      resumen,
      ventas_por_dia: porDia,
      top_productos: productosTop
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;