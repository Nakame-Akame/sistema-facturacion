const express = require('express');
const db = require('../database');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

function leerProveedor(body) {
  const proveedor = {
    documento: String(body?.documento || '').trim().toUpperCase(),
    razon_social: String(body?.razon_social || '').trim(),
    direccion: String(body?.direccion || '').trim(),
    telefono: String(body?.telefono || '').trim(),
    email: String(body?.email || '').trim(),
  };

  if (!proveedor.documento || proveedor.documento.length > 30) {
    return { error: 'El documento es obligatorio y admite hasta 30 caracteres.' };
  }
  if (!proveedor.razon_social || proveedor.razon_social.length > 200) {
    return { error: 'La razón social es obligatoria y admite hasta 200 caracteres.' };
  }
  if (proveedor.direccion.length > 300 || proveedor.telefono.length > 50 || proveedor.email.length > 254) {
    return { error: 'Uno de los datos de contacto excede la longitud permitida.' };
  }
  if (proveedor.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proveedor.email)) {
    return { error: 'El correo electrónico no es válido.' };
  }

  return { proveedor };
}

function responderProveedor(res, id) {
  const proveedor = db.prepare('SELECT * FROM proveedores WHERE id = ?').get(id);
  return res.json({ ok: true, data: proveedor });
}

router.get('/', requierePermiso('compras:ver'), (req, res) => {
  const buscar = String(req.query.buscar || '').trim();
  const incluirInactivos = req.query.incluir_inactivos === 'true';
  const proveedores = db.prepare(`
    SELECT * FROM proveedores
    WHERE (? = 1 OR activo = 1)
      AND (? = '' OR documento LIKE '%' || ? || '%' COLLATE NOCASE
        OR razon_social LIKE '%' || ? || '%' COLLATE NOCASE)
    ORDER BY razon_social COLLATE NOCASE ASC, id ASC
  `).all(Number(incluirInactivos), buscar, buscar, buscar);
  res.json({ ok: true, data: proveedores });
});

router.post('/', requierePermiso('compras:crear'), (req, res) => {
  const resultado = leerProveedor(req.body);
  if (resultado.error) return res.status(400).json({ ok: false, error: resultado.error });

  try {
    const { proveedor } = resultado;
    const insertado = db.prepare(`
      INSERT INTO proveedores (documento, razon_social, direccion, telefono, email)
      VALUES (?, ?, ?, ?, ?)
    `).run(proveedor.documento, proveedor.razon_social, proveedor.direccion || null,
      proveedor.telefono || null, proveedor.email || null);
    return res.status(201).json({ ok: true, id: Number(insertado.lastInsertRowid), ...proveedor, activo: 1 });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ ok: false, error: 'Ya existe un proveedor con ese documento.' });
    }
    return res.status(500).json({ ok: false, error: 'No se pudo guardar el proveedor.' });
  }
});

router.put('/:id', requierePermiso('compras:crear'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Identificador no válido.' });
  const resultado = leerProveedor(req.body);
  if (resultado.error) return res.status(400).json({ ok: false, error: resultado.error });

  try {
    const { proveedor } = resultado;
    const actualizado = db.prepare(`
      UPDATE proveedores
      SET documento = ?, razon_social = ?, direccion = ?, telefono = ?, email = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(proveedor.documento, proveedor.razon_social, proveedor.direccion || null,
      proveedor.telefono || null, proveedor.email || null, id);
    if (!actualizado.changes) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado.' });
    return responderProveedor(res, id);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ ok: false, error: 'Ya existe un proveedor con ese documento.' });
    }
    return res.status(500).json({ ok: false, error: 'No se pudo actualizar el proveedor.' });
  }
});

router.patch('/:id/estado', requierePermiso('compras:crear'), (req, res) => {
  const id = Number(req.params.id);
  const activo = req.body?.activo;
  if (!Number.isInteger(id) || id <= 0 || typeof activo !== 'boolean') {
    return res.status(400).json({ ok: false, error: 'Identificador o estado no válido.' });
  }
  const actualizado = db.prepare(`
    UPDATE proveedores SET activo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(Number(activo), id);
  if (!actualizado.changes) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado.' });
  return responderProveedor(res, id);
});

module.exports = router;