const express = require('express');
const router = express.Router();
const db = require('../database');

// Tipos que representan una VENTA real (afectan ingresos)
const TIPOS_VENTA = ['factura', 'boleta'];
// Tipos que restan ingresos (notas de crédito y devoluciones)
const TIPOS_REVERSA = ['nota_credito_f', 'nota_credito_b', 'nota_devolucion'];

const enListaVenta = `('${TIPOS_VENTA.join("','")}')`;

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
    res.status(500).json({ ok: false, error: err.message });
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
    res.status(500).json({ ok: false, error: err.message });
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
    res.status(500).json({ ok: false, error: err.message });
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
    res.status(500).json({ ok: false, error: err.message });
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
    res.status(500).json({ ok: false, error: err.message });
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
    res.status(500).json({ ok: false, error: err.message });
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
    res.status(500).json({ ok: false, error: err.message });
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
    res.status(500).json({ ok: false, error: err.message });
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Créditos pendientes / próximos a vencer
router.get('/creditos-pendientes', (req, res) => {
  try {
    const data = db.prepare(`
      SELECT c.id, c.tipo, c.serie, c.numero, c.total, c.fecha_vencimiento,
             cl.nombre as cliente_nombre,
             CASE WHEN DATE(c.fecha_vencimiento) < DATE('now') THEN 1 ELSE 0 END as vencido
      FROM comprobantes c
      JOIN clientes cl ON c.cliente_id = cl.id
      WHERE c.tipo IN ${enListaVenta}
        AND c.condicion_pago = 'credito'
        AND c.estado = 'emitido'
      ORDER BY c.fecha_vencimiento ASC
    `).all();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;