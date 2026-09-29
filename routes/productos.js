const express = require('express');
const router = express.Router();
const db = require('../database');
const { requierePermiso } = require('../middleware/permisos');
const { aCentimos, desdeCentimos } = require('../services/comprobantes');

function normalizarPrecio(precio) {
  const valor = Number(precio);
  if (!Number.isFinite(valor) || valor <= 0 || valor > 1000000000) return null;
  const redondeado = desdeCentimos(aCentimos(precio, 'El precio'));
  return redondeado > 0 ? redondeado : null;
}

function normalizarStock(stock) {
  const valor = stock === undefined ? 0 : Number(stock);
  if (!Number.isSafeInteger(valor) || valor < 0) return null;
  return valor;
}

// GET - Listar todos los productos
router.get('/', requierePermiso('productos:ver'), (req, res) => {
  try {
    const productos = db.prepare('SELECT * FROM productos ORDER BY nombre ASC').all();
    res.json({ ok: true, data: productos });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Obtener un producto por ID
router.get('/:id', requierePermiso('productos:ver'), (req, res) => {
  try {
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
    if (!producto) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    res.json({ ok: true, data: producto });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// POST - Crear nuevo producto
router.post('/', requierePermiso('productos:crear'), (req, res) => {
  try {
    const { nombre, descripcion, precio, stock, categoria } = req.body;
    const nombreNormalizado = typeof nombre === 'string' ? nombre.trim() : '';
    const precioNormalizado = normalizarPrecio(precio);
    const stockNormalizado = normalizarStock(stock);
    if (!nombreNormalizado) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
    if (nombreNormalizado.length > 200) return res.status(400).json({ ok: false, error: 'El nombre es demasiado largo' });
    if (precioNormalizado === null) return res.status(400).json({ ok: false, error: 'El precio debe ser positivo y válido' });
    if (stockNormalizado === null) return res.status(400).json({ ok: false, error: 'El stock debe ser un entero no negativo' });

    const result = db.prepare(`
      INSERT INTO productos (nombre, descripcion, precio, stock, categoria)
      VALUES (?, ?, ?, ?, ?)
    `).run(nombreNormalizado, descripcion, precioNormalizado, stockNormalizado, categoria);

    res.status(201).json({ ok: true, id: result.lastInsertRowid, mensaje: 'Producto creado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// PUT - Actualizar producto
router.put('/:id', requierePermiso('productos:editar'), (req, res) => {
  try {
    const { nombre, descripcion, precio, stock, categoria } = req.body;
    const nombreNormalizado = typeof nombre === 'string' ? nombre.trim() : '';
    const precioNormalizado = normalizarPrecio(precio);
    const stockNormalizado = normalizarStock(stock);
    if (!nombreNormalizado) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
    if (nombreNormalizado.length > 200) return res.status(400).json({ ok: false, error: 'El nombre es demasiado largo' });
    if (precioNormalizado === null) return res.status(400).json({ ok: false, error: 'El precio debe ser positivo y válido' });
    if (stockNormalizado === null) return res.status(400).json({ ok: false, error: 'El stock debe ser un entero no negativo' });
    const existe = db.prepare('SELECT id FROM productos WHERE id = ?').get(req.params.id);
    if (!existe) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    db.prepare(`
      UPDATE productos SET nombre=?, descripcion=?, precio=?, stock=?, categoria=?
      WHERE id=?
    `).run(nombreNormalizado, descripcion, precioNormalizado, stockNormalizado, categoria, req.params.id);

    res.json({ ok: true, mensaje: 'Producto actualizado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// DELETE - Eliminar producto
router.delete('/:id', requierePermiso('productos:eliminar'), (req, res) => {
  try {
    const existe = db.prepare('SELECT id FROM productos WHERE id = ?').get(req.params.id);
    if (!existe) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    db.prepare('DELETE FROM productos WHERE id = ?').run(req.params.id);
    res.json({ ok: true, mensaje: 'Producto eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Buscar productos por nombre o categoria
router.get('/buscar/:texto', requierePermiso('productos:ver'), (req, res) => {
  try {
    const texto = `%${req.params.texto}%`;
    const productos = db.prepare(`
      SELECT * FROM productos
      WHERE nombre LIKE ? OR categoria LIKE ? OR descripcion LIKE ?
      ORDER BY nombre ASC
    `).all(texto, texto, texto);
    res.json({ ok: true, data: productos, total: productos.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Productos con stock bajo (menos de 5 unidades)
router.get('/alertas/stock-bajo', requierePermiso('productos:ver'), (req, res) => {
  try {
    const productos = db.prepare(`
      SELECT * FROM productos WHERE stock <= 5 ORDER BY stock ASC
    `).all();
    res.json({ ok: true, data: productos, total: productos.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// PATCH - Ajustar stock manualmente
router.patch('/:id/stock', requierePermiso('productos:ajustar_stock'), (req, res) => {
  try {
    const { cantidad, operacion } = req.body;
    const cantidadNormalizada = Number(cantidad);
    if (!Number.isSafeInteger(cantidadNormalizada) || cantidadNormalizada <= 0) {
      return res.status(400).json({ ok: false, error: 'La cantidad debe ser un entero positivo' });
    }
    if (!['sumar', 'restar'].includes(operacion)) {
      return res.status(400).json({ ok: false, error: 'La operación debe ser sumar o restar' });
    }

    const ajustar = db.transaction(() => {
      const producto = db.prepare('SELECT id, stock FROM productos WHERE id = ?').get(req.params.id);
      if (!producto) return { error: 'Producto no encontrado', status: 404 };

      if (operacion === 'restar' && producto.stock < cantidadNormalizada) {
        return { error: 'Stock insuficiente', status: 400 };
      }

      const delta = operacion === 'sumar' ? cantidadNormalizada : -cantidadNormalizada;
      db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?').run(delta, producto.id);
      return {
        stockAnterior: producto.stock,
        stockNuevo: producto.stock + delta,
      };
    });
    const resultado = ajustar.immediate();
    if (resultado.error) return res.status(resultado.status).json({ ok: false, error: resultado.error });

    res.json({
      ok: true,
      mensaje: 'Stock actualizado',
      stock_anterior: resultado.stockAnterior,
      stock_nuevo: resultado.stockNuevo,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Listar todas las categorias existentes
router.get('/categorias/lista', requierePermiso('productos:ver'), (req, res) => {
  try {
    const categorias = db.prepare(`
      SELECT DISTINCT categoria FROM productos 
      WHERE categoria IS NOT NULL 
      ORDER BY categoria ASC
    `).all();
    res.json({ ok: true, data: categorias.map(c => c.categoria) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;