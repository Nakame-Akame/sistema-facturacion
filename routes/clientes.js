const express = require('express');
const router = express.Router();
const db = require('../database');

// GET - Listar todos los clientes
router.get('/', (req, res) => {
  try {
    const clientes = db.prepare('SELECT * FROM clientes ORDER BY nombre ASC').all();
    res.json({ ok: true, data: clientes });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Obtener un cliente por ID
router.get('/:id', (req, res) => {
  try {
    const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    res.json({ ok: true, data: cliente });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Crear nuevo cliente
router.post('/', (req, res) => {
  try {
    const { nombre, documento, direccion, email, telefono } = req.body;
    if (!nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });

    const result = db.prepare(`
      INSERT INTO clientes (nombre, documento, direccion, email, telefono)
      VALUES (?, ?, ?, ?, ?)
    `).run(nombre, documento, direccion, email, telefono);

    res.status(201).json({ ok: true, id: result.lastInsertRowid, mensaje: 'Cliente creado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT - Actualizar cliente
router.put('/:id', (req, res) => {
  try {
    const { nombre, documento, direccion, email, telefono } = req.body;
    const existe = db.prepare('SELECT id FROM clientes WHERE id = ?').get(req.params.id);
    if (!existe) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });

    db.prepare(`
      UPDATE clientes SET nombre=?, documento=?, direccion=?, email=?, telefono=?
      WHERE id=?
    `).run(nombre, documento, direccion, email, telefono, req.params.id);

    res.json({ ok: true, mensaje: 'Cliente actualizado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE - Eliminar cliente
router.delete('/:id', (req, res) => {
  try {
    const existe = db.prepare('SELECT id FROM clientes WHERE id = ?').get(req.params.id);
    if (!existe) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });

    db.prepare('DELETE FROM clientes WHERE id = ?').run(req.params.id);
    res.json({ ok: true, mensaje: 'Cliente eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Buscar clientes por nombre o documento
router.get('/buscar/:texto', (req, res) => {
  try {
    const texto = `%${req.params.texto}%`;
    const clientes = db.prepare(`
      SELECT * FROM clientes 
      WHERE nombre LIKE ? OR documento LIKE ? OR email LIKE ?
      ORDER BY nombre ASC
    `).all(texto, texto, texto);
    res.json({ ok: true, data: clientes, total: clientes.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
