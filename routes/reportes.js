const express = require('express');
const router = express.Router();
const db = require('../database');

// GET - Resumen general del negocio
router.get('/resumen', (req, res) => {
  try {
    const totalClientes = db.prepare('SELECT COUNT(*) as total FROM clientes').get();
    const totalProductos = db.prepare('SELECT COUNT(*) as total FROM productos').get();
    const totalFacturas = db.prepare("SELECT COUNT(*) as total FROM facturas WHERE estado != 'anulada'").get();
    const ventasHoy = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total 
      FROM facturas 
      WHERE DATE(fecha) = DATE('now') AND estado != 'anulada'
    `).get();
    const ventasMes = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total 
      FROM facturas 
      WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now') AND estado != 'anulada'
    `).get();
    const ventasTotales = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total 
      FROM facturas WHERE estado != 'anulada'
    `).get();
    const stockBajo = db.prepare('SELECT COUNT(*) as total FROM productos WHERE stock <= 5').get();

    res.json({
      ok: true,
      data: {
        clientes: totalClientes.total,
        productos: totalProductos.total,
        facturas: totalFacturas.total,
        ventas_hoy: parseFloat(ventasHoy.total.toFixed(2)),
        ventas_mes: parseFloat(ventasMes.total.toFixed(2)),
        ventas_totales: parseFloat(ventasTotales.total.toFixed(2)),
        productos_stock_bajo: stockBajo.total
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
      FROM facturas
      WHERE estado != 'anulada'
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
      FROM facturas
      WHERE estado != 'anulada'
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
        SUM(df.cantidad) as unidades_vendidas,
        ROUND(SUM(df.subtotal), 2) as ingresos_generados
      FROM detalle_factura df
      JOIN productos p ON df.producto_id = p.id
      JOIN facturas f ON df.factura_id = f.id
      WHERE f.estado != 'anulada'
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
        c.id,
        c.nombre,
        c.documento,
        c.email,
        COUNT(f.id) as total_facturas,
        ROUND(SUM(f.total), 2) as total_compras
      FROM clientes c
      JOIN facturas f ON f.cliente_id = c.id
      WHERE f.estado != 'anulada'
      GROUP BY c.id
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
        COUNT(DISTINCT f.id) as facturas,
        SUM(df.cantidad) as unidades_vendidas,
        ROUND(SUM(df.subtotal), 2) as ingresos
      FROM detalle_factura df
      JOIN productos p ON df.producto_id = p.id
      JOIN facturas f ON df.factura_id = f.id
      WHERE f.estado != 'anulada' AND p.categoria IS NOT NULL
      GROUP BY p.categoria
      ORDER BY ingresos DESC
    `).all();
    res.json({ ok: true, data: categorias });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Facturas por estado (emitida, pagada, anulada)
router.get('/facturas-por-estado', (req, res) => {
  try {
    const estados = db.prepare(`
      SELECT 
        estado,
        COUNT(*) as cantidad,
        ROUND(SUM(total), 2) as monto_total
      FROM facturas
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
      FROM facturas
      WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now')
        AND estado != 'anulada'
      GROUP BY mes
    `).get();
    res.json({ ok: true, data: igv || { mes: null, facturas: 0, base_imponible: 0, igv_total: 0, total_con_igv: 0 } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Reporte personalizado por rango de fechas
// Uso: /api/reportes/rango?desde=2024-01-01&hasta=2024-12-31
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
      FROM facturas
      WHERE DATE(fecha) BETWEEN ? AND ? AND estado != 'anulada'
    `).get(desde, hasta);

    const porDia = db.prepare(`
      SELECT 
        DATE(fecha) as dia,
        COUNT(*) as facturas,
        ROUND(SUM(total), 2) as total
      FROM facturas
      WHERE DATE(fecha) BETWEEN ? AND ? AND estado != 'anulada'
      GROUP BY DATE(fecha)
      ORDER BY dia ASC
    `).all(desde, hasta);

    const productosTop = db.prepare(`
      SELECT 
        p.nombre,
        SUM(df.cantidad) as unidades,
        ROUND(SUM(df.subtotal), 2) as ingresos
      FROM detalle_factura df
      JOIN productos p ON df.producto_id = p.id
      JOIN facturas f ON df.factura_id = f.id
      WHERE DATE(f.fecha) BETWEEN ? AND ? AND f.estado != 'anulada'
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