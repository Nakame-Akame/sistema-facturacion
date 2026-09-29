const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const db       = require('../database');
const { ROLES_VALIDOS, requierePermiso } = require('../middleware/permisos');

// Crear tabla de usuarios si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'vendedor',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const columnasUsuarios = db.pragma('table_info(usuarios)');
if (!columnasUsuarios.some(columna => columna.name === 'created_at')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN created_at DATETIME');
}

// POST - Login
router.post('/login', (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body;
    if (!email || typeof password !== 'string' || !password)
      return res.status(400).json({ ok: false, error: 'Email y contraseña son requeridos' });

    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!usuario)
      return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos' });

    const valido = bcrypt.compareSync(password, usuario.password);
    if (!valido)
      return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos' });

    req.session.regenerate(err => {
      if (err) return res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión' });
      req.session.usuario = {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
      };
      req.session.save(saveError => {
        if (saveError) return res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión' });
        res.json({ ok: true, usuario: req.session.usuario, mensaje: 'Sesión iniciada' });
      });
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión' });
  }
});

// POST - Logout
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ ok: false, error: 'No se pudo cerrar sesión' });
    res.clearCookie('connect.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    res.json({ ok: true, mensaje: 'Sesión cerrada' });
  });
});

// GET - Verificar sesión activa
router.get('/me', (req, res) => {
  if (!req.session.usuario)
    return res.status(401).json({ ok: false, error: 'No autenticado' });
  res.json({ ok: true, usuario: req.session.usuario });
});

// POST - Crear nuevo usuario (solo admin)
router.post('/usuarios', requierePermiso('usuarios:administrar'), (req, res) => {
  try {
    const { nombre, password } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const rol = req.body.rol || 'vendedor';
    if (!nombre || !email || typeof password !== 'string')
      return res.status(400).json({ ok: false, error: 'Nombre, email y contraseña son requeridos' });
    if (password.length < 12)
      return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 12 caracteres' });
    if (!ROLES_VALIDOS.includes(rol))
      return res.status(400).json({ ok: false, error: 'Rol inválido' });

    const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (existe)
      return res.status(400).json({ ok: false, error: 'Ya existe un usuario con ese email' });

    const hash = bcrypt.hashSync(password, 12);
    const result = db.prepare(`
      INSERT INTO usuarios (nombre, email, password, rol)
      VALUES (?, ?, ?, ?)
    `).run(nombre, email, hash, rol || 'vendedor');

    res.status(201).json({ ok: true, id: result.lastInsertRowid, mensaje: 'Usuario creado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo crear el usuario' });
  }
});

// GET - Listar usuarios (solo admin)
router.get('/usuarios', requierePermiso('usuarios:administrar'), (req, res) => {
  try {
    const usuarios = db.prepare(`
      SELECT id, nombre, email, rol, created_at FROM usuarios ORDER BY nombre ASC
    `).all();
    res.json({ ok: true, data: usuarios });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo listar usuarios' });
  }
});

// DELETE - Eliminar usuario (solo admin, no puede eliminarse a sí mismo)
router.delete('/usuarios/:id', requierePermiso('usuarios:administrar'), (req, res) => {
  try {
    if (parseInt(req.params.id) === req.session.usuario.id)
      return res.status(400).json({ ok: false, error: 'No puedes eliminarte a ti mismo' });

    const usuario = db.prepare('SELECT id, rol FROM usuarios WHERE id = ?').get(req.params.id);
    if (!usuario) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    if (usuario.rol === 'admin' && db.prepare("SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin'").get().total <= 1) {
      return res.status(400).json({ ok: false, error: 'No se puede eliminar el último administrador' });
    }

    db.prepare('DELETE FROM usuarios WHERE id = ?').run(usuario.id);
    res.json({ ok: true, mensaje: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo eliminar el usuario' });
  }
});

// PUT - Cambiar contraseña
router.put('/cambiar-password', (req, res) => {
  try {
    if (!req.session.usuario)
      return res.status(401).json({ ok: false, error: 'No autenticado' });

    const { password_actual, password_nuevo } = req.body;
    if (!password_actual || !password_nuevo)
      return res.status(400).json({ ok: false, error: 'Ambas contraseñas son requeridas' });
    if (typeof password_nuevo !== 'string' || password_nuevo.length < 12)
      return res.status(400).json({ ok: false, error: 'La nueva contraseña debe tener al menos 12 caracteres' });

    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.session.usuario.id);
    if (!usuario) return res.status(401).json({ ok: false, error: 'No autenticado' });
    const valido  = bcrypt.compareSync(password_actual, usuario.password);
    if (!valido)
      return res.status(401).json({ ok: false, error: 'La contraseña actual es incorrecta' });

    const nuevoHash = bcrypt.hashSync(password_nuevo, 12);
    db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(nuevoHash, usuario.id);
    res.json({ ok: true, mensaje: 'Contraseña actualizada' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo cambiar la contraseña' });
  }
});

module.exports = router;