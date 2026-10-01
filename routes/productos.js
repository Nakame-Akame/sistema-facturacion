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

function normalizarCosto(costo) {
  const valor = costo === undefined ? 0 : Number(costo);
  if (!Number.isFinite(valor) || valor < 0 || valor > 1000000000) return null;
  return desdeCentimos(aCentimos(valor, 'El precio de compra'));
}

function normalizarPrecios(precios) {
  const precioUnidad = normalizarPrecio(precios.precio);
  const precioRebaja = normalizarPrecio(precios.precio_rebaja ?? precios.precio);
  const precioPase = normalizarPrecio(precios.precio_pase ?? precios.precio);
  return { precioUnidad, precioRebaja, precioPase };
}

function normalizarTexto(valor, { maxLength = 200, permitirVacio = false } = {}) {
  if (valor === undefined || valor === null) {
    return permitirVacio ? '' : null;
  }

  const texto = String(valor).trim();
  if (!texto && !permitirVacio) return null;
  if (texto.length > maxLength) return texto.slice(0, maxLength);
  return texto;
}

function normalizarBoolean(valor, defecto = true) {
  if (valor === undefined || valor === null) return defecto;
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'string') {
    const texto = valor.trim().toLowerCase();
    if (['1', 'true', 'yes', 'si', 'on'].includes(texto)) return true;
    if (['0', 'false', 'no', 'off'].includes(texto)) return false;
  }
  if (typeof valor === 'number') return Boolean(valor);
  return defecto;
}

function obtenerCamposProducto(payload = {}) {
  const nombreNormalizado = normalizarTexto(payload.nombre, { maxLength: 200 });
  const descripcion = normalizarTexto(payload.descripcion, { maxLength: 500, permitirVacio: true }) || null;
  const codigoInterno = normalizarTexto(payload.codigo_interno, { maxLength: 80, permitirVacio: true }) || null;
  const sku = normalizarTexto(payload.sku, { maxLength: 100, permitirVacio: true }) || null;
  const codigoBarras = normalizarTexto(payload.codigo_barras, { maxLength: 100, permitirVacio: true }) || null;
  const marca = normalizarTexto(payload.marca, { maxLength: 100, permitirVacio: true }) || null;
  const categoria = normalizarTexto(payload.categoria, { maxLength: 100, permitirVacio: true }) || null;
  const unidadMedida = normalizarTexto(payload.unidad_medida, { maxLength: 20, permitirVacio: true }) || 'UND';
  const precioCompra = normalizarCosto(payload.precio_compra);
  const stockNormalizado = normalizarStock(payload.stock ?? 0);
  const stockMinimo = normalizarStock(payload.stock_minimo ?? 0);
  const stockMaximo = normalizarStock(payload.stock_maximo ?? 0);
  const imagen = normalizarTexto(payload.imagen, { maxLength: 500, permitirVacio: true }) || null;
  const activo = normalizarBoolean(payload.activo, true);
  const igv = normalizarBoolean(payload.igv, true);
  const ubicacion = normalizarTexto(payload.ubicacion, { maxLength: 200, permitirVacio: true }) || null;
  const proveedorPrincipal = normalizarTexto(payload.proveedor_principal, { maxLength: 200, permitirVacio: true }) || null;
  const precios = normalizarPrecios({
    precio: payload.precio,
    precio_rebaja: payload.precio_rebaja,
    precio_pase: payload.precio_pase,
  });

  return {
    nombre: nombreNormalizado,
    descripcion,
    codigoInterno,
    sku,
    codigoBarras,
    marca,
    categoria,
    unidadMedida,
    precioCompra,
    stockNormalizado,
    stockMinimo,
    stockMaximo,
    imagen,
    activo,
    igv,
    ubicacion,
    proveedorPrincipal,
    precios,
  };
}

function validarDuplicadoProducto({ codigoInterno, sku, codigoBarras }, excluirId = null) {
  const candidatos = [];
  if (codigoInterno) candidatos.push({ campo: 'codigo_interno', valor: codigoInterno });
  if (sku) candidatos.push({ campo: 'sku', valor: sku });
  if (codigoBarras) candidatos.push({ campo: 'codigo_barras', valor: codigoBarras });

  for (const candidato of candidatos) {
    const producto = db.prepare(`
      SELECT id, ${candidato.campo} AS valor
      FROM productos
      WHERE lower(COALESCE(${candidato.campo}, '')) = lower(?)
      ${excluirId ? 'AND id != ?' : ''}
    `).get(candidato.valor, ...(excluirId ? [excluirId] : []));

    if (producto) {
      return { campo: candidato.campo, valor: candidato.valor };
    }
  }

  return null;
}

function armarCondicionBusqueda(search = '') {
  const texto = String(search || '').trim();
  if (!texto) return { where: '', params: [] };
  const valor = `%${texto.toLowerCase()}%`;
  return {
    where: `(
      lower(nombre) LIKE ? OR
      lower(codigo_interno) LIKE ? OR
      lower(sku) LIKE ? OR
      lower(codigo_barras) LIKE ? OR
      lower(marca) LIKE ? OR
      lower(categoria) LIKE ? OR
      lower(ubicacion) LIKE ?
    )`,
    params: [valor, valor, valor, valor, valor, valor, valor],
  };
}

// GET - Listar todos los productos
router.get('/', requierePermiso('productos:ver'), (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const categoria = typeof req.query.categoria === 'string' ? req.query.categoria.trim() : '';
    const activo = req.query.activo === undefined ? null : normalizarBoolean(req.query.activo, true);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const sort = ['nombre', 'precio', 'stock', 'precio_compra', 'categoria', 'marca', 'created_at'].includes(req.query.sort) ? req.query.sort : 'nombre';
    const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

    const whereClauses = [];
    const params = [];

    const busqueda = armarCondicionBusqueda(search);
    if (busqueda.where) {
      whereClauses.push(busqueda.where);
      params.push(...busqueda.params);
    }
    if (categoria) {
      whereClauses.push('lower(categoria) = lower(?)');
      params.push(categoria);
    }
    if (activo !== null) {
      whereClauses.push('activo = ?');
      params.push(activo ? 1 : 0);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS total FROM productos ${whereSql}`).get(...params).total;
    const productos = db.prepare(`
      SELECT * FROM productos
      ${whereSql}
      ORDER BY ${sort} ${order}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ ok: true, data: productos, total, limit, offset });
  } catch (err) {
    console.error('Error al listar productos:', err);
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
    const producto = obtenerCamposProducto(req.body);
    if (!producto.nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
    if (Object.values(producto.precios).some(precioProducto => precioProducto === null)) {
      return res.status(400).json({ ok: false, error: 'Los precios deben ser positivos y válidos' });
    }
    if (producto.precioCompra === null) return res.status(400).json({ ok: false, error: 'El precio de compra no es válido' });
    if (producto.stockNormalizado === null) return res.status(400).json({ ok: false, error: 'El stock debe ser un entero no negativo' });
    if (producto.stockMinimo === null || producto.stockMaximo === null) {
      return res.status(400).json({ ok: false, error: 'Los stocks mínimo y máximo deben ser enteros no negativos' });
    }

    const duplicado = validarDuplicadoProducto({
      codigoInterno: producto.codigoInterno,
      sku: producto.sku,
      codigoBarras: producto.codigoBarras,
    });
    if (duplicado) {
      return res.status(409).json({ ok: false, error: `Ya existe otro producto con el mismo ${duplicado.campo.replace('_', ' ')}` });
    }

    const result = db.prepare(`
      INSERT INTO productos (
        nombre, descripcion, codigo_interno, sku, codigo_barras, marca, categoria, unidad_medida,
        precio, precio_rebaja, precio_pase, precio_compra, stock, stock_minimo, stock_maximo,
        imagen, activo, igv, ubicacion, proveedor_principal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      producto.nombre,
      producto.descripcion,
      producto.codigoInterno,
      producto.sku,
      producto.codigoBarras,
      producto.marca,
      producto.categoria,
      producto.unidadMedida,
      producto.precios.precioUnidad,
      producto.precios.precioRebaja,
      producto.precios.precioPase,
      producto.precioCompra,
      producto.stockNormalizado,
      producto.stockMinimo,
      producto.stockMaximo,
      producto.imagen,
      producto.activo ? 1 : 0,
      producto.igv ? 1 : 0,
      producto.ubicacion,
      producto.proveedorPrincipal,
    );

    res.status(201).json({ ok: true, id: result.lastInsertRowid, mensaje: 'Producto creado' });
  } catch (err) {
    console.error('Error al crear producto:', err);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// PUT - Actualizar producto
router.put('/:id', requierePermiso('productos:editar'), (req, res) => {
  try {
    const existe = db.prepare('SELECT id FROM productos WHERE id = ?').get(req.params.id);
    if (!existe) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    const producto = obtenerCamposProducto(req.body);
    if (!producto.nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
    if (Object.values(producto.precios).some(precioProducto => precioProducto === null)) {
      return res.status(400).json({ ok: false, error: 'Los precios deben ser positivos y válidos' });
    }
    if (producto.precioCompra === null) return res.status(400).json({ ok: false, error: 'El precio de compra no es válido' });
    if (producto.stockNormalizado === null) return res.status(400).json({ ok: false, error: 'El stock debe ser un entero no negativo' });
    if (producto.stockMinimo === null || producto.stockMaximo === null) {
      return res.status(400).json({ ok: false, error: 'Los stocks mínimo y máximo deben ser enteros no negativos' });
    }

    const duplicado = validarDuplicadoProducto({
      codigoInterno: producto.codigoInterno,
      sku: producto.sku,
      codigoBarras: producto.codigoBarras,
    }, req.params.id);
    if (duplicado) {
      return res.status(409).json({ ok: false, error: `Ya existe otro producto con el mismo ${duplicado.campo.replace('_', ' ')}` });
    }

    db.prepare(`
      UPDATE productos SET
        nombre = ?, descripcion = ?, codigo_interno = ?, sku = ?, codigo_barras = ?, marca = ?,
        categoria = ?, unidad_medida = ?, precio = ?, precio_rebaja = ?, precio_pase = ?,
        precio_compra = ?, stock = ?, stock_minimo = ?, stock_maximo = ?, imagen = ?,
        activo = ?, igv = ?, ubicacion = ?, proveedor_principal = ?
      WHERE id = ?
    `).run(
      producto.nombre,
      producto.descripcion,
      producto.codigoInterno,
      producto.sku,
      producto.codigoBarras,
      producto.marca,
      producto.categoria,
      producto.unidadMedida,
      producto.precios.precioUnidad,
      producto.precios.precioRebaja,
      producto.precios.precioPase,
      producto.precioCompra,
      producto.stockNormalizado,
      producto.stockMinimo,
      producto.stockMaximo,
      producto.imagen,
      producto.activo ? 1 : 0,
      producto.igv ? 1 : 0,
      producto.ubicacion,
      producto.proveedorPrincipal,
      req.params.id,
    );

    res.json({ ok: true, mensaje: 'Producto actualizado' });
  } catch (err) {
    console.error('Error al actualizar producto:', err);
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
      WHERE nombre LIKE ? OR categoria LIKE ? OR descripcion LIKE ? OR codigo_interno LIKE ? OR sku LIKE ? OR codigo_barras LIKE ?
      ORDER BY nombre ASC
    `).all(texto, texto, texto, texto, texto, texto);
    res.json({ ok: true, data: productos, total: productos.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Productos con stock bajo (menos de 5 unidades)
router.get('/alertas/stock-bajo', requierePermiso('productos:ver'), (req, res) => {
  try {
    const productos = db.prepare(`
      SELECT * FROM productos WHERE stock <= COALESCE(stock_minimo, 0) OR stock <= 5 ORDER BY stock ASC
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
      WHERE categoria IS NOT NULL AND TRIM(categoria) != ''
      ORDER BY categoria ASC
    `).all();
    res.json({ ok: true, data: categorias.map(c => c.categoria) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;