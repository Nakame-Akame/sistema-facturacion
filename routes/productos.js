const express = require('express');
const router = express.Router();
const db = require('../database');

// GET - Listar todos los productos
router.get('/', (req, res) => {
  try {
    const productos = db.prepare('SELECT * FROM productos ORDER BY nombre ASC').all();
    res.json({ ok: true, data: productos });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Obtener un producto por ID
router.get('/:id', (req, res) => {
  try {
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
    if (!producto) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    res.json({ ok: true, data: producto });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Crear nuevo producto
router.post('/', (req, res) => {
  try {
    const { nombre, descripcion, precio, stock, categoria } = req.body;
    if (!nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
    if (!precio || precio <= 0) return res.status(400).json({ ok: false, error: 'El precio debe ser mayor a 0' });

    const result = db.prepare(`
      INSERT INTO productos (nombre, descripcion, precio, stock, categoria)
      VALUES (?, ?, ?, ?, ?)
    `).run(nombre, descripcion, precio, stock || 0, categoria);

    res.status(201).json({ ok: true, id: result.lastInsertRowid, mensaje: 'Producto creado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT - Actualizar producto
router.put('/:id', (req, res) => {
  try {
    const { nombre, descripcion, precio, stock, categoria } = req.body;
    const existe = db.prepare('SELECT id FROM productos WHERE id = ?').get(req.params.id);
    if (!existe) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    db.prepare(`
      UPDATE productos SET nombre=?, descripcion=?, precio=?, stock=?, categoria=?
      WHERE id=?
    `).run(nombre, descripcion, precio, stock, categoria, req.params.id);

    res.json({ ok: true, mensaje: 'Producto actualizado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE - Eliminar producto
router.delete('/:id', (req, res) => {
  try {
    const existe = db.prepare('SELECT id FROM productos WHERE id = ?').get(req.params.id);
    if (!existe) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    db.prepare('DELETE FROM productos WHERE id = ?').run(req.params.id);
    res.json({ ok: true, mensaje: 'Producto eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Buscar productos por nombre o categoria
router.get('/buscar/:texto', (req, res) => {
  try {
    const texto = `%${req.params.texto}%`;
    const productos = db.prepare(`
      SELECT * FROM productos
      WHERE nombre LIKE ? OR categoria LIKE ? OR descripcion LIKE ?
      ORDER BY nombre ASC
    `).all(texto, texto, texto);
    res.json({ ok: true, data: productos, total: productos.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Productos con stock bajo (menos de 5 unidades)
router.get('/alertas/stock-bajo', (req, res) => {
  try {
    const productos = db.prepare(`
      SELECT * FROM productos WHERE stock <= 5 ORDER BY stock ASC
    `).all();
    res.json({ ok: true, data: productos, total: productos.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH - Ajustar stock manualmente
router.patch('/:id/stock', (req, res) => {
  try {
    const { cantidad, operacion } = req.body; // operacion: 'sumar' o 'restar'
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
    if (!producto) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    let nuevoStock;
    if (operacion === 'sumar') {
      nuevoStock = producto.stock + cantidad;
    } else if (operacion === 'restar') {
      nuevoStock = producto.stock - cantidad;
      if (nuevoStock < 0) return res.status(400).json({ ok: false, error: 'Stock insuficiente' });
    } else {
      return res.status(400).json({ ok: false, error: 'Operacion debe ser sumar o restar' });
    }

    db.prepare('UPDATE productos SET stock=? WHERE id=?').run(nuevoStock, req.params.id);
    res.json({ ok: true, mensaje: 'Stock actualizado', stock_anterior: producto.stock, stock_nuevo: nuevoStock });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Listar todas las categorias existentes
router.get('/categorias/lista', (req, res) => {
  try {
    const categorias = db.prepare(`
      SELECT DISTINCT categoria FROM productos 
      WHERE categoria IS NOT NULL 
      ORDER BY categoria ASC
    `).all();
    res.json({ ok: true, data: categorias.map(c => c.categoria) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;