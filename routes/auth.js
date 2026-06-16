const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const db       = require('../database');

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

// Crear usuario admin por defecto si no existe
const adminExiste = db.prepare("SELECT id FROM usuarios WHERE email = 'admin@facturapro.com'").get();
if (!adminExiste) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`
    INSERT INTO usuarios (nombre, email, password, rol)
    VALUES (?, ?, ?, ?)
  `).run('Administrador', 'admin@facturapro.com', hash, 'admin');
  console.log('✓ Usuario admin creado → admin@facturapro.com / admin123');
}

// POST - Login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ ok: false, error: 'Email y contraseña son requeridos' });

    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!usuario)
      return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos' });

    const valido = bcrypt.compareSync(password, usuario.password);
    if (!valido)
      return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos' });

    req.session.usuario = {
      id:     usuario.id,
      nombre: usuario.nombre,
      email:  usuario.email,
      rol:    usuario.rol,
    };

    res.json({ ok: true, usuario: req.session.usuario, mensaje: 'Sesión iniciada' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST - Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
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
router.post('/usuarios', (req, res) => {
  try {
    if (!req.session.usuario || req.session.usuario.rol !== 'admin')
      return res.status(403).json({ ok: false, error: 'Solo el admin puede crear usuarios' });

    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password)
      return res.status(400).json({ ok: false, error: 'Nombre, email y contraseña son requeridos' });

    const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (existe)
      return res.status(400).json({ ok: false, error: 'Ya existe un usuario con ese email' });

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO usuarios (nombre, email, password, rol)
      VALUES (?, ?, ?, ?)
    `).run(nombre, email, hash, rol || 'vendedor');

    res.status(201).json({ ok: true, id: result.lastInsertRowid, mensaje: 'Usuario creado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET - Listar usuarios (solo admin)
router.get('/usuarios', (req, res) => {
  try {
    if (!req.session.usuario || req.session.usuario.rol !== 'admin')
      return res.status(403).json({ ok: false, error: 'Acceso denegado' });

    const usuarios = db.prepare(`
      SELECT id, nombre, email, rol, created_at FROM usuarios ORDER BY nombre ASC
    `).all();
    res.json({ ok: true, data: usuarios });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE - Eliminar usuario (solo admin, no puede eliminarse a sí mismo)
router.delete('/usuarios/:id', (req, res) => {
  try {
    if (!req.session.usuario || req.session.usuario.rol !== 'admin')
      return res.status(403).json({ ok: false, error: 'Acceso denegado' });

    if (parseInt(req.params.id) === req.session.usuario.id)
      return res.status(400).json({ ok: false, error: 'No puedes eliminarte a ti mismo' });

    db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.params.id);
    res.json({ ok: true, mensaje: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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

    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.session.usuario.id);
    const valido  = bcrypt.compareSync(password_actual, usuario.password);
    if (!valido)
      return res.status(401).json({ ok: false, error: 'La contraseña actual es incorrecta' });

    const nuevoHash = bcrypt.hashSync(password_nuevo, 10);
    db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(nuevoHash, usuario.id);
    res.json({ ok: true, mensaje: 'Contraseña actualizada' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;