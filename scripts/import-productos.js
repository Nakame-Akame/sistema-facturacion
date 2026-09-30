const path = require('node:path');
const XLSX = require('xlsx');
const db = require('../database');

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: node scripts/import-productos.js <archivo.xls>');
  process.exitCode = 1;
} else {
  const libro = XLSX.readFile(path.resolve(archivo), { cellDates: true });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { defval: null, raw: true });
  const insertar = db.prepare(`
    INSERT INTO productos (nombre, descripcion, precio, precio_rebaja, precio_pase, precio_compra, stock, categoria)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const actualizar = db.prepare(`
    UPDATE productos
    SET descripcion = ?, precio = ?, precio_rebaja = ?, precio_pase = ?, precio_compra = ?, stock = ?, categoria = ?
    WHERE lower(nombre) = lower(?)
  `);
  const buscar = db.prepare('SELECT id FROM productos WHERE lower(nombre) = lower(?)');
  const resultados = { insertados: 0, actualizados: 0, omitidos: [], stockAjustado: 0, duplicados: 0 };
  const nombresProcesados = new Set();

  const importar = db.transaction(() => {
    for (const [indice, fila] of filas.entries()) {
      const nombre = typeof fila.Producto === 'string' ? fila.Producto.trim() : '';
      const precio = Number(fila['Precio Unidad']);
      const precioRebaja = Number(fila['Precio Mayor']) || precio;
      const precioPase = Number(fila['Precio Especial']) || precio;
      const precioCompra = Number(fila['Precio Compra Promedio']) || 0;
      const stockOriginal = Number(fila['Stock Real']);
      const filaExcel = indice + 2;

      if (!nombre || !Number.isFinite(precio) || precio <= 0) {
        resultados.omitidos.push({ fila: filaExcel, nombre, motivo: 'sin nombre o precio de venta válido' });
        continue;
      }
      if (!Number.isFinite(stockOriginal)) {
        resultados.omitidos.push({ fila: filaExcel, nombre, motivo: 'stock no numérico' });
        continue;
      }

      const clave = nombre.toLocaleLowerCase();
      if (nombresProcesados.has(clave)) {
        resultados.duplicados++;
        continue;
      }
      nombresProcesados.add(clave);

      const stock = Math.max(0, Math.trunc(stockOriginal));
      if (stock !== stockOriginal) resultados.stockAjustado++;
      const datos = [
        null,
        Math.round(precio * 100) / 100,
        Math.round(precioRebaja * 100) / 100,
        Math.round(precioPase * 100) / 100,
        Math.round(precioCompra * 100) / 100,
        stock,
        fila.Familia || null,
      ];
      const existente = buscar.get(nombre);
      if (existente) {
        actualizar.run(datos[0], datos[1], datos[2], datos[3], datos[4], datos[5], datos[6], nombre);
        resultados.actualizados++;
      } else {
        insertar.run(nombre, fila.Marca ? `Marca: ${fila.Marca}` : null, datos[1], datos[2], datos[3], datos[4], datos[5], datos[6]);
        resultados.insertados++;
      }
    }
  });

  try {
    importar.immediate();
    console.log(JSON.stringify({ ...resultados, totalFilas: filas.length }, null, 2));
  } finally {
    db.close();
  }
}